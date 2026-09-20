# Radio Melody

Spin a globe, tap a glowing dot, listen to live radio from thousands of cities.
Fork-friendly, and **completely free to host** — the whole app is static files on
GitHub Pages. No Emergent, no FastAPI server, no database, no `REACT_APP_BACKEND_URL`.

## How it works now

| Piece | What it does | Where it runs |
| --- | --- | --- |
| `frontend/` | The React app (globe, player, search, favorites). | GitHub Pages — static |
| [Radio-Browser API](https://api.radio-browser.info) | Station catalogue, search, geo coordinates. Sends `Access-Control-Allow-Origin: *`, so the browser calls it directly. | Public API, free |
| `worker/` *(optional)* | Tiny Cloudflare Worker: https relay for `http://` streams, ICY "now playing" titles, favicon CORS. | Cloudflare free tier (100k req/day, no card) |

Everything that used to be a backend endpoint — station search, city clusters
within 120 km, single-station lookup, click counts — is now plain browser code in
[`frontend/src/lib/radioApi.js`](frontend/src/lib/radioApi.js).

## Do I need the worker?

No, but it unlocks about 20% more stations.

* **Without it:** ~80% of stations stream over `https` and play straight from the
  page. The other ~20% are `http://` only, and every browser blocks `http` media
  on an `https` page (mixed content). Those stations are hidden rather than
  failing mid-playback, and the "now playing" song line stays blank.
* **With it:** all stations play and the current song title shows up.

Setup is one file and ~2 minutes: [`worker/README.md`](worker/README.md).

## Run locally

```bash
cd frontend
npm install --legacy-peer-deps
npm start                 # http://localhost:3000
```

Optional relay (needed for http streams + song titles while developing):

```bash
cd worker && npx wrangler dev          # prints http://localhost:8787
# then in frontend/.env.local:
# REACT_APP_PROXY_URL=http://localhost:8787
```

## Deploy to GitHub Pages

1. **Settings → Pages → Source = GitHub Actions.**
2. Push to `main`. The workflow
   [`.github/workflows/deploy-frontend-pages.yml`](.github/workflows/deploy-frontend-pages.yml)
   builds `frontend/` and publishes it.
3. Optional relay: create a repository **variable** (not a secret)
   `REACT_APP_PROXY_URL` = your worker URL, then re-run the workflow.

No secrets are required. Nothing else to pay for.

## Notes / limits

* Browsers refuse to autoplay audio until the first tap — the app shows a
  "Tap to play" overlay and resumes on your first interaction. Once playing, the
  lock screen / car head unit gets Play, Pause, Next station, Previous station and
  Stop. The ±10s seek buttons are deliberately unregistered (live radio has no
  timeline).
* Tap or click anywhere on the globe and the nearest station plays — you do not
  have to hit the dot exactly. Hovering/touching a dot shows a pulsing ring.
* "Say a station" pauses the radio first so the microphone hears you, then
  resumes it if nothing matched.
* The station catalogue is fetched fresh from Radio-Browser on load (~5,000 geo
  stations). Search, genres and "city cluster" lookups hit the API on demand.
* Icons/fonts come from Google Fonts and jsDelivr (unpkg) for the globe textures.

## Custom domain later

1. Add the domain in **Settings → Pages → Custom domain**.
2. Point DNS at GitHub (`A`/`ALIAS` records, or `CNAME` for a subdomain).
3. Tick **Enforce HTTPS**.
