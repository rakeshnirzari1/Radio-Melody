import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import "./App.css";
import { Shuffle, Loader2, Radio, LocateFixed } from "lucide-react";
import { Toaster } from "sonner";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { getGeoStations, getStation } from "./lib/radioApi";
import GlobeView from "./components/GlobeView";
import Header from "./components/Header";
import PlayerBar from "./components/PlayerBar";
import SidePanel from "./components/SidePanel";
import NowPlayingCard from "./components/NowPlayingCard";
import GenreBar, { filterByGenre } from "./components/GenreBar";

const hav = (la1, lo1, la2, lo2) => {
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((la2 - la1) * p) / 2 +
    (Math.cos(la1 * p) * Math.cos(la2 * p) * (1 - Math.cos((lo2 - lo1) * p))) / 2;
  return 12742 * Math.asin(Math.sqrt(Math.max(0, a)));
};

const IntroLoader = ({ show }) => (
  <div
    className={`absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#05070a] transition-opacity duration-700 ${
      show ? "opacity-100" : "pointer-events-none opacity-0"
    }`}
  >
    <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
      <span className="absolute inset-0 rounded-full border border-[#2fe08a]/30 rm-pulse" />
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#2fe08a] text-[#05070a] shadow-[0_0_30px_rgba(47,224,138,0.6)]">
        <Radio size={28} />
      </span>
    </div>
    <div className="font-display text-2xl font-700 text-white">
      Radio<span className="text-[#2fe08a]">Melody</span>
    </div>
    <div className="mt-2 flex items-center gap-2 text-sm text-[#8497a0]">
      <Loader2 size={15} className="rm-spin" /> Tuning into the world…
    </div>
  </div>
);

const Hint = ({ show }) => (
  <div
    className={`pointer-events-none absolute bottom-40 left-1/2 z-20 -translate-x-1/2 text-center transition-opacity duration-700 ${
      show ? "opacity-100" : "opacity-0"
    }`}
  >
    <p className="font-display text-sm text-[#cfe8dd] drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
      Drag the globe · tap a <span className="text-[#37f59a]">glowing dot</span> ·
      press <span className="text-[#37f59a]">Space</span> to play
    </p>
  </div>
);

const RadioApp = () => {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState(null);
  const [focusStation, setFocusStation] = useState(null);
  const [cityStation, setCityStation] = useState(null);
  const [userLoc, setUserLoc] = useState(null);
  const [genre, setGenre] = useState("");
  const { current, play, toggle, resume, importFavorites } = usePlayer();

  const queueRef = useRef([]);
  const idxRef = useRef(0);
  const userChoseRef = useRef(false);
  const pendingAutoplayRef = useRef(false);
  const autoInitRef = useRef(false);

  const filtered = useMemo(() => filterByGenre(stations, genre), [stations, genre]);

  const sortNearest = useCallback(
    (lat, lng) =>
      [...stations]
        .filter((s) => s.lat != null && s.lng != null)
        .sort((a, b) => hav(lat, lng, a.lat, a.lng) - hav(lat, lng, b.lat, b.lng)),
    [stations]
  );

  useEffect(() => {
    let mounted = true;
    getGeoStations(5000)
      .then((data) => mounted && setStations(data))
      .catch(() => {})
      .finally(() => mounted && setTimeout(() => setLoading(false), 900));
    return () => {
      mounted = false;
    };
  }, []);

  // Keep a proximity queue in sync with the current station (for arrow-key hopping)
  useEffect(() => {
    if (!current) return;
    const q = queueRef.current;
    const found = q.findIndex((s) => s.id === current.id);
    if (found >= 0) {
      idxRef.current = found;
      return;
    }
    if (current.lat != null && stations.length) {
      const sorted = sortNearest(current.lat, current.lng).slice(0, 60);
      queueRef.current = sorted;
      idxRef.current = Math.max(0, sorted.findIndex((s) => s.id === current.id));
    } else {
      queueRef.current = [current, ...stations.slice(0, 59)];
      idxRef.current = 0;
    }
  }, [current, stations, sortNearest]);

  const hop = useCallback(
    (dir) => {
      const q = queueRef.current;
      if (!q.length) return;
      let n = idxRef.current + dir;
      if (n < 0) n = 0;
      if (n >= q.length) n = q.length - 1;
      idxRef.current = n;
      const s = q[n];
      if (s) {
        userChoseRef.current = true;
        play(s);
        setFocusStation({ ...s, _t: Date.now() });
        setCityStation(s);
      }
    },
    [play]
  );

  // Keyboard controls
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        hop(1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        hop(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, hop]);

  // Resume autoplay on the first user gesture (browser autoplay policy)
  useEffect(() => {
    const onGesture = () => {
      if (pendingAutoplayRef.current) {
        resume();
        pendingAutoplayRef.current = false;
      }
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [resume]);

  // Shareable single-station link: ?s=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("s");
    if (!sid) return;
    userChoseRef.current = true;
    getStation(sid)
      .then((s) => {
        if (s && s.id) {
          play(s);
          pendingAutoplayRef.current = true;
          if (s.lat != null) setFocusStation({ ...s, _t: Date.now() });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shareable favorites link: ?favs=<base64>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const favs = params.get("favs");
    if (!favs) return;
    try {
      const list = JSON.parse(decodeURIComponent(escape(atob(favs))));
      if (Array.isArray(list) && list.length) {
        importFavorites(list);
        userChoseRef.current = true;
        setPanel("favorites");
        const first = list[0];
        if (first && first.url) {
          play(first);
          pendingAutoplayRef.current = true;
          if (first.lat != null) setFocusStation({ ...first, _t: Date.now() });
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-play on load: nearest station if we get location, else random (never silent)
  useEffect(() => {
    if (!stations.length || autoInitRef.current) return;
    autoInitRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("s") || params.get("favs")) return;

    const rand = stations[Math.floor(Math.random() * Math.min(stations.length, 600))];
    if (rand) {
      play(rand);
      pendingAutoplayRef.current = true;
      setFocusStation({ ...rand, _t: Date.now() });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLoc(loc);
          if (!userChoseRef.current) {
            const near = sortNearest(loc.lat, loc.lng)[0];
            if (near) {
              play(near);
              pendingAutoplayRef.current = true;
              setFocusStation({ ...near, _t: Date.now() });
            }
          }
        },
        () => {},
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations]);

  const handleOpen = useCallback(
    (p) => setPanel((cur) => (cur === p ? null : p)),
    []
  );

  const handlePlayFocus = useCallback((station) => {
    userChoseRef.current = true;
    setFocusStation({ ...station, _t: Date.now() });
    setPanel(null);
  }, []);

  const handleStationClick = useCallback(
    (station) => {
      userChoseRef.current = true;
      play(station);
      setFocusStation({ ...station, _t: Date.now() });
      setCityStation(station);
      setPanel("city");
    },
    [play]
  );

  const surprise = useCallback(() => {
    if (!stations.length) return;
    userChoseRef.current = true;
    const s = stations[Math.floor(Math.random() * Math.min(stations.length, 800))];
    play(s);
    setFocusStation({ ...s, _t: Date.now() });
    setCityStation(s);
  }, [stations, play]);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(loc);
        userChoseRef.current = true;
        const near = sortNearest(loc.lat, loc.lng)[0];
        if (near) {
          play(near);
          setFocusStation({ ...near, _t: Date.now() });
          setCityStation(near);
        } else {
          setFocusStation({ ...loc, _t: Date.now() });
        }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [sortNearest, play]);

  return (
    <div className="App rm-star-field">
      <IntroLoader show={loading} />
      <GlobeView
        stations={filtered}
        focusStation={focusStation}
        userLoc={userLoc}
        onStationClick={handleStationClick}
      />
      <Hint show={!loading && !current} />

      <Header onOpen={handleOpen} activePanel={panel} onHome={() => setPanel(null)} />
      <GenreBar active={genre} onSelect={setGenre} />
      <NowPlayingCard />

      <div className="pointer-events-none absolute bottom-24 right-4 z-20 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        <button
          onClick={locateMe}
          className="group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 text-[#9fd8ff] transition-all hover:bg-[#7fd4ff]/15"
          title="Find my location & play the nearest station"
        >
          <LocateFixed size={17} className="transition-transform group-hover:scale-110" />
          <span className="hidden sm:inline">Locate me</span>
        </button>
        <button
          onClick={surprise}
          className="group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 text-[#7bf0b8] transition-all hover:bg-[#2fe08a]/15"
          title="Play a random station"
        >
          <Shuffle size={17} className="transition-transform group-hover:rotate-12" />
          <span className="hidden sm:inline">Surprise me</span>
        </button>
      </div>

      <PlayerBar />
      <SidePanel
        panel={panel}
        cityStation={cityStation}
        onClose={() => setPanel(null)}
        onPlayFocus={handlePlayFocus}
      />
      <Toaster
        position="top-center"
        theme="dark"
        toastOptions={{
          style: {
            background: "#0a1014",
            border: "1px solid rgba(47,224,138,0.25)",
            color: "#e8f0ec",
          },
        }}
      />
    </div>
  );
};

function App() {
  return (
    <PlayerProvider>
      <RadioApp />
    </PlayerProvider>
  );
}

export default App;
