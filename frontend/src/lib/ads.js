// Advertisement breaks.
//
// The ad folder (shoppingdeals.au/advertisements-for-radio-melody/) returns 403
// for directory listings and sends no CORS headers, so the browser can neither
// list it nor fetch() it. What it CAN do is load a file into a media element —
// which is all we need to find out whether adN.mp3 exists. So the list is
// discovered by probing ad1..adN, then cached in localStorage for a day.
//
// Adding a new ad is therefore just dropping ad<N>.mp3 into the folder on your
// site — no redeploy here. Names must be ad1.mp3, ad2.mp3, ... (gaps are fine).

const DEFAULT_BASE =
  "https://shoppingdeals.au/advertisements-for-radio-melody/";

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
const readIntervalMinutes = () => {
  try {
    const override = Number(window.localStorage.getItem("rm_ad_interval_min"));
    if (override > 0) return override;
  } catch {
    /* private mode */
  }
  const configured = Number(process.env.REACT_APP_AD_INTERVAL_MINUTES);
  return configured > 0 ? configured : 20;
};

export const AD_INTERVAL_MS = readIntervalMinutes() * 60 * 1000;

const readCache = () => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CACHE_KEY));
    if (raw && Array.isArray(raw.urls) && Date.now() - raw.at < CACHE_TTL_MS) {
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
    writeCache(found);
    return found;
  })();

  return inFlight;
};

export const pickAd = async (exclude = []) => {
  const ads = await getAds();
  if (!ads.length) return null;
  const pool = ads.filter((a) => !exclude.includes(a));
  const list = pool.length ? pool : ads;
  return list[Math.floor(Math.random() * list.length)];
};
