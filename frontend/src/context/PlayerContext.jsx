import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  streamUrl,
  registerClick,
  getNowPlaying,
  imgProxyUrl,
} from "../lib/radioApi";
import { AD_INTERVAL_MS, pickAd } from "../lib/ads";
import { noteFailure, noteSuccess } from "../lib/health";
import { noteCountry } from "../lib/explored";
import { toast } from "sonner";

const PlayerContext = createContext(null);
export const usePlayer = () => useContext(PlayerContext);

const FAV_KEY = "rm_favorites";
const HIST_KEY = "rm_history";

// The rescue ladder. The contract with the driver is that a station failure never
// leaves the player silent, because a silent media element is exactly what makes
// iOS tear down the lock-screen card and the Bluetooth Next/Back buttons with it.
// If the whole queue and the last good station have failed we park on one of these
// instead — and rotate through them, so a single flaky standby can never be the
// reason the player goes quiet. All three are https, so a rescue does not depend on
// the relay being up.
const RESCUE_STATIONS = [
  {
    id: "rm-rescue-1",
    name: "Sky News Australia Radio",
    url: "https://playerservices.streamtheworld.com/api/livestream-redirect/NOVA_SKYNEWSAAC.aac",
    country: "Australia",
    state: "NSW",
    tags: ["news"],
  },
  {
    id: "rm-rescue-2",
    name: "SomaFM Groove Salad",
    url: "https://ice1.somafm.com/groovesalad-128-mp3",
    country: "United States",
    state: "California",
    tags: ["ambient", "electronic"],
  },
  {
    id: "rm-rescue-3",
    name: "Radio Paradise",
    url: "https://stream.radioparadise.com/mp3-192",
    country: "United States",
    state: "California",
    tags: ["eclectic", "rock"],
  },
];

const FALLBACK_STATION = RESCUE_STATIONS[0];

// Station changes never point the live element at an unverified URL: a second
// element buffers the candidate and only then takes over (see bufferIncoming and
// promoteIncoming in PlayerContext). That is why there is no separate "probe"
// helper here any more — the incoming element IS the probe.

const load = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

// Small rolling trace of player decisions, readable from the console as
// window.__rmTrace. Cheap, capped, and the only practical way to see why a
// station change took the path it did when the screen is locked.
const trace = (event, extra) => {
  try {
    const w = window;
    if (!w.__rmTrace) w.__rmTrace = [];
    w.__rmTrace.push({
      at: new Date().toISOString().slice(11, 23),
      event,
      els: document.querySelectorAll("audio").length,
      ...extra,
    });
    if (w.__rmTrace.length > 80) w.__rmTrace.shift();
  } catch {
    /* never let diagnostics break playback */
  }
};

export const PlayerProvider = ({ children }) => {
  const audioRef = useRef(null);
  const userVolRef = useRef(0.9);
  const fadeRef = useRef(null);

  const [current, setCurrent] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [sleepEndsAt, setSleepEndsAt] = useState(null);
  const [sleepRemaining, setSleepRemaining] = useState(0);
  const [favorites, setFavorites] = useState(() => load(FAV_KEY, []));
  const [history, setHistory] = useState(() => load(HIST_KEY, []));

  // Refs used inside imperative audio event handlers
  const queueRef = useRef([]);
  // { name, source } while a station change is in flight. The old station keeps
  // playing through a switch, so without visible feedback a press looks ignored
  // and people press again. UI renders this as a "Tuning to …" chip.
  const [switching, setSwitching] = useState(null);
  const indexRef = useRef(0);
  const skipRef = useRef(0);
  const errorHandlerRef = useRef(null);
  // Which station we are currently trying to start, and the last one that
  // actually produced sound — used to fall back instead of going silent.
  const pendingRef = useRef(null);
  const lastGoodRef = useRef(null);
  // True when silence is deliberate (user pressed pause, or voice search is
  // listening) — the buffering watchdog must never "fix" that by playing.
  const userPausedRef = useRef(false);

  // The rescue ladder is walked in order, and the chime is created lazily: an
  // AudioContext created before any user gesture starts suspended.
  const rescueIdxRef = useRef(0);
  const stingCtxRef = useRef(null);

  const nextRescue = useCallback(() => {
    const s = RESCUE_STATIONS[rescueIdxRef.current % RESCUE_STATIONS.length];
    rescueIdxRef.current += 1;
    return s;
  }, []);

  // A short two-note chime, played only on the rescue path. A station dying and a
  // stranger's stream suddenly appearing reads as a fault; the chime makes it read
  // as the app handling it. It can only play when the element is already silent,
  // and every failure is swallowed — it must never be the reason there is no sound.
  const playRescueSting = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!stingCtxRef.current) stingCtxRef.current = new Ctx();
      const ctx = stingCtxRef.current;
      if (ctx.state === "suspended" && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      const t0 = ctx.currentTime + 0.02;
      [
        [880, 0],
        [1174.66, 0.17],
      ].forEach(([freq, at], i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(i === 0 ? 0.17 : 0.13, t0 + at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + 0.24);
      });
    } catch {
      /* a chime is a nicety, never a dependency */
    }
  }, []);

  // Advertisement break state.
  const [adPlaying, setAdPlaying] = useState(false);
  const adRef = useRef({ active: false, station: null, ad: null });
  const adTimerRef = useRef(null);
  const startAdRef = useRef(() => {});
  const adHandlerRef = useRef(null);
  const lastAdCheckRef = useRef(0);
  // Latest station, readable from timers without stale closures.
  const currentStationRef = useRef(null);
  // Active hls.js instance (only ever used for .m3u8 stations in browsers
  // without native HLS).
  const hlsRef = useRef(null);

  const pushHistory = useCallback((station) => {
    setHistory((prev) => {
      const filtered = prev.filter((s) => s.id !== station.id);
      return [{ ...station, playedAt: Date.now() }, ...filtered].slice(0, 40);
    });
  }, []);

  const detachHls = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* already gone */
      }
      hlsRef.current = null;
    }
  }, []);

  // Plays a URL on the shared audio element.
  //
  // .m3u8 (HLS) stations play natively on Safari/iOS but not in Chrome, Firefox
  // or Android Chrome. There we lazily pull in hls.js — only at the moment an
  // HLS station is actually chosen, so the library costs nothing for the other
  // 90-odd percent of stations and stays out of the initial bundle.
  const attachSource = useCallback(
    (rawUrl, { autoplay = true } = {}) => {
      const a = audioRef.current;
      if (!a || !rawUrl) return;
      detachHls();

      const src = streamUrl(rawUrl);
      const isHls = /\.m3u8(\?|#|$)/i.test(rawUrl) || /\.m3u8(\?|#|$)/i.test(src);

      const play = () => {
        if (!autoplay) return;
        const p = a.play();
        if (p && p.catch) {
          p.catch((err) => {
            setIsBuffering(false);
            if (err && err.name === "NotAllowedError") setBlocked(true);
          });
        }
      };

      if (isHls) {
        // Let hls.js decide, not canPlayType: Chrome reports "maybe" for HLS
        // without being able to play it, so the old check skipped hls.js exactly
        // where it was needed. hls.js reports unsupported on iOS Safari (no
        // MediaSource on iPhone), which is where native HLS is used instead.
        import("hls.js")
          .then((mod) => {
            const Hls = mod.default || mod.Hls;
            if (!Hls || !Hls.isSupported()) throw new Error("no MSE");
            const hls = new Hls({ enableWorker: true });
            hlsRef.current = hls;
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data && data.fatal) {
                detachHls();
                if (errorHandlerRef.current) errorHandlerRef.current();
              }
            });
            hls.loadSource(src);
            hls.attachMedia(a);
            play();
          })
          .catch(() => {
            // Safari / iOS: hand the playlist to the element and let WebKit's
            // own HLS stack deal with it.
            a.src = src;
            play();
          });
        return;
      }

      a.src = src;
      play();
    },
    [detachHls]
  );

  // State/history side of starting a station: everything except touching audio.
  // Kept separate so a handover can commit the new station at the exact moment the
  // new element becomes audible rather than seconds earlier.
  const commitStation = useCallback(
    (station, { buffering = true } = {}) => {
      setError(null);
      setBlocked(false);
      setNowPlaying(null);
      setCurrent(station);
      setIsBuffering(buffering);
      pendingRef.current = station;
      userPausedRef.current = false;
      // Selecting a station cancels any ad break in progress.
      adRef.current.active = false;
      adRef.current.station = null;
      setAdPlaying(false);
      pushHistory(station);
      registerClick(station.id);
      // Station health and the Around the World count: this is the single place a
      // station definitively becomes the one on air.
      noteSuccess(station);
      const world = noteCountry(station);
      if (world && world.milestone) {
        toast.success(`${world.milestone} countries heard`, {
          description: "Your Around the World map just grew — see it in Explore.",
        });
      }
    },
    [pushHistory]
  );

  const _start = useCallback(
    (station) => {
      if (!station || !station.url) return;
      trace("_start", { station: station.name && station.name.slice(0, 24) });
      commitStation(station);
      attachSource(station.url);
    },
    [commitStation, attachSource]
  );

  const play = useCallback(
    (station, queue = null) => {
      if (!station) return;
      skipRef.current = 0;
      if (Array.isArray(queue) && queue.length) {
        queueRef.current = queue;
        const i = queue.findIndex((s) => s.id === station.id);
        indexRef.current = i >= 0 ? i : 0;
      } else {
        const cq = queueRef.current;
        const i = cq.findIndex((s) => s.id === station.id);
        if (i >= 0) {
          indexRef.current = i;
        } else {
          queueRef.current = [station];
          indexRef.current = 0;
        }
      }
      // Gapless when something is already playing, instant when nothing is.
      if (handoverRef.current) handoverRef.current(station);
      else _start(station);
    },
    [_start]
  );

  // (Removed: playAt() used to point the live element straight at the next
  // queue entry. Switching now goes through tuneTo/stepQueue so a dead station
  // is never allowed to interrupt what is playing.)

  // ---- Switching stations without ever going silent ----------------------
  //
  // The old path pointed the live element straight at the next candidate. If that
  // candidate was dead or slow, the driver got several seconds of silence — and
  // iOS treats silence on a locked screen as "the media session ended", so the
  // card disappeared along with the Bluetooth Next/Back buttons. Worse, the
  // element was left paused on the dead URL: play() on that same URL can never
  // succeed, so tapping play (or Next) again did nothing and only a page refresh
  // (a brand new element) brought the controls back.
  //
  // Now a candidate is verified on a throwaway element first, the current station
  // keeps playing the whole time, and if nothing verifies we stay on what is
  // already playing rather than switching to silence.
  // Shared element plumbing. Declared before the switching code because a
  // useCallback dependency array is evaluated during render, so anything
  // referenced there must already be initialised.
  const handlersRef = useRef(null);
  // Set once handoverTo exists, so earlier callbacks (play) can use it without a
  // dependency cycle.
  const handoverRef = useRef(null);
  // Bumped on every switch attempt so a slow candidate cannot take over after a
  // newer press has already started.
  const switchSeqRef = useRef(0);

  // Builds an element with the shared listeners attached. Kept in the document and
  // marked inline: iOS holds the lock-screen / Bluetooth session far more reliably
  // for an attached media element.
  const createElement = useCallback(({ muted = false, preload = "none" } = {}) => {
    const el = new Audio();
    el.preload = preload;
    el.muted = muted;
    // No crossOrigin: most radio servers don't send CORS headers, and asking for
    // CORS makes the browser refuse streams it would otherwise play fine.
    el.volume = userVolRef.current;
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.setAttribute("x-webkit-airplay", "allow");
    el.style.display = "none";
    document.body.appendChild(el);
    const h = handlersRef.current;
    if (h) Object.keys(h).forEach((ev) => el.addEventListener(ev, h[ev]));
    return el;
  }, []);

  // Detaches an element for good: stops it, drops its source and removes it from
  // the document so no connection or listener is left behind.
  const discardElement = useCallback(({ el, hls } = {}) => {
    if (!el) return;
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    try {
      el.removeAttribute("src");
      el.load();
    } catch {
      /* ignore */
    }
    if (hls) {
      try {
        hls.destroy();
      } catch {
        /* ignore */
      }
    }
    if (el.parentNode) el.parentNode.removeChild(el);
  }, []);

  // Buffers a station on a SECOND element without touching what is playing.
  //
  // Deliberately NOT muted: Chrome fails to decode some Icecast streams on a muted
  // element (MEDIA_ERR_DECODE) and refuses to start inaudible media in a background
  // tab, which is precisely the situation we need this for. Volume 0 is silent to
  // the ear but still a normal, decodable, playing element.
  const bufferIncoming = useCallback(
    async (rawUrl, timeoutMs = 8000) => {
      const el = createElement({ preload: "auto" });
      el.volume = 0;
      const src = streamUrl(rawUrl);
      const isHls = /\.m3u8(\?|#|$)/i.test(rawUrl) || /\.m3u8(\?|#|$)/i.test(src);
      let hls = null;

      const discard = () => discardElement({ el, hls });

      const ready = await new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(ok);
        };
        // Reading bytes is what counts, so a slow stream that has started is a
        // pass, not a failure.
        const timer = setTimeout(() => finish(el.readyState >= 2), timeoutMs);
        el.addEventListener("canplay", () => finish(true), { once: true });
        el.addEventListener("playing", () => finish(true), { once: true });
        el.addEventListener("error", () => finish(false), { once: true });
        const start = () => {
          const p = el.play();
          if (p && p.catch) {
            p.catch((err) => {
              // A refusal to start is not the same as a dead stream: the element
              // may still fill its buffer, and the timeout below decides. Only a
              // hard media error is fatal here.
              trace("buffer.playRejected", { err: err && err.name });
            });
          }
        };
        if (isHls) {
          import("hls.js")
            .then((mod) => {
              const Hls = mod.default || mod.Hls;
              if (Hls && Hls.isSupported()) {
                hls = new Hls({ enableWorker: true });
                hls.on(Hls.Events.ERROR, (_event, data) => {
                  if (data && data.fatal) finish(false);
                });
                hls.loadSource(src);
                hls.attachMedia(el);
              } else {
                el.src = src;
              }
              start();
            })
            .catch(() => {
              el.src = src;
              start();
            });
        } else {
          el.src = src;
          start();
        }
      });

      if (!ready) {
        discard();
        return null;
      }
      return { el, hls };
    },
    [createElement, discardElement]
  );

  // Hands the audible role to the buffered element. It is already producing audio
  // before the old one stops, so the changeover is a few milliseconds instead of
  // the seconds of silence that used to cost us the lock-screen card.
  const promoteIncoming = useCallback((incoming, station) => {
    const old = audioRef.current;
    const el = incoming.el;
    // The incoming element has been playing silently at volume 0 while it filled
    // its buffer; give it the real volume as it takes over.
    el.volume = userVolRef.current;
    audioRef.current = el;
    if (old && old !== el) {
      // Retire the old element with a very short fade so the change isn't a click.
      try {
        const steps = 3;
        const startVol = old.volume;
        let i = 0;
        const fade = setInterval(() => {
          i += 1;
          try {
            old.volume = Math.max(0, startVol * (1 - i / steps));
          } catch {
            /* ignore */
          }
          if (i >= steps) {
            clearInterval(fade);
            try {
              old.pause();
            } catch {
              /* ignore */
            }
            try {
              old.removeAttribute("src");
              old.load();
            } catch {
              /* ignore */
            }
            if (old.parentNode) old.parentNode.removeChild(old);
          }
        }, 45);
      } catch {
        /* ignore */
      }
    }
    if (hlsRef.current && hlsRef.current !== incoming.hls) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* ignore */
      }
    }
    hlsRef.current = incoming.hls || null;
    // The new element is already playing, so its "playing" event fired before it
    // held the audible role — reflect that state here instead of waiting for an
    // event that will not come again.
    setIsPlaying(true);
    setIsBuffering(false);
    setError(null);
    setBlocked(false);
    skipRef.current = 0;
    lastGoodRef.current = station || pendingRef.current;
    trace("promoted", {
      station: (station && station.name && station.name.slice(0, 24)) || null,
      rs: el.readyState,
      vol: el.volume,
    });
  }, []);

  // Switch stations without a gap. Falls back to the direct source swap when
  // nothing is playing (nothing to protect) or when the candidate could not be
  // buffered (in which case the current station simply keeps playing).
  const handoverTo = useCallback(
    async (station, timeoutMs = 8000, source = "pick") => {
      if (!station || !station.url) return false;
      const seq = switchSeqRef.current + 1;
      switchSeqRef.current = seq;
      setSwitching({ name: station.name, id: station.id, source, at: Date.now() });
      const clearSwitching = () => {
        // Only the newest attempt may clear the indicator.
        if (seq === switchSeqRef.current) setSwitching(null);
      };
      const a = audioRef.current;
      const live = Boolean(a && !a.paused && a.readyState >= 2 && !adRef.current.active);
      trace("handoverTo", {
        station: station.name && station.name.slice(0, 24),
        live,
        paused: a ? a.paused : null,
        rs: a ? a.readyState : null,
      });
      if (!live) {
        trace("handover.skip", { reason: "nothing playing", station: station.name.slice(0, 24) });
        _start(station);
        clearSwitching();
        return true;
      }
      const incoming = await bufferIncoming(station.url, timeoutMs);
      // A newer press may have started while this one was buffering: a slow
      // candidate must never take over after the driver has already moved on.
      if (seq !== switchSeqRef.current) {
        if (incoming) discardElement(incoming);
        trace("handover.superseded", { station: station.name.slice(0, 24) });
        return false;
      }
      if (!incoming) {
        trace("handover.bufferFailed", { station: station.name.slice(0, 24) });
        // Remember the dud on this device so the queue stops offering it.
        noteFailure(station);
        clearSwitching();
        return false;
      }
      trace("handover.promote", { station: station.name.slice(0, 24) });
      commitStation(station, { buffering: false });
      promoteIncoming(incoming, station);
      clearSwitching();
      return true;
    },
    [_start, bufferIncoming, commitStation, promoteIncoming, discardElement]
  );

  const tuneTo = useCallback(
    async (station, { timeout = 8000, source = "pick" } = {}) =>
      handoverTo(station, timeout, source),
    [handoverTo]
  );

  // Expose the gapless switch to callbacks declared earlier in the component
  // (play), without creating a dependency cycle.
  useEffect(() => {
    handoverRef.current = handoverTo;
  }, [handoverTo]);

  // Walks the queue until a candidate verifies. Stations that fail never get the
  // live element, so a run of dead stations costs the listener nothing.
  const stepQueue = useCallback(
    async (direction, source) => {
      const q = queueRef.current;
      if (!q.length) return;
      const from = source || (direction > 0 ? "next" : "prev");
      const attempts = Math.min(q.length - 1, 6);
      for (let i = 1; i <= attempts; i += 1) {
        const n = (((indexRef.current + direction * i) % q.length) + q.length) % q.length;
        const candidate = q[n];
        if (!candidate || !candidate.url) continue;
        // eslint-disable-next-line no-await-in-loop
        const ok = await tuneTo(candidate, { source: from });
        trace("stepQueue.try", { station: candidate.name.slice(0, 24), ok });
        if (ok) {
          // Advance the queue cursor — without this every press retries the same
          // station (the old playAt() used to do it).
          indexRef.current = n;
          skipRef.current = 0;
          return;
        }
      }
      // Nothing nearby verified. If audio is still playing, stay exactly where we
      // are — never hand the driver silence.
      const a = audioRef.current;
      if (a && !a.paused && a.readyState >= 2 && !adRef.current.active) {
        setIsBuffering(false);
        return;
      }
      // Already silent, so there is nothing left to protect: get sound back by
      // any means available.
      const good = lastGoodRef.current;
      const currentId = currentStationRef.current && currentStationRef.current.id;
      if (good && good.url && good.id !== currentId) {
        _start(good);
        return;
      }
      const rescue = nextRescue();
      trace("rescue.ladder", { station: rescue.name.slice(0, 24), from: "queue" });
      playRescueSting();
      toast.message(`${rescue.name} — standing in until something better answers`);
      _start(rescue);
    },
    [tuneTo, _start, nextRescue, playRescueSting]
  );

  const next = useCallback(() => {
    stepQueue(1, "next");
  }, [stepQueue]);
  const prev = useCallback(() => {
    stepQueue(-1, "prev");
  }, [stepQueue]);

  const setNeighbors = useCallback(
    (list, currentId) => {
      if (!Array.isArray(list) || !list.length) return;
      queueRef.current = list;
      const i = list.findIndex((s) => s.id === currentId);
      indexRef.current = i >= 0 ? i : 0;
    },
    []
  );

  // ---- Audio element ------------------------------------------------------
  // (handlersRef and createElement are declared above, before the switching
  // code, because a dependency array is evaluated during render.)
  //
  // Exactly one element is audible at a time and it is the one that owns the
  // lock-screen session. A station change builds a SECOND element, lets it buffer
  // and start producing audio, and only then stops the first one (see
  // bufferIncoming/promoteIncoming). That is what removes the seconds of silence a
  // source swap caused — and silence on a locked screen is what makes iOS take the
  // Now Playing card and the car buttons away.

  // While handing over, two elements exist at once (one winding down, one
  // starting). Events from a retired element must be ignored.
  const isActive = (e) => Boolean(e) && e.currentTarget === audioRef.current;

  const onPlaying = useCallback((e) => {
    if (!isActive(e)) return;
    setIsPlaying(true);
    setIsBuffering(false);
    setError(null);
    setBlocked(false);
    skipRef.current = 0;
    lastGoodRef.current = pendingRef.current;
  }, []);

  const onWaiting = useCallback((e) => {
    if (!isActive(e)) return;
    setIsBuffering(true);
  }, []);

  const onPause = useCallback((e) => {
    if (!isActive(e)) return;
    setIsPlaying(false);
    // iOS can pause the element by itself (screen lock plus a stalled stream). If
    // the driver never asked for a pause, push it back on: a silent element is
    // what costs us the card and the car buttons.
    if (userPausedRef.current || adRef.current.active) return;
    setTimeout(() => {
      const el = audioRef.current;
      if (
        el &&
        el.paused &&
        !el.ended &&
        el.getAttribute("src") &&
        !userPausedRef.current &&
        !adRef.current.active
      ) {
        el.play().catch(() => {});
      }
    }, 1200);
  }, []);

  const onError = useCallback((e) => {
    if (!isActive(e)) return;
    // A broken ad must never be mistaken for a broken station.
    if (adRef.current.active) {
      adHandlerRef.current && adHandlerRef.current();
      return;
    }
    if (errorHandlerRef.current) errorHandlerRef.current();
  }, []);

  const onEnded = useCallback((e) => {
    if (!isActive(e)) return;
    // An ad finishing is the signal to hand the stream back to the radio.
    if (adRef.current.active) adHandlerRef.current && adHandlerRef.current();
  }, []);

  // Background safety net for the ad cadence. While the screen is locked iOS may
  // throttle setTimeout, but a playing media element keeps raising timeupdate, so
  // an overdue break still happens.
  const onTimeUpdate = useCallback((e) => {
    if (!isActive(e)) return;
    if (adRef.current.active) return;
    const now = Date.now();
    if (now - lastAdCheckRef.current < 10000) return;
    lastAdCheckRef.current = now;
    if (adTimerRef.current) return; // the normal timer is alive and owns this
    const dueAt = adRef.current.dueAt;
    if (dueAt && now >= dueAt && !userPausedRef.current) {
      startAdRef.current && startAdRef.current();
    }
  }, []);

  useEffect(() => {
    handlersRef.current = {
      playing: onPlaying,
      waiting: onWaiting,
      pause: onPause,
      error: onError,
      ended: onEnded,
      timeupdate: onTimeUpdate,
    };
  }, [onPlaying, onWaiting, onPause, onError, onEnded, onTimeUpdate]);

  useEffect(() => {
    const a = createElement();
    audioRef.current = a;
    return () => {
      a.pause();
      if (a.parentNode) a.parentNode.removeChild(a);
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
      }
    };
  }, [createElement]);

  // Auto-skip broken streams (keep latest closure in a ref).
  //
  // Hands-free driving contract: a dead or stuck station must never leave the
  // player silent, because silence is what makes iOS drop the lock-screen card
  // and with it the Next/Previous buttons you are steering with. So we keep
  // moving through the queue, and when the whole queue has failed we fall back
  // to the last station that actually played rather than stopping.
  useEffect(() => {
    errorHandlerRef.current = () => {
      const el = audioRef.current;
      // Stopped on purpose — nothing to skip to.
      if (!el || !el.getAttribute("src")) return;
      // An ad is on air: its own handler deals with problems.
      if (adRef.current.active) return;
      // Paused on purpose — don't surprise the driver with a new station.
      if (userPausedRef.current) {
        setIsBuffering(false);
        return;
      }
      setIsBuffering(false);
      setIsPlaying(false);
      // The element that erred is the live one, so the station worth scoring is
      // whatever we last asked it to play.
      noteFailure(pendingRef.current || currentStationRef.current);
      // Sound first, search second.
      //
      // iOS drops the Now Playing card and the Bluetooth buttons the moment the
      // page stops producing audio, and walking the queue on a second element
      // while this one sits in an error state can take tens of seconds — all of
      // them silent. That is how the lock screen was lost when a station went
      // down. So put audio back on the LIVE element immediately and only then
      // look for something better; the handover keeps that audio alive while the
      // search runs.
      const audible = el && !el.paused && el.readyState >= 2 && !el.error;
      const lastGood = lastGoodRef.current;
      const usingLastGood = Boolean(
        lastGood && lastGood.url && lastGood.id !== pendingRef.current?.id
      );
      const emergency = usingLastGood ? lastGood : nextRescue();
      if (!audible && pendingRef.current?.id !== emergency.id) {
        trace("recover.emergency", {
          station: emergency.name.slice(0, 24),
          ladder: !usingLastGood,
        });
        if (!usingLastGood) playRescueSting();
        skipRef.current = 0;
        _start(emergency);
        setIsBuffering(true);
        // Let the rescue stream actually start (readyState 2 is what makes the
        // next switch take the gapless handover path instead of a source swap),
        // then keep looking for a better station.
        setTimeout(() => stepQueue(1, "recover"), 1000);
        return;
      }
      const q = queueRef.current;
      // The station that just died is the current one, so walk forward from here.
      // stepQueue only commits to a candidate it has verified, so a run of dead
      // stations never reaches the speakers as silence.
      if (q.length > 1 && skipRef.current < 12) {
        skipRef.current += 1;
        stepQueue(1);
        return;
      }
      const good = lastGoodRef.current;
      if (good && good.url && good.id !== pendingRef.current?.id) {
        skipRef.current = 0;
        _start(good);
        return;
      }
      // Last resort: park on a stream that is known to work, so the lock-screen
      // card and the Bluetooth buttons survive the whole queue failing. Anything
      // already on the ladder counts as rescued, or the ladder could never advance
      // past its first rung.
      const onLadder = RESCUE_STATIONS.some((s) => s.id === pendingRef.current?.id);
      if (!onLadder) {
        const rescue = nextRescue();
        skipRef.current = 0;
        trace("rescue.ladder", { station: rescue.name.slice(0, 24), from: "exhausted" });
        playRescueSting();
        toast.message(`${rescue.name} — standing in until something better answers`);
        _start(rescue);
        return;
      }
      setError("This station couldn't be reached. Try another one.");
    };
  }, [stepQueue, _start, nextRescue, playRescueSting]);

  // Watchdog for stations that never fire an error: a stream that hangs on
  // "buffering" forever looks identical to a slow one, so give it 12 seconds
  // and then treat it as broken and move on.
  useEffect(() => {
    if (!current || blocked || isPlaying || userPausedRef.current) return;
    if (adRef.current.active) return;
    const timer = setTimeout(() => {
      // Re-check at fire time: pausing while a station is still buffering does
      // not change isPlaying, so this effect never re-runs to cancel the timer.
      if (userPausedRef.current || adRef.current.active) return;
      const a = audioRef.current;
      if (!a || a.readyState < 3) {
        errorHandlerRef.current && errorHandlerRef.current();
      }
    }, 12000);
    return () => clearTimeout(timer);
  }, [current, isPlaying, blocked]);

  // ---- Advertisement breaks ----------------------------------------------
  //
  // An ad plays through the SAME audio element as the radio, never a second
  // one. A second element would take over the "now playing" session and iOS /
  // Android would drop the lock-screen and Bluetooth controls with it — the one
  // thing that must not happen mid-drive. Swapping src on the single element
  // keeps one continuous media session: the card stays, the buttons stay, and
  // when the ad ends the same element is pointed back at the live stream.

  // Smooth volume ramp. Cutting hard into an advert sounds like a fault; a short
  // fade reads as "the radio is pausing for a moment", and fading back in after
  // the break means the return to live radio is not a click either.
  const fadeTo = useCallback(
    (el, target, ms) =>
      new Promise((resolve) => {
        if (!el) return resolve();
        let from;
        try {
          from = el.volume;
        } catch {
          return resolve();
        }
        const steps = Math.max(3, Math.round((ms || 300) / 60));
        let i = 0;
        const timer = setInterval(() => {
          i += 1;
          try {
            el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
          } catch {
            /* element went away mid-fade */
          }
          if (i >= steps) {
            clearInterval(timer);
            resolve();
          }
        }, 60);
      }),
    []
  );

  const scheduleAd = useCallback((delay) => {
    if (adTimerRef.current) clearTimeout(adTimerRef.current);
    // Wall-clock deadline as well as a timer: iOS throttles or suspends timers
    // when the screen locks, so the media clock (timeupdate) double-checks this
    // deadline and fires a break that the timer slept through.
    adRef.current.dueAt = Date.now() + delay;
    adTimerRef.current = setTimeout(() => {
      adTimerRef.current = null;
      startAdRef.current && startAdRef.current();
    }, delay);
  }, []);

  const endAd = useCallback(() => {
    adRef.current.active = false;
    setAdPlaying(false);
    const station = adRef.current.station || currentStationRef.current;
    adRef.current.station = null;
    adRef.current.ad = null;
    const a = audioRef.current;
    if (a && station && station.url) {
      // Fade the ad out, put the live stream back, fade it up. The element is
      // never pointed at nothing, so the media session survives the break — which
      // is why ads use the same element as the radio.
      fadeTo(a, 0, 300).then(() => {
        attachSource(station.url);
        setTimeout(() => {
          if (!adRef.current.active) fadeTo(a, userVolRef.current, 450);
        }, 300);
      });
    }
    scheduleAd(AD_INTERVAL_MS);
  }, [scheduleAd, attachSource, fadeTo]);

  const startAd = useCallback(async () => {
    if (adRef.current.active) return;
    const a = audioRef.current;
    if (!a || !a.getAttribute("src")) return;
    if (userPausedRef.current) {
      scheduleAd(5 * 60 * 1000);
      return;
    }
    const station = currentStationRef.current;
    if (!station || !station.url) {
      scheduleAd(5 * 60 * 1000);
      return;
    }
    const ad = await pickAd();
    if (!ad) {
      scheduleAd(15 * 60 * 1000);
      return;
    }
    // Conditions can change while the ad list loads.
    if (adRef.current.active || userPausedRef.current) return;
    adRef.current.active = true;
    adRef.current.station = station;
    adRef.current.ad = ad;
    setAdPlaying(true);
    detachHls();
    // Duck the radio away first, then swap the source.
    await fadeTo(a, 0, 320);
    if (adRef.current.active !== true || userPausedRef.current) return;
    try {
      a.src = ad;
    } catch {
      endAd();
      return;
    }
    const p = a.play();
    if (p && p.catch) p.catch(() => endAd());
    setTimeout(() => {
      if (adRef.current.active) fadeTo(a, userVolRef.current, 450);
    }, 320);
  }, [endAd, scheduleAd, detachHls, fadeTo]);

  useEffect(() => {
    startAdRef.current = startAd;
  }, [startAd]);

  useEffect(() => {
    adHandlerRef.current = endAd;
  }, [endAd]);

  // Latest station for timers, which must not read stale state.
  useEffect(() => {
    currentStationRef.current = current;
  }, [current]);

  // Arm the cadence once a station is playing. Deliberately not restarted on
  // every station change, so breaks still land every 20 minutes while you hop
  // between stations instead of resetting the clock each time.
  useEffect(() => {
    if (!isPlaying || adPlaying) return;
    if (adTimerRef.current) return;
    scheduleAd(AD_INTERVAL_MS);
  }, [isPlaying, adPlaying, scheduleAd]);

  useEffect(
    () => () => {
      if (adTimerRef.current) clearTimeout(adTimerRef.current);
      adTimerRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (volume > 0) userVolRef.current = volume;
  }, [volume]);

  useEffect(() => {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    localStorage.setItem(HIST_KEY, JSON.stringify(history));
  }, [history]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!current) return;
    if (isPlaying) {
      userPausedRef.current = true;
      a.pause();
    } else {
      userPausedRef.current = false;
      a.play().catch(() => {});
    }
  }, [current, isPlaying]);

  // Recover, don't just un-pause. If the element is parked on a URL that can
  // never play — the failure that used to require a page refresh — play()
  // rejects forever, so re-attach a station we actually believe in.
  const retune = useCallback(() => {
    const cur = currentStationRef.current;
    const good = lastGoodRef.current;
    const el = audioRef.current;
    const curBroken = !cur || !cur.url || Boolean(el && el.error);
    if (!curBroken && cur && cur.url) {
      _start(cur);
      return;
    }
    if (good && good.url) {
      _start(good);
      return;
    }
    _start(cur && cur.url ? cur : FALLBACK_STATION);
  }, [_start]);

  const resume = useCallback(() => {
    userPausedRef.current = false;
    const a = audioRef.current;
    if (!a) return;
    const src = a.getAttribute("src");
    if (src && !a.error && a.readyState >= 1) {
      a.play().catch(() => retune());
      return;
    }
    retune();
  }, [retune]);

  // iOS sometimes pauses the element by itself when the screen locks and a
  // stream stalls. If the driver never asked for a pause, push playback back on:
  // silence is what costs us the lock-screen card and the car buttons.
  // The per-element pause/resume kick lives in onPause, so it also covers elements
  // created later by a handover. This interval is the slow safety net behind it.
  useEffect(() => {
    const kick = () => {
      const a = audioRef.current;
      if (!a || adRef.current.active || userPausedRef.current) return;
      if (!a.getAttribute("src") || a.ended) return;
      if (a.paused) a.play().catch(() => {});
    };
    const id = setInterval(kick, 5000);
    return () => clearInterval(id);
  }, []);

  // Pause without forgetting the station (used by voice search and the car /
  // lock-screen "pause" button). `stop` would clear the queue.
  const pause = useCallback(() => {
    userPausedRef.current = true;
    if (audioRef.current) audioRef.current.pause();
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    a.pause();
    // removeAttribute rather than src="": assigning an empty string points the
    // element at the page URL and fires a spurious error, which the auto-skip
    // logic would treat as a dead station.
    a.removeAttribute("src");
    detachHls();
    pendingRef.current = null;
    adRef.current.active = false;
    adRef.current.station = null;
    setAdPlaying(false);
    if (adTimerRef.current) {
      clearTimeout(adTimerRef.current);
      adTimerRef.current = null;
    }
    adRef.current.dueAt = null;
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        /* ignore */
      }
      try {
        navigator.mediaSession.playbackState = "none";
      } catch {
        /* ignore */
      }
    }
    setCurrent(null);
    setIsPlaying(false);
    setNowPlaying(null);
    setSleepEndsAt(null);
    queueRef.current = [];
    indexRef.current = 0;
  }, [detachHls]);

  // ---- Now Playing polling ----
  useEffect(() => {
    if (!current || !current.url || !isPlaying || adPlaying) return;
    let active = true;
    const fetchMeta = async () => {
      try {
        const data = await getNowPlaying(current.url);
        if (active) setNowPlaying(data && data.title ? data.title : null);
      } catch {
        /* ignore */
      }
    };
    fetchMeta();
    const id = setInterval(fetchMeta, 20000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [current, isPlaying, adPlaying]);

  // ---- Media Session API (lock screen / car bluetooth controls) ----
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    try {
      const artwork = current.favicon
        ? [96, 128, 192, 256, 384, 512].map((sz) => ({
            src: imgProxyUrl(current.favicon),
            sizes: `${sz}x${sz}`,
          }))
        : [];
      // eslint-disable-next-line no-undef
      navigator.mediaSession.metadata = new MediaMetadata({
        title: adPlaying
          ? "Radio Melody · advert"
          : nowPlaying || current.name || "Radio",
        artist: adPlaying
          ? `Back to ${current.name || "your station"} in a moment`
          : nowPlaying && current.name
            ? current.name
            : [current.state, current.country].filter(Boolean).join(", ") ||
              "Radio Melody",
        album: "Radio Melody",
        artwork,
      });
    } catch {
      /* ignore */
    }
  }, [current, nowPlaying, adPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      // Report "playing" for as long as a station is selected and the driver has
      // not asked for a pause — including while tuning or skipping. Silence plus
      // "paused" is what makes iOS take the card away; this is the honest signal
      // for a live-radio player that intends to be audible.
      navigator.mediaSession.playbackState =
        current && !blocked && !userPausedRef.current ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  }, [isPlaying, isBuffering, blocked, current]);

  // Lock-screen / car controls (iOS Control Center, Android Auto, Bluetooth).
  //
  // Two things matter here:
  //  1. Re-register whenever a station changes, not just once on mount. iOS
  //     Safari ignores handlers registered before playback has actually begun,
  //     which is why the lock screen fell back to standard +/-10s seek buttons
  //     on an iPhone. Registering again once audio is playing makes it show
  //     Previous / Next station instead.
  //  2. Live radio has no timeline, so the seek actions are explicitly cleared.
  // Latest handlers, reachable from the registered callbacks without ever having
  // to re-register them (re-registering means clearing first, and a cleared
  // handler is a button that vanishes from the lock screen).
  const actionsRef = useRef({});
  useEffect(() => {
    actionsRef.current = { resume, pause, next, prev, stop };
  }, [resume, pause, next, prev, stop]);

  const registerMediaActions = useCallback(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, handler) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    set("play", () => actionsRef.current.resume());
    set("pause", () => actionsRef.current.pause());
    set("nexttrack", () => actionsRef.current.next());
    set("previoustrack", () => actionsRef.current.prev());
    set("stop", () => actionsRef.current.stop());
    // Live radio has no timeline, so clear the seek actions: that is what makes
    // the car and Control Center show Previous / Next instead of ±10 seconds.
    set("seekbackward", null);
    set("seekforward", null);
    set("seekto", null);
  }, []);

  // Register once and never tear them down again. The earlier version cleared
  // the handlers on every station change and re-registered afterwards, leaving a
  // window with no handlers at all — on iOS that window is exactly where the
  // Next/Back buttons disappear.
  useEffect(() => {
    registerMediaActions();
  }, [registerMediaActions]);

  // Re-assert once audio is actually playing: iOS Safari only honours handlers
  // registered after playback began.
  useEffect(() => {
    if (isPlaying) registerMediaActions();
  }, [isPlaying, registerMediaActions]);

  // ---- Sleep timer ----
  const startSleepTimer = useCallback((minutes) => {
    if (fadeRef.current) {
      clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
    setSleepEndsAt(minutes ? Date.now() + minutes * 60000 : null);
  }, []);

  const cancelSleepTimer = useCallback(() => {
    if (fadeRef.current) {
      clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
    setSleepEndsAt(null);
    if (audioRef.current) audioRef.current.volume = userVolRef.current;
    setVolume(userVolRef.current);
  }, []);

  useEffect(() => {
    if (!sleepEndsAt) {
      setSleepRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = sleepEndsAt - Date.now();
      setSleepRemaining(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(id);
        const a = audioRef.current;
        const startVol = a ? a.volume : userVolRef.current;
        let step = 0;
        fadeRef.current = setInterval(() => {
          step += 1;
          const v = Math.max(0, startVol * (1 - step / 16));
          if (a) a.volume = v;
          if (step >= 16) {
            clearInterval(fadeRef.current);
            fadeRef.current = null;
            if (a) {
              a.pause();
              // Same reason as stop(): never leave the element pointing at "".
              a.removeAttribute("src");
              a.volume = userVolRef.current;
            }
            setIsPlaying(false);
            setCurrent(null);
            setNowPlaying(null);
            setVolume(userVolRef.current);
          }
        }, 500);
        setSleepEndsAt(null);
      }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [sleepEndsAt]);

  const isFavorite = useCallback(
    (id) => favorites.some((s) => s.id === id),
    [favorites]
  );

  const toggleFavorite = useCallback((station) => {
    setFavorites((prev) => {
      if (prev.some((s) => s.id === station.id)) {
        return prev.filter((s) => s.id !== station.id);
      }
      return [{ ...station }, ...prev];
    });
  }, []);

  const importFavorites = useCallback((list) => {
    if (!Array.isArray(list) || !list.length) return;
    setFavorites((prev) => {
      const ids = new Set(prev.map((s) => s.id));
      const additions = list.filter((s) => s && s.id && !ids.has(s.id));
      return [...additions, ...prev];
    });
  }, []);

  const value = {
    current,
    switching,
    adPlaying,
    isPlaying,
    isBuffering,
    error,
    blocked,
    volume,
    setVolume,
    nowPlaying,
    sleepEndsAt,
    sleepRemaining,
    startSleepTimer,
    cancelSleepTimer,
    favorites,
    history,
    play,
    next,
    prev,
    setNeighbors,
    toggle,
    resume,
    pause,
    stop,
    isFavorite,
    toggleFavorite,
    importFavorites,
    setHistory,
  };
  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};
