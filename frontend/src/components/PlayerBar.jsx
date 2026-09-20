import React from "react";
import {
  Play,
  Pause,
  Heart,
  X,
  Volume2,
  VolumeX,
  Loader2,
  MapPin,
  Music2,
  Share2,
  Moon,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { absoluteUrl } from "../lib/share";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { toast } from "sonner";

export const slugify = (str) =>
  (str || "station")
    .toString()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "station";

const Equalizer = () => (
  <div className="rm-eq flex h-4 items-end gap-[3px]">
    {[0, 0.15, 0.3, 0.45, 0.2].map((d, i) => (
      <span key={i} style={{ animationDelay: `${d}s` }} />
    ))}
  </div>
);

const StationLogo = ({ station }) => {
  const [err, setErr] = React.useState(false);
  const letter = (station.name || "?").trim().charAt(0).toUpperCase();
  if (station.favicon && !err) {
    return (
      <img
        src={station.favicon}
        alt=""
        onError={() => setErr(true)}
        className="h-full w-full rounded-xl object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center rounded-xl bg-gradient-to-br from-[#123a2b] to-[#0a1a14] font-display text-2xl font-700 text-[#2fe08a]">
      {letter}
    </div>
  );
};

const SLEEP_OPTIONS = [15, 30, 45, 60];

const SleepTimer = () => {
  const { sleepEndsAt, sleepRemaining, startSleepTimer, cancelSleepTimer } =
    usePlayer();
  const active = Boolean(sleepEndsAt);
  const mins = Math.floor(sleepRemaining / 60000);
  const secs = Math.floor((sleepRemaining % 60000) / 1000);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex h-10 items-center justify-center gap-1.5 rounded-full px-2.5 transition-colors ${
            active
              ? "bg-[#2fe08a]/15 text-[#7bf0b8]"
              : "text-[#9fb3aa] hover:bg-white/5 hover:text-white"
          }`}
          title="Sleep timer"
        >
          <Moon size={18} />
          {active && (
            <span className="text-xs font-500 tabular-nums">
              {mins}:{String(secs).padStart(2, "0")}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-52 rounded-xl border-[#2fe08a]/20 bg-[#0a1014] p-3 text-[#e8f0ec]"
      >
        <div className="mb-2 flex items-center gap-2 font-display text-sm font-600">
          <Moon size={15} className="text-[#2fe08a]" /> Sleep timer
        </div>
        <p className="mb-3 text-xs text-[#8497a0]">
          Playback gently fades out and stops.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SLEEP_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => startSleepTimer(m)}
              className="rounded-lg bg-white/5 py-2 text-sm font-500 text-white transition-colors hover:bg-[#2fe08a]/20 hover:text-[#7bf0b8]"
            >
              {m} min
            </button>
          ))}
        </div>
        {active && (
          <button
            onClick={cancelSleepTimer}
            className="mt-2 w-full rounded-lg border border-rose-400/30 py-2 text-sm text-rose-300 transition-colors hover:bg-rose-400/10"
          >
            Cancel timer
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
};

const FavoriteButton = ({ active, onClick, className = "" }) => (
  <button
    onClick={onClick}
    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-all ${
      active ? "text-rose-400" : "text-[#9fb3aa] hover:bg-white/5 hover:text-white"
    } ${className}`}
    title="Favorite"
  >
    <Heart size={20} fill={active ? "currentColor" : "none"} />
  </button>
);

const PlayerBar = () => {
  const {
    current,
    isPlaying,
    isBuffering,
    error,
    nowPlaying,
    toggle,
    next,
    prev,
    stop,
    volume,
    setVolume,
    isFavorite,
    toggleFavorite,
  } = usePlayer();

  if (!current) return null;
  const fav = isFavorite(current.id);

  const share = async () => {
    const link = absoluteUrl(`/station/${slugify(current.name)}/${current.id}`);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${current.name} · Radio Melody`, url: link });
      } else {
        await navigator.clipboard.writeText(link);
        toast.success("Link copied", {
          description: "Opens the globe playing this station.",
        });
      }
    } catch {
      try {
        await navigator.clipboard.writeText(link);
        toast.success("Link copied to clipboard");
      } catch {
        toast.error("Couldn't copy link");
      }
    }
  };

  const place =
    [current.state, current.country].filter(Boolean).join(", ") || "On air";

  return (
    <div className="rm-safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3 sm:px-6 sm:pb-5">
      <div className="rm-fade-up pointer-events-auto w-full max-w-3xl rounded-2xl rm-glass px-3 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.5)] sm:px-4">
        {/*
          On phones this is deliberately two rows: the station name gets the full
          width beside the logo, and the transport controls get a row of their
          own. Squeezing a logo, a title and five buttons into one 360px row left
          the name as a couple of truncated characters.
        */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
              <StationLogo station={current} />
              {isPlaying && (
                <div className="absolute inset-0 flex items-end justify-center bg-black/35 pb-2">
                  <Equalizer />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 font-display text-[15px] font-600 leading-tight text-white sm:truncate">
                {current.name || "Unknown station"}
              </div>
              {nowPlaying ? (
                <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-[#7bf0b8]">
                  <Music2 size={12} className="flex-shrink-0" />
                  <span className="truncate">{nowPlaying}</span>
                </div>
              ) : (
                <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-[#9fb3aa]">
                  <MapPin size={12} className="flex-shrink-0 text-[#2fe08a]" />
                  <span className="truncate">{place}</span>
                </div>
              )}
              {error && (
                <div className="mt-0.5 truncate text-[11px] text-rose-400">
                  {error}
                </div>
              )}
            </div>

            {/* Phone: heart sits up here so the control row stays roomy */}
            <FavoriteButton
              active={fav}
              onClick={() => toggleFavorite(current)}
              className="sm:hidden"
            />
          </div>

          <div className="flex w-full items-center justify-center gap-4 sm:w-auto sm:justify-end sm:gap-2">
            <div className="hidden items-center gap-2 md:flex">
              <button
                onClick={() => setVolume(volume > 0 ? 0 : 0.9)}
                className="text-[#9fb3aa] transition-colors hover:text-white"
              >
                {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/15 accent-[#2fe08a]"
              />
            </div>

            <SleepTimer />

            <button
              onClick={share}
              className="hidden h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[#9fb3aa] transition-all hover:bg-white/5 hover:text-white sm:flex"
              title="Share this station"
            >
              <Share2 size={18} />
            </button>

            <FavoriteButton
              active={fav}
              onClick={() => toggleFavorite(current)}
              className="hidden sm:flex"
            />

            <button
              onClick={prev}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[#9fb3aa] transition-all hover:bg-white/5 hover:text-white"
              title="Previous station"
            >
              <SkipBack size={19} fill="currentColor" />
            </button>

            <button
              onClick={toggle}
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#2fe08a] text-[#05070a] shadow-[0_0_20px_rgba(47,224,138,0.5)] transition-transform hover:scale-105 active:scale-95"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isBuffering ? (
                <Loader2 size={22} className="rm-spin" />
              ) : isPlaying ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" className="ml-0.5" />
              )}
            </button>

            <button
              onClick={next}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[#9fb3aa] transition-all hover:bg-white/5 hover:text-white"
              title="Next station"
            >
              <SkipForward size={19} fill="currentColor" />
            </button>

            <button
              onClick={stop}
              className="hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[#6f857b] transition-colors hover:bg-white/5 hover:text-white sm:flex"
              title="Stop"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerBar;
