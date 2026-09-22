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
import { Shuffle, Loader2, Radio, LocateFixed, Route as RouteIcon, Play, Mic, Car, ArrowLeft, Compass } from "lucide-react";
import { Toaster, toast } from "sonner";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { getGeoStations, getStation, searchStations } from "./lib/radioApi";
import GlobeView from "./components/GlobeView";
import SwitchingChip from "./components/SwitchingChip";
import Header from "./components/Header";
import PlayerBar, { slugify } from "./components/PlayerBar";
import SidePanel from "./components/SidePanel";
import NowPlayingCard from "./components/NowPlayingCard";
import GenreBar, { filterByGenre, GENRES } from "./components/GenreBar";
import DrivingMode from "./components/DrivingMode";
import ReactiveBackground from "./components/ReactiveBackground";
import InstallPrompt from "./components/InstallPrompt";
import EmbedPlayer from "./components/EmbedPlayer";
import PrivacyContent from "./components/PrivacyContent";
import { orderByHealth } from "./lib/health";

const hav = (la1, lo1, la2, lo2) => {
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((la2 - la1) * p) / 2 +
    (Math.cos(la1 * p) * Math.cos(la2 * p) * (1 - Math.cos((lo2 - lo1) * p))) / 2;
  return 12742 * Math.asin(Math.sqrt(Math.max(0, a)));
};

// Voice is not only search. In a car the useful commands are transport controls,
// and they have to be recognised before anything is treated as a station name.
// Order matters: "exit driving" before "driving", "unpause" before "pause".
const matchVoiceCommand = (text) => {
  const t = ` ${text} `;
  const has = (...words) => words.some((w) => t.includes(w));
  if (has("exit driving", "stop driving", "leave driving", "normal mode")) return "exit-driving";
  if (has("driving mode", "car mode", "drive mode", "on the road")) return "driving";
  if (has("next station", "next track", "next one", "skip this", "skip", "next")) return "next";
  if (has("previous station", "previous one", "go back", "last station", "previous", "back"))
    return "prev";
  if (has("unpause", "resume", "play radio", "start playing", "carry on")) return "play";
  if (has("pause", "stop the radio", "stop music", "be quiet", "hold on")) return "pause";
  if (has("louder", "volume up", "turn it up", "increase volume", "turn up")) return "louder";
  if (has("quieter", "volume down", "turn it down", "lower the volume", "quieter", "softer"))
    return "quieter";
  if (has("mute", "silence")) return "mute";
  if (has("surprise", "random station", "shuffle", "anything")) return "surprise";
  return null;
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
    volume,
    setVolume,
  } = usePlayer();

  const userChoseRef = useRef(false);
  const pendingAutoplayRef = useRef(false);
  const autoInitRef = useRef(false);
  const sharedQueueRef = useRef(false);

  // Road trip mode: Next/Previous walk your pinned favourites instead of the
  // stations around whatever is playing. It is a toggle — once you are in the
  // list you need a way back out to the wider world.
  const [roadTripOn, setRoadTripOn] = useState(false);
  // Which curated list Next/Back is walking, if any: a preset collection or the
  // pinned favourites. Shown on the button so the mode is never a mystery.
  const [collection, setCollection] = useState(null);

  // Driving mode is a preference, not a session: once you have used it in the car
  // you want it back the next time you get in.
  const [driving, setDriving] = useState(() => {
    try {
      return window.localStorage.getItem("rm_driving_v1") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("rm_driving_v1", driving ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [driving]);

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
        // Stations that have already failed on this device go to the back of the
        // queue (see lib/health) — a shorter queue beats a queue full of duds.
        const s = orderByHealth(sortNearest(station.lat, station.lng).slice(0, 60));
        if (!s.some((x) => x.id === station.id)) s.unshift(station);
        return s;
      }
      return [station, ...stations.slice(0, 59)];
    },
    [stations, sortNearest]
  );

  useEffect(() => {
    let mounted = true;
    const mergeIn = (batch) => {
      if (!mounted || !batch || !batch.length) return;
      setStations((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s]));
        batch.forEach((s) => byId.set(s.id, s));
        return [...byId.values()];
      });
    };
    getGeoStations({ onBatch: mergeIn })
      .then((data) => mounted && setStations(data))
      .catch(() => {})
      .finally(() => mounted && setTimeout(() => setLoading(false), 900));
    return () => {
      mounted = false;
    };
  }, []);

  // Support/debug hook: how big the loaded catalogue actually is.
  useEffect(() => {
    window.__radioMelody = { stations: stations.length, updatedAt: Date.now() };
  }, [stations]);

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
      // Tapping a station on the globe plays it, full stop. It used to also slide
      // open the "nearby stations" side panel, which buried the map you were
      // reading and had to be dismissed before you could pick another dot. The
      // queue is built from the stations around it, so Next/Previous still walk
      // the neighbourhood.
      play(station, buildQueue(station));
      setCityStation(station);
      // Picking a station by hand means you are done with the road trip list.
      setRoadTripOn(false);
    },
    [play, buildQueue]
  );

  const surprise = useCallback(() => {
    if (!stations.length) return;
    userChoseRef.current = true;
    const s = stations[Math.floor(Math.random() * Math.min(stations.length, 800))];
    play(s, buildQueue(s));
    setCityStation(s);
    setRoadTripOn(false);
  }, [stations, play, buildQueue]);

  // "Spin the globe": the map spins down like a wheel and lands on a random
  // station. The station is chosen a moment in, while it is still slowing, because
  // the fly-in that frames it belongs to the player — running our own landing
  // animation as well would just fight it.
  const [spinToken, setSpinToken] = useState(0);
  const spinTimerRef = useRef(null);

  const spinTheGlobe = useCallback(() => {
    if (!stations.length) {
      toast.error("Still loading stations — give it a second");
      return;
    }
    setSpinToken((n) => n + 1);
    toast.message("Spinning the globe…", {
      description: "Wherever it stops is what you get.",
    });
    clearTimeout(spinTimerRef.current);
    spinTimerRef.current = setTimeout(() => surprise(), 1500);
  }, [stations.length, surprise]);

  useEffect(() => () => clearTimeout(spinTimerRef.current), []);

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
          setRoadTripOn(false);
          toast.success("Playing the station nearest to you");
        } else {
          setFocusStation({ ...loc, _t: Date.now() });
        }
      },
      () => toast.error("Couldn't get your location"),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [sortNearest, play, buildQueue]);

  // App-shortcut entry points from the PWA manifest: long-press the installed icon
  // and pick "Driving mode", "Surprise me" or "Explore".
  useEffect(() => {
    const go = new URLSearchParams(window.location.search).get("go");
    if (!go) return undefined;
    if (go === "driving") {
      setDriving(true);
      return undefined;
    }
    if (go === "explore") {
      setPanel("explore");
      return undefined;
    }
    if (go === "surprise") {
      // Wait for the catalogue, otherwise there is nothing to pick from.
      const t = setTimeout(() => stations.length && surprise(), 2500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [stations.length, surprise]);

  const runVoiceCommand = useCallback(
    (cmd) => {
      const step = (delta) => Number(Math.max(0, Math.min(1, volume + delta)).toFixed(2));
      switch (cmd) {
        case "next":
          next();
          toast.message("Next station");
          break;
        case "prev":
          prev();
          toast.message("Previous station");
          break;
        case "play":
          resume();
          toast.message("Playing");
          break;
        case "pause":
          pause();
          toast.message("Paused");
          break;
        case "louder":
          setVolume(step(0.1));
          toast.message("Louder");
          break;
        case "quieter":
          setVolume(step(-0.1));
          toast.message("Quieter");
          break;
        case "mute":
          setVolume(0);
          toast.message("Muted");
          break;
        case "surprise":
          surprise();
          break;
        case "driving":
          setDriving(true);
          toast.success("Driving mode on");
          break;
        case "exit-driving":
          setDriving(false);
          toast.message("Driving mode off");
          break;
        default:
          break;
      }
    },
    [next, prev, resume, pause, volume, setVolume, surprise]
  );

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
      // Transport commands first — see matchVoiceCommand.
      const cmd = matchVoiceCommand(lower);
      if (cmd) {
        runVoiceCommand(cmd);
        return;
      }
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
  }, [play, pause, resume, runVoiceCommand]);

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
    // Toggle: pressing it again leaves the pinned list, so Next/Back/Surprise go
    // back to walking the stations around whatever is playing.
    if (roadTripOn) {
      setRoadTripOn(false);
      setCollection(null);
      if (current) {
        setNeighbors(buildQueue(current), current.id);
        toast.success("Road trip off", {
          description: "Next and Back are wandering the nearby stations again.",
        });
      } else {
        toast.info("Road trip off");
      }
      return;
    }
    setRoadTripOn(true);
    setCollection({ label: "Pinned favorites" });
    play(pins[0], pins);
    toast.success(`Road trip · ${pins.length} pinned stations`, {
      description: "Next/Back travel between them. Press Road trip again to leave.",
    });
  }, [favorites, play, roadTripOn, current, buildQueue, setNeighbors]);

  return (
    <div className="App rm-star-field">
      <ReactiveBackground />
      <IntroLoader show={loading} />
      <GlobeView
        stations={filtered}
        focusStation={focusStation}
        userLoc={userLoc}
        pins={favorites}
        onStationClick={handleStationClick}
        spinToken={spinToken}
      />
      <Hint show={!loading && !current} />
      <TapToPlay />

      <Header onOpen={handleOpen} activePanel={panel} onHome={() => setPanel(null)} />
      <GenreBar active={genre} onSelect={setGenre} />
      <NowPlayingCard />
      {/* A switch keeps the old station on air, so this is the only sign a press
          registered. */}
      <SwitchingChip />

      <div className="rm-safe-bottom pointer-events-none absolute bottom-44 right-4 z-20 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        <button
          onClick={spinTheGlobe}
          className="group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 text-[#eafff4] ring-1 ring-[#2fe08a]/40 transition-all hover:bg-[#2fe08a]/15"
          title="Spin the globe and land on a random station"
        >
          <Compass
            size={17}
            className="transition-transform duration-700 group-hover:rotate-180"
          />
          <span className="hidden sm:inline">Spin the globe</span>
        </button>
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
          className={`group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 transition-all ${
            roadTripOn
              ? "bg-[#ffb454]/20 text-[#ffcf8a] ring-1 ring-[#ffb454]/50"
              : "text-[#ffcf8a] hover:bg-[#ffb454]/15"
          }`}
          title={
            roadTripOn
              ? "Road trip is on — next/back walk your pinned stations. Press to leave."
              : "Road trip through your pinned favorites"
          }
        >
          <RouteIcon size={17} className="transition-transform group-hover:scale-110" />
          <span className="hidden max-w-[9rem] truncate sm:inline">
            {roadTripOn ? (collection ? collection.label : "Road trip on") : "Road trip"}
          </span>
          {roadTripOn && !collection && (
            <span className="text-[11px] opacity-80">{favorites.filter((s) => s.url).length}</span>
          )}
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
        <button
          onClick={() => setDriving(true)}
          className="group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 text-[#cfe8dd] transition-all hover:bg-white/10"
          title="Driving mode — three huge controls, screen stays awake"
        >
          <Car size={17} className="transition-transform group-hover:scale-110" />
          <span className="hidden sm:inline">Driving mode</span>
        </button>
      </div>

      <PlayerBar />
      <InstallPrompt />
      {driving && <DrivingMode onExit={() => setDriving(false)} />}
      <SidePanel
        panel={panel}
        cityStation={cityStation}
        onClose={() => setPanel(null)}
        onPlayFocus={handlePlayFocus}
        onPresetStarted={(preset, stations) => {
          // A preset becomes the Next/Back list, exactly like the favourites road
          // trip — same mechanism, different source.
          setRoadTripOn(true);
          setCollection({ label: preset.label });
          if (stations && stations[0]) setCityStation(stations[0]);
        }}
        onOpenPrivacyPage={() => {
          setPanel(null);
          navigate("/privacy");
        }}
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

// The privacy note as a page of its own, so it can be linked to directly from the
// About panel, the footer of a shared card, or anywhere else.
const PrivacyPage = () => {
  const navigate = useNavigate();
  return (
    <div className="App rm-star-field min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-8 text-[#cfe8dd]">
        <button
          onClick={() => navigate("/")}
          className="mb-5 flex w-max items-center gap-2 rounded-full px-3 py-2 text-sm text-[#9fb3aa] transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={16} /> Back to the radio
        </button>
        <h1 className="font-display text-3xl font-700 text-white">Privacy</h1>
        <p className="mb-6 mt-1 text-sm text-[#8497a0]">
          The short version: there is nothing to opt out of.
        </p>
        <div className="flex-1">
          <PrivacyContent />
        </div>
        <p className="mt-8 text-xs text-[#5f7a6e]">
          Radio Melody · station data from the community-run Radio-Browser project ·
          static site on GitHub Pages.
        </p>
      </div>
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
          {/* Embeddable single-station player for other people's websites. */}
          <Route path="/embed/:id" element={<EmbedPlayer />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<RadioApp />} />
        </Routes>
      </BrowserRouter>
    </PlayerProvider>
  );
}

export default App;
