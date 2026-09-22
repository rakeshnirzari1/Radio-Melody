// Wake-up alarm: the settings, and the arithmetic for when it next fires.
//
// Honest limits, by platform: a web page can only wake you if the page is still
// alive. A background tab that is playing audio is kept alive by the browser; a tab
// that has been closed, or a home-screen app that iOS has suspended, cannot wake
// itself without native code. So this is a "radio alarm for the bedside phone or the
// tablet on the dresser" — the UI says so rather than pretending otherwise.

export const KEY = "rm_alarm_v1";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MODES = [
  { key: "daily", label: "Every day" },
  { key: "weekdays", label: "Weekdays" },
  { key: "weekends", label: "Weekends" },
  { key: "once", label: "Just once" },
];

const pad = (n) => String(n).padStart(2, "0");

export const defaultAlarm = () => ({
  enabled: false,
  time: "07:00",
  mode: "daily",
  stationId: "",
  stationName: "",
  fadeIn: true,
  lastFired: "",
});

export const readAlarm = () => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY));
    if (!raw || typeof raw !== "object") return defaultAlarm();
    const merged = { ...defaultAlarm(), ...raw };
    // Never trust stored shape: a corrupted value must not brick the watcher.
    if (!/^\d{2}:\d{2}$/.test(merged.time)) merged.time = "07:00";
    if (!MODES.some((m) => m.key === merged.mode)) merged.mode = "daily";
    merged.enabled = Boolean(merged.enabled);
    merged.fadeIn = merged.fadeIn !== false;
    merged.stationId = typeof merged.stationId === "string" ? merged.stationId.slice(0, 64) : "";
    merged.stationName =
      typeof merged.stationName === "string" ? merged.stationName.slice(0, 80) : "";
    merged.lastFired = typeof merged.lastFired === "string" ? merged.lastFired.slice(0, 32) : "";
    return merged;
  } catch {
    return defaultAlarm();
  }
};

export const writeAlarm = (cfg) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* storage blocked — the alarm simply will not survive a reload */
  }
};

const daysFor = (mode) => {
  if (mode === "weekdays") return [1, 2, 3, 4, 5];
  if (mode === "weekends") return [0, 6];
  return [0, 1, 2, 3, 4, 5, 6];
};

export const occurrenceKey = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${
    pad(date.getHours())
  }:${pad(date.getMinutes())}`;

/** Should the alarm go off at this minute? Fires once per occurrence, never twice. */
export const dueNow = (cfg, now = new Date()) => {
  if (!cfg || !cfg.enabled) return false;
  const [h, m] = String(cfg.time || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  if (now.getHours() !== h || now.getMinutes() !== m) return false;
  if (!daysFor(cfg.mode).includes(now.getDay())) return false;
  return cfg.lastFired !== occurrenceKey(now);
};

/** The next time it will fire, as a Date. Used for "Next: Wed 07:00 (in 7h 12m)". */
export const nextOccurrence = (cfg, from = new Date()) => {
  if (!cfg || !cfg.enabled) return null;
  const [h, m] = String(cfg.time || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const days = daysFor(cfg.mode);
  const at = new Date(from.getTime());
  at.setSeconds(0, 0);
  for (let i = 0; i < 8; i += 1) {
    const candidate = new Date(from.getTime());
    candidate.setDate(candidate.getDate() + i);
    candidate.setHours(h, m, 0, 0);
    if (days.includes(candidate.getDay()) && candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }
  at.setHours(h, m, 0, 0);
  return at;
};

export const describeNext = (cfg, from = new Date()) => {
  const next = nextOccurrence(cfg, from);
  if (!next) return "Off";
  const diffMs = next.getTime() - from.getTime();
  const mins = Math.round(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  const when =
    hours >= 24
      ? `${Math.floor(hours / 24)}d ${hours % 24}h`
      : hours > 0
        ? `${hours}h ${rem}m`
        : `${rem}m`;
  const day = DAY_LABELS[next.getDay()];
  const sameDay = next.toDateString() === from.toDateString();
  return `${sameDay ? "today" : day} ${pad(next.getHours())}:${pad(next.getMinutes())} · in ${when}`;
};

/** A time a minute from now, for the "try it" button. */
export const testTime = (from = new Date()) => {
  const t = new Date(from.getTime() + 60000);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
