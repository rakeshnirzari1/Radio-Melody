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

const PlayerContext = createContext(null);
export const usePlayer = () => useContext(PlayerContext);

const FAV_KEY = "rm_favorites";
const HIST_KEY = "rm_history";

const load = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
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

  const _start = useCallback(
    (station) => {
      if (!station || !station.url) return;
      setError(null);
      setBlocked(false);
      setNowPlaying(null);
      setCurrent(station);
      setIsBuffering(true);
      pendingRef.current = station;
      userPausedRef.current = false;
      // Selecting a station cancels any ad break in progress.
      adRef.current.active = false;
      adRef.current.station = null;
      setAdPlaying(false);
      attachSource(station.url);
      pushHistory(station);
      registerClick(station.id);
    },
    [pushHistory, attachSource]
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
      _start(station);
    },
    [_start]
  );

  const playAt = useCallback(
    (i) => {
      const q = queueRef.current;
      if (!q.length) return;
      const n = ((i % q.length) + q.length) % q.length;
      indexRef.current = n;
      _start(q[n]);
    },
    [_start]
  );

  const next = useCallback(() => playAt(indexRef.current + 1), [playAt]);
  const prev = useCallback(() => playAt(indexRef.current - 1), [playAt]);

  const setNeighbors = useCallback(
    (list, currentId) => {
      if (!Array.isArray(list) || !list.length) return;
      queueRef.current = list;
      const i = list.findIndex((s) => s.id === currentId);
      indexRef.current = i >= 0 ? i : 0;
    },
    []
  );

  // ---- Audio element (created once) ----
  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    // No crossOrigin: most radio servers don't send CORS headers, and asking for
    // CORS makes the browser refuse streams it would otherwise play fine. We
    // never read the audio samples, so CORS buys us nothing here.
    a.volume = userVolRef.current;
    // Keep the element attached to the document and marked inline. iOS holds on
    // to the lock-screen / Bluetooth media session far more reliably for an
    // attached media element, which is what keeps the car controls alive when a
    // station in the queue turns out to be dead.
    a.setAttribute("playsinline", "");
    a.setAttribute("webkit-playsinline", "");
    a.setAttribute("x-webkit-airplay", "allow");
    a.style.display = "none";
    document.body.appendChild(a);
    audioRef.current = a;

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      setError(null);
      setBlocked(false);
      skipRef.current = 0;
      lastGoodRef.current = pendingRef.current;
    };
    const onWaiting = () => setIsBuffering(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      // A broken ad must never be mistaken for a broken station.
      if (adRef.current.active) {
        adHandlerRef.current && adHandlerRef.current();
        return;
      }
      if (errorHandlerRef.current) errorHandlerRef.current();
    };
    // An ad finishing is the signal to hand the stream back to the radio.
    const onEnded = () => {
      if (adRef.current.active) adHandlerRef.current && adHandlerRef.current();
    };
    // Background safety net for the ad cadence. While the screen is locked iOS
    // may throttle setTimeout, but a playing media element keeps raising
    // timeupdate, so an overdue break still happens.
    const onTimeUpdate = () => {
      if (adRef.current.active) return;
      const now = Date.now();
      if (now - lastAdCheckRef.current < 10000) return;
      lastAdCheckRef.current = now;
      if (adTimerRef.current) return; // the normal timer is alive and owns this
      const dueAt = adRef.current.dueAt;
      if (dueAt && now >= dueAt && !userPausedRef.current) {
        startAdRef.current && startAdRef.current();
      }
    };
    a.addEventListener("playing", onPlaying);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("pause", onPause);
    a.addEventListener("error", onError);
    a.addEventListener("ended", onEnded);
    a.addEventListener("timeupdate", onTimeUpdate);
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
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("error", onError);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

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
      const q = queueRef.current;
      if (q.length > 1 && skipRef.current < 12) {
        skipRef.current += 1;
        playAt(indexRef.current + 1);
        return;
      }
      const good = lastGoodRef.current;
      if (good && good.url && good.id !== pendingRef.current?.id) {
        skipRef.current = 0;
        _start(good);
        return;
      }
      setError("This station couldn't be reached. Try another one.");
    };
  }, [playAt, _start]);

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
      attachSource(station.url);
    }
    scheduleAd(AD_INTERVAL_MS);
  }, [scheduleAd, attachSource]);

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
    a.src = ad;
    const p = a.play();
    if (p && p.catch) p.catch(() => endAd());
  }, [endAd, scheduleAd, detachHls]);

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

  const resume = useCallback(() => {
    const a = audioRef.current;
    if (a && a.src) {
      userPausedRef.current = false;
      a.play().catch(() => {});
    }
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
      // Report "playing" while tuning or skipping too, so iOS keeps the
      // lock-screen card up through a broken station instead of dropping it.
      navigator.mediaSession.playbackState =
        !blocked && current && (isPlaying || isBuffering) ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  }, [isPlaying, isBuffering, blocked, current]);

  const currentId = current ? current.id : null;

  // Lock-screen / car controls (iOS Control Center, Android Auto, Bluetooth).
  //
  // Two things matter here:
  //  1. Re-register whenever a station changes, not just once on mount. iOS
  //     Safari ignores handlers registered before playback has actually begun,
  //     which is why the lock screen fell back to standard +/-10s seek buttons
  //     on an iPhone. Registering again once audio is playing makes it show
  //     Previous / Next station instead.
  //  2. Live radio has no timeline, so the seek actions are explicitly cleared.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, handler) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    // Clear first: some browsers keep the previous handler otherwise.
    ["seekbackward", "seekforward", "seekto"].forEach((a) => set(a, null));
    set("play", () => resume());
    set("pause", () => pause());
    set("nexttrack", () => next());
    set("previoustrack", () => prev());
    set("stop", () => stop());
    set("seekbackward", null);
    set("seekforward", null);
    set("seekto", null);
    return () => {
      [
        "play",
        "pause",
        "nexttrack",
        "previoustrack",
        "stop",
        "seekbackward",
        "seekforward",
        "seekto",
      ].forEach((a) => set(a, null));
    };
  }, [resume, pause, next, prev, stop, currentId, isPlaying]);

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
              a.src = "";
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
