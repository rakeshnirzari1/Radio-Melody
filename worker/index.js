/**
 * Radio Melody relay — a single-file Cloudflare Worker (free tier: 100k requests/day).
 *
 * The static site on GitHub Pages needs this for exactly three things the browser
 * cannot do on its own:
 *
 *   GET /api/stream?url=<stream>   https relay for http-only radio streams
 *                                  (browsers block http media on an https page)
 *   GET /api/nowplaying?url=<stream> reads the ICY StreamTitle (current song)
 *   GET /api/img?url=<favicon>     favicon relay that adds CORS so the page can
 *                                  sample the logo colour into a canvas
 *   GET /api/health                {"ok":true}
 *
 * Nothing is stored, logged or rewritten — it is a pass-through.
 *
 * Deploy:  cd worker && npx wrangler deploy
 * Then set the GitHub repo variable REACT_APP_PROXY_URL to the deployed
 * https://<name>.<subdomain>.workers.dev URL and re-run the Pages workflow.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const UA = "Mozilla/5.0 (compatible; RadioMelodyRelay/1.0)";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const fail = (message, status) => json({ error: message }, status);

function targetUrl(requestUrl) {
  const raw = new URL(requestUrl).searchParams.get("url");
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* already decoded */
  }
  if (!/^https?:\/\//i.test(decoded)) return null;
  return decoded;
}

// ---- /api/stream -----------------------------------------------------------
// Byte-for-byte pass-through. Cloudflare streams the body straight through, so
// one request stays open for the whole listening session.
async function handleStream(url) {
  const upstream = await fetch(url, {
    headers: { "User-Agent": UA, "Icy-MetaData": "0", Accept: "*/*" },
    redirect: "follow",
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!upstream.ok && upstream.status !== 206) {
    return fail(`upstream ${upstream.status}`, 502);
  }

  const headers = new Headers(CORS);
  headers.set("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
  headers.set("Cache-Control", "no-cache, no-store");
  headers.set("X-Accel-Buffering", "no");
  headers.set("ngrok-skip-browser-warning", "true");
  return new Response(upstream.body, { status: 200, headers });
}

// ---- /api/nowplaying -------------------------------------------------------
// Reads ICY metadata. We don't rely on the icy-metaint header surviving the
// proxy hop: with Icy-MetaData: 1 the metadata is interleaved in the body, so we
// pull the first ~96 KB and regex the StreamTitle out of it.
async function handleNowPlaying(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": UA, "Icy-MetaData": "1", Accept: "*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    const name = upstream.headers.get("icy-name") || upstream.headers.get("ice-name") || null;

    if (!upstream.body) return json({ title: null, name });

    const reader = upstream.body.getReader();
    let received = 0;
    let text = "";
    let title = null;

    try {
      while (received < 98304) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        text += new TextDecoder("utf-8", { fatal: false }).decode(value, { stream: true });
        const match = /StreamTitle='(.*?)';/s.exec(text);
        if (match && match[1].trim()) {
          title = match[1].trim();
          break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* stream already closed */
      }
    }

    if (!title) {
      const match = /StreamTitle='(.*?)';/s.exec(text);
      if (match && match[1].trim()) title = match[1].trim();
    }

    return json({ title, name });
  } catch (err) {
    return json({ title: null, name: null, error: String(err) });
  } finally {
    clearTimeout(timer);
  }
}

// ---- /api/img --------------------------------------------------------------
async function handleImg(url) {
  try {
    const upstream = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!upstream.ok) return fail(`upstream ${upstream.status}`, 404);
    const headers = new Headers(CORS);
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/png");
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    return fail(String(err), 502);
  }
}

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return fail("method not allowed", 405);
    }

    if (pathname === "/api/health" || pathname === "/") {
      return json({ ok: true, service: "radio-melody-relay" });
    }

    const url = targetUrl(request.url);

    if (pathname === "/api/stream") {
      if (!url) return fail("missing or invalid ?url=", 400);
      return handleStream(url);
    }
    if (pathname === "/api/nowplaying") {
      if (!url) return fail("missing or invalid ?url=", 400);
      return handleNowPlaying(url);
    }
    if (pathname === "/api/img") {
      if (!url) return fail("missing or invalid ?url=", 400);
      return handleImg(url);
    }

    return fail("not found", 404);
  },
};
