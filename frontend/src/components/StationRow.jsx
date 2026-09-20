import React from "react";
import { Play, Pause, Heart, MapPin, Loader2 } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

const StationRow = ({ station, onPlay }) => {
  const {
    current,
    isPlaying,
    isBuffering,
    toggle,
    isFavorite,
    toggleFavorite,
  } = usePlayer();
  const [err, setErr] = React.useState(false);

  const active = current && current.id === station.id;
  const fav = isFavorite(station.id);
  const letter = (station.name || "?").trim().charAt(0).toUpperCase();

  const handlePlay = () => {
    if (active) toggle();
    else onPlay(station);
  };

  return (
    <div
      className={`group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors ${
        active ? "bg-[#2fe08a]/10" : "hover:bg-white/5"
      }`}
    >
      <button
        onClick={handlePlay}
        className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg"
      >
        {station.favicon && !err ? (
          <img
            src={station.favicon}
            alt=""
            onError={() => setErr(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#123a2b] to-[#0a1a14] font-display font-700 text-[#2fe08a]">
            {letter}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          {active && isBuffering ? (
            <Loader2 size={16} className="rm-spin text-white" />
          ) : active && isPlaying ? (
            <Pause size={16} className="text-white" fill="currentColor" />
          ) : (
            <Play size={16} className="ml-0.5 text-white" fill="currentColor" />
          )}
        </div>
      </button>

      <button
        onClick={handlePlay}
        className="min-w-0 flex-1 text-left"
      >
        <div
          className={`truncate text-sm font-500 ${
            active ? "text-[#7bf0b8]" : "text-white"
          }`}
        >
          {station.name || "Unknown"}
        </div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-[#8497a0]">
          <MapPin size={11} className="flex-shrink-0" />
          <span className="truncate">
            {[station.state, station.country].filter(Boolean).join(", ") ||
              "Worldwide"}
          </span>
        </div>
      </button>

      <button
        onClick={() => toggleFavorite(station)}
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
          fav ? "text-rose-400" : "text-[#6f857b] hover:text-white"
        }`}
      >
        <Heart size={16} fill={fav ? "currentColor" : "none"} />
      </button>
    </div>
  );
};

export default StationRow;
