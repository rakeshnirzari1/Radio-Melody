import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe2, Flame, Tag, Loader2, ChevronLeft, Search, X, Share2 } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import {
  getCountries,
  getByCountry,
  getTrending,
  getByTag,
  searchStations,
} from "../lib/radioApi";
import { countryFlag } from "../lib/explored";
import { slugify } from "../lib/stationUrls";
import { BASE_PATH, absoluteUrl } from "../lib/share";
import { toast } from "sonner";

/**
 * Country names -> country page slugs.
 *
 * Sharing a country shares the *list*, so the link has to point at the page the
 * build wrote for that country. Radio-Browser spells country names formally
 * ("The United Kingdom Of Great Britain And Northern Ireland"), which no longer
 * slugifies to the page's address, so the build publishes the map it used. It is
 * loaded the moment a country is opened and read synchronously when the button is
 * tapped: Safari only opens the native share sheet from inside the tap that caused
 * it, and one awaited fetch in between is enough for it to refuse.
 */
let countryIndex = null;
let countryIndexPromise = null;

const loadCountryIndex = () => {
  if (!countryIndexPromise) {
    countryIndexPromise = fetch(`${BASE_PATH}/station-index/countries.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
      .then((map) => {
        countryIndex = map || {};
        return countryIndex;
      });
  }
  return countryIndexPromise;
};

const countrySlug = (name) => (countryIndex && countryIndex[name]) || slugify(name);
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

// One page of a country or genre list. A country used to ask for exactly 100 rows
// and stop, so India announced 1,005 stations and offered 100 of them — the list
// disagreed with the number printed beside it. Now the list walks on with `offset`
// as the bottom of the scroll comes into view, and because a station played from
// this list queues the list, Next walks everything that has loaded.
const PAGE_SIZE = 100;

// Safety rail: popularity order shifts between pages, so a page can come back with
// nothing new in it. Stop rather than keep asking.
const MAX_PAGES = 25;

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
  const [countryTotal, setCountryTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [trending, setTrending] = useState(null);
  const [tag, setTag] = useState("");
  const [tagStations, setTagStations] = useState([]);
  const [moreLoading, setMoreLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [insideQuery, setInsideQuery] = useState("");
  const { play } = usePlayer();

  // ---- paging state -------------------------------------------------------
  // Kept in refs, not state: a page load reads all of this synchronously, and a
  // stale closure would either skip a page or request the same one twice.
  const pageRef = useRef({ kind: null, country: null, tag: "", query: "" });
  const offsetRef = useRef(0);
  const totalRef = useRef(0);
  const seenRef = useRef(new Set());
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const sentinelRef = useRef(null);
  // The list's own scroll container. The sentinel is observed against THIS, not the
  // viewport: the panel's bottom edge sits below the window on a phone-sized window,
  // so a sentinel parked at the end of the list is outside the viewport even when the
  // list is scrolled to the very bottom — and an observer rooted on the viewport then
  // never fires, which is exactly how the first version of this failed.
  const scrollRef = useRef(null);

  const fetchPage = useCallback(async (offset) => {
    const p = pageRef.current;
    if (p.kind === "country") {
      return getByCountry({
        country: p.country.name,
        countrycode: p.country.code,
        limit: PAGE_SIZE,
        offset,
      });
    }
    if (p.kind === "tag") return getByTag(p.tag, PAGE_SIZE, offset);
    if (p.kind === "search") {
      return searchStations({
        q: p.query,
        countrycode: p.country ? p.country.code : "",
        limit: PAGE_SIZE,
        offset,
      });
    }
    return [];
  }, []);

  const appendRows = useCallback((kind, rows) => {
    if (!rows.length) return;
    if (kind === "tag") setTagStations((prev) => prev.concat(rows));
    else setCountryStations((prev) => prev.concat(rows));
  }, []);

  // Asks for the next page of whatever list is open, and doubles as "load page one".
  const loadMore = useCallback(async () => {
    if (busyRef.current || doneRef.current || !pageRef.current.kind) return;
    busyRef.current = true;
    setMoreLoading(true);
    try {
      const rows = await fetchPage(offsetRef.current);
      const fresh = [];
      rows.forEach((s) => {
        if (seenRef.current.has(s.id)) return;
        seenRef.current.add(s.id);
        fresh.push(s);
      });
      // Advance by what actually came back, not by the page size we asked for: the
      // row pipeline drops stations that cannot play, so a list of 90 arrives as 80,
      // and a fixed step would jump past the tail of it. Duplicates are dropped by the
      // seen-set, which makes an overlapping step safe.
      offsetRef.current += rows.length;
      appendRows(pageRef.current.kind, fresh);
      const pastReportedTotal = totalRef.current > 0 && offsetRef.current >= totalRef.current;
      const nothingNew = !rows.length || !fresh.length;
      if (nothingNew || pastReportedTotal || offsetRef.current >= PAGE_SIZE * MAX_PAGES) {
        doneRef.current = true;
        setDone(true);
      }
    } catch {
      // A page that failed must not leave the sentinel asking forever.
      doneRef.current = true;
      setDone(true);
    } finally {
      busyRef.current = false;
      setMoreLoading(false);
    }
  }, [appendRows, fetchPage]);

  const startPage = useCallback((source, total) => {
    pageRef.current = source;
    offsetRef.current = 0;
    totalRef.current = total || 0;
    seenRef.current = new Set();
    doneRef.current = false;
    setDone(false);
  }, []);

  // The sentinel at the end of a list asks for the next page when it scrolls into
  // view. The observer is re-armed after every page (the list lengths are in the
  // dependency list), so holding at the bottom keeps loading rather than stopping
  // after one page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: scrollRef.current || null, rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, done, countryStations.length, tagStations.length, openCountry, tag]);

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

  // One country is open. Opening it loads page one; typing in its own search box
  // switches that same list to a country-scoped search, and clearing the box
  // switches back. Both run through the same pager, so search results scroll on for
  // more matches too.
  //
  // The country list answers "what does this country listen to", which is the wrong
  // tool for "where is Radio City Mumbai" — the popular first page can easily not
  // contain the station you came for.
  const insideQueryTrimmed = insideQuery.trim();

  useEffect(() => {
    if (!openCountry) return undefined;
    loadCountryIndex();
    const searching = insideQueryTrimmed.length > 0;
    const t = setTimeout(async () => {
      setLoading(true);
      setCountryStations([]);
      if (searching) {
        startPage({ kind: "search", country: openCountry, tag: "", query: insideQueryTrimmed }, 0);
      } else {
        startPage({ kind: "country", country: openCountry, tag: "", query: "" }, openCountry.count);
      }
      try {
        await loadMore();
      } finally {
        setLoading(false);
      }
    }, searching ? 400 : 0);
    return () => clearTimeout(t);
  }, [openCountry, insideQueryTrimmed, loadMore, startPage]);

  // Share the whole country, not the line you happen to be looking at: the link
  // goes to the static page the build writes for it, which lists every station in
  // the country and opens instantly for whoever receives it.
  const shareCountry = useCallback((country) => {
    const url = absoluteUrl(`/country/${countrySlug(country.name)}/`);
    const label = country.count
      ? `${country.count} radio stations in ${country.name}`
      : `Radio stations in ${country.name}`;
    if (navigator.share) {
      navigator.share({ title: label, text: `${label} — live on World Radio`, url }).catch(() => {});
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() =>
        toast.success("Link copied", {
          description: `Anyone who opens it gets every ${country.name} station.`,
        })
      )
      .catch(() => toast.error("Couldn't copy the link"));
  }, []);

  const openCountryStations = useCallback((country) => {
    setOpenCountry(country);
    setCountryTotal(country.count || 0);
    setInsideQuery("");
  }, []);

  const pickTag = useCallback(
    async (t) => {
      setTag(t);
      setLoading(true);
      setTagStations([]);
      startPage({ kind: "tag", country: null, tag: t, query: "" }, 0);
      try {
        await loadMore();
      } finally {
        setLoading(false);
      }
    },
    [loadMore, startPage]
  );

  const filteredCountries = useMemo(() => {
    if (!countries) return [];
    const q = countryQuery.trim().toLowerCase();
    const list = q ? countries.filter((c) => c.name.toLowerCase().includes(q)) : countries;
    return list.slice(0, 200);
  }, [countries, countryQuery]);

  // The bottom of any paged list: the sentinel that asks for more, the notice while
  // it does, and an honest end-of-list line so the list never looks truncated.
  const pagerFooter = (shown) => (
    <>
      {!done && <div ref={sentinelRef} className="h-12" aria-hidden="true" />}
      {moreLoading && (
        <div className="py-2 text-center text-[11px] text-[#6f857b]">Loading more…</div>
      )}
      {done && shown > 0 && (
        <div className="py-3 text-center text-[11px] text-[#6f857b]">
          That&apos;s all {shown} {shown === 1 ? "station" : "stations"}.
        </div>
      )}
    </>
  );

  // A country is open: show its stations with a way back.
  if (openCountry) {
    const searching = insideQueryTrimmed.length > 0;
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 pb-2">
          <button
            onClick={() => setOpenCountry(null)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-[#9fb3aa] transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft size={15} /> Countries
          </button>
          <div className="min-w-0 flex-1 truncate text-sm text-white">
            {countryFlag(openCountry.code)} {openCountry.name}
          </div>
          <button
            onClick={() => shareCountry(openCountry)}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1.5 text-xs text-[#9fb3aa] transition-colors hover:bg-white/10 hover:text-white"
            title={`Share the full list of ${openCountry.name} stations`}
            aria-label={`Share the full list of ${openCountry.name} stations`}
          >
            <Share2 size={14} /> Share
          </button>
        </div>

        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
            <Search size={15} className="text-[#2fe08a]" />
            <input
              value={insideQuery}
              onChange={(e) => setInsideQuery(e.target.value)}
              placeholder={`Search stations in ${openCountry.name}`}
              aria-label={`Search stations in ${openCountry.name}`}
              className="w-full bg-transparent text-sm text-white placeholder:text-[#6f857b] focus:outline-none"
            />
            {insideQuery && (
              <button
                onClick={() => setInsideQuery("")}
                aria-label="Clear search"
                className="text-[#6f857b] transition-colors hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div ref={scrollRef}
            className="rm-scroll flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <Spinner />
          ) : countryStations.length ? (
            <>
              <div className="px-3 pb-2 text-[11px] text-[#6f857b]">
                {searching
                  ? `${countryStations.length} match${countryStations.length === 1 ? "" : "es"}`
                  : countryTotal
                  ? `${countryStations.length} of ${countryTotal} loaded`
                  : `${countryStations.length} loaded`}
              </div>
              <StationList stations={countryStations} onPlayFocus={onPlayFocus} />
              {pagerFooter(countryStations.length)}
            </>
          ) : (
            <div className="px-4 py-10 text-center text-sm text-[#8497a0]">
              {searching
                ? `No stations in ${openCountry.name} match the search.`
                : `No playable stations found for ${openCountry.name} right now.`}
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
        <div ref={scrollRef}
          className="rm-scroll mt-3 flex-1 overflow-y-auto px-2 pb-4">
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
          <div ref={scrollRef}
          className="rm-scroll mt-3 flex-1 overflow-y-auto px-2 pb-4">
            {loading ? (
              <Spinner />
            ) : tagStations.length ? (
              <>
                <div className="px-3 pb-2 text-[11px] capitalize text-[#6f857b]">
                  {tagStations.length} {tag} stations loaded
                </div>
                <StationList stations={tagStations} onPlayFocus={onPlayFocus} />
                {pagerFooter(tagStations.length)}
              </>
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
