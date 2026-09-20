import React, { useEffect, useState, useCallback } from "react";
import "./App.css";
import { Shuffle, Loader2, Radio, LocateFixed } from "lucide-react";
import { Toaster } from "sonner";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { getGeoStations, getStation } from "./lib/radioApi";
import GlobeView from "./components/GlobeView";
import Header from "./components/Header";
import PlayerBar from "./components/PlayerBar";
import SidePanel from "./components/SidePanel";

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
    className={`pointer-events-none absolute left-1/2 top-[16%] z-20 -translate-x-1/2 text-center transition-opacity duration-700 ${
      show ? "opacity-100" : "opacity-0"
    }`}
  >
    <p className="font-display text-sm text-[#cfe8dd] drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] sm:text-base">
      Drag the globe · tap a{" "}
      <span className="text-[#37f59a]">glowing dot</span> to listen
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
  const { current, play } = usePlayer();

  useEffect(() => {
    let mounted = true;
    getGeoStations(5000)
      .then((data) => {
        if (mounted) setStations(data);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setTimeout(() => setLoading(false), 900);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Shareable link: ?s=<stationId> opens the globe already playing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("s");
    if (!sid) return;
    getStation(sid)
      .then((s) => {
        if (s && s.id) {
          play(s);
          if (s.lat != null) setFocusStation({ ...s, _t: Date.now() });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = useCallback(
    (p) => setPanel((cur) => (cur === p ? null : p)),
    []
  );

  const handlePlayFocus = useCallback((station) => {
    setFocusStation({ ...station, _t: Date.now() });
    setPanel(null);
  }, []);

  const handleStationClick = useCallback(
    (station) => {
      play(station);
      setFocusStation({ ...station, _t: Date.now() });
      setCityStation(station);
      setPanel("city");
    },
    [play]
  );

  const surprise = useCallback(() => {
    if (!stations.length) return;
    const s = stations[Math.floor(Math.random() * Math.min(stations.length, 800))];
    play(s);
    setFocusStation({ ...s, _t: Date.now() });
  }, [stations, play]);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLoc(loc);
        setFocusStation({ ...loc, _t: Date.now() });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  return (
    <div className="App rm-star-field">
      <IntroLoader show={loading} />
      <GlobeView
        stations={stations}
        focusStation={focusStation}
        userLoc={userLoc}
        onStationClick={handleStationClick}
      />
      <Hint show={!loading && !current} />

      <Header onOpen={handleOpen} activePanel={panel} onHome={() => setPanel(null)} />

      {/* Floating controls */}
      <div className="pointer-events-none absolute bottom-24 right-4 z-20 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        <button
          onClick={locateMe}
          className="group pointer-events-auto flex items-center gap-2 rounded-full rm-glass px-4 py-3 text-sm font-500 text-[#9fd8ff] transition-all hover:bg-[#7fd4ff]/15"
          title="Find my location"
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
