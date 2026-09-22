import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Play, Pause, Loader2, Radio, ExternalLink, MapPin } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { getStation } from "../lib/radioApi";
import { countryFlag } from "../lib/explored";

/**
 * The embeddable player: /embed/<station-id>
 *
 * Deliberately tiny — no globe, no panels — so a blogger or forum can drop a live
 * station into a page. It uses the same PlayerProvider, so the lock-screen and
 * car-control behaviour is identical to the main app.
 */
const EmbedPlayer = () => {
  const { id } = useParams();
  const { play, current, isPlaying, isBuffering, toggle } = usePlayer();
  const [station, setStation] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    getStation(id)
      .then((s) => {
        if (!alive) return;
        setStation(s);
        setState(s ? "ready" : "missing");
      })
      .catch(() => alive && setState("missing"));
    return () => {
      alive = false;
    };
  }, [id]);

  const isThis = current && station && current.id === station.id;

  const start = () => {
    if (!station) return;
    if (isThis) toggle();
    else play(station, [station]);
  };

  if (state === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-[#05070a] text-[#2fe08a]">
        <Loader2 className="rm-spin" size={22} />
      </div>
    );
  }

  if (state === "missing" || !station) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#05070a] px-4 text-center">
        <Radio size={20} className="text-[#2fe08a]" />
        <div className="text-sm text-[#e8f0ec]">Station not found</div>
        <a
          href="../"
          className="text-xs text-[#7bf0b8] underline-offset-2 hover:underline"
        >
          Browse World Radio
        </a>
      </div>
    );
  }

  const place = [station.state, station.country].filter(Boolean).join(", ");

  return (
    <div className="flex h-full items-center gap-3 bg-[#05070a] px-3 py-3 text-white">
      <span className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#123a2b] to-[#0a1a14]">
        {station.favicon ? (
          <img src={station.favicon} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-display text-xl font-700 text-[#2fe08a]">
            {station.name.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-600">{station.name}</div>
        <div className="flex items-center gap-1 truncate text-[11px] text-[#9fb3aa]">
          <MapPin size={10} className="flex-shrink-0 text-[#2fe08a]" />
          <span className="truncate">
            {countryFlag(station.countrycode)} {place || "Worldwide"}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#6f857b]">
          <Radio size={9} />
          {isThis && isPlaying ? "Live now" : "Live radio"}
        </div>
      </div>

      <button
        onClick={start}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#2fe08a] text-[#05070a] transition-transform hover:scale-105"
        title={isThis && isPlaying ? "Pause" : "Play"}
      >
        {isThis && isBuffering ? (
          <Loader2 size={18} className="rm-spin" />
        ) : isThis && isPlaying ? (
          <Pause size={18} fill="currentColor" />
        ) : (
          <Play size={18} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      <a
        href="../"
        target="_blank"
        rel="noreferrer"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/5 text-[#9fb3aa] transition-colors hover:text-white"
        title="Open World Radio"
      >
        <ExternalLink size={15} />
      </a>
    </div>
  );
};

export default EmbedPlayer;
