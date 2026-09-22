import React, { useEffect, useState } from "react";
import { Share2, RotateCcw, Trophy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { worldProgress, subscribeWorld, resetWorld, countryFlag } from "../lib/explored";
import { worldCardCanvas, shareCard } from "../lib/shareCard";
import { absoluteUrl } from "../lib/share";

// "Around the World" — your own progress, drawn from the stations you have
// actually heard. Nothing is uploaded; this is localStorage plus a canvas.
const ChallengeContent = () => {
  const [progress, setProgress] = useState(worldProgress);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const unsub = subscribeWorld(() => setProgress(worldProgress()));
    setProgress(worldProgress());
    return unsub;
  }, []);

  const share = async () => {
    if (!progress.total) {
      toast.info("Nothing to share yet", {
        description: "Play a few stations from different countries first.",
      });
      return;
    }
    setSharing(true);
    try {
      const canvas = worldCardCanvas(progress);
      const url = absoluteUrl("/");
      const result = await shareCard(canvas, {
        filename: `radio-melody-world-${progress.total}.png`,
        text: `I've heard live radio from ${progress.total} ${
          progress.total === 1 ? "country" : "countries"
        } on Radio Melody 🌍`,
        url,
      });
      if (result === "downloaded") {
        toast.success("Card saved", { description: "Link copied too — paste it anywhere." });
      } else if (result === "shared") {
        toast.success("Shared");
      }
    } catch {
      toast.error("Couldn't build the card");
    } finally {
      setSharing(false);
    }
  };

  const next = progress.next;
  const pct = next ? Math.min(100, Math.round((progress.total / next) * 100)) : 100;

  return (
    <div className="rm-scroll flex-1 overflow-y-auto px-5 pb-6">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-center">
        <div className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.25em] text-[#7fd4ff]">
          <Trophy size={12} /> Around the world
        </div>
        <div className="mt-2 font-display text-5xl font-800 text-white">{progress.total}</div>
        <div className="mt-1 text-sm text-[#9fb3aa]">
          {progress.total === 1 ? "country heard live" : "countries heard live"}
        </div>
        {next && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2fe08a] to-[#7fd4ff] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-[#6f857b]">
              {next - progress.total} more to reach {next}
            </div>
          </div>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={share}
            disabled={sharing}
            className="flex items-center gap-2 rounded-full bg-[#2fe08a] px-4 py-2.5 text-sm font-600 text-[#05070a] transition-transform hover:scale-105 disabled:opacity-60"
          >
            {sharing ? <Loader2 size={15} className="rm-spin" /> : <Share2 size={15} />}
            Share my map
          </button>
        </div>
      </div>

      {progress.countries.length > 0 && (
        <>
          <div className="mt-6 mb-2 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#6f857b]">
              Countries heard
            </div>
            <button
              onClick={() => {
                resetWorld();
                toast.info("Progress reset");
              }}
              className="flex items-center gap-1 text-[11px] text-[#6f857b] transition-colors hover:text-rose-400"
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {progress.countries.map((c) => (
              <span
                key={c.code}
                title={`${c.name} · ${c.plays} ${c.plays === 1 ? "station" : "plays"}`}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-[#cfe8dd]"
              >
                <span className="text-sm leading-none">{countryFlag(c.code)}</span>
                <span className="max-w-[110px] truncate">{c.name}</span>
                <span className="text-[10px] text-[#6f857b]">{c.plays}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {!progress.total && (
        <p className="mt-6 text-center text-sm leading-relaxed text-[#8497a0]">
          Every country you tune into gets counted here — a dot on the globe is a
          country heard. Land on five and you will know about it.
        </p>
      )}
    </div>
  );
};

export default ChallengeContent;
