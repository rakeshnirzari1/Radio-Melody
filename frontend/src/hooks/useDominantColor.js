import { useEffect, useState } from "react";
import { imgProxyUrl } from "../lib/radioApi";

// Samples the average color of a station favicon (via CORS-enabled proxy)
export const useDominantColor = (faviconUrl) => {
  const [color, setColor] = useState(null);

  useEffect(() => {
    if (!faviconUrl) {
      setColor(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 125) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (n === 0) {
          if (!cancelled) setColor(null);
          return;
        }
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        // Boost very dark averages so the glow stays visible
        const max = Math.max(r, g, b);
        if (max < 60) {
          const f = 60 / (max || 1);
          r = Math.min(255, Math.round(r * f));
          g = Math.min(255, Math.round(g * f));
          b = Math.min(255, Math.round(b * f));
        }
        if (!cancelled) setColor(`${r}, ${g}, ${b}`);
      } catch {
        if (!cancelled) setColor(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setColor(null);
    };
    img.src = imgProxyUrl(faviconUrl);
    return () => {
      cancelled = true;
    };
  }, [faviconUrl]);

  return color;
};
