import React from "react";
import { Music, Newspaper, Guitar, Radio, Disc3, Piano, Mic2, Headphones } from "lucide-react";

export const GENRES = [
  { key: "", label: "All", icon: Radio, match: null },
  { key: "pop", label: "Pop", icon: Music, match: ["pop"] },
  { key: "rock", label: "Rock", icon: Guitar, match: ["rock"] },
  { key: "jazz", label: "Jazz", icon: Piano, match: ["jazz"] },
  { key: "news", label: "News", icon: Newspaper, match: ["news", "talk", "information"] },
  { key: "lofi", label: "Lo-fi", icon: Headphones, match: ["lofi", "lo-fi", "chill", "chillout"] },
  { key: "classical", label: "Classical", icon: Piano, match: ["classical", "classic"] },
  { key: "electronic", label: "Electronic", icon: Disc3, match: ["electronic", "edm", "techno", "house", "trance", "dance"] },
  { key: "hiphop", label: "Hip-Hop", icon: Mic2, match: ["hip hop", "hip-hop", "hiphop", "rap"] },
  { key: "reggae", label: "Reggae", icon: Music, match: ["reggae", "dub", "ska"] },
];

export const filterByGenre = (stations, genreKey) => {
  if (!genreKey) return stations;
  const g = GENRES.find((x) => x.key === genreKey);
  if (!g || !g.match) return stations;
  return stations.filter((s) => {
    const t = (s.tags || "").toLowerCase();
    return g.match.some((m) => t.includes(m));
  });
};

const GenreBar = ({ active, onSelect, counts }) => {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3"
      // Clears the header by its measured height instead of a hardcoded offset: on a
      // phone the header is two rows tall, and a fixed 76px put these chips under the
      // nav pill.
      style={{ top: "calc(var(--rm-header-h, 124px) + 0.5rem)" }}
    >
      <div className="rm-scroll pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto rounded-full rm-glass px-2 py-2">
        {GENRES.map((g) => {
          const isActive = active === g.key;
          const Icon = g.icon;
          return (
            <button
              key={g.key || "all"}
              onClick={() => onSelect(g.key)}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-500 transition-all duration-200 ${
                isActive
                  ? "bg-[#2fe08a] text-[#05070a]"
                  : "text-[#9fb3aa] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={14} strokeWidth={2.2} />
              {g.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default GenreBar;
