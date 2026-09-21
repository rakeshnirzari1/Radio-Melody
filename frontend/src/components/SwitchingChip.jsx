import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

/**
 * "I heard you" feedback for a station change.
 *
 * A switch is deliberately gapless: the current station keeps playing while the
 * next one is prepared, so nothing audibly changes until the handover lands. That
 * is great for the driver and confusing for everyone else — a press looks like it
 * was ignored and people press again and again. This chip names the station being
 * fetched, and only appears if the switch has not landed within a moment, so fast
 * switches do not flash anything.
 */
const SwitchingChip = () => {
  const { switching } = usePlayer();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!switching) {
      setVisible(false);
      return undefined;
    }
    const t = setTimeout(() => setVisible(true), 350);
    return () => clearTimeout(t);
  }, [switching]);

  if (!switching || !visible) return null;

  return (
    <div className="rm-safe-top pointer-events-none absolute left-1/2 top-[92px] z-30 w-max max-w-[92vw] -translate-x-1/2 sm:top-[104px]">
      <div className="rm-glass flex items-center gap-2 rounded-full px-3.5 py-2 text-xs text-[#e8f0ec] shadow-[0_8px_30px_rgba(0,0,0,0.45)] sm:text-sm">
        <Loader2 size={15} className="rm-spin flex-shrink-0 text-[#2fe08a]" />
        <span className="opacity-60">Tuning to</span>
        <span className="font-500 truncate">{switching.name}</span>
      </div>
    </div>
  );
};

export default SwitchingChip;
