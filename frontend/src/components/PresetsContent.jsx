import React, { useState } from "react";
import { Loader2, Play, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { usePlayer } from "../context/PlayerContext";
import { ROAD_TRIP_PRESETS } from "../data/presets";
import { getByTag } from "../lib/radioApi";

// Presets build a queue from a tag query, so a listener who has not pinned any
// favourites still gets a "road trip" with a direction. Pressing a preset starts
// it and hands the whole list to Next/Back — the same shape as the favourites
// road trip, so the player needs no special case.
const PresetsContent = ({ onPlayFocus, onPresetStarted }) => {
  const { play } = usePlayer();
  const [busy, setBusy] = useState(null);

  const start = async (preset) => {
    if (busy) return;
    setBusy(preset.key);
    try {
      const stations = await getByTag(preset.tag, 80);
      if (!stations.length) {
        toast.info(`Nothing found for ${preset.label}`, {
          description: "Try another collection.",
        });
        return;
      }
      play(stations[0], stations);
      onPresetStarted && onPresetStarted(preset, stations);
      toast.success(`${preset.label} · ${stations.length} stations`, {
        description: "Next and Back now walk this collection.",
      });
      onPlayFocus && onPlayFocus(stations[0]);
    } catch {
      toast.error("Couldn't load that collection");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rm-scroll flex-1 overflow-y-auto px-4 pb-6">
      <p className="mb-3 text-sm text-[#8497a0]">
        Hand-picked collections. Starting one makes it your Next/Back list, so you
        can drive through it — no favourites required.
      </p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {ROAD_TRIP_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => start(p)}
            disabled={Boolean(busy)}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-all hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-60"
          >
            <span
              className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl"
              style={{ background: `${p.accent}55` }}
            />
            <div className="relative flex items-center gap-2">
              <RouteIcon size={15} style={{ color: p.accent }} />
              <span className="font-display text-sm font-600 text-white">{p.label}</span>
            </div>
            <p className="relative mt-1.5 text-xs leading-relaxed text-[#9fb3aa]">{p.blurb}</p>
            <div className="relative mt-3 flex items-center gap-1.5 text-[11px] text-[#7bf0b8]">
              {busy === p.key ? (
                <>
                  <Loader2 size={12} className="rm-spin" /> Finding stations…
                </>
              ) : (
                <>
                  <Play size={12} /> Start listening
                </>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PresetsContent;
