import React, { useEffect, useRef } from "react";
import { usePlayer } from "../context/PlayerContext";

/**
 * A living backdrop behind the globe.
 *
 * Honest caveat: this is NOT a real spectrum analyser. Radio streams are
 * cross-origin and have no CORS headers, and connecting one to a Web Audio
 * AnalyserNode silences it — you cannot measure audio you are not allowed to read.
 * So the motion is a stylised envelope driven by the player's real state (playing,
 * buffering, volume) rather than by the waveform. It reads as reacting because it
 * genuinely starts, breathes and stops with the audio.
 */
const BAR_COUNT = 56;

const ReactiveBackground = () => {
  const { isPlaying, isBuffering, current } = usePlayer();
  const canvasRef = useRef(null);
  const stateRef = useRef({ energy: 0, target: 0.0, bars: new Array(BAR_COUNT).fill(0.05) });
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    // Playing breathes, buffering idles low, stopped settles to nothing.
    stateRef.current.target = isBuffering ? 0.22 : isPlaying ? 0.72 : 0.04;
  }, [isPlaying, isBuffering]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let t = 0;

    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const { width: w, height: h } = canvas;
      const s = stateRef.current;
      s.energy += (s.target - s.energy) * 0.035;
      t += reduced.current ? 0 : 0.018;

      ctx.clearRect(0, 0, w, h);
      const bw = w / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i += 1) {
        // Two out-of-phase sines plus a slow drift: enough movement that it looks
        // alive, smooth enough not to distract.
        const wave =
          0.5 +
          0.5 *
            Math.sin(t * 1.7 + i * 0.42) *
            Math.cos(t * 0.6 + i * 0.17);
        const goal = 0.06 + wave * s.energy;
        s.bars[i] += (goal - s.bars[i]) * 0.12;
        const bh = Math.max(2, s.bars[i] * h * 0.42);
        const x = i * bw + bw * 0.22;
        const grad = ctx.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, "rgba(47,224,138,0.00)");
        grad.addColorStop(1, "rgba(47,224,138,0.30)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, h - bh, bw * 0.56, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[34vh] opacity-70"
      style={{ maskImage: "linear-gradient(to top, black, transparent)" }}
      key={current ? current.id : "none"}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
};

export default ReactiveBackground;
