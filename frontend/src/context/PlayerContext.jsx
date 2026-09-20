import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { streamUrl, registerClick, getNowPlaying } from "../lib/radioApi";

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
  const [volume, setVolume] = useState(0.9);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [sleepEndsAt, setSleepEndsAt] = useState(null);
  const [sleepRemaining, setSleepRemaining] = useState(0);
  const [favorites, setFavorites] = useState(() => load(FAV_KEY, []));
  const [history, setHistory] = useState(() => load(HIST_KEY, []));

  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    a.crossOrigin = "anonymous";
    audioRef.current = a;

    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      setError(null);
    };
    const onWaiting = () => setIsBuffering(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      setIsBuffering(false);
      setIsPlaying(false);
      setError("This station couldn't be reached. Try another one.");
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

  const pushHistory = useCallback((station) => {
    setHistory((prev) => {
      const filtered = prev.filter((s) => s.id !== station.id);
      return [{ ...station, playedAt: Date.now() }, ...filtered].slice(0, 40);
    });
  }, []);

  const play = useCallback(
    (station) => {
      if (!station || !station.url) return;
      const a = audioRef.current;
      setError(null);
      setNowPlaying(null);
      setCurrent(station);
      setIsBuffering(true);
      a.src = streamUrl(station.url);
      const p = a.play();
      if (p && p.catch) {
        p.catch(() => {
          setIsBuffering(false);
          setError("Playback blocked. Tap play to start.");
        });
      }
      pushHistory(station);
      registerClick(station.id);
    },
    [pushHistory]
  );

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!current) return;
    if (isPlaying) {
      a.pause();
    } else {
      a.play().catch(() => setError("Playback blocked."));
    }
  }, [current, isPlaying]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    a.pause();
    a.src = "";
    setCurrent(null);
    setIsPlaying(false);
    setNowPlaying(null);
    setSleepEndsAt(null);
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

  // ---- Sleep timer ----
  const startSleepTimer = useCallback((minutes) => {
    if (fadeRef.current) {
      clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
    if (!minutes) {
      setSleepEndsAt(null);
      return;
    }
    setSleepEndsAt(Date.now() + minutes * 60000);
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
        // Gentle fade out over ~8s then stop
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

  const value = {
    current,
    isPlaying,
    isBuffering,
    error,
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
    toggle,
    stop,
    isFavorite,
    toggleFavorite,
    setHistory,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};
