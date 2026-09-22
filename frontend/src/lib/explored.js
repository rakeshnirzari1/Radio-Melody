// "Around the World" — which countries you have actually heard.
//
// Recorded when a station becomes the one on air (not when it is merely tapped),
// so the count means something. Kept in localStorage like everything else: no
// account, no server, nothing to leak.
const KEY = "rm_world_v1";
const MILESTONES = [5, 10, 15, 25, 40, 60, 80, 100];

let cache = null;
const listeners = new Set();

const read = () => {
  if (cache) return cache;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY));
    cache = raw && typeof raw === "object" && raw.countries ? raw : { countries: {} };
  } catch {
    cache = { countries: {} };
  }
  return cache;
};

const write = () => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => {
    try {
      fn(cache);
    } catch {
      /* ignore */
    }
  });
};

export const countryFlag = (code) => {
  const cc = (code || "").trim().toUpperCase();
  if (cc.length !== 2) return "🌍";
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
};

// Returns { code, name, isNew, milestone } so the caller can celebrate.
export const noteCountry = (station) => {
  if (!station || !station.countrycode) return null;
  const code = station.countrycode.toUpperCase();
  const store = read();
  const prev = store.countries[code];
  const isNew = !prev;
  store.countries[code] = {
    name: station.country || (prev && prev.name) || code,
    plays: (prev ? prev.plays : 0) + 1,
    at: Date.now(),
  };
  write();
  const total = Object.keys(store.countries).length;
  return {
    code,
    name: store.countries[code].name,
    isNew,
    total,
    milestone: isNew && MILESTONES.includes(total) ? total : null,
  };
};

export const worldProgress = () => {
  const store = read();
  const entries = Object.entries(store.countries).map(([code, v]) => ({ code, ...v }));
  entries.sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));
  const next = MILESTONES.find((m) => m > entries.length) || null;
  return { total: entries.length, countries: entries, next };
};

export const subscribeWorld = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const resetWorld = () => {
  cache = { countries: {} };
  write();
};

export const WORLD_MILESTONES = MILESTONES;
