import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import "./App.css";
import {
  BrowserRouter,
  Routes,
  Route,
  useParams,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { Shuffle, Loader2, Radio, LocateFixed, Route as RouteIcon, Play, Mic } from "lucide-react";
import { Toaster, toast } from "sonner";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { getGeoStations, getStation, searchStations } from "./lib/radioApi";
import GlobeView from "./components/GlobeView";
import Header from "./components/Header";
import PlayerBar, { slugify } from "./components/PlayerBar";
import SidePanel from "./components/SidePanel";
import NowPlayingCard from "./components/NowPlayingCard";
import GenreBar, { filterByGenre, GENRES } from "./components/GenreBar";

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

const TapToPlay = () => {
  const { blocked, current, resume } = usePlayer();
  if (!blocked || !current) return null;
  return (
    <button
      onClick={() => resume()}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-[2px]"
    >
      <div className="rm-fade-up flex flex-col items-center gap-4 px-6 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#2fe08a] text-[#05070a] shadow-[0_0_40px_rgba(47,224,138,0.7)]">
          <Play size={34} fill="currentColor" className="ml-1" />
        </span>
        <div className="font-display text-xl font-600 text-white">
          Tap to play
        </div>
        <div className="max-w-xs text-sm text-[#cfe8dd]">
          {current.name}
          <span className="block text-[#9fb3aa]">
            Your browser needs one tap before it can start the sound.
          </span>
        </div>
      </div>
    </button>
  );
};

const RadioApp = () => {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState(null);
  const [focusStation, setFocusStation] = useState(null);
  const [cityStation, setCityStation] = useState(null);
  const [userLoc, setUserLoc] = useState(null);
  const [genre, setGenre] = useState("");
  const [listening, setListening] = useState(false);
  const {
    current,
    play,
    next,
    prev,
    toggle,
    resume,
    pause,
    setNeighbors,
    importFavorites,
    favorites,
  } = usePlayer();

  const userChoseRef = useRef(false);
  const pendingAutoplayRef = useRef(false);
  const autoInitRef = useRef(false);
  const sharedQueueRef = useRef(false);

  const filtered = useMemo(() => filterByGenre(stations, genre), [stations, genre]);

  const sortNearest = useCallback(
    (lat, lng) =>
      [...stations]
        .filter((s) => s.lat != null && s.lng != null)
        .sort((a, b) => hav(lat, lng, a.lat, a.lng) - hav(lat, lng, b.lat, b.lng)),
    [stations]
  );

  const buildQueue = useCallback(
    (station) => {
      if (station.lat != null && stations.length) {
        const s = sortNearest(station.lat, station.lng).slice(0, 60);
        if (!s.some((x) => x.id === station.id)) s.unshift(station);
        return s;
      }
      return [station, ...stations.slice(0, 59)];
    },
    [stations, sortNearest]
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

  // Globe follows the current station
  useEffect(() => {
    if (current && current.lat != null) {
      setFocusStation({ ...current, _t: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // SEO: page title + address bar reflect the current station
  useEffect(() => {
    if (current) {
      const place = [current.state, current.country].filter(Boolean).join(", ");
      document.title = `${current.name}${place ? " — " + place : ""} | Radio Melody`;
      const path = `/station/${slugify(current.name)}/${current.id}`;
      if (location.pathname !== path) {
        navigate(path, { replace: true });
      }
    } else {
      document.title = "Radio Melody — Live radio from around the world";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, location.pathname]);

  // Give shared links a proper nearby queue once stations load
  useEffect(() => {
    if (stations.length && sharedQueueRef.current && current) {
      setNeighbors(buildQueue(current), current.id);
      sharedQueueRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, current]);

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
        next();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, next, prev]);

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

  // Resolve a shared station link: /station/:slug/:id  or legacy ?s=<id>
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const sid = params.id || query.get("s");
    if (!sid) return;
    userChoseRef.current = true;
    sharedQueueRef.current = true;
    getStation(sid)
      .then((s) => {
        if (s && s.id) {
          play(s);
          pendingAutoplayRef.current = true;
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shareable favorites link: ?favs=<base64>
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const favs = query.get("favs");
    if (!favs) return;
    try {
      const list = JSON.parse(decodeURIComponent(escape(atob(favs))));
      if (Array.isArray(list) && list.length) {
        importFavorites(list);
        userChoseRef.current = true;
        setPanel("favorites");
        const first = list[0];
        if (first && first.url) {
          play(first, list);
          pendingAutoplayRef.current = true;
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-play on load: nearest if location granted, else random (never silent)
  useEffect(() => {
    if (!stations.length || autoInitRef.current) return;
    autoInitRef.current = true;
    const query = new URLSearchParams(window.location.search);
    if (params.id || query.get("s") || query.get("favs")) return;

    const rand = stations[Math.floor(Math.random() * Math.min(stations.length, 600))];
    if (rand) {
      play(rand, buildQueue(rand));
      pendingAutoplayRef.current = true;
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLoc(loc);
          if (!userChoseRef.current) {
            const near = sortNearest(loc.lat, loc.lng)[0];
            if (near) {
              play(near, buildQueue(near));
              pendingAutoplayRef.current = true;
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

  const handlePlayFocus = useCallback(() => {
    userChoseRef.current = true;
    setPanel(null);
  }, []);

  const handleStationClick = useCallback(
    (station) => {
      userChoseRef.current = true;
      play(station, buildQueue(station));
      setCityStation(station);
      setPanel("city");
    },
    [play, buildQueue]
  );

  const surprise = useCallback(() => {
    if (!stations.length) return;
    userChoseRef.current = true;
    const s = stations[Math.floor(Math.random() * Math.min(stations.length, 800))];
    play(s, buildQueue(s));
    setCityStation(s);
  }, [stations, play, buildQueue]);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("Location isn't available on this device");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(loc);
        userChoseRef.current = true;
        const near = sortNearest(loc.lat, loc.lng)[0];
        if (near) {
          play(near, buildQueue(near));
          setCityStation(near);
          toast.success("Playing the station nearest to you");
        } else {
          setFocusStation({ ...loc, _t: Date.now() });
        }
      },
      () => toast.error("Couldn't get your location"),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [sortNearest, play, buildQueue]);

  const startVoice = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice search isn't supported on this browser");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);

    // Silence the radio first — the microphone would otherwise pick up what the
    // speakers are playing and transcribe the song instead of the user.
    pause();

    let handled = false;
    toast.message("Listening…", { description: "Say a city, country or genre" });

    rec.onresult = async (e) => {
      const transcript = (e.results[0][0].transcript || "").trim();
      setListening(false);
      handled = true;
      if (!transcript) {
        resume();
        return;
      }
      toast.success(`Heard: “${transcript}”`);
      const lower = transcript.toLowerCase();
      const g = GENRES.find(
        (x) =>
          x.key &&
          (lower.includes(x.label.toLowerCase()) ||
            (x.match || []).some((m) => lower.includes(m)))
      );
      try {
        let results;
        if (g) {
          setGenre(g.key);
          results = await searchStations({ tag: g.match[0], limit: 40 });
        } else {
          results = await searchStations({ q: transcript, limit: 40 });
        }
        if (results && results.length) {
          userChoseRef.current = true;
          play(results[0], results);
          setCityStation(results[0]);
        } else {
          toast.error(`No stations found for “${transcript}”`);
          resume();
        }
      } catch {
        toast.error("Voice search failed, please try again");
        resume();
      }
    };
    rec.onerror = () => {
      setListening(false);
      handled = true;
      toast.error("Didn't catch that — tap the mic and try again");
      resume();
    };
    rec.onend = () => {
      setListening(false);
      // Stopped without a usable result — put the radio back on.
      if (!handled) resume();
    };
    try {
      rec.start();
    } catch {
      setListening(false);
      resume();
    }
  }, [play, pause, resume]);

  const roadTrip = useCallback(() => {
    const pins = favorites.filter((s) => s.url);
    if (!pins.length) {
      toast.info("Pin some favorites first", {
        description: "Tap the heart on stations to build your road trip.",
      });
      setPanel("favorites");
      return;
    }
    userChoseRef.current = true;
    play(pins[0], pins);
    toast.success(`Road trip · ${pins.length} pinned stations`, {
      description: "Use Next (or your car controls) to travel between them.",
    });
  }, [favorites, play]);

  return (
    <div className="App rm-star-field">
      <IntroLoader show={loading} />
      <GlobeView
        stations={filtered}
        focusStation={focusStation}
        userLoc={userLoc}
        pins={favorites}
        onStationClick={handleStationClick}
      />
      <Hint show={!loading && !current} />
      <TapToPlay />

      <Header onOpen={handleOpen} activePanel={panel} onHome={() => setPanel(null)} />
      <GenreBar active={genre} onSelect={setGenre} />
      <NowPlayingCard />

      <div className="rm-safe-bottom pointer-events-none absolute bottom-24 right-4 z-20 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        <button
          onClick={startVoice}
          className={`group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 transition-all ${
            listening
              ? "bg-[#2fe08a]/20 text-[#2fe08a]"
              : "text-[#c9b4ff] hover:bg-[#b79cff]/15"
          }`}
          title="Voice search — say a city or genre"
        >
          <Mic size={17} className={listening ? "rm-pulse" : "transition-transform group-hover:scale-110"} />
          <span className="hidden sm:inline">{listening ? "Listening…" : "Say a station"}</span>
        </button>
        <button
          onClick={roadTrip}
          className="group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 text-[#ffcf8a] transition-all hover:bg-[#ffb454]/15"
          title="Road trip through your pinned favorites"
        >
          <RouteIcon size={17} className="transition-transform group-hover:scale-110" />
          <span className="hidden sm:inline">Road trip</span>
        </button>
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
      <BrowserRouter basename={process.env.PUBLIC_URL}>
        <Routes>
          <Route path="/" element={<RadioApp />} />
          <Route path="/station/:slug/:id" element={<RadioApp />} />
          <Route path="*" element={<RadioApp />} />
        </Routes>
      </BrowserRouter>
    </PlayerProvider>
  );
}

export default App;
