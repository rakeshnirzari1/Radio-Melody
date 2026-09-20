// Radio Melody data layer — runs entirely in the browser, no owned backend.
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
      return await res.json();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Radio Browser unavailable");
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

const mapPlayable = (rows) => (rows || []).map(mapStation).filter(isPlayable);

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

export const getGeoStations = async (limit = 5000) => {
  const rows = await rbGet("/json/stations/search", {
    ...byClickcount,
    has_geo_info: "true",
    limit: String(limit),
  });
  return mapPlayable(rows);
};

export const getTopStations = async (limit = 40) => {
  const rows = await rbGet("/json/stations/search", {
    ...byClickcount,
    limit: String(limit),
  });
  return mapPlayable(rows);
};

export const searchStations = async ({ q = "", country = "", tag = "", limit = 60 } = {}) => {
  const params = { ...byClickcount, limit: String(limit) };
  if (q) params.name = q;
  if (country) params.country = country;
  if (tag) params.tag = tag;
  const rows = await rbGet("/json/stations/search", params);
  return mapPlayable(rows);
};

export const getCountries = async () => {
  const rows = await rbGet("/json/countries", { hidebroken: "true" });
  return (rows || [])
    .filter((c) => c.name)
    .map((c) => ({ name: c.name, count: c.stationcount }));
};

// ---- Single station / clusters ---------------------------------------------

export const getStation = async (stationId) => {
  const rows = await rbGet(`/json/stations/byuuid/${encodeURIComponent(stationId)}`);
  if (!rows || !rows.length) return null;
  return mapStation(rows[0]);
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

// With a relay configured every stream goes through it (https upgrade, plus it
// dodges the servers that reject browser user-agents). Without one, https
// streams play directly and http ones are filtered out of the catalogue.
export const streamUrl = (url) => {
  if (!url) return "";
  if (PROXY_URL) return `${PROXY_URL}/api/stream?url=${encodeURIComponent(url)}`;
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
