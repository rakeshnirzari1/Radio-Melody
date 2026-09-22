/**
 * The one place that decides what a station's URL looks like.
 *
 * `/station/<slug>/` is the canonical address; the UUID is not needed in the
 * URL to *read* it, only to resolve it. Station names repeat across the
 * catalogue ("Radio One" exists in dozens of countries), so uniqueness is
 * enforced here by appending `-2`, `-3`, … in a deterministic order: the
 * most-clicked station wins the clean slug, ties broken by id. Run the same
 * input through it twice and you get the same URLs.
 *
 * The browser needs identical answers when it writes the address bar or builds
 * a share link, so `frontend/src/lib/stationUrls.js` mirrors these rules.
 * Change one, change the other, or shared links will resolve to the wrong
 * station.
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
    // Without this, every Russian or Greek station shares the address
    // "/station/station-412/". Anything still unmapped (CJK, Arabic, Thai…)
    // falls through to a numeric slug; the index resolves either.
    .replace(/./gu, (ch) => CYRILLIC_GREEK[ch] ?? EXTRA_LETTERS[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX) || "station";

/**
 * Shard key: two characters of a slug or id. Slugs shard on their first two
 * characters so the browser can pick the right file without any lookup.
 */
export const shardKey = (key) => {
  const s = String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (s.slice(0, 2) || "00").padEnd(2, "0");
};

/**
 * Sort most-wanted first. clickcount decides; the id breaks ties so the result
 * never depends on the order the API happened to return rows in.
 */
export const byImportance = (a, b) =>
  (Number(b.clickcount) || 0) - (Number(a.clickcount) || 0) ||
  String(a.stationuuid).localeCompare(String(b.stationuuid));

/**
 * Assign a unique slug to every station.
 * @param {{stationuuid:string,name:string,clickcount?:number}[]} stations
 * @returns {Map<string,string>} stationuuid -> slug
 */
export const assignSlugs = (stations) => {
  const taken = new Set();
  const byId = new Map();
  for (const s of stations) {
    const base = slugify(s.name);
    let slug = base;
    let n = 1;
    while (taken.has(slug)) slug = `${base.slice(0, SLUG_MAX - 5)}-${++n}`;
    taken.add(slug);
    byId.set(s.stationuuid, slug);
  }
  return byId;
};
