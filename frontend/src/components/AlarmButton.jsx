import React, { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { AlarmClock, Play, Trash2 } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import {
  MODES,
  describeNext,
  defaultAlarm,
  readAlarm,
  testTime,
  writeAlarm,
} from "../lib/alarm";
import { toast } from "sonner";

/**
 * Wake-up alarm settings. The clock itself lives in AlarmWatcher, which is mounted for
 * the whole session; this only edits the settings, so opening and closing the popover
 * can never leave the alarm un-armed.
 */
const AlarmButton = () => {
  const { favorites } = usePlayer();
  const [cfg, setCfg] = useState(() => readAlarm());
  const [status, setStatus] = useState(() => describeNext(readAlarm()));

  useEffect(() => {
    setStatus(describeNext(cfg));
  }, [cfg]);

  const update = (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    writeAlarm(next);
  };

  const onFire = () => {
    if (!cfg.stationId) {
      toast.message("The alarm will play the most popular station at that time", {
        description: "Pick a favourite below to hear something specific.",
      });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
            cfg.enabled
              ? "bg-[#2fe08a]/15 text-[#7bf0b8]"
              : "text-[#9fb3aa] hover:bg-white/5 hover:text-white"
          }`}
          title={cfg.enabled ? `Alarm set for ${cfg.time}` : "Wake-up alarm"}
        >
          <AlarmClock size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 rounded-xl border-[#2fe08a]/20 bg-[#0a1014] p-3 text-[#e8f0ec]"
      >
        <div className="mb-2 flex items-center gap-2 font-display text-sm font-600">
          <AlarmClock size={15} className="text-[#2fe08a]" /> Wake-up alarm
        </div>

        <div className="mb-3 flex items-center justify-between gap-2">
          <input
            type="time"
            value={cfg.time}
            onChange={(e) => update({ time: e.target.value || "07:00" })}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => update({ enabled: !cfg.enabled })}
            className={`rounded-full px-3 py-1.5 text-xs font-600 transition-colors ${
              cfg.enabled
                ? "bg-[#2fe08a] text-[#05070a]"
                : "bg-white/10 text-[#cfe8dd] hover:bg-white/15"
            }`}
          >
            {cfg.enabled ? "On" : "Off"}
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => update({ mode: m.key })}
              className={`rounded-lg px-2 py-1.5 text-xs font-500 transition-colors ${
                cfg.mode === m.key
                  ? "bg-[#2fe08a]/20 text-[#7bf0b8]"
                  : "bg-white/5 text-[#cfe8dd] hover:bg-white/10"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-[11px] uppercase tracking-wider text-[#7f9a90]">
          Station
        </label>
        <select
          value={cfg.stationId}
          onChange={(e) => {
            const id = e.target.value;
            const picked = (favorites || []).find((s) => s.id === id);
            update({ stationId: id, stationName: picked ? picked.name : "" });
          }}
          className="mb-3 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white"
        >
          <option value="">Most popular station at the time</option>
          {(favorites || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <label className="mb-3 flex items-center gap-2 text-xs text-[#cfe8dd]">
          <input
            type="checkbox"
            checked={cfg.fadeIn}
            onChange={(e) => update({ fadeIn: e.target.checked })}
            className="h-3.5 w-3.5 accent-[#2fe08a]"
          />
          Start quietly and rise
        </label>

        <div className="rounded-lg bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-[#7f9a90]">
          {cfg.enabled ? (
            <>
              Next: <span className="text-[#cfe8dd]">{status}</span>
              <span className="mt-1 block">
                Keep this app open (screen can be off) — a web page can only wake you if it
                is still running.
              </span>
            </>
          ) : (
            "Off. Turn it on and the app will start the radio at that time."
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              update({ enabled: true, mode: "once", time: testTime() });
              toast.success("Alarm set for one minute from now", {
                description: "Leave the app open and listen.",
              });
            }}
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-500 text-[#cfe8dd] hover:bg-white/10"
          >
            <Play size={13} /> Try in 1 min
          </button>
          <button
            type="button"
            onClick={() => {
              const cleared = { ...defaultAlarm() };
              setCfg(cleared);
              writeAlarm(cleared);
              toast.message("Alarm cleared");
            }}
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-500 text-[#cfe8dd] hover:bg-white/10"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default AlarmButton;
