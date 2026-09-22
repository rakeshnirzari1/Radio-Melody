/**
 * Post-build prerender.
 *
 * The app is a single-page app, so every station URL used to serve the same
 * generic HTML: Google had nothing to index and a shared link showed a bare URL.
 * This runs AFTER `npm run build` (so the bundle names and the public path are
 * already resolved) and, for the most popular stations, writes
 * `build/station/<slug>/<id>/index.html` — the real app shell with per-station
 * title, description, Open Graph tags, Twitter card, JSON-LD and a noscript
 * summary. The app then boots on top of it exactly as before.
 *
 * It also emits sitemap.xml, robots.txt and a stations index.
 *
 *   node tools/prerender.mjs            # uses build/, tops out at 400 stations
 *   PRERENDER_LIMIT=50 node tools/prerender.mjs
 *
 * Nothing here is required for the site to work: if the API is unreachable the
 * script logs and exits 0, and the deploy proceeds with the plain SPA.
 */
import fs from "node:fs";
import path from "node:path";

const BUILD_DIR = process.env.BUILD_DIR || "frontend/build";
const LIMIT = Number(process.env.PRERENDER_LIMIT || 400);
const SITE = (
  process.env.SITE_URL || "https://rakeshnirzari1.github.io/World-Radio"
).replace(/\/+$/, "");
const API = "https://de1.api.radio-browser.info";

const slugify = (s) =>
  String(s || "station")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "station";

const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const readShell = () => {
  const file = path.join(BUILD_DIR, "index.html");
  if (!fs.existsSync(file)) {
    console.error(`prerender: ${file} not found — run the build first`);
    process.exit(0);
  }
  return fs.readFileSync(file, "utf8");
};

const fetchTop = async () => {
  const url = `${API}/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=${LIMIT}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`radio-browser ${res.status}`);
  return res.json();
};

const metaBlock = (station, canonical, ogImage) => {
  const place = [station.state, station.country].filter(Boolean).join(", ");
  const title = `${station.name}${place ? ` — ${place}` : ""} | Live radio on World Radio`;
  const desc = `Listen live to ${station.name}${
    place ? ` from ${place}` : ""
  } on World Radio. ${
    station.codec ? station.codec.toUpperCase() : "Audio"
  }${station.bitrate ? ` at ${station.bitrate} kbps` : ""}, free, no account needed.`;
  return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(desc)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="music.radio_station" />
    <meta property="og:site_name" content="World Radio" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(desc)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
    <script type="application/ld+json">
      ${JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "RadioStation",
          name: station.name,
          url: canonical,
          ...(station.favicon && /^https:/i.test(station.favicon)
            ? { logo: station.favicon }
            : {}),
          ...(place ? { areaServed: place } : {}),
          broadcastAffiliateOf: "World Radio",
          isPartOf: { "@type": "WebSite", name: "World Radio", url: `${SITE}/` },
        },
        null,
        2
      )}
    </script>`;
};

const noscriptBlock = (station, canonical) => {
  const place = [station.state, station.country].filter(Boolean).join(", ");
  return `<noscript>
      <div style="font-family:Inter,system-ui,sans-serif;padding:32px;color:#e8f0ec;background:#05070a">
        <h1>${escapeHtml(station.name)}</h1>
        <p>Live radio${place ? ` from ${escapeHtml(place)}` : ""}. World Radio needs JavaScript to play audio.</p>
        <p><a style="color:#2fe08a" href="${escapeHtml(canonical)}">Open this station on World Radio</a></p>
      </div>
    </noscript>`;
};

// Rewrite the manifest's relative URLs to absolute ones. iOS resolves a relative
// start_url inconsistently — and treats the bare `id` as if it belonged to the
// origin root — so an installed app can end up opening the wrong address. Static
// hosting means the base is known at build time, so just say it outright.
const absolutiseManifest = () => {
  const file = path.join(BUILD_DIR, "manifest.json");
  if (!fs.existsSync(file)) return;
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`prerender: manifest not parseable (${err.message}) — leaving it alone`);
    return;
  }
  const abs = (u) =>
    typeof u === "string" && u && !/^https?:/i.test(u) ? new URL(u, `${SITE}/`).toString() : u;
  m.start_url = abs(m.start_url || "./");
  m.scope = abs(m.scope || "./");
  m.id = abs(m.id || "./");
  if (Array.isArray(m.icons)) m.icons = m.icons.map((i) => ({ ...i, src: abs(i.src) }));
  if (Array.isArray(m.shortcuts)) m.shortcuts = m.shortcuts.map((s) => ({ ...s, url: abs(s.url) }));
  fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
  console.log(`prerender: manifest absolutised (start_url ${m.start_url}, id ${m.id})`);
};

const main = async () => {
  const shell = readShell();
  absolutiseManifest();
  let stations;
  try {
    stations = await fetchTop();
  } catch (err) {
    console.warn(`prerender: could not reach Radio-Browser (${err.message}) — skipping`);
    process.exit(0);
  }
  if (!Array.isArray(stations) || !stations.length) {
    console.warn("prerender: no stations returned — skipping");
    process.exit(0);
  }

  const urls = [];
  let written = 0;

  for (const s of stations) {
    const id = s.stationuuid;
    const slug = slugify(s.name);
    if (!id) continue;
    const rel = `/station/${slug}/${id}/`;
    const canonical = `${SITE}${rel}`;
    // A station's own logo makes a far better preview than a generic card, and
    // costs nothing to produce at build time.
    const ogImage =
      s.favicon && /^https:/i.test(s.favicon) ? s.favicon : `${SITE}/og-default.png`;

    const html = shell
      .replace(/<title>[\s\S]*?<\/title>/, "")
      // Drop the shell's own description/OG/Twitter tags: two sets of them and
      // crawlers pick whichever they happen to read first.
      .replace(/[ \t]*<meta (?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*>\r?\n?/g, "")
      .replace("</head>", `${metaBlock(s, canonical, ogImage)}\n  </head>`)
      .replace("<body>", `<body>\n${noscriptBlock(s, canonical)}`);

    const dir = path.join(BUILD_DIR, "station", slug, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
    urls.push({ loc: canonical, changefreq: "weekly", priority: "0.6" });
    written += 1;
  }

  // The privacy note as a real file: without it the link is answered by the SPA
  // 404 shell, which is a 404 status even though a human sees the page.
  const stripHead = (html) =>
    html
      .replace(/<title>[\s\S]*?<\/title>/, "")
      .replace(/[ \t]*<meta (?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*>/g, "");
  const privacyHtml = stripHead(shell)
    .replace(
      "</head>",
      `
    <title>Privacy — World Radio</title>
    <meta name="description" content="World Radio has no accounts, no analytics and no tracking. Nothing is kept beyond your own favourites, history and settings, in your own browser." />
    <link rel="canonical" href="${SITE}/privacy/" />
  </head>`
    )
    .replace("<body>", `<body>\n<noscript><p style="font-family:system-ui;padding:24px">World Radio stores nothing but your own favourites and history, in this browser. No accounts, no analytics.</p></noscript>`);
  fs.mkdirSync(path.join(BUILD_DIR, "privacy"), { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "privacy", "index.html"), privacyHtml);

  // The home page itself. CRA writes it from public/index.html, so it carries no
  // canonical and no og:url of its own — which would make worldradio.io, the
  // pages.dev address and the GitHub mirror look like three separate documents to a
  // search engine. Stamped here, AFTER the station loop on purpose: build/index.html
  // is also the shell every station page is cut from, and a home canonical copied
  // into 400 station pages would be worse than having none at all.
  const homeFile = path.join(BUILD_DIR, "index.html");
  fs.writeFileSync(
    homeFile,
    fs
      .readFileSync(homeFile, "utf8")
      .replace(
        "</head>",
        `  <link rel="canonical" href="${SITE}/" />\n  <meta property="og:url" content="${SITE}/" />\n</head>`
      )
  );

  // Sitemap: the app itself, the privacy note, and every prerendered station.
  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE}/privacy/</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
  )
  .join("\n")}
</urlset>
`;
  fs.writeFileSync(path.join(BUILD_DIR, "sitemap.xml"), sitemap);
  fs.writeFileSync(
    path.join(BUILD_DIR, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`
  );

  console.log(`prerender: ${written} station pages, sitemap.xml, robots.txt`);
};

main().catch((err) => {
  console.warn(`prerender: skipped (${err.message})`);
  process.exit(0);
});
