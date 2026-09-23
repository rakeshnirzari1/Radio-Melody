import React from "react";
import { MapPin, Music2, Radio } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useDominantColor } from "../hooks/useDominantColor";
import { imgProxyUrl } from "../lib/radioApi";

const NowPlayingCard = () => {
  const { current, isPlaying, nowPlaying } = usePlayer();
  const [imgErr, setImgErr] = React.useState(false);
  const color = useDominantColor(current?.favicon);

  React.useEffect(() => {
    setImgErr(false);
  }, [current?.id]);

  if (!current) return null;
  const glow = color || "47, 224, 138";
  const letter = (current.name || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="rm-fade-up pointer-events-none absolute left-6 top-1/2 z-20 hidden -translate-y-1/2 lg:block">
      <div
        className="relative w-56 overflow-hidden rounded-3xl rm-glass p-4"
        style={{ boxShadow: `0 20px 60px rgba(${glow}, 0.28)` }}
      >
        <div
          className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: `rgba(${glow}, 0.45)` }}
        />
        <div className="relative">
          <div
            className="relative mx-auto aspect-square w-32 overflow-hidden rounded-2xl"
            style={{ boxShadow: `0 0 40px rgba(${glow}, 0.55)` }}
          >
            {current.favicon && !imgErr ? (
              <img
                src={imgProxyUrl(current.favicon)}
                alt=""
                onError={() => setImgErr(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#123a2b] to-[#0a1a14]">
                <span className="font-display text-6xl font-700 text-[#2fe08a]">
                  {letter}
                </span>
              </div>
            )}
            {isPlaying && (
              <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-[3px] bg-gradient-to-t from-black/60 to-transparent pb-3 pt-8">
                <div className="rm-eq flex h-5 items-end gap-[3px]">
                  {[0, 0.15, 0.3, 0.45, 0.2, 0.35].map((d, i) => (
                    <span key={i} style={{ animationDelay: `${d}s` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-[#6f857b]">
            <Radio size={11} /> Now on air
          </div>
          <div className="mt-1 truncate text-center font-display text-lg font-600 text-white">
            {current.name}
          </div>
          <div className="mt-1 flex items-center justify-center gap-1 truncate text-xs text-[#9fb3aa]">
            <MapPin size={12} className="flex-shrink-0 text-[#2fe08a]" />
            <span className="truncate">
              {[current.state, current.country].filter(Boolean).join(", ") ||
                "Worldwide"}
            </span>
          </div>
          {nowPlaying && (
            <div
              className="mt-3 flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
              style={{ background: `rgba(${glow}, 0.14)`, color: `rgb(${glow})` }}
            >
              <Music2 size={12} className="flex-shrink-0" />
              <span className="truncate">{nowPlaying}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NowPlayingCard;
