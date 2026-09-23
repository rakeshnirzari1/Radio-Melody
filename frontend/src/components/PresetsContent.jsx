import React, { useState } from "react";
import { Loader2, Play, Route as RouteIcon, Share2 } from "lucide-react";
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

  // A collection is a short link, because a preset is a tag query rather than a
  // wall of station ids: the recipient loads the same query and hears the same
  // collection, and the link stays short enough to paste into a chat.
  const sharePreset = async (preset) => {
    const origin = `${window.location.origin}${process.env.PUBLIC_URL || ""}`.replace(
      /\/+$/,
      ""
    );
    const url = `${origin}/?preset=${encodeURIComponent(preset.key)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${preset.label} link copied`, {
        description: "Anyone who opens it hears this collection.",
      });
    } catch {
      toast.error(`Copy this link: ${url}`);
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
          <div key={p.key} className="relative">
          <button
            onClick={() => start(p)}
            disabled={Boolean(busy)}
            className="group relative w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-all hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-60"
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
          {/* Beside the card, not inside it: a button inside a button is invalid
              HTML and browsers disagree about which one was pressed. */}
          <button
            onClick={() => sharePreset(p)}
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-[#9fb3aa] transition-colors hover:bg-black/60 hover:text-white"
            title={`Copy a link to ${p.label}`}
            aria-label={`Copy a link to ${p.label}`}
          >
            <Share2 size={13} />
          </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PresetsContent;
