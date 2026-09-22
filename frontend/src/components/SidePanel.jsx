import React, { useEffect, useState, useCallback } from "react";
import { X, Search, Heart, Clock, Info, Radio, Loader2, Trash2, MapPin, Building2, Share2, Globe2, Route as RouteIcon, Trophy, ShieldCheck } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { searchStations, getCity } from "../lib/radioApi";
import { absoluteUrl } from "../lib/share";
import { buildShareLink } from "../lib/backup";
import BackupControls from "./BackupControls";
import ExploreContent from "./ExploreContent";
import PresetsContent from "./PresetsContent";
import ChallengeContent from "./ChallengeContent";
import PrivacyContent from "./PrivacyContent";
import StationRow from "./StationRow";
import { toast } from "sonner";

// (The old hand-rolled favourites encoder used to live here. Building and reading a
// backup now goes through lib/backup.js, which validates everything on the way in.)

const TAGS = [
  "jazz", "pop", "rock", "news", "classical",
  "electronic", "lofi", "reggae", "hip hop", "80s",
];

const Empty = ({ icon: Icon, title, sub }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-[#2fe08a]">
      <Icon size={26} />
    </div>
    <div className="font-display text-lg font-600 text-white">{title}</div>
    <p className="max-w-[240px] text-sm text-[#8497a0]">{sub}</p>
  </div>
);

const SearchContent = ({ onPlayFocus }) => {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const { play } = usePlayer();

  const run = useCallback(async (query, t) => {
    if (!query && !t) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchStations({ q: query, tag: t, limit: 60 });
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => run(q, tag), 350);
    return () => clearTimeout(id);
  }, [q, tag, run]);

  const handlePlay = (s) => {
    play(s, results);
    onPlayFocus(s);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-1">
        <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 focus-within:ring-1 focus-within:ring-[#2fe08a]/50">
          <Search size={18} className="text-[#2fe08a]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stations, cities, countries…"
            className="w-full bg-transparent text-sm text-white placeholder:text-[#6f857b] focus:outline-none"
          />
          {q && (
            <button onClick={() => setQ("")} className="text-[#6f857b] hover:text-white">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {TAGS.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? "" : t)}
              className={`rounded-full px-3 py-1 text-xs font-500 capitalize transition-colors ${
                tag === t
                  ? "bg-[#2fe08a] text-[#05070a]"
                  : "bg-white/5 text-[#9fb3aa] hover:bg-white/10 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="rm-scroll mt-3 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="rm-spin text-[#2fe08a]" size={26} />
          </div>
        ) : results.length ? (
          <div className="space-y-0.5">
            {results.map((s) => (
              <StationRow key={s.id} station={s} onPlay={handlePlay} />
            ))}
          </div>
        ) : (
          <Empty
            icon={Search}
            title="Find your sound"
            sub="Search by name or pick a genre to discover live stations from around the globe."
          />
        )}
      </div>
    </div>
  );
};

const ListContent = ({ items, empty, onPlayFocus, onClear, showClear, onShare }) => {
  const { play } = usePlayer();
  const handlePlay = (s) => {
    play(s, items);
    onPlayFocus(s);
  };
  return (
    <div className="flex h-full flex-col">
      {(showClear || onShare) && items.length > 0 && (
        <div className="flex justify-end gap-1 px-4 pb-1">
          {onShare && (
            <button
              onClick={onShare}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[#8497a0] transition-colors hover:bg-white/5 hover:text-[#7bf0b8]"
            >
              <Share2 size={13} /> Share list
            </button>
          )}
          {showClear && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[#8497a0] transition-colors hover:bg-white/5 hover:text-rose-400"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      )}
      <div className="rm-scroll flex-1 overflow-y-auto px-2 pb-4">
        {items.length ? (
          <div className="space-y-0.5">
            {items.map((s) => (
              <StationRow key={s.id + (s.playedAt || "")} station={s} onPlay={handlePlay} />
            ))}
          </div>
        ) : (
          empty
        )}
      </div>
    </div>
  );
};

const CityContent = ({ cityStation, onPlayFocus }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { play } = usePlayer();

  useEffect(() => {
    if (!cityStation) return;
    let active = true;
    setLoading(true);
    setData(null);
    getCity(cityStation.id)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [cityStation]);

  const handlePlay = (s) => {
    play(s, data?.stations || [s]);
    onPlayFocus(s);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-2">
        <div className="flex items-center gap-2 text-sm text-[#8497a0]">
          <MapPin size={14} className="text-[#2fe08a]" />
          <span>
            {data?.stations?.length || 0} station
            {(data?.stations?.length || 0) === 1 ? "" : "s"} near{" "}
            <span className="text-white">{data?.city || "this location"}</span>
          </span>
        </div>
      </div>
      <div className="rm-scroll flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="rm-spin text-[#2fe08a]" size={26} />
          </div>
        ) : data && data.stations && data.stations.length ? (
          <div className="space-y-0.5">
            {data.stations.map((s) => (
              <StationRow key={s.id} station={s} onPlay={handlePlay} />
            ))}
          </div>
        ) : (
          <Empty
            icon={Building2}
            title="No other stations here"
            sub="This spot has just the one you're listening to. Spin the globe for more."
          />
        )}
      </div>
    </div>
  );
};

const AboutContent = () => (
  <div className="rm-scroll flex-1 overflow-y-auto px-6 pb-6 text-sm leading-relaxed text-[#aebfb7]">
    <div className="mb-5 flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2fe08a] text-[#05070a]">
        <Radio size={22} />
      </span>
      <div className="font-display text-xl font-700 text-white">Radio Melody</div>
    </div>
    <p className="mb-4">
      Spin the globe and drop in on live radio from thousands of cities across
      the world. Every glowing dot is a real station broadcasting right now.
    </p>
    <p className="mb-4">
      Click a dot on the planet to tune in instantly. Save the ones you love to
      <span className="text-[#7bf0b8]"> Favorites</span>, and jump back to
      anything you played in <span className="text-[#7bf0b8]">History</span>.
    </p>
    <p className="text-[#6f857b]">
      Live station data powered by the community-run Radio-Browser project.
    </p>
  </div>
);

const SidePanel = ({ panel, onClose, onPlayFocus, cityStation, onPresetStarted, onOpenPrivacyPage }) => {
  const { favorites, history, setHistory } = usePlayer();
  const open = Boolean(panel);

  const titles = {
    search: { icon: Search, label: "Search" },
    explore: { icon: Globe2, label: "Explore" },
    presets: { icon: RouteIcon, label: "Collections" },
    challenge: { icon: Trophy, label: "Around the World" },
    privacy: { icon: ShieldCheck, label: "Privacy" },
    favorites: { icon: Heart, label: "Favorites" },
    history: { icon: Clock, label: "Recently Played" },
    about: { icon: Info, label: "About" },
    city: { icon: MapPin, label: cityStation?.state || cityStation?.country || "Nearby stations" },
  };
  const meta = titles[panel] || titles.search;

  return (
    <>
      <div
        onClick={onClose}
        className={`absolute inset-0 z-40 bg-black/40 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`absolute right-0 top-0 z-50 flex h-full w-full flex-col rm-glass transition-transform duration-300 ease-out sm:w-[420px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <meta.icon size={20} className="text-[#2fe08a]" />
            <h2 className="font-display text-lg font-600 text-white">
              {meta.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#9fb3aa] transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={19} />
          </button>
        </div>

        {panel === "search" && <SearchContent onPlayFocus={onPlayFocus} />}
        {panel === "explore" && <ExploreContent onPlayFocus={onPlayFocus} />}
        {panel === "presets" && (
          <PresetsContent
            onPlayFocus={onPlayFocus}
            onPresetStarted={onPresetStarted}
          />
        )}
        {panel === "challenge" && <ChallengeContent />}
        {panel === "privacy" && (
          <PrivacyContent onOpenPrivacyPage={onOpenPrivacyPage} />
        )}
        {panel === "favorites" && (
          <>
            <BackupControls />
            <ListContent
              items={favorites}
            onPlayFocus={onPlayFocus}
            onShare={async () => {
              const { url, count, truncated } = buildShareLink(
                favorites,
                absoluteUrl("/")
              );
              if (!count) {
                toast.error("No favourites to share yet");
                return;
              }
              const note = truncated
                ? `Sharing the first ${count} — ${favorites.length} in total.`
                : "Open it anywhere to load this whole list.";
              try {
                if (navigator.share) {
                  await navigator.share({ title: "My Radio Melody favourites", url });
                  if (truncated) toast.message(note);
                } else {
                  await navigator.clipboard.writeText(url);
                  toast.success("Favourites link copied", { description: note });
                }
              } catch {
                try {
                  await navigator.clipboard.writeText(url);
                  toast.success("Favourites link copied", { description: note });
                } catch {
                  toast.error("Couldn't copy link");
                }
              }
            }}
            empty={
              <Empty
                icon={Heart}
                title="No favorites yet"
                sub="Tap the heart on any station to keep it here for quick access."
              />
            }
          />
          </>
        )}
        {panel === "history" && (
          <ListContent
            items={history}
            onPlayFocus={onPlayFocus}
            showClear
            onClear={() => setHistory([])}
            empty={
              <Empty
                icon={Clock}
                title="Nothing played yet"
                sub="Stations you tune into will show up here so you can revisit them."
              />
            }
          />
        )}
        {panel === "about" && <AboutContent />}
        {panel === "city" && (
          <CityContent cityStation={cityStation} onPlayFocus={onPlayFocus} />
        )}
      </aside>
    </>
  );
};

export default SidePanel;
