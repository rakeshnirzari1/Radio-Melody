/**
 * Station addresses, in the browser.
 *
 * This mirrors tools/stationSlug.mjs exactly. The build writes the pages and the
 * sharded index with those rules, so the app has to arrive at the same slug —
 * otherwise a shared link opens a different station. Change one, change the other.
 *
 * The canonical address is /station/<slug>/ — readable, no UUID. The UUID is
 * still what identifies a station to the API, so there are two directions:
 *
 *   slug -> id   a link was opened and the page did not come from the build
 *   id   -> slug when the address bar follows whatever is playing
 *
 * Both read one small sharded JSON file (roughly 15 KB) instead of a list of
 * 60,000 stations, and everything is cached for the session. Sharding on the
 * first two characters is what keeps that a single file: the browser knows which
 * one it needs without asking.
 */

export const SLUG_MAX = 60;

/** Letters NFKD cannot split, mostly Nordic and Slavic, mapped by hand. */
const EXTRA_LETTERS = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", þ: "th", ł: "l", ħ: "h", ŧ: "t", ı: "i",
};

/** Cyrillic and Greek: the two big non-Latin scripts in the catalogue. */
const CYRILLIC_GREEK = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ї: "i", є: "e", ґ: "g", ў: "u", ѕ: "s", ј: "j", љ: "lj", њ: "nj", ћ: "c", џ: "dz",
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l",
  μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f",
  χ: "ch", ψ: "ps", ω: "o",
};

export const slugify = (name) =>
  String(name || "station")
    .normalize("NFKD") // "é" becomes "e" plus a combining accent
    .replace(/[\u0300-\u036f]/g, "") // drop the combining accents
    .toLowerCase()
    .replace(/./gu, (ch) => CYRILLIC_GREEK[ch] ?? EXTRA_LETTERS[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX) || "station";

/** Two characters of a slug or id, matching the shard file names on disk. */
export const shardKey = (key) => {
  const s = String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (s.slice(0, 2) || "00").padEnd(2, "0");
};

/** The readable path for a slug, correct under any base path. */
export const stationPath = (slug) => `/station/${slug}/`;

/** The id the build baked into this page, when the page came from the build. */
export const stationIdFromPage = () => {
  try {
    const el = document.querySelector('meta[name="wr:station-id"]');
    return el ? el.getAttribute("content") : null;
  } catch {
    return null;
  }
};

const INDEX_BASE = `${(process.env.PUBLIC_URL || "").replace(/\/+$/, "")}/station-index`;
const shards = new Map(); // "u/ab" -> { id: slug } or { slug: id }
const pending = new Map(); // in-flight fetches, so two callers share one request

const loadShard = (dir, key) => {
  const name = `${dir}/${shardKey(key)}`;
  if (shards.has(name)) return Promise.resolve(shards.get(name));
  if (pending.has(name)) return pending.get(name);
  const request = fetch(`${INDEX_BASE}/${name}.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({})) // a missing index must never break playback
    .then((data) => {
      shards.set(name, data);
      pending.delete(name);
      return data;
    });
  pending.set(name, request);
  return request;
};

/** slug for a station id, or null if the index has never heard of it. */
export const slugForId = (id) =>
  id ? loadShard("u", id).then((m) => m[id] || null) : Promise.resolve(null);

/** station id for a slug, or null. */
export const idForSlug = (slug) =>
  slug ? loadShard("s", slug).then((m) => m[slug] || null) : Promise.resolve(null);

/**
 * The best slug available *right now*: the exact one once the shard has loaded,
 * otherwise the same guess the app would have written before. Used for share
 * links, which must be built synchronously.
 */
export const slugIfKnown = (id, name) => {
  const cached = shards.get(`u/${shardKey(id)}`);
  return (cached && cached[id]) || slugify(name);
};
