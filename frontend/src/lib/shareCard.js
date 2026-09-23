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

// Printed on the card. Read from the address bar rather than hardcoded: the app has
// already moved host once, and a hardcoded address prints a dead link onto every
// image a listener shares, permanently, in other people's threads.
const siteAddress = () => {
  try {
    return `${window.location.origin}${process.env.PUBLIC_URL || ""}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
};

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
const paintBackground = (ctx, accent, w = W, h = H) => {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#04120d");
  bg.addColorStop(0.55, "#05070a");
  bg.addColorStop(1, "#0a1f18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w / 2, h * 0.36, 40, w / 2, h * 0.36, w * 0.72);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(55,245,154,0.30)";
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 130; i += 1) {
    const a = rnd() * Math.PI * 2;
    const rad = 0.16 + rnd() * 0.34;
    const x = w / 2 + Math.cos(a) * rad * w * 0.52;
    const y = h * 0.36 + Math.sin(a) * rad * h * 0.30;
    ctx.beginPath();
    ctx.arc(x, y, 2 + rnd() * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
};

// The wordmark: "World" in white, "Radio" in the brand green. Measured as one line
// rather than positioned with a hand-tuned offset — the two halves are not the same
// width, and an offset that centred the old pair leaves this one visibly off-centre.
const paintBrand = (ctx, y, w = W) => {
  ctx.save();
  ctx.textAlign = "left";
  ctx.font = "700 46px Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  const left = "World";
  const right = "Radio";
  const gap = ctx.measureText(" ").width;
  const total = ctx.measureText(left).width + gap + ctx.measureText(right).width;
  let x = w / 2 - total / 2;
  ctx.fillStyle = "#eafff4";
  ctx.fillText(left, x, y);
  x += ctx.measureText(left).width + gap;
  ctx.fillStyle = "#2fe08a";
  ctx.fillText(right, x, y);
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
// Can this browser share a *file*, not just a link? Asked with a real one-pixel
// PNG because some platforms answer yes for the wrong shape and then refuse the
// share itself.
export const canShareFiles = () => {
  try {
    if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare) {
      return false;
    }
    const probe = new File([new Blob(["x"], { type: "image/png" })], "probe.png", {
      type: "image/png",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
};

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
  ctx.fillText(`Listen live — ${siteAddress() || "World Radio"}`, cx, H - 40);
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
  ctx.fillText(siteAddress(), W / 2, H - 40);
  return canvas;
};

/**
 * The story-format card: 1080x1920, shaped for Instagram, WhatsApp status and
 * anything else that wants a full-height picture rather than a square. Same
 * background, same wordmark, far more room — so the two lines that actually travel
 * on a story ("who is this" and "how do I listen") can be read across a room.
 *
 * Shared as a file through shareCard(), exactly like the square card, so the
 * platform plumbing is identical and there is only one code path to trust.
 */
export const storyCardCanvas = async (station, { link } = {}) => {
  const SW = 1080;
  const SH = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = SW;
  canvas.height = SH;
  const ctx = canvas.getContext("2d");
  paintBackground(ctx, "#2fe08a", SW, SH);
  const cx = SW / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(123,240,184,0.9)";
  ctx.font = "600 38px Inter, system-ui, sans-serif";
  ctx.fillText("LIVE NOW", cx, 300);

  const logo = await loadImage(
    station && station.favicon
      ? PROXY_URL
        ? imgProxyUrl(station.favicon)
        : station.favicon
      : null
  );

  const cy = 720;
  const r = 250;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(47,224,138,0.55)";
  ctx.lineWidth = 6;
  ctx.stroke();
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 8, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(logo, cx - r + 8, cy - r + 8, (r - 8) * 2, (r - 8) * 2);
    } catch {
      /* tainted or broken image - the ring alone is fine */
    }
    ctx.restore();
  } else {
    ctx.fillStyle = "#2fe08a";
    ctx.font = "800 200px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(((station && station.name) || "?").trim().charAt(0).toUpperCase(), cx, cy + 10);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 84px Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  const nameLines = wrapText(ctx, (station && station.name) || "Live radio", SW - 200, 2);
  let y = 1160;
  nameLines.forEach((line) => {
    ctx.fillText(line, cx, y);
    y += 100;
  });

  const place = [station && station.state, station && station.country].filter(Boolean).join(", ");
  if (place) {
    ctx.fillStyle = "#9fb3aa";
    ctx.font = "500 50px Inter, system-ui, sans-serif";
    ctx.fillText(`${countryFlag(station && station.countrycode)}  ${place}`, cx, y + 16);
    y += 90;
  }

  // The invitation, for the people who see the story and are not listening yet.
  const invite = "Tap to listen - free, no sign-up";
  ctx.font = "600 40px Inter, system-ui, sans-serif";
  const bw = Math.min(SW - 200, ctx.measureText(invite).width + 110);
  ctx.fillStyle = "rgba(47,224,138,0.16)";
  roundRect(ctx, cx - bw / 2, y + 64, bw, 96, 48);
  ctx.fill();
  ctx.fillStyle = "#7bf0b8";
  ctx.fillText(invite, cx, y + 128);

  paintBrand(ctx, SH - 150, SW);
  ctx.fillStyle = "rgba(159,179,170,0.85)";
  ctx.font = "500 34px Inter, system-ui, sans-serif";
  ctx.fillText(link ? link.replace(/^https?:\/\//, "") : siteAddress(), cx, SH - 84);
  return canvas;
};

/**
 * The radio wall: your favourites as one picture.
 *
 * Drawn from the logos served through the relay, which is same-origin, so the
 * canvas stays untainted and toBlob() keeps working — the same reason the square
 * card can be shared as a file at all. A station with no usable logo gets its
 * initial instead, so a tile is never blank.
 */
export const radioWallCanvas = async (stations, { title = "My radio wall" } = {}) => {
  const SW = 1080;
  const SH = 1350;
  const all = Array.isArray(stations) ? stations : [];
  const list = all.slice(0, 9);
  const canvas = document.createElement("canvas");
  canvas.width = SW;
  canvas.height = SH;
  const ctx = canvas.getContext("2d");
  paintBackground(ctx, "#7fd4ff", SW, SH);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#eafff4";
  ctx.font = "700 56px Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(title, SW / 2, 132);
  ctx.fillStyle = "#9fb3aa";
  ctx.font = "500 34px Inter, system-ui, sans-serif";
  ctx.fillText(
    all.length === 1
      ? "1 station I keep coming back to"
      : `${all.length} stations I keep coming back to`,
    SW / 2,
    188
  );

  const cols = 3;
  const size = 300;
  const gap = 24;
  const left = (SW - (cols * size + (cols - 1) * gap)) / 2;
  const top = 252;

  const images = await Promise.all(
    list.map((s) =>
      loadImage(s && s.favicon ? (PROXY_URL ? imgProxyUrl(s.favicon) : s.favicon) : null)
    )
  );

  list.forEach((s, i) => {
    const x = left + (i % cols) * (size + gap);
    const y = top + Math.floor(i / cols) * (size + gap);

    ctx.save();
    roundRect(ctx, x, y, size, size, 28);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x, y, size, size);
    const img = images[i];
    if (img) {
      try {
        // Cover-fit: fill the tile without squashing the mark.
        const scale = Math.max(size / img.width, size / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
      } catch {
        /* tainted or broken - the tile keeps its tint */
      }
    } else {
      ctx.fillStyle = "#2fe08a";
      ctx.font = "800 130px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        ((s && s.name) || "?").trim().charAt(0).toUpperCase(),
        x + size / 2,
        y + size / 2 + 8
      );
      ctx.textBaseline = "alphabetic";
    }
    // Scrim, so a name reads over any artwork.
    const scrim = ctx.createLinearGradient(0, y + size * 0.5, 0, y + size);
    scrim.addColorStop(0, "rgba(4,10,8,0)");
    scrim.addColorStop(1, "rgba(4,10,8,0.9)");
    ctx.fillStyle = scrim;
    ctx.fillRect(x, y + size * 0.5, size, size * 0.5);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 26px Inter, system-ui, sans-serif";
    const lines = wrapText(ctx, (s && s.name) || "", size - 30, 2);
    let ty = y + size - 22 - (lines.length - 1) * 30;
    lines.forEach((l) => {
      ctx.fillText(l, x + size / 2, ty);
      ty += 30;
    });
    ctx.restore();
  });

  ctx.save();
  ctx.textAlign = "center";
  paintBrand(ctx, SH - 88, SW);
  ctx.fillStyle = "rgba(159,179,170,0.85)";
  ctx.font = "500 28px Inter, system-ui, sans-serif";
  ctx.fillText(siteAddress(), SW / 2, SH - 34);
  ctx.restore();
  return canvas;
};
