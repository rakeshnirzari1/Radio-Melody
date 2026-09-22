// Shareable cards, drawn on a canvas.
//
// A link in a WhatsApp thread is easy to ignore; a picture is not. These render a
// 1080x1080 card for a station, or for your Around-the-World progress, and hand it
// to the native share sheet as a real file where the platform allows it (iOS and
// Android), falling back to a download, and always copying the link too.
import { imgProxyUrl, PROXY_URL } from "./radioApi";
import { countryFlag } from "./explored";

const W = 1080;
const H = 1080;

const loadImage = (url) =>
  new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    // Through the relay this is same-origin, so the canvas stays untainted and
    // toBlob() keeps working. Direct favicon URLs usually lack CORS, so a failure
    // here is expected and simply means no logo on the card.
    img.crossOrigin = "anonymous";
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      resolve(val);
    };
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    setTimeout(() => finish(null), 4000);
    img.src = url;
  });

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const wrapText = (ctx, text, maxWidth, maxLines = 3) => {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && line && lines[lines.length - 1] !== line) {
    // Trim the last line if there was more text than fits.
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 4) {
      last = last.slice(0, -2);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
};

// The shared backdrop: deep green-black, a soft glow, and a dotted-hemisphere
// motif that echoes the globe without needing the WebGL scene.
const paintBackground = (ctx, accent) => {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#04120d");
  bg.addColorStop(0.55, "#05070a");
  bg.addColorStop(1, "#0a1f18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, H * 0.36, 40, W / 2, H * 0.36, W * 0.72);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(55,245,154,0.30)";
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 130; i += 1) {
    const a = rnd() * Math.PI * 2;
    const rad = 0.16 + rnd() * 0.34;
    const x = W / 2 + Math.cos(a) * rad * W * 0.52;
    const y = H * 0.36 + Math.sin(a) * rad * H * 0.30;
    ctx.beginPath();
    ctx.arc(x, y, 2 + rnd() * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
};

const paintBrand = (ctx, y) => {
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#eafff4";
  ctx.font = "700 46px Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Radio", W / 2 - 116, y);
  const w = ctx.measureText("Radio").width;
  ctx.fillStyle = "#2fe08a";
  ctx.fillText("Melody", W / 2 - 116 + w + 42, y);
  ctx.restore();
};

const toBlob = (canvas) =>
  new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png", 0.92);
    } catch {
      resolve(null);
    }
  });

const download = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

/**
 * Offer a rendered card to the user. Returns "shared" | "downloaded" | "failed".
 * The link is copied as well when the platform cannot take a file, so a share
 * never ends up as a picture with no way back to the site.
 */
export const shareCard = async (canvas, { filename, text, url }) => {
  let blob = null;
  try {
    blob = await toBlob(canvas);
  } catch {
    blob = null;
  }
  if (!blob) return "failed";

  let file = null;
  try {
    file = new File([blob], filename, { type: "image/png" });
  } catch {
    file = null;
  }

  // Some browsers say they can share a file and then refuse — the capability probe
  // itself has to be defensive, or the whole share dies on the way in.
  let canShareFile = false;
  if (file && navigator.share && navigator.canShare) {
    try {
      canShareFile = navigator.canShare({ files: [file] });
    } catch {
      canShareFile = false;
    }
  }

  if (canShareFile) {
    try {
      await navigator.share({ files: [file], text, url });
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
      // Anything else: fall through to saving the image locally.
    }
  }

  try {
    download(blob, filename);
  } catch {
    /* ignore */
  }
  try {
    if (url && navigator.clipboard) await navigator.clipboard.writeText(url);
  } catch {
    /* ignore */
  }
  return "downloaded";
};

export const stationCardCanvas = async (station, { note } = {}) => {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  // 8-digit hex, not rgba(): the alpha is appended to this string below, and
  // "rgba(47,224,138,0.95)55" is not a colour — addColorStop throws on it and the
  // whole card fails to build.
  const accent = "#2fe08a";
  paintBackground(ctx, accent);

  const logo = await loadImage(
    station && station.favicon ? (PROXY_URL ? imgProxyUrl(station.favicon) : station.favicon) : null
  );

  const cx = W / 2;
  const cy = H * 0.36;
  const r = 190;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(47,224,138,0.55)";
  ctx.lineWidth = 4;
  ctx.stroke();
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(logo, cx - r + 6, cy - r + 6, (r - 6) * 2, (r - 6) * 2);
    } catch {
      /* tainted or broken image — the ring alone is fine */
    }
    ctx.restore();
  } else {
    ctx.fillStyle = "#2fe08a";
    ctx.font = "800 150px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(((station && station.name) || "?").trim().charAt(0).toUpperCase(), cx, cy + 6);
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 66px Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  const nameLines = wrapText(ctx, (station && station.name) || "Live radio", W - 190, 2);
  let y = H * 0.62;
  nameLines.forEach((line) => {
    ctx.fillText(line, cx, y);
    y += 78;
  });

  const place = [station && station.state, station && station.country].filter(Boolean).join(", ");
  if (place) {
    ctx.fillStyle = "#9fb3aa";
    ctx.font = "500 40px Inter, system-ui, sans-serif";
    ctx.fillText(`${countryFlag(station && station.countrycode)}  ${place}`, cx, y + 10);
    y += 66;
  }

  if (note) {
    ctx.fillStyle = "rgba(47,224,138,0.16)";
    const nw = Math.min(W - 160, ctx.measureText(note).width + 90);
    roundRect(ctx, cx - nw / 2, y + 24, nw, 76, 38);
    ctx.fill();
    ctx.fillStyle = "#7bf0b8";
    ctx.font = "600 36px Inter, system-ui, sans-serif";
    ctx.fillText(note, cx, y + 76);
  }

  paintBrand(ctx, H - 96);
  ctx.fillStyle = "rgba(159,179,170,0.85)";
  ctx.font = "500 30px Inter, system-ui, sans-serif";
  ctx.fillText("Listen live — rakeshnirzari1.github.io/Radio-Melody", cx, H - 40);
  return canvas;
};

export const worldCardCanvas = ({ total, countries }) => {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  paintBackground(ctx, "#7fd4ff");

  ctx.textAlign = "center";
  ctx.fillStyle = "#7fd4ff";
  ctx.font = "600 42px Inter, system-ui, sans-serif";
  ctx.fillText("AROUND THE WORLD", W / 2, 180);

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 240px Inter, system-ui, sans-serif";
  ctx.fillText(String(total), W / 2, 430);

  ctx.fillStyle = "#9fb3aa";
  ctx.font = "500 46px Inter, system-ui, sans-serif";
  ctx.fillText(total === 1 ? "country heard live" : "countries heard live", W / 2, 500);

  const top = (countries || []).slice(0, 12);
  ctx.font = "500 44px Inter, system-ui, sans-serif";
  let y = 610;
  for (let row = 0; row < 3; row += 1) {
    const slice = top.slice(row * 4, row * 4 + 4);
    if (!slice.length) break;
    const line = slice.map((c) => `${countryFlag(c.code)} ${c.name}`).join("   ");
    ctx.fillStyle = "#eafff4";
    ctx.fillText(line, W / 2, y);
    y += 82;
  }

  paintBrand(ctx, H - 96);
  ctx.fillStyle = "rgba(159,179,170,0.85)";
  ctx.font = "500 30px Inter, system-ui, sans-serif";
  ctx.fillText("rakeshnirzari1.github.io/Radio-Melody", W / 2, H - 40);
  return canvas;
};
