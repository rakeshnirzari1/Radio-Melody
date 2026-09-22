// Favourites backup: export, share link, and import.
//
// Import is the only door in this app that takes data from outside itself — it comes
// in as a pasted code or a ?favs= link a stranger can send — so it is treated as
// hostile input, not as "our own JSON coming back":
//
//   * JSON only. Nothing is ever eval'd, and no field is ever inserted as HTML.
//   * Hard caps on the payload size and on how many stations it may claim.
//   * Every field is whitelisted, type-checked, length-capped and range-checked;
//     unknown fields are dropped rather than stored.
//   * Every URL is forced to http/https — no javascript:, no data:, no blob:.
//   * Station ids must match the shape the catalogue actually uses, because ids get
//     interpolated into API paths.
//   * Names cannot bring back a blocked station.
//   * Anything invalid is dropped and counted, never imported "best effort".
import { isBlockedStation } from "./radioApi";

const MAX_CODE_CHARS = 400000;
const MAX_ITEMS = 2000;
const MAX_TEXT = 200;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/g;

const cleanText = (v, max = MAX_TEXT) => {
  if (typeof v !== "string") return "";
  return v
    .replace(CONTROL, " ")
    // Angle brackets have no business in a station name, a country or a codec. React
    // already escapes text nodes and the globe tooltip escapes its own HTML, but a
    // name that cannot contain markup at all removes the whole question.
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
};

const cleanNumber = (v, min, max) => {
  // An explicit null/"" means "no coordinate", which is a legitimate state for a
  // station. Without this guard Number(null) is 0, and the station would be plotted
  // off the coast of Africa.
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const cleanUrl = (v) => {
  const s = cleanText(v, 500);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
};

/**
 * One station, rebuilt from scratch out of validated pieces. Returns null when the
 * entry is not usable as a station at all.
 */
export const sanitiseStation = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = cleanText(raw.id, 64);
  if (!ID_RE.test(id)) return null;
  const name = cleanText(raw.name, 120);
  if (!name) return null;
  const url = cleanUrl(raw.url);
  if (!url) return null;

  const lat = cleanNumber(raw.lat, -90, 90);
  const lng = cleanNumber(raw.lng, -180, 180);
  const hasLatLng = lat !== null && lng !== null;

  return {
    id,
    name,
    url,
    favicon: cleanUrl(raw.favicon),
    country: cleanText(raw.country),
    countrycode: cleanText(raw.countrycode, 3).toUpperCase(),
    state: cleanText(raw.state),
    tags: cleanText(raw.tags, 300),
    language: cleanText(raw.language, 80),
    codec: cleanText(raw.codec, 24),
    bitrate: cleanNumber(raw.bitrate, 0, 100000) || 0,
    votes: cleanNumber(raw.votes, 0, 1e9) || 0,
    clickcount: cleanNumber(raw.clickcount, 0, 1e9) || 0,
    // Half a coordinate is worse than none: it would put the station on the globe at
    // the equator or on the prime meridian.
    lat: hasLatLng ? lat : null,
    lng: hasLatLng ? lng : null,
  };
};

// A cheap integrity check, not a security one: it catches a code that was truncated
// by a chat app wrapping, or copied without its last line.
const checksum = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
};

const b64urlEncode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlDecode = (code) => {
  const normalised = code.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

const payloadFor = (favorites, limit) => {
  const list = (favorites || []).slice(0, limit).map(sanitiseStation).filter(Boolean);
  return list;
};

/** The backup code to paste into another phone, and the JSON to keep as a file. */
export const buildBackup = (favorites) => {
  const stations = payloadFor(favorites, MAX_ITEMS);
  const body = JSON.stringify({ v: 1, s: stations });
  return {
    count: stations.length,
    code: `v1.${b64urlEncode(body)}.${checksum(body)}`,
    json: JSON.stringify({ v: 1, exported: new Date().toISOString(), stations }, null, 2),
  };
};

/** A link that carries favourites to someone else (capped: URLs have limits). */
export const buildShareLink = (favorites, origin, max = 60) => {
  const stations = payloadFor(favorites, max);
  const body = JSON.stringify({ v: 1, s: stations });
  const base = (origin || "").replace(/\/+$/, "");
  return {
    count: stations.length,
    truncated: (favorites || []).length > stations.length,
    url: `${base}/?favs=${b64urlEncode(body)}`,
  };
};

/**
 * Read a backup code, a ?favs= payload or an exported JSON file.
 * Always returns a shape; never throws.
 */
export const parseBackup = (input) => {
  const fail = (error) => ({ items: [], dropped: 0, error });
  if (typeof input !== "string") return fail("Nothing to import");
  const text = input.trim();
  if (!text) return fail("Nothing to import");
  if (text.length > MAX_CODE_CHARS) {
    return fail("That backup is far too large to be a favourites list");
  }

  let data = null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      data = JSON.parse(text);
    } catch {
      return fail("That file isn't valid JSON");
    }
  } else {
    // A backup code, with or without the version prefix and the checksum suffix.
    const parts = text.replace(/^v1[.:]/, "").split(".");
    const body = parts[0].replace(/\s+/g, "");
    const given = parts[1];
    try {
      data = JSON.parse(b64urlDecode(body));
    } catch {
      return fail("That backup code isn't readable — check it was pasted in full");
    }
    if (given && checksum(JSON.stringify({ v: data.v || 1, s: data.s || data })) !== given) {
      // Only a warning-grade mismatch: still import, but say so.
      data.__checksumMismatch = true;
    }
  }

  const list = Array.isArray(data)
    ? data
    : data && Array.isArray(data.s)
      ? data.s
      : data && Array.isArray(data.stations)
        ? data.stations
        : null;
  if (!list) return fail("No favourites found in that backup");
  if (list.length > MAX_ITEMS) {
    return fail(`That backup lists more than ${MAX_ITEMS} stations`);
  }

  const items = [];
  const seen = new Set();
  let dropped = 0;
  let blocked = 0;
  for (const raw of list) {
    const station = sanitiseStation(raw);
    if (!station) {
      dropped += 1;
      continue;
    }
    if (isBlockedStation(station)) {
      blocked += 1;
      continue;
    }
    if (seen.has(station.id)) continue;
    seen.add(station.id);
    items.push(station);
  }

  if (!items.length) {
    return { items: [], dropped, error: "None of the entries in that backup were valid stations" };
  }
  return {
    items,
    dropped,
    blocked,
    checksumMismatch: Boolean(data.__checksumMismatch),
    error: null,
  };
};
