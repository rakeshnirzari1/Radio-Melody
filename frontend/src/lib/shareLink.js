// Compact favourites links.
//
// A ?favs= link carries a whole record per station — name, logo, country, tags,
// coordinates, click counts — roughly 130 characters each, so twenty stations
// produce a URL around 2,300 characters long. Nobody can read it, and some chat
// clients wrap it across lines and break it.
//
// Playback only needs to know *which* stations. A catalogue id is a UUID: 32 hex
// characters, 16 bytes once packed. The compact form is exactly those bytes,
// base64url-encoded, behind a version prefix:
//
//     /?f=c1.0bjBkGrNpRc9SztCgWyLdgJq4mX1z8YvB2nQ5rT7wS9dF3hK6pL0aZ
//
// Nothing is lost and no server is needed: the app resolves the ids against the
// catalogue when the link is opened. The legacy ?favs= form still parses, and a
// legacy link is rewritten to the compact form in the address bar as soon as it
// loads, so links already sitting in people's messages keep working.
//
// Ids that are not UUIDs (an imported station may carry any id the validator
// allows) cannot be packed. Callers fall back to the legacy link rather than
// silently dropping those stations.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMPACT_PREFIX = "c1.";

const bytesToB64url = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlToBytes = (code) => {
  const normalised = code.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const isUuid = (id) => UUID_RE.test(String(id || ""));

/** True when every id in the list survives the packing unchanged. */
export const isPackable = (stations) =>
  Array.isArray(stations) && stations.length > 0 && stations.every((s) => isUuid(s && s.id));

/** Pack station ids into the short form, or "" when any id is not a UUID. */
export const encodeCompact = (stations) => {
  if (!isPackable(stations)) return "";
  const bytes = new Uint8Array(stations.length * 16);
  stations.forEach((s, i) => {
    const hex = s.id.replace(/-/g, "");
    for (let j = 0; j < 16; j += 1) {
      bytes[i * 16 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
    }
  });
  return COMPACT_PREFIX + bytesToB64url(bytes);
};

/** Unpack a compact payload back into ids. Returns null when it is not one. */
export const decodeCompact = (code) => {
  if (typeof code !== "string" || !code.startsWith(COMPACT_PREFIX)) return null;
  let bytes;
  try {
    bytes = b64urlToBytes(code.slice(COMPACT_PREFIX.length));
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length % 16 !== 0) return null;
  const ids = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const hex = [];
    for (let j = 0; j < 16; j += 1) hex.push(bytes[i + j].toString(16).padStart(2, "0"));
    const h = hex.join("");
    ids.push(
      `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    );
  }
  return ids;
};

/** The short link for a list of stations, or "" when they cannot be packed. */
export const compactLink = (stations, origin) => {
  const code = encodeCompact(stations);
  if (!code) return "";
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/?f=${code}`;
};
