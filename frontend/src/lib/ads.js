// Advertisement breaks.
//
// The adverts are served from this app's own build, at <base>/audio/breaks/.
// They used to live on a third-party site, which meant every break depended on
// someone else's server, hotlink rules and uptime — and a folder that answered
// 403 to a listing. Shipping them with the app removes all of that.
//
// A media element can load a file that fetch() cannot read, which is all we need
// to learn whether adN.mp3 exists, so the list is discovered by probing ad1..adN
// and cached in localStorage. Adding a new advert is just dropping ad<N>.mp3 into
// frontend/public/audio/breaks/ (or the deployed folder) — no code change.
// Names must be ad1.mp3, ad2.mp3, ... (gaps are fine).

// Same-origin by default, and correct under any base path: PUBLIC_URL is inlined by
// the build, so this is /audio/breaks/ at a domain root and /<repo>/audio/breaks/ if
// the app is ever served from a subfolder again.
const DEFAULT_BASE = `${(process.env.PUBLIC_URL || "").replace(/\/+$/, "")}/audio/breaks/`;

export const AD_BASE_URL =
  (process.env.REACT_APP_AD_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "") + "/";

const CACHE_KEY = "rm_ads_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_PROBE = 40; // highest ad number we look for
const MAX_GAP = 6; // give up after this many consecutive missing numbers
const PARALLEL = 4; // probes in flight at once
const PROBE_TIMEOUT_MS = 8000;

// Break cadence. The localStorage knob exists so the interval can be shortened
// when testing without rebuilding the app.
// Five minutes: the cadence is fixed for everyone, and nothing can stretch it - not the
// localStorage knob, not the build env. The knob still works, but only downwards, so a
// short interval can be tested without shipping a shorter one.
const AD_INTERVAL_MINUTES = 5;

const readIntervalMinutes = () => {
  try {
    const override = Number(window.localStorage.getItem("rm_ad_interval_min"));
    if (override > 0) return Math.min(override, AD_INTERVAL_MINUTES);
  } catch {
    /* private mode */
  }
  const configured = Number(process.env.REACT_APP_AD_INTERVAL_MINUTES);
  return configured > 0 ? Math.min(configured, AD_INTERVAL_MINUTES) : AD_INTERVAL_MINUTES;
};

// Resolved at call time, not at import time. As a module-level constant this froze
// when the bundle loaded, so the rm_ad_interval_min test knob (and any change to it)
// only took effect after a full page reload — which made a perfectly correct
// 1-minute test look like the ad engine was broken.
export const adIntervalMs = () => readIntervalMinutes() * 60 * 1000;

const readCache = () => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CACHE_KEY));
    // An empty list is nearly always a failed discovery — a blocked request, an 8s
    // timeout — not a folder that genuinely has no ads. Caching that for a day meant
    // one bad moment silenced every break until tomorrow, so treat it as unknown and
    // look again.
    if (
      raw &&
      Array.isArray(raw.urls) &&
      raw.urls.length > 0 &&
      Date.now() - raw.at < CACHE_TTL_MS &&
      // Only valid for the folder it was discovered in. The adverts have already moved
      // host once (a third-party site -> the app itself); without this the cache kept
      // the old absolute URLs alive for up to a day, so a correct move looked like it
      // had not happened at all.
      raw.urls.every((u) => typeof u === "string" && u.startsWith(AD_BASE_URL))
    ) {
      return raw.urls;
    }
  } catch {
    /* ignore */
  }
  return null;
};

const writeCache = (urls) => {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), urls }));
  } catch {
    /* ignore */
  }
};

// Resolves true when the browser can load audio metadata for the URL. The
// element is never played, so this costs a metadata (range) request per ad.
const probe = (url) =>
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
      resolve(ok);
    };

    el.preload = "metadata";
    el.onloadedmetadata = () => finish(true);
    el.onerror = () => finish(false);
    timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    el.src = url;
  });

let inFlight = null;

export const getAds = () => {
  const cached = readCache();
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const found = [];
    let n = 1;
    let gap = 0;

    while (n <= MAX_PROBE && gap < MAX_GAP) {
      const batch = [];
      for (let k = 0; k < PARALLEL && n <= MAX_PROBE && gap < MAX_GAP; k += 1, n += 1) {
        const num = n;
        batch.push(
          probe(`${AD_BASE_URL}ad${num}.mp3`).then((ok) => ({ num, ok }))
        );
      }
      const results = (await Promise.all(batch)).sort((a, b) => a.num - b.num);
      for (const r of results) {
        if (r.ok) {
          found.push(`${AD_BASE_URL}ad${r.num}.mp3`);
          gap = 0;
        } else {
          gap += 1;
        }
      }
    }

    inFlight = null;
    // Only ever cache a real discovery — see readCache().
    if (found.length) writeCache(found);
    return found;
  })();

  return inFlight;
};

// An advert that failed to play is remembered for this session, so the next break does
// not walk into the same wall. Session-scoped on purpose: a stalled download today is no
// verdict on the file tomorrow.
const failedAds = new Set();
export const noteAdFailure = (url) => {
  if (url) failedAds.add(url);
};

export const pickAd = async (exclude = []) => {
  const ads = (await getAds()).filter((a) => !failedAds.has(a));
  if (!ads.length) return null;
  const pool = ads.filter((a) => !exclude.includes(a));
  const list = pool.length ? pool : ads;
  return list[Math.floor(Math.random() * list.length)];
};
