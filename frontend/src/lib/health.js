// Station health memory.
//
// Radio-Browser's `hidebroken` flag is a community judgement and often wrong:
// plenty of listed stations are dead, geo-blocked or only reachable from some
// networks. Rather than re-offering the same dud every time the queue reaches it,
// remember which streams have failed on THIS device and deprioritise them. A
// success clears the record, so a station that was just having a bad day comes
// back on its own.
const KEY = "rm_station_health_v1";
const MAX_ENTRIES = 600;
// After this many failures a station is parked at the back of the queue, but
// never removed — it may work tomorrow, or from another network.
export const BAD_THRESHOLD = 2;

let cache = null;

const read = () => {
  if (cache) return cache;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY));
    cache = raw && typeof raw === "object" ? raw : {};
  } catch {
    cache = {};
  }
  return cache;
};

const write = () => {
  try {
    const entries = Object.entries(cache || {})
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, MAX_ENTRIES);
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or blocked — health is a nicety, never a hard failure */
  }
};

export const noteFailure = (station) => {
  if (!station || !station.id) return;
  const store = read();
  const prev = store[station.id] || { fails: 0, name: station.name };
  store[station.id] = {
    fails: prev.fails + 1,
    at: Date.now(),
    name: station.name || prev.name,
  };
  write();
};

export const noteSuccess = (station) => {
  if (!station || !station.id) return;
  const store = read();
  if (store[station.id]) {
    delete store[station.id];
    write();
  }
};

export const failCount = (station) => {
  if (!station || !station.id) return 0;
  const rec = read()[station.id];
  return rec && rec.fails ? rec.fails : 0;
};

// Known-bad stations go to the end of a queue, but stay in it: an empty queue
// would be worse than a long shot.
export const orderByHealth = (list) => {
  if (!Array.isArray(list) || list.length < 2) return list;
  const good = [];
  const doubtful = [];
  for (const s of list) {
    if (failCount(s) >= BAD_THRESHOLD) doubtful.push(s);
    else good.push(s);
  }
  return doubtful.length ? [...good, ...doubtful] : list;
};

export const healthSummary = () => {
  const store = read();
  const ids = Object.keys(store);
  return {
    known: ids.length,
    parked: ids.filter((id) => (store[id].fails || 0) >= BAD_THRESHOLD).length,
  };
};

export const clearHealth = () => {
  cache = {};
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
