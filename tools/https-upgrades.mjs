#!/usr/bin/env node
/**
 * Regenerates frontend/src/data/https-upgrades.json
 *
 * Radio-Browser lists ~19% of stations as http:// only, and a browser refuses to
 * play http media on an https page. Many of those servers also answer on https
 * at the same host and port, so this script asks the scheme-swapped URL for a
 * couple of kilobytes and keeps the ones that come back as audio.
 *
 *   node tools/https-upgrades.mjs            # scan the top 420 http stations
 *   node tools/https-upgrades.mjs 1000       # scan more
 *
 * Takes a few minutes (one request per station, 16 at a time). Commit the JSON
 * it writes; the app then never has to probe those URLs in the browser.
 */
import { writeFile } from "node:fs/promises";

const LIMIT = Number(process.argv[2] || 420);
const CONCURRENCY = 16;
const CATALOGUE =
  "https://de1.api.radio-browser.info/json/stations/search?has_geo_info=true&hidebroken=true&order=clickcount&reverse=true&limit=5000";
const OUT = new URL("../frontend/src/data/https-upgrades.json", import.meta.url);

const isAudio = (contentType) =>
  /^audio\//i.test(contentType) ||
  /^(application\/ogg|application\/x-ogg)$/i.test(contentType);

const probe = async (url) => {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WorldRadioHttpsAudit/1.0)",
        Range: "bytes=0-2000",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && res.status !== 206) return null;
    return isAudio(res.headers.get("content-type") || "") ? url : null;
  } catch {
    return null;
  }
};

const main = async () => {
  console.log("Fetching catalogue…");
  const stations = await (
    await fetch(CATALOGUE, { headers: { Accept: "application/json" } })
  ).json();

  const candidates = [
    ...new Set(
      stations
        .map((s) => s.url_resolved || s.url || "")
        .filter((u) => u.startsWith("http://"))
        .map((u) => u.replace("http://", "https://"))
    ),
  ].slice(0, LIMIT);

  console.log(`Probing ${candidates.length} scheme-swapped URLs…`);
  const found = [];
  let index = 0;

  const worker = async () => {
    while (index < candidates.length) {
      const url = candidates[index];
      index += 1;
      const ok = await probe(url);
      if (ok) {
        found.push(ok);
        process.stdout.write(".");
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  found.sort();
  await writeFile(
    OUT,
    JSON.stringify(
      {
        note: "Radio streams listed as http:// by Radio-Browser that also serve the same audio over https://. Verified by requesting the scheme-swapped URL and requiring an audio/* (or Ogg) response. Used to keep playback on https without a proxy.",
        generated: new Date().toISOString().slice(0, 10),
        count: found.length,
        urls: found,
      },
      null,
      1
    ) + "\n"
  );
  console.log(
    `\n${found.length}/${candidates.length} answer over https → ${OUT.pathname}`
  );
};

main();
