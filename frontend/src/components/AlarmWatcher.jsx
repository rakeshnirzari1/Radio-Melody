import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { usePlayer } from "../context/PlayerContext";
import { getStation, getTrending } from "../lib/radioApi";
import { dueNow, occurrenceKey, readAlarm, writeAlarm } from "../lib/alarm";
import { confirm as hapticConfirm } from "../lib/haptics";

/**
 * The alarm's clock. Renders nothing; it only needs to be mounted.
 *
 * The settings are re-read from storage on every tick rather than held in state, so
 * the settings popover can change them without the two copies drifting apart.
 *
 * Wake-up volume starts low and rises: an alarm that slams a pop stream into a dark
 * bedroom at full volume is a reason to uninstall the app.
 */
const AlarmWatcher = () => {
  const { play, setVolume, favorites } = usePlayer();
  const rampRef = useRef(null);

  useEffect(() => {
    const fire = async () => {
      const cfg = readAlarm();
      const now = new Date();
      if (!dueNow(cfg, now)) return;

      // Mark the occurrence before anything can be slow or fail, so a retry of the
      // tick cannot fire the same alarm twice.
      writeAlarm({
        ...cfg,
        lastFired: occurrenceKey(now),
        enabled: cfg.mode === "once" ? false : cfg.enabled,
      });

      let station = cfg.stationId
        ? (favorites || []).find((s) => s.id === cfg.stationId) || null
        : null;
      if (!station && cfg.stationId) {
        station = await getStation(cfg.stationId).catch(() => null);
      }
      if (!station) {
        // No station chosen (or it is gone): take the most popular station right now,
        // which is a far better alarm than a random one.
        const trending = await getTrending().catch(() => null);
        station =
          (Array.isArray(trending) && trending.find((s) => s && s.url)) ||
          (favorites || []).find((s) => s && s.url) ||
          null;
      }
      if (!station) {
        toast.error("Alarm: no station available", {
          description: "Pick one in the alarm settings, or open the app while online.",
        });
        return;
      }

      const target = 0.9;
      if (cfg.fadeIn) {
        setVolume(0.1);
        let step = 1;
        const steps = 14;
        if (rampRef.current) clearInterval(rampRef.current);
        rampRef.current = setInterval(() => {
          const v = 0.1 + (target - 0.1) * (step / steps);
          setVolume(Math.min(target, v));
          step += 1;
          if (step > steps) {
            clearInterval(rampRef.current);
            rampRef.current = null;
          }
        }, 1000);
      } else {
        setVolume(target);
      }

      hapticConfirm();
      play(station, [station]);
      toast.success(`Good morning — ${station.name}`, {
        description: cfg.fadeIn ? "Volume is rising gently." : undefined,
        duration: 8000,
      });
    };

    // A 20 second tick is enough to catch the minute, and cheap enough to leave
    // running. (Browsers throttle background timers, which is why the tick is
    // frequent: a sleeping phone may only give us one wake-up per minute.)
    const id = setInterval(() => {
      fire().catch(() => {});
    }, 20000);
    fire().catch(() => {});
    return () => {
      clearInterval(id);
      if (rampRef.current) clearInterval(rampRef.current);
    };
  }, [play, setVolume, favorites]);

  return null;
};

export default AlarmWatcher;
