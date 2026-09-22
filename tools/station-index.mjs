/**
 * Builds the station URL index: the thing that makes `/station/<slug>/` work
 * without the UUID in the address.
 *
 * It walks the whole working catalogue (~59k stations, 12 requests, about a
 * minute), assigns every station a unique slug with the shared rules in
 * `stationSlug.mjs`, and writes three things:
 *
 *   station-index/s/<xx>.json        { "<slug>": "<uuid>" }   slug -> id
 *   station-index/u/<xx>.json        { "<uuid>": "<slug>" }   id -> slug
 *   <directory>/<country>.json       every station in a country
 *
 * The first two are shipped: a visitor fetches the one shard they need (~15 KB),
 * the browser looks up the slug for a station it is already playing (to write the
 * address bar and share links) and the id for a slug it was handed from outside.
 *
 * The third is not shipped. It is what lets a country page list *every* station
 * in the country rather than only the prerendered ones — which is the point of
 * sharing a country link — and taking it from this walk means the country pages
 * cost no extra API calls and are guaranteed to agree with the slugs above. It
 * lives outside the build directory for that reason (see STATION_DIRECTORY_DIR).
 *
 * Run before the prerender: the prerender consumes both.
 *
 *   node tools/station-index.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assignSlugs, byImportance, shardKey, slugify } from "./stationSlug.mjs";

const BUILD_DIR = process.env.BUILD_DIR || "frontend/build";
const API = process.env.RB_API || "https://de1.api.radio-browser.info";
const PAGE = Number(process.env.INDEX_PAGE || 5000);
const MAX_PAGES = Number(process.env.INDEX_MAX_PAGES || 24);
const OUT_DIR = path.join(BUILD_DIR, "station-index");
const DIRECTORY_DIR =
  process.env.STATION_DIRECTORY_DIR || path.join(os.tmpdir(), "wr-directory");

const fetchCatalogue = async () => {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${API}/json/stations/search?hidebroken=true&limit=${PAGE}&offset=${page * PAGE}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`radio-browser ${res.status} at offset ${page * PAGE}`);
    const rows = await res.json();
    all.push(...rows);
    process.stdout.write(`  page ${page + 1}: +${rows.length} (total ${all.length})\n`);
    if (rows.length < PAGE) break;
  }
  return all;
};

const writeShards = (dir, pairs) => {
  fs.mkdirSync(dir, { recursive: true });
  const shards = new Map();
  for (const [key, value] of pairs) {
    const shard = shardKey(key);
    if (!shards.has(shard)) shards.set(shard, {});
    shards.get(shard)[key] = value;
  }
  let bytes = 0;
  for (const [shard, map] of shards) {
    const file = path.join(dir, `${shard}.json`);
    const json = JSON.stringify(map);
    fs.writeFileSync(file, json);
    bytes += json.length;
  }
  return { files: shards.size, bytes };
};

/**
 * Every playable station in each country, most played first, keyed by the slug
 * of the country's *formal* name — the same shared slugify() the prerender uses
 * to find the file again, so neither side needs a country-name table.
 */
const writeDirectory = (rows, slugs) => {
  fs.rmSync(DIRECTORY_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIRECTORY_DIR, { recursive: true });
  const byCountry = new Map();
  for (const s of rows) {
    // Broken entries are dropped here rather than at read time: a country page
    // exists to be listened to.
    if (Number(s.lastcheckok) === 0) continue;
    const country = String(s.country || "").trim();
    if (!country) continue;
    const key = slugify(country);
    if (!byCountry.has(key)) byCountry.set(key, []);
    byCountry.get(key).push({
      n: s.name,
      s: slugs.get(s.stationuuid),
      st: s.state || "",
    });
  }
  let bytes = 0;
  let listed = 0;
  for (const [country, stations] of byCountry) {
    const json = JSON.stringify(stations);
    fs.writeFileSync(path.join(DIRECTORY_DIR, `${country}.json`), json);
    bytes += json.length;
    listed += stations.length;
  }
  return { countries: byCountry.size, stations: listed, bytes };
};

const main = async () => {
  if (!fs.existsSync(BUILD_DIR)) {
    console.error(`station-index: ${BUILD_DIR} not found — run the build first`);
    process.exit(0);
  }
  console.log(`station-index: fetching the catalogue from ${API}`);
  const rows = (await fetchCatalogue()).filter((s) => s && s.stationuuid && s.name);
  rows.sort(byImportance);
  const slugs = assignSlugs(rows);

  const slugToId = rows.map((s) => [slugs.get(s.stationuuid), s.stationuuid]);
  const idToSlug = rows.map((s) => [s.stationuuid, slugs.get(s.stationuuid)]);

  const a = writeShards(path.join(OUT_DIR, "s"), slugToId);
  const b = writeShards(path.join(OUT_DIR, "u"), idToSlug);
  const d = writeDirectory(rows, slugs);

  // Written last and treated as the completeness flag: if this file exists, the
  // app can trust a 404 from an index shard to mean "no such station".
  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify({ stations: rows.length, generated: new Date().toISOString() })
  );
  console.log(
    `station-index: ${rows.length} stations — s/ ${a.files} files (${
      Math.round(a.bytes / 1024)
    } KB), u/ ${b.files} files (${Math.round(b.bytes / 1024)} KB)`
  );
  console.log(
    `station-index: directory ${d.stations} playable stations across ${
      d.countries
    } countries (${Math.round(d.bytes / 1024 / 1024)} MB, not deployed, at ${DIRECTORY_DIR})`
  );
};

main().catch((err) => {
  // Never fail a deploy over this: without the index the app falls back to the
  // long URL form, and the prerendered pages still carry the id in their head.
  console.warn(`station-index: skipped (${err.message})`);
  process.exit(0);
});
