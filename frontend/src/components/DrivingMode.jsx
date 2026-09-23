import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipForward, SkipBack, X, Loader2, Gauge } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { countryFlag } from "../lib/explored";

/**
 * Driving mode: the whole screen becomes three enormous controls.
 *
 * Deliberately minimal — the station name, where it is from, and back / next. No
 * map, no panels, no small targets, and deliberately no pause button: live radio has
 * nothing to resume from, and on a locked phone a pause only ever means losing the
 * station. It also asks for a screen wake lock
 * so the phone does not sleep while you are using it as a car radio, and falls
 * back quietly where that API is unavailable (iOS Safari).
 */
const DrivingMode = ({ onExit }) => {
  const { current, isPlaying, isBuffering, toggle, next, prev, nowPlaying, switching, listLabel } =
    usePlayer();
  const wakeRef = useRef(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const request = async () => {
      try {
        if (navigator.wakeLock && document.visibilityState === "visible") {
          const lock = await navigator.wakeLock.request("screen");
          if (cancelled) lock.release();
          else wakeRef.current = lock;
        }
      } catch {
        /* not supported, or the page is not visible — fine */
      }
    };
    request();
    const onVisible = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      try {
        wakeRef.current && wakeRef.current.release();
      } catch {
        /* ignore */
      }
      wakeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onExit();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, toggle, next, prev]);

  const station = current;
  const place = station
    ? [station.state, station.country].filter(Boolean).join(", ")
    : "";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#04070a] text-white">
      <div className="flex items-center justify-between px-6 pt-6">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[#2fe08a]">
          <Gauge size={13} /> Driving mode
        </div>
        <div className="flex items-center gap-4">
          <span className="font-display text-sm tabular-nums text-[#9fb3aa]">
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button
            onClick={onExit}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-[#9fb3aa] transition-colors hover:bg-white/10 hover:text-white"
            title="Leave driving mode"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl leading-none">{countryFlag(station && station.countrycode)}</div>
        <div className="mt-5 max-w-[16ch] font-display text-4xl font-700 leading-tight sm:text-5xl">
          {station ? station.name : "Nothing playing"}
        </div>
        {place && <div className="mt-3 text-base text-[#9fb3aa]">{place}</div>}
        <div className="mt-4 h-6 text-sm text-[#7bf0b8]">
          {switching ? (
            <span className="opacity-80">Tuning to {switching.name}…</span>
          ) : (
            nowPlaying || (isBuffering ? "Buffering…" : "")
          )}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-md grid-cols-2 items-center gap-4 px-6 pb-10">
        <button
          onClick={prev}
          className="flex h-24 items-center justify-center rounded-3xl bg-white/[0.06] text-[#e8f0ec] transition-transform active:scale-95 sm:h-28"
          title="Previous station"
        >
          <SkipBack size={54} fill="currentColor" />
        </button>
        
        <button
          onClick={next}
          className="flex h-24 items-center justify-center rounded-3xl bg-white/[0.06] text-[#e8f0ec] transition-transform active:scale-95 sm:h-28"
          title="Next station"
        >
          <SkipForward size={54} fill="currentColor" />
        </button>
      </div>

      <p className="pb-8 text-center text-xs text-[#5f7a6e]">
        {listLabel
          ? `Back · Next — staying inside ${listLabel}`
          : "Back · Next — the same buttons your car and lock screen show"}
      </p>
    </div>
  );
};

export default DrivingMode;
