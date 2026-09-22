// World Radio data layer — runs entirely in the browser, no owned backend.
//
//   * Station catalogue / search / city clusters → called straight from the browser
//     against the public Radio-Browser API, which sends `Access-Control-Allow-Origin: *`.
//   * Audio → played straight from the station URL when it is https.
//   * Two things genuinely cannot be done from a static page:
//       - http:// streams on an https page  (browser mixed-content block)
//       - ICY "now playing" song titles     (browsers can't read icy-* headers)
//     Both switch on automatically when REACT_APP_PROXY_URL points at the free
//     Cloudflare Worker in /worker (see worker/README.md). Nothing else changes.
//
// With no relay configured the app still works, minus http-only stations and the
// song title line — those are filtered out instead of failing mid-playback.
//
// HTTPS rescue: Radio-Browser lists ~19% of stations as http:// only, and a
// browser blocks http media on an https page. Many of those servers are in fact
// reachable over https at the same host and port — so before hiding a station,
// we swap the scheme, keep it if it answers with audio, and never play http.
// `data/https-upgrades.json` holds URLs verified this way; anything not in that
// list is probed once per browser and cached (see rescueHttpStations).

import HTTPS_UPGRADES from "../data/https-upgrades.json";

const SEEDED_HTTPS = new Set(HTTPS_UPGRADES.urls || []);

const RB_SERVERS = [
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

const RB_TIMEOUT_MS = 20000;

// Optional free https relay (Cloudflare Worker). Empty string = not configured.
export const PROXY_URL = (process.env.REACT_APP_PROXY_URL || "")
  .trim()
  .replace(/\/+$/, "");

export const hasRelay = Boolean(PROXY_URL);

const rbGet = async (path, params) => {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  const shuffled = [...RB_SERVERS].sort(() => Math.random() - 0.5);
  let lastError;

  for (const base of shuffled) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RB_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}${qs}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`radio-browser ${res.status}`);
      const data = await res.json();
      // Every station the app can ever show arrives through here — the globe, search,
      // trending, a deep link, the city/nearby panels — so one filter at this choke
      // point keeps a name out of the app everywhere, rather than hiding it in each
      // view and hoping none was missed.
      return Array.isArray(data) ? data.filter((row) => !isBlockedStation(row)) : data;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Radio Browser unavailable");
};

// Stations this app will not carry. Matched on the station name, ignoring case and
// spacing, so "Voice of Islam", "Voice Of Islam" and "VoiceofIslam" are all caught.
const BLOCKED_NAME = /voice\s*of\s*islam|voiceofislam/i;

export const isBlockedStation = (station) => {
  if (!station) return false;
  const name = station.name || station.station_name || "";
  return BLOCKED_NAME.test(name);
};

const mapStation = (s) => ({
  id: s.stationuuid,
  name: (s.name || "").trim(),
  url: s.url_resolved || s.url,
  favicon: s.favicon,
  country: s.country,
  countrycode: s.countrycode,
  state: s.state,
  tags: s.tags,
  language: s.language,
  codec: s.codec,
  bitrate: s.bitrate,
  votes: s.votes,
  clickcount: s.clickcount,
  lat: s.geo_lat,
  lng: s.geo_long,
});

// A station is playable from an https page only if it streams over https,
// unless the relay is configured (it upgrades http streams for us).
export const isPlayable = (station) =>
  hasRelay || /^https:/i.test((station && station.url) || "");

const toHttps = (url) => (url || "").replace(/^http:\/\//i, "https://");

// ---- HTTPS rescue -----------------------------------------------------------

const PROBE_CACHE_KEY = "rm_https_probe_v1";
const PROBE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8000;
const PROBE_CONCURRENCY = 6;
const MAX_PROBES_PER_SESSION = 120;

const readProbeCache = () => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PROBE_CACHE_KEY));
    if (raw && raw.at && Date.now() - raw.at < PROBE_TTL_MS && raw.results) {
      return raw.results;
    }
  } catch {
    /* ignore */
  }
  return {};
};

let probeCache = null;
const writeProbeCache = () => {
  try {
    window.localStorage.setItem(
      PROBE_CACHE_KEY,
      JSON.stringify({ at: Date.now(), results: probeCache })
    );
  } catch {
    /* ignore */
  }
};

// Loads a stream's metadata only. Resolves true when the browser gets far enough
// to play it; the connection is then dropped without ever producing sound.
const probeHttps = (url) =>
  new Promise((resolve) => {
    const el = new Audio();
    let settled = false;
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute("src");
      try {
        el.load(); // releases the connection
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => finish(true);
    el.onerror = () => finish(false);
    timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    el.src = url;
  });

// The https twin of a station URL, if we already know it works (seed list or a
// previous probe). No network access — safe to call during render.
export const knownHttps = (url) => {
  if (!url || !/^http:\/\//i.test(url)) return null;
  const https = toHttps(url);
  if (SEEDED_HTTPS.has(https)) return https;
  if (probeCache === null) probeCache = readProbeCache();
  return probeCache[https] === true ? https : null;
};

// Probes the http-only stations that are not in the seed list yet, a few at a
// time, calling onBatch with the ones that answered. Cached for a week, and
// capped per session so a first visit doesn't hammer 900 servers.
export const rescueHttpStations = async (stations, onBatch) => {
  if (hasRelay || !stations.length) return;
  if (probeCache === null) probeCache = readProbeCache();

  const todo = stations
    .filter((s) => s && /^http:\/\//i.test(s.url || ""))
    .filter((s) => !SEEDED_HTTPS.has(toHttps(s.url)))
    .filter((s) => probeCache[toHttps(s.url)] === undefined)
    .slice(0, MAX_PROBES_PER_SESSION);

  if (!todo.length) return;

  let index = 0;
  let done = 0;
  let rescued = [];
  const worker = async () => {
    while (index < todo.length) {
      const station = todo[index];
      index += 1;
      const https = toHttps(station.url);
      let ok = false;
      try {
        ok = await probeHttps(https);
      } catch {
        ok = false;
      }
      probeCache[https] = ok;
      done += 1;
      // Persist as we go: a probe pass can take a minute or two, and closing the
      // tab part-way should not throw the findings away.
      if (done % 10 === 0) writeProbeCache();
      if (ok) {
        rescued.push({ ...station, url: https });
        // Hand them over in small batches so the globe fills in as we go.
        if (rescued.length >= 10 && onBatch) {
          onBatch(rescued);
          rescued = [];
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, todo.length) }, worker)
  );

  writeProbeCache();
  if (rescued.length && onBatch) onBatch(rescued);
};

// A station whose https twin is already known to work has its URL rewritten, so
// it stays in the catalogue at zero network cost.
const upgradeKnown = (station) => {
  const https = knownHttps(station.url);
  return https ? { ...station, url: https } : station;
};

const mapPlayable = (rows) => (rows || []).map(mapStation).map(upgradeKnown).filter(isPlayable);

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p))) / 2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0, a)));
};

const byClickcount = {
  hidebroken: "true",
  order: "clickcount",
  reverse: "true",
};

// ---- Catalogue --------------------------------------------------------------
//
// The globe holds every geolocated station Radio-Browser knows about, which is
// ~12,600 rows today, and it is fetched in pages so the first screen appears
// fast. Page one is awaited; the rest arrive in the background and are merged in
// as they land. (A single request for all of them is refused by the API — a
// limit of 50000 on the unfiltered search returns 502.)

const GEO_PAGE_SIZE = 4000;
const GEO_BACKGROUND_PAGES = 4; // ≈ 20,000 rows scanned, more than the geo set

const fetchGeoPage = (offset, limit) =>
  rbGet("/json/stations/search", {
    ...byClickcount,
    has_geo_info: "true",
    limit: String(limit),
    offset: String(offset),
  });

export const getGeoStations = async ({ onBatch } = {}) => {
  const firstRows = (await fetchGeoPage(0, GEO_PAGE_SIZE)) || [];
  const first = firstRows.map(mapStation);
  const firstPlayable = first.map(upgradeKnown).filter(isPlayable);

  // Everything that is still http-only gets a chance to be rescued (cached, so
  // this is a no-op after the first visit).
  rescueHttpStations(first, onBatch).catch(() => {});

  if (onBatch) {
    (async () => {
      for (let page = 1; page <= GEO_BACKGROUND_PAGES; page += 1) {
        let rows;
        try {
          rows = await fetchGeoPage(page * GEO_PAGE_SIZE, GEO_PAGE_SIZE);
        } catch {
          return; // network hiccup or rate limit — keep what we have
        }
        if (!rows || !rows.length) return;

        const mapped = rows.map(mapStation);
        const playable = mapped.map(upgradeKnown).filter(isPlayable);
        if (playable.length) onBatch(playable);
        rescueHttpStations(mapped, onBatch).catch(() => {});

        if (rows.length < GEO_PAGE_SIZE) return; // catalogue exhausted
      }
    })();
  }

  return firstPlayable;
};

export const getTopStations = async (limit = 40) => {
  const rows = await rbGet("/json/stations/search", {
    ...byClickcount,
    limit: String(limit),
  });
  return mapPlayable(rows);
};

// "Trending" means clicked in the last 24 hours, which is a different (and much
// more interesting) list than order=clickcount, which is historical.
export const getTrending = async (limit = 50) => {
  const rows = await rbGet(`/json/stations/topclick/${Math.min(100, limit)}`);
  return mapPlayable(rows);
};

// Everything in one country, most popular first. Used by country browsing, where
// the point is to see a place rather than a search result list.
// `offset` is what makes a big country browsable: the caller walks the list a page
// at a time as the reader scrolls, instead of being handed the first page and left
// to assume that was everything.
export const getByCountry = async ({
  country = "",
  countrycode = "",
  limit = 100,
  offset = 0,
} = {}) => {
  const params = { ...byClickcount, limit: String(limit) };
  if (offset > 0) params.offset = String(offset);
  if (countrycode) params.countrycode = countrycode.toUpperCase();
  else if (country) params.country = country;
  else return [];
  const rows = await rbGet("/json/stations/search", params);
  return mapPlayable(rows);
};

export const getByTag = async (tag, limit = 80, offset = 0) => {
  if (!tag) return [];
  const params = { ...byClickcount, tag, limit: String(limit) };
  if (offset > 0) params.offset = String(offset);
  const rows = await rbGet("/json/stations/search", params);
  return mapPlayable(rows);
};

export const searchStations = async ({
  q = "",
  country = "",
  countrycode = "",
  tag = "",
  limit = 60,
  offset = 0,
} = {}) => {
  const params = { ...byClickcount, limit: String(limit) };
  if (offset > 0) params.offset = String(offset);
  if (q) params.name = q;
  // countrycode beats country here: some country names in the table do not match
  // the name the search endpoint indexes, and the code always does.
  if (countrycode) params.countrycode = countrycode.toUpperCase();
  else if (country) params.country = country;
  if (tag) params.tag = tag;
  const rows = await rbGet("/json/stations/search", params);
  return mapPlayable(rows);
};

export const getCountries = async () => {
  const rows = await rbGet("/json/countries", { hidebroken: "true" });
  return (rows || [])
    .filter((c) => c.name)
    .map((c) => ({
      name: c.name,
      count: c.stationcount,
      code: c.iso_3166_1 || "",
    }))
    .sort((a, b) => b.count - a.count);
};

// ---- Single station / clusters ---------------------------------------------

export const getStation = async (stationId) => {
  const rows = await rbGet(`/json/stations/byuuid/${encodeURIComponent(stationId)}`);
  if (!rows || !rows.length) return null;
  return mapStation(rows[0]);
};

/**
 * Resolve several station ids at once, for a compact favourites link.
 *
 * The catalogue's byuuid endpoint takes one id: a comma-separated list answers 200
 * with an empty array, which is worse than an error because it reads as "those
 * stations are gone" (measured, so this walks the ids instead). Waves of five keep a
 * sixty-station link to roughly a second without hammering a free community API, and
 * a station that fails to resolve is dropped rather than failing the whole link.
 */
export const getStationsByIds = async (ids, wave = 5) => {
  const list = (ids || []).filter(Boolean);
  const out = [];
  for (let i = 0; i < list.length; i += wave) {
    const batch = list.slice(i, i + wave);
    // eslint-disable-next-line no-await-in-loop
    const rows = await Promise.all(batch.map((id) => getStation(id).catch(() => null)));
    rows.forEach((s) => {
      if (s) out.push(s);
    });
  }
  return out;
};

export const getNearby = async (stationId) => {
  const base = await getStation(stationId);
  if (!base) return { station: null, nearby: [] };
  const rows = await rbGet("/json/stations/search", {
    ...byClickcount,
    country: base.country || "",
    limit: "40",
  });
  return {
    station: base,
    nearby: mapPlayable(rows).filter((s) => s.id !== stationId),
  };
};

// Stations clustered around the clicked station (~120 km, else same state).
export const getCity = async (stationId) => {
  const baseRow = await rbGet(`/json/stations/byuuid/${encodeURIComponent(stationId)}`);
  if (!baseRow || !baseRow.length) return null;
  const base = mapStation(baseRow[0]);

  let pool = [];
  try {
    pool = (
      await rbGet("/json/stations/search", {
        ...byClickcount,
        country: base.country || "",
        has_geo_info: "true",
        limit: "500",
      })
    ).map(mapStation);
  } catch {
    pool = [];
  }

  let results = [];
  if (base.lat != null && base.lng != null) {
    results = pool
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ ...s, distance: Number(haversineKm(base.lat, base.lng, s.lat, s.lng).toFixed(1)) }))
      .filter((s) => s.distance <= 120)
      .sort((a, b) => a.distance - b.distance);
  }
  if (results.length < 2 && base.state) {
    results = pool.filter((s) => s.state === base.state);
  }
  if (!results.length) results = [base];

  return {
    city: (base.state || "").trim() || base.name,
    country: base.country,
    station: base,
    stations: results.filter(isPlayable).slice(0, 60),
  };
};

// Radio-Browser click counter (feeds the global "most popular" ordering).
export const registerClick = async (stationId) => {
  if (!stationId) return;
  try {
    await rbGet(`/json/url/${encodeURIComponent(stationId)}`);
  } catch {
    /* silent — never block playback on a counter */
  }
};

// ---- Audio + artwork --------------------------------------------------------

// Only http:// streams need the relay: an https page cannot play http media.
// Everything else plays directly, so if the relay is ever over quota or down the
// site degrades to "https stations only" instead of losing the whole player.
export const streamUrl = (url) => {
  if (!url) return "";
  if (PROXY_URL && !/^https:/i.test(url)) {
    return `${PROXY_URL}/api/stream?url=${encodeURIComponent(url)}`;
  }
  return url;
};

// Favicon proxied through the relay so canvas colour sampling stays same-origin
// clean. Without a relay we use the direct URL: it still displays, but the
// canvas is tainted so the glow falls back to the default colour.
export const imgProxyUrl = (url) => {
  if (!url) return "";
  if (PROXY_URL) return `${PROXY_URL}/api/img?url=${encodeURIComponent(url)}`;
  return url;
};

// ICY metadata (current song/artist) is unreadable from a browser — it needs the
// relay. Returns { title: null } when there is none so callers stay quiet.
export const getNowPlaying = async (url) => {
  if (!url || !PROXY_URL) return { title: null, name: null };
  try {
    const res = await fetch(`${PROXY_URL}/api/nowplaying?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { title: null, name: null };
    const data = await res.json();
    return { title: data.title || null, name: data.name || null };
  } catch {
    return { title: null, name: null };
  }
};
