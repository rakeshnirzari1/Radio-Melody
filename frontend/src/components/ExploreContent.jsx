import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2, Flame, Tag, Loader2, ChevronLeft, Search } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { getCountries, getByCountry, getTrending, getByTag } from "../lib/radioApi";
import { countryFlag } from "../lib/explored";
import StationRow from "./StationRow";

// Browse by place, by what the world is listening to right now, or by genre.
// The countries list is the Radio-Browser country table sorted by station count,
// so it doubles as a "where is radio dense" map.
const TABS = [
  { key: "countries", label: "Countries", icon: Globe2 },
  { key: "trending", label: "Trending", icon: Flame },
  { key: "genres", label: "Genres", icon: Tag },
];

const GENRE_TAGS = [
  "jazz", "pop", "rock", "news", "classical", "electronic", "dance", "hip hop",
  "reggae", "country", "blues", "soul", "funk", "metal", "punk", "indie",
  "lofi", "chillout", "ambient", "house", "techno", "trance", "80s", "90s",
  "oldies", "bollywood", "salsa", "latin", "kpop", "talk", "sport", "comedy",
];

const Spinner = () => (
  <div className="flex justify-center py-14">
    <Loader2 className="rm-spin text-[#2fe08a]" size={24} />
  </div>
);

const StationList = ({ stations, onPlayFocus }) => {
  const { play } = usePlayer();
  const handlePlay = (s) => {
    play(s, stations);
    onPlayFocus(s);
  };
  return (
    <div className="space-y-0.5">
      {stations.map((s) => (
        <StationRow key={s.id} station={s} onPlay={handlePlay} />
      ))}
    </div>
  );
};

const ExploreContent = ({ onPlayFocus }) => {
  const [tab, setTab] = useState("countries");
  const [countries, setCountries] = useState(null);
  const [countryQuery, setCountryQuery] = useState("");
  const [openCountry, setOpenCountry] = useState(null);
  const [countryStations, setCountryStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trending, setTrending] = useState(null);
  const [tag, setTag] = useState("");
  const [tagStations, setTagStations] = useState([]);
  const { play } = usePlayer();

  useEffect(() => {
    let alive = true;
    getCountries()
      .then((c) => alive && setCountries(c))
      .catch(() => alive && setCountries([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (tab !== "trending" || trending) return;
    let alive = true;
    getTrending(60)
      .then((rows) => alive && setTrending(rows))
      .catch(() => alive && setTrending([]));
    return () => {
      alive = false;
    };
  }, [tab, trending]);

  const openCountryStations = useCallback(async (country) => {
    setOpenCountry(country);
    setLoading(true);
    setCountryStations([]);
    try {
      const rows = await getByCountry({
        country: country.name,
        countrycode: country.code,
        limit: 100,
      });
      setCountryStations(rows);
    } catch {
      setCountryStations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const pickTag = useCallback(async (t) => {
    setTag(t);
    setLoading(true);
    setTagStations([]);
    try {
      setTagStations(await getByTag(t, 80));
    } catch {
      setTagStations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredCountries = useMemo(() => {
    if (!countries) return [];
    const q = countryQuery.trim().toLowerCase();
    const list = q
      ? countries.filter((c) => c.name.toLowerCase().includes(q))
      : countries;
    return list.slice(0, 200);
  }, [countries, countryQuery]);

  // A country is open: show its stations with a way back.
  if (openCountry) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 pb-2">
          <button
            onClick={() => setOpenCountry(null)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-[#9fb3aa] transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft size={15} /> Countries
          </button>
          <div className="truncate text-sm text-white">
            {countryFlag(openCountry.code)} {openCountry.name}
          </div>
        </div>
        <div className="rm-scroll flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <Spinner />
          ) : countryStations.length ? (
            <StationList stations={countryStations} onPlayFocus={onPlayFocus} />
          ) : (
            <div className="px-4 py-10 text-center text-sm text-[#8497a0]">
              No playable stations found for {openCountry.name} right now.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1.5 px-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-500 transition-all ${
                active
                  ? "bg-[#2fe08a] text-[#05070a]"
                  : "bg-white/5 text-[#9fb3aa] hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "countries" && (
        <>
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
              <Search size={15} className="text-[#2fe08a]" />
              <input
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder={`Search ${countries ? countries.length : "…"} countries`}
                className="w-full bg-transparent text-sm text-white placeholder:text-[#6f857b] focus:outline-none"
              />
            </div>
          </div>
          <div className="rm-scroll mt-2 flex-1 overflow-y-auto px-2 pb-4">
            {!countries ? (
              <Spinner />
            ) : (
              <div className="space-y-0.5">
                {filteredCountries.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => openCountryStations(c)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                  >
                    <span className="text-lg leading-none">{countryFlag(c.code)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-white">{c.name}</span>
                    <span className="text-[11px] text-[#6f857b]">{c.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "trending" && (
        <div className="rm-scroll mt-3 flex-1 overflow-y-auto px-2 pb-4">
          <div className="px-3 pb-2 text-[11px] uppercase tracking-[0.2em] text-[#6f857b]">
            Most played in the last 24 hours
          </div>
          {!trending ? (
            <Spinner />
          ) : trending.length ? (
            <StationList stations={trending} onPlayFocus={onPlayFocus} />
          ) : (
            <div className="px-4 py-10 text-center text-sm text-[#8497a0]">
              Trending list is unavailable right now.
            </div>
          )}
        </div>
      )}

      {tab === "genres" && (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {GENRE_TAGS.map((t) => (
              <button
                key={t}
                onClick={() => pickTag(t)}
                className={`rounded-full px-2.5 py-1 text-xs capitalize transition-colors ${
                  tag === t
                    ? "bg-[#2fe08a] text-[#05070a]"
                    : "bg-white/5 text-[#9fb3aa] hover:bg-white/10 hover:text-white"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="rm-scroll mt-3 flex-1 overflow-y-auto px-2 pb-4">
            {loading ? (
              <Spinner />
            ) : tagStations.length ? (
              <StationList stations={tagStations} onPlayFocus={onPlayFocus} />
            ) : (
              <div className="px-4 py-10 text-center text-sm text-[#8497a0]">
                Pick a genre to see the biggest stations in it.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ExploreContent;
