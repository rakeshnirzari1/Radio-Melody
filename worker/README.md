# Radio Melody relay (optional, free)

A static GitHub Pages site cannot do three things by itself. This Worker does
only those three things and nothing else — no database, no accounts, no state.

| Route | Why it exists |
| --- | --- |
| `GET /api/stream?url=` | An https page may not play an `http://` stream (mixed-content block). This relays it over https. |
| `GET /api/nowplaying?url=` | Browsers cannot read ICY (`icy-metaint`) metadata, so the current song title needs a server. |
| `GET /api/img?url=` | Adds CORS to station favicons so the page can sample the logo colour into a canvas. |
| `GET /api/health` | `{"ok":true}` — sanity check. |

## Is it really free?

Yes. Cloudflare's Workers free plan is 100,000 requests/day and asks for no
credit card. A stream stays open as **one** request for the whole listening
session, so normal use is a few dozen requests a day.

## Deploy (option A — dashboard, ~2 minutes)

1. Sign in / sign up at <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Worker**.
2. Name it e.g. `radio-melody-relay`, click **Deploy**.
3. Click **Edit code**, delete the sample, paste the entire contents of
   [`index.js`](./index.js), then **Deploy**.
4. Copy the URL shown, e.g. `https://radio-melody-relay.<you>.workers.dev`.

## Deploy (option B — wrangler CLI)

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

## Point the site at it

GitHub repo → **Settings → Secrets and variables → Actions → Variables** →
**New repository variable**:

```
Name:  REACT_APP_PROXY_URL
Value: https://radio-melody-relay.<you>.workers.dev
```

Then re-run the **Deploy frontend to GitHub Pages** workflow (Actions → the
workflow → *Run workflow*). No secret, no card, nothing to pay.

Without this variable the site still works: it just hides the ~20% of stations
that only stream over `http`, and does not show the current song title.

## Removing it later

Delete the worker in the Cloudflare dashboard and delete the
`REACT_APP_PROXY_URL` variable, then re-run the workflow. That is the whole
dependency — the site falls back to direct https streaming.
