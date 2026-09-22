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
| `shoppingdeals.au/advertisements-for-radio-melody/` | Ad mp3s, played one per 20 minutes. | Your hosting |

Everything that used to be a backend endpoint — station search, city clusters
within 120 km, single-station lookup, click counts — is now plain browser code in
[`frontend/src/lib/radioApi.js`](frontend/src/lib/radioApi.js).

## Do I need the worker?

It is already deployed and wired up — nothing to do. It runs at
`https://radio-melody-relay.rakeshnirzari1.workers.dev` and the Pages build picks
it up from the repository variable `REACT_APP_PROXY_URL`.

Without it the site still works, minus about 20% of stations:

* **Without it:** ~80% of stations stream over `https` and play straight from the
  page. The other ~20% are `http://` only, and every browser blocks `http` media
  on an `https` page (mixed content). Those stations are then filtered out of the
  catalogue rather than failing mid-playback, and the "now playing" song line
  stays blank.
* **With it:** all stations play and the current song title shows up.

It only carries what genuinely needs it: `http://` streams are proxied, `https`
ones play directly. So if the relay is ever over quota, disabled or deleted, the
site degrades to "https stations only" instead of losing the player. Re-deploy
with `cd worker && npx wrangler deploy` (see [`worker/README.md`](worker/README.md)).

## How much of the catalogue is available

Radio-Browser holds ~59,300 stations (~52,500 working). The app aims to make as
many as possible reachable everywhere:

| | |
| --- | --- |
| Stations on the globe | **all 12,665 geolocated stations**, loaded in pages (page one paints the globe, the rest merge in the background) |
| Reachable by search | the whole catalogue — search hits the API directly with no geo filter, so non-geolocated stations are findable by name, country, tag or genre |
| Playable on Chrome, Safari, Firefox, Android, iOS | every https stream, plus `http://`-only stations through the relay, plus HLS (`.m3u8`) stations, handled natively on Safari/iOS and through lazily-loaded `hls.js` everywhere else |

## What you can do in the app

| Feature | Where it lives |
| --- | --- |
| **Explore** — browse by country (with flags and station counts), by what the world is playing in the last 24 hours (Trending), or by genre | header → Explore |
| **Collections** — "80s Drive", "Bollywood Morning", "Late Night Jazz", "World News Now" and more, each one a tag query so they stay fresh. Starting one makes it your Next/Back list | header → Collections, or the Road trip button |
| **Around the World** — counts the countries you have actually heard, with milestones and a shareable card | header → Around |
| **Driving mode** — three enormous controls, a clock, screen wake lock, and voice commands ("next station", "louder", "driving mode") | the Driving mode button |
| **Share cards** — each station is shareable as a 1080×1080 image (native share sheet on phones, download + copied link elsewhere) | the share button in the player |
| **Embeddable player** — `/embed/<station-id>` drops a single live station into any website | copy the snippet from Privacy |
| **Privacy note** — a page stating plainly that there are no accounts, no analytics and nothing to erase beyond your own browser | `/privacy` |
| **Station health memory** — stations that fail on your device are pushed to the back of the queue, and forgiven as soon as one works | automatic |
| **Installable PWA** — icons, iOS splash screens, app shortcuts (Driving / Surprise / Explore) and an install nudge | automatic |

### SEO and link previews

The build prerenders the top ~400 stations after `npm run build`
([`tools/prerender.mjs`](tools/prerender.mjs)): each gets a real HTML page with its
own title, description, Open Graph card (the station's own logo where there is
one) and `RadioStation` JSON-LD, plus a `sitemap.xml` and `robots.txt`. The page is
the same app shell, so the player boots on top of it exactly as before. If
Radio-Browser is unreachable during a build the step logs and skips — the deploy
never fails because of it.

### Native wrapper

[`native/`](native/README.md) holds a Capacitor scaffold for Android and iOS app
builds, including what is still missing for Android Auto and CarPlay (both need
additional native code, and CarPlay needs an Apple entitlement). The PWA already
covers install + lock-screen controls without it.

## Streams are always https

Nothing is ever played over `http://` — an https page can't, and the browser
would block it anyway. Three layers make sure of it:

1. **Native https** — about 80% of the catalogue already streams over https.
2. **Scheme upgrade** — of the ~19% listed as `http://` only, roughly 43% answer
   the same request over https at the same host and port. Those stations have
   their URL rewritten to https and stay in the catalogue; the rest are hidden
   rather than played insecurely.
   * `frontend/src/data/https-upgrades.json` holds 186 verified URLs, so the
     popular ones cost no probing at all.
   * Everything else is probed once per browser — 6 at a time, max 120 per visit,
     cached in `localStorage` for a week (so only the first visit pays).
   * Regenerate the verified list with `node tools/https-upgrades.mjs`.
3. **The relay** (see above) covers anything still `http://`, by proxying it over
   https.

HLS stations (`something.m3u8`) are ~790 of the geolocated set and far more of the
catalogue. Safari and iOS play them natively; Chrome, Firefox and Android Chrome
don't, so `hls.js` is loaded on demand the first time such a station is chosen —
it stays out of the initial bundle and costs nothing for the other 90-odd percent
of stations. (Some HLS servers don't send CORS headers; those still work on
Safari/iOS and simply skip on Chrome.)

Checked live: Radio 538 is listed as `http://playerservices.streamtheworld.com/…`
and used to be filtered out; it now plays from the same URL over **https**.

## Never losing the lock screen (the driving contract)

When the phone is locked in a car, the Now Playing card and the Bluetooth
Next/Back buttons survive only while the audio element has a live source and is
not sitting paused. iOS tears the card down when the element goes quiet or
sourceless, and once that happens `play()` on the same dead URL can never
succeed — which is why a stalled station used to need a page refresh.

So the rules the player follows:

* **A station change is verified before the live element is touched.** Pressing
  Next loads the candidate on a throwaway, muted, never-played element; only when
  it produces audio metadata does the real element switch. The station you were
  listening to keeps playing throughout, so a dead station costs you nothing — the
  app simply stays where it is.
* **The player is never left silent.** If the queue, the current station and the
  last good station have all failed, it parks on a known-good stream rather than
  going quiet.
* **Recovery, not just un-pause.** If the element is parked on a URL that cannot
  play, pressing play (or the car's play button) re-attaches a station instead of
  retrying the dead one — so no refresh is ever needed.
* **Media-session handlers are registered once and never cleared.** Re-registering
  means clearing first, and a cleared handler is a button that disappears from the
  lock screen.
* **The session reports `playing`** whenever a station is selected and you have not
  asked for a pause — including while tuning or skipping.
* A keep-alive pushes playback back on if iOS pauses the element by itself, but it
  never fights a deliberate pause.

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
