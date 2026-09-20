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

  const pushHistory = useCallback((station) => {
    setHistory((prev) => {
      const filtered = prev.filter((s) => s.id !== station.id);
      return [{ ...station, playedAt: Date.now() }, ...filtered].slice(0, 40);
    });
  }, []);

  const _start = useCallback(
    (station) => {
      if (!station || !station.url) return;
      const a = audioRef.current;
      setError(null);
      setBlocked(false);
      setNowPlaying(null);
      setCurrent(station);
      setIsBuffering(true);
      a.src = streamUrl(station.url);
      const p = a.play();
      if (p && p.catch) {
        p.catch((err) => {
          setIsBuffering(false);
          if (err && err.name === "NotAllowedError") {
            setBlocked(true); // autoplay policy — needs a tap
          }
        });
      }
      pushHistory(station);
      registerClick(station.id);
    },
    [pushHistory]
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
    a.crossOrigin = "anonymous";
    a.volume = userVolRef.current;
    audioRef.current = a;

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      setError(null);
      setBlocked(false);
      skipRef.current = 0;
    };
    const onWaiting = () => setIsBuffering(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      if (errorHandlerRef.current) errorHandlerRef.current();
    };
    a.addEventListener("playing", onPlaying);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("pause", onPause);
    a.addEventListener("error", onError);
    return () => {
      a.pause();
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("error", onError);
    };
  }, []);

  // Auto-skip broken streams (keep latest closure in a ref)
  useEffect(() => {
    errorHandlerRef.current = () => {
      setIsBuffering(false);
      setIsPlaying(false);
      const q = queueRef.current;
      if (q.length > 1 && skipRef.current < 6) {
        skipRef.current += 1;
        playAt(indexRef.current + 1);
      } else {
        setError("This station couldn't be reached. Try another one.");
      }
    };
  }, [playAt]);

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
      a.pause();
    } else {
      a.play().catch(() => {});
    }
  }, [current, isPlaying]);

  const resume = useCallback(() => {
    const a = audioRef.current;
    if (a && a.src) a.play().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    a.pause();
    a.src = "";
    setCurrent(null);
    setIsPlaying(false);
    setNowPlaying(null);
    setSleepEndsAt(null);
    queueRef.current = [];
    indexRef.current = 0;
  }, []);

  // ---- Now Playing polling ----
  useEffect(() => {
    if (!current || !current.url || !isPlaying) return;
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
  }, [current, isPlaying]);

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
        title: nowPlaying || current.name || "Radio",
        artist:
          nowPlaying && current.name
            ? current.name
            : [current.state, current.country].filter(Boolean).join(", ") ||
              "Radio Melody",
        album: "Radio Melody",
        artwork,
      });
    } catch {
      /* ignore */
    }
  }, [current, nowPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  }, [isPlaying]);

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
    set("play", () => resume());
    set("pause", () => audioRef.current && audioRef.current.pause());
    set("nexttrack", () => next());
    set("previoustrack", () => prev());
    set("stop", () => stop());
    return () => {
      ["play", "pause", "nexttrack", "previoustrack", "stop"].forEach((a) =>
        set(a, null)
      );
    };
  }, [resume, next, prev, stop]);

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
