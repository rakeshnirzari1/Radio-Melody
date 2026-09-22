#!/usr/bin/env python3
"""Generate the PWA / iOS icon set for World Radio.

Stdlib only — no Pillow, no sharp, nothing to install in CI. Writes straight RGBA
PNGs with a minimal encoder, which is plenty for flat vector-ish artwork.

    python3 tools/make-icons.py

Output (all into frontend/public/):
  icon-192.png, icon-512.png           standard PWA icons
  icon-maskable-512.png                same mark with the safe-zone padding Android wants
  apple-touch-icon.png (180)           iOS home screen
  splash-<w>x<h>.png                   iOS launch images (dark, mark centred)

The mark: a broadcast glyph — three arcs and a dot — in World Radio green on the
app's near-black. Drawn from maths so it stays crisp at every size.
"""
import os
import struct
import zlib

GREEN = (47, 224, 138)
DARK = (5, 7, 10)
WHITE = (234, 255, 244)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "public")


def write_png(path, width, height, pixels):
    """pixels: bytearray of RGBA rows."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0
        raw.extend(pixels[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def blend(dst, idx, color, alpha):
    if alpha <= 0:
        return
    if alpha >= 1:
        dst[idx] = color[0]
        dst[idx + 1] = color[1]
        dst[idx + 2] = color[2]
        dst[idx + 3] = 255
        return
    for k in range(3):
        dst[idx + k] = int(dst[idx + k] * (1 - alpha) + color[k] * alpha)
    dst[idx + 3] = 255


def make_icon(size, maskable=False):
    """The app mark on a rounded (or full-bleed) dark tile."""
    pixels = bytearray(size * size * 4)
    # Background
    radius = size * (0.22 if not maskable else 0.0)
    for y in range(size):
        for x in range(size):
            idx = (y * size + x) * 4
            inside = True
            if radius > 0:
                cx = min(max(x, radius), size - radius)
                cy = min(max(y, radius), size - radius)
                dx, dy = x - cx, y - cy
                if dx * dx + dy * dy > radius * radius:
                    inside = False
                    d = (dx * dx + dy * dy) ** 0.5
                    # 1px feather so the corners are not jagged
                    a = max(0.0, min(1.0, radius - d))
                    if a > 0:
                        blend(pixels, idx, DARK, a)
                    continue
            if inside:
                blend(pixels, idx, DARK, 1.0)

    cx = size / 2
    # Broadcast glyph: a dot with three arcs above it.
    dot_y = size * 0.70
    dot_r = size * 0.085
    for y in range(size):
        for x in range(size):
            dx = x + 0.5 - cx
            dy = y + 0.5 - dot_y
            dist = (dx * dx + dy * dy) ** 0.5
            idx = (y * size + x) * 4

            # dot
            a = dot_r - dist
            if a > -1:
                blend(pixels, idx, GREEN, max(0.0, min(1.0, a)))

            # arcs: only above the dot
            if y < dot_y:
                angle = None
                if dist > 0:
                    # angle from straight up
                    import math

                    angle = math.degrees(math.acos(max(-1.0, min(1.0, -dy / dist))))
                if angle is not None and angle <= 52:
                    for r in (0.215, 0.315, 0.415):
                        rr = size * r
                        ring = size * 0.032
                        a2 = ring - abs(dist - rr)
                        if a2 > -1:
                            blend(pixels, idx, GREEN, max(0.0, min(1.0, a2)))
    return pixels


def make_splash(width, height):
    """iOS launch image: the mark, small, centred on the app background."""
    pixels = bytearray(bytes(DARK) * 0)
    pixels = bytearray(width * height * 4)
    for i in range(width * height):
        pixels[i * 4] = DARK[0]
        pixels[i * 4 + 1] = DARK[1]
        pixels[i * 4 + 2] = DARK[2]
        pixels[i * 4 + 3] = 255

    mark = int(min(width, height) * 0.28)
    icon = make_icon(mark, maskable=False)
    ox = (width - mark) // 2
    oy = (height - mark) // 2
    for y in range(mark):
        for x in range(mark):
            src = (y * mark + x) * 4
            dx = ox + x
            dy = oy + y
            if 0 <= dx < width and 0 <= dy < height:
                dst = (dy * width + dx) * 4
                pixels[dst:dst + 4] = icon[src:src + 4]
    return pixels


def main():
    out = os.path.abspath(OUT_DIR)
    os.makedirs(out, exist_ok=True)

    jobs = [
        ("icon-192.png", 192, make_icon(192)),
        ("icon-512.png", 512, make_icon(512)),
        ("icon-maskable-512.png", 512, make_icon(512, maskable=True)),
        ("apple-touch-icon.png", 180, make_icon(180)),
    ]
    for name, size, pixels in jobs:
        path = os.path.join(out, name)
        write_png(path, size, size, pixels)
        print(f"{name}: {os.path.getsize(path)} bytes")

    # The iPhone sizes that actually matter today, plus two iPads.
    splashes = [
        (1170, 2532), (1284, 2778), (1179, 2556), (1125, 2436),
        (750, 1334), (1242, 2688), (1536, 2048), (1668, 2388),
    ]
    for w, h in splashes:
        name = f"splash-{w}x{h}.png"
        path = os.path.join(out, name)
        write_png(path, w, h, make_splash(w, h))
        print(f"{name}: {os.path.getsize(path)} bytes")

    # Default link-preview image (1200x630 is what every social crawler expects).
    # Stations get their own card; this is what the homepage and the privacy note
    # fall back to.
    og_path = os.path.join(out, "og-default.png")
    write_png(og_path, 1200, 630, make_splash(1200, 630))
    print(f"og-default.png: {os.path.getsize(og_path)} bytes")


if __name__ == "__main__":
    main()
