# Radio Melody — native wrapper (Android / iOS / Android Auto / CarPlay)

This directory scaffolds the native apps. **Nothing here is required for the
website**, which keeps working exactly as it does now. The wrapper exists for two
things the browser cannot do:

1. A real installed app (better audio-session survival, no browser chrome).
2. **Android Auto** and **CarPlay** — the only way to get Radio Melody into a car
   head unit's own launcher rather than mirroring the phone.

## What is and is not done

- ✅ Capacitor config, app id, package scripts, status-bar and background colours.
- ✅ The web app itself already sets up a MediaSession, so lock-screen and
  Bluetooth controls work inside the wrapper with no native code.
- ⚠️ **Not built here.** Creating the Android/iOS projects and building them needs
  Android Studio + the Android SDK, and Xcode — neither is available on the
  machine this was prepared on. The steps below are the missing part.
- ⚠️ **Android Auto / CarPlay need extra native work** (an automotive service,
  `CarAppService`, and a media browser service for CarPlay). Capacitor alone does
  not provide them. Plan for that as a follow-up, not a checkbox.

## Build steps (on a machine with the SDKs)

```bash
cd native
npm install

# The web build is copied in as www/
npm run build:web
mkdir -p www && cp -r ../frontend/build/* www/

npm run add:android      # creates native/android (needs Android SDK)
npm run add:ios          # creates native/ios (needs macOS + Xcode)

npm run sync             # copy www/ + plugins into both platforms
npm run open:android     # opens Android Studio to build/sign an APK or AAB
npm run open:ios         # opens Xcode to build/sign for the App Store
```

Notes:

- `androidScheme`/`iosScheme` are `https` deliberately. The app refuses to play
  `http://` streams on an https page; inside the wrapper the same rule applies,
  and the Cloudflare relay covers the stations that are http-only.
- `allowMixedContent` is on for Android as a safety net for exotic station
  servers. Only turn it on knowingly: it weakens the https guarantee.
- If you would rather not ship a wrapper at all, the PWA is already installable
  ("Add to Home Screen" on iOS, the install prompt on Android/desktop) and gives
  you the same lock-screen controls.

## Android Auto groundwork (future)

1. Add `androidx.car.app:app` and a `CarAppService` with a `MediaPlaybackTemplate`.
2. Expose the stations through a `MediaBrowserServiceCompat` backed by the same
   Radio-Browser queries the web app uses.
3. Register `androidx.car.app.category.PLAYBACK` in the manifest and test with the
   Desktop Head Unit (`dhc`).
4. Ship via a Play Store release track — Android Auto apps must be distributed
   through the Play Store, not sideloaded.

## CarPlay groundwork (future)

1. Requires an Apple **CarPlay entitlement** (request from Apple; approval is not
   automatic) and a `MPPlayableContentManager` based app.
2. Reuse the same station catalogue as the web/mobile apps.
3. Test with the CarPlay simulator in Xcode.
