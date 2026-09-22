#!/usr/bin/env python3
"""Draw the Open Graph / social sharing cards.

A shared link is only as good as the picture next to it. Every page that can be
shared — the home page, each country, each genre, and every station with a page —
gets a 1200x630 JPEG drawn here.

Three layouts, picked per entry, so a shared link always looks like the thing it
links to:

  * a station that has its own artwork, wide enough to fill a card, gets that
    artwork, darkened at the bottom so the name and the domain stay readable;
  * a station that has artwork in any other shape — the usual square logo — keeps
    the branded card and shows the logo in the ring where the globe normally sits;
  * everything else (and every station with no artwork at all) falls back to the
    branded globe card.

Nothing is hotlinked: the station's image is downloaded at build time, cached, and
re-hosted on worldradio.io as part of the card, so a share preview never depends
on a broadcaster's server still being up, and no third party sees the traffic.

tools/prerender.mjs decides *which* cards are needed and writes them to a
manifest; this script only draws them, which keeps the naming in one place and
means a card can never be referenced without existing.

Two layout rules matter, because a messaging app crops the picture to fit:

  * WhatsApp renders link previews close to square, so the name is kept inside
    the middle band and there is nothing to lose at the extreme left or right.
  * Text is wrapped by measurement, never by character count, so a long station
    name shrinks to fit instead of running off the edge.

    python tools/og-cards.py            # draws the queued cards
    python tools/og-cards.py --force    # redraws cards that already exist
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
import sys
import tempfile
import threading
import time
import urllib.request
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

W, H = 1200, 630
BG_TOP = (5, 7, 10)
BG_BOTTOM = (8, 26, 21)
ACCENT = (47, 224, 138)
TEXT = (236, 246, 241)
MUTED = (150, 178, 165)
DIM = (108, 134, 122)
RING = (34, 74, 60)
DOMAIN = "worldradio.io"

HERE = Path(__file__).resolve().parent
MANIFEST = Path(
    os.environ.get("OG_MANIFEST")
    or Path(tempfile.gettempdir()) / "worldradio-og-cards.json"
)
LOGO_DIR = Path(
    os.environ.get("OG_LOGO_CACHE")
    or Path(tempfile.gettempdir()) / "worldradio-og-logos"
)
LOGO_WORKERS = int(os.environ.get("OG_LOGO_WORKERS") or 24)
LOGO_TIMEOUT = int(os.environ.get("OG_LOGO_TIMEOUT") or 8)
LOGO_MAX_BYTES = 8 * 1024 * 1024
LOGO_DEADLINE = int(os.environ.get("OG_LOGO_DEADLINE") or 300)
# One attempt per URL per run — see fetch_logo().
ATTEMPTED: set[str] = set()
UA = "Mozilla/5.0 (compatible; WorldRadioCardBot/1.0; +https://worldradio.io/)"

# Committed with the repo so Windows (production) and Ubuntu (the GitHub mirror)
# draw identical cards. Inter ships as one variable file; the weight axis is set
# per style. Static and system fonts are only a fallback for a fresh clone.
VARIABLE = HERE / "assets" / "Inter-Variable.ttf"
AXES = {"bold": 700, "regular": 400}
STATIC_FONTS = {
    "bold": [
        HERE / "assets" / "Inter-Bold.ttf",
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ],
    "regular": [
        HERE / "assets" / "Inter-Regular.ttf",
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
    ],
}

force = False


@lru_cache(maxsize=None)
def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    if VARIABLE.exists():
        try:
            f = ImageFont.truetype(str(VARIABLE), size)
            f.set_variation_by_axes([14, AXES[kind]])  # opsz, wght
            return f
        except Exception:
            pass  # fall through to whatever static font this machine has
    for path in STATIC_FONTS[kind]:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    raise SystemExit(
        f"og-cards: no {kind} font found. Expected one at {STATIC_FONTS[kind][0]}"
    )


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def background() -> Image.Image:
    """Dark vertical gradient with a soft green glow sitting behind the globe."""
    grad = Image.new("RGB", (1, H))
    for y in range(H):
        grad.putpixel((0, y), lerp(BG_TOP, BG_BOTTOM, (y / H) ** 1.25))
    img = grad.resize((W, H), Image.BILINEAR).convert("RGB")

    # Drawn small and scaled up: a radial falloff is cheap at 128 px and smooth
    # once resized. Centred on the globe (x=930, y=315 of 1200x630) so the light
    # appears to come from behind it. Added, not blended — blending toward a
    # mostly-black glow would darken the whole card instead of lighting it.
    glow = Image.new("RGB", (128, 128), (0, 0, 0))
    px = glow.load()
    for y in range(128):
        for x in range(128):
            d = math.hypot((x - 72) / 74, (y - 64) / 74)
            f = max(0.0, 1.0 - d) ** 2.2
            px[x, y] = (int(ACCENT[0] * f), int(ACCENT[1] * f), int(ACCENT[2] * f))
    glow = glow.resize((W, H), Image.BICUBIC)
    return ImageChops.add(img, glow.point(lambda v: int(v * 0.40)))


def globe(draw: ImageDraw.ImageDraw) -> None:
    """A quiet globe on the right: outline, two latitudes, one meridian."""
    # Kept clear of the right edge: the orbit dots reach r+44, and a clipped ring
    # is the first thing a designer notices on a share card.
    cx, cy, r = 930, 315, 188
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=RING, width=2)
    draw.ellipse((cx - r - 26, cy - r - 26, cx + r + 26, cy + r + 26), outline=(24, 54, 45), width=2)
    for factor in (0.36, 0.72):
        hh = r * factor
        bw = math.sqrt(max(0.0, r * r - hh * hh))
        draw.ellipse((cx - bw, cy - hh, cx + bw, cy + hh), outline=RING, width=2)
        draw.arc((cx - bw, cy - r, cx + bw, cy + r), 0, 360, fill=(28, 62, 51), width=1)
    draw.arc((cx - r * 0.42, cy - r, cx + r * 0.42, cy + r), 0, 360, fill=RING, width=2)
    for i in range(46):
        a = i * (math.tau / 46)
        rr = r + 34 + (10 if i % 5 == 0 else 0)
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        s = 3 if i % 5 == 0 else 2
        draw.ellipse((x - s, y - s, x + s, y + s), fill=(24, 58, 47))


def wrap(text: str, fnt: ImageFont.FreeTypeFont, draw: ImageDraw.ImageDraw, max_w: int, max_lines: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for word in words:
        probe = f"{cur} {word}".strip()
        if draw.textlength(probe, font=fnt) <= max_w or not cur:
            cur = probe
        else:
            lines.append(cur)
            cur = word
            if len(lines) == max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) == max_lines and (len(" ".join(lines).split()) < len(words)):
        while lines and draw.textlength(lines[-1] + "…", font=fnt) > max_w:
            lines[-1] = lines[-1].rsplit(" ", 1)[0] if " " in lines[-1] else lines[-1][:-1]
        lines[-1] = f"{lines[-1]}…"
    return lines


# ---------------------------------------------------------------------------
# the station's own artwork
# ---------------------------------------------------------------------------

def fetch_logo(url: str) -> Path | None:
    """Download a station image once and keep it.

    Cached under a hash of the URL, and only cached once Pillow has actually
    decoded it — a broadcaster that answers with a redirect loop, an HTML error
    page or a 404 must not poison tomorrow's build with an empty file.
    """
    if not url or not url.lower().startswith(("http://", "https://")):
        return None
    dest = LOGO_DIR / hashlib.sha1(url.encode("utf-8")).hexdigest()
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    # One attempt each: the drawing pass must not sit through another 8 s timeout
    # for every host the prefetch already gave up on.
    if url in ATTEMPTED:
        return None
    ATTEMPTED.add(url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
        with urllib.request.urlopen(req, timeout=LOGO_TIMEOUT) as res:
            data = res.read(LOGO_MAX_BYTES)
        if len(data) < 200:
            return None
        with Image.open(io.BytesIO(data)) as probe:
            probe.convert("RGB").thumbnail((16, 16))  # force a real decode
        LOGO_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return dest
    except Exception:
        return None


def prefetch(urls: list[str], deadline_s: int | None = None) -> int:
    """Fetch every station image, in parallel, in a way that cannot hang.

    Some broadcaster hosts accept the connection and then trickle bytes for ever.
    A socket timeout does not catch that, and a pool whose workers are all stuck
    is a build that never finishes — which is exactly what the first version of
    this did. So: plain daemon threads (which cannot hold the process open when
    the interpreter exits) plus a deadline for the whole phase. Whatever has not
    arrived by then simply falls back to the branded card.
    """
    deadline = time.monotonic() + (deadline_s or LOGO_DEADLINE)
    pending = list(urls)
    lock = threading.Lock()

    def worker() -> None:
        while time.monotonic() < deadline:
            with lock:
                if not pending:
                    return
                url = pending.pop()
            fetch_logo(url)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(LOGO_WORKERS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=max(0.0, deadline - time.monotonic()))
    return sum(
        1
        for url in urls
        if (LOGO_DIR / hashlib.sha1(url.encode("utf-8")).hexdigest()).exists()
    )


@lru_cache(maxsize=64)
def open_source(path: str) -> Image.Image | None:
    try:
        with Image.open(path) as img:
            img.thumbnail((1600, 1600), Image.LANCZOS)
            return img.convert("RGB")
    except Exception:
        return None


def cover(img: Image.Image, w: int = W, h: int = H) -> Image.Image:
    """Resize to fill w x h and centre-crop — no letterboxing, no distortion."""
    ratio = max(w / img.width, h / img.height)
    nw, nh = max(1, int(img.width * ratio)), max(1, int(img.height * ratio))
    resized = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - w) // 2, (nh - h) // 2
    return resized.crop((left, top, left + w, top + h))


def square(img: Image.Image, side: int) -> Image.Image:
    ratio = max(side / img.width, side / img.height)
    nw, nh = max(1, int(img.width * ratio)), max(1, int(img.height * ratio))
    resized = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - side) // 2, (nh - side) // 2
    return resized.crop((left, top, left + side, top + side))


def with_rounded_corners(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, img.size[0] - 1, img.size[1] - 1), radius=radius, fill=255
    )
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out


# ---------------------------------------------------------------------------
# layouts
# ---------------------------------------------------------------------------

@lru_cache(maxsize=2)
def base(with_globe: bool) -> Image.Image:
    """The branded card, drawn once and copied per card — a 1200x630 gradient and
    a 46-dot orbit are expensive to rebuild 2,000 times."""
    img = background()
    if with_globe:
        globe(ImageDraw.Draw(img))
    return img


@lru_cache(maxsize=1)
def bottom_scrim() -> Image.Image:
    """A soft dark ramp up from the bottom edge, for cards built on a photo."""
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(scrim)
    top = H - 300
    for y in range(top, H):
        t = (y - top) / (H - top)
        draw.line([(0, y), (W, y)], fill=(3, 7, 6, int(226 * (t ** 0.85))))
    return scrim


@lru_cache(maxsize=1)
def top_scrim() -> Image.Image:
    """The same idea at the top, so the wordmark stays readable over artwork."""
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(scrim)
    for y in range(0, 190):
        t = 1 - (y / 190)
        draw.line([(0, y), (W, y)], fill=(3, 7, 6, int(150 * (t ** 1.4))))
    return scrim


def wordmark(draw: ImageDraw.ImageDraw, fill_word, fill_rest) -> None:
    left = 118
    f = font("bold", 26)
    draw.text((left, 96), "W", font=f, fill=fill_word)
    draw.text((left + draw.textlength("W", font=f), 96), "ORLD RADIO  ·  LIVE", font=f, fill=fill_rest)


def title_block(draw, title, subtitle, left, right, bottom_line: bool = True) -> None:
    """Title, subtitle and the domain, sized and wrapped to fit the space."""
    max_w = right - left
    size = 74
    lines: list[str] = []
    title_font = font("bold", size)
    while size > 34:
        title_font = font("bold", size)
        lines = wrap(title, title_font, draw, max_w, 3)
        widest = max((draw.textlength(l, font=title_font) for l in lines), default=0)
        if len(lines) <= 3 and widest <= max_w:
            break
        size -= 3

    line_h = int(size * 1.16)
    block_h = line_h * len(lines)
    y = int(H / 2 - block_h / 2) - (18 if subtitle else -6)
    y = max(y, 200)
    for line in lines:
        draw.text((left, y), line, font=title_font, fill=TEXT)
        y += line_h

    if subtitle:
        sub_font = font("regular", 30)
        sub = (
            subtitle
            if draw.textlength(subtitle, font=sub_font) <= max_w
            else wrap(subtitle, sub_font, draw, max_w, 1)[0]
        )
        draw.text((left, y + 10), sub, font=sub_font, fill=MUTED)

    if bottom_line:
        draw.text((left, H - 108), DOMAIN, font=font("regular", 27), fill=MUTED)
        draw.line((left, H - 130, left + 64, H - 130), fill=ACCENT, width=3)


def card_from_artwork(src: Image.Image, title: str, subtitle: str) -> Image.Image:
    """The station's own picture, full bleed, with the brand over the dark end."""
    img = cover(src).convert("RGBA")
    img = Image.alpha_composite(img, top_scrim())
    img = Image.alpha_composite(img, bottom_scrim())
    out = img.convert("RGB")
    draw = ImageDraw.Draw(out)
    wordmark(draw, TEXT, (214, 232, 224))

    left, right = 96, W - 96
    size = 62
    lines: list[str] = []
    while size > 30:
        f = font("bold", size)
        lines = wrap(title, f, draw, right - left, 2)
        if len(lines) <= 2 and max((draw.textlength(l, font=f) for l in lines), default=0) <= right - left:
            break
        size -= 3
    f = font("bold", size)
    line_h = int(size * 1.15)
    y = H - 190 - (line_h * (len(lines) - 1))
    for line in lines:
        draw.text((left, y), line, font=f, fill=TEXT)
        y += line_h
    if subtitle:
        sf = font("regular", 28)
        sub = subtitle if draw.textlength(subtitle, font=sf) <= right - left else wrap(subtitle, sf, draw, right - left, 1)[0]
        draw.text((left, y + 6), sub, font=sf, fill=(206, 224, 216))
    draw.text((left, H - 46), DOMAIN, font=font("regular", 26), fill=(196, 216, 208))
    return out


def card_from_logo(src: Image.Image, title: str, subtitle: str) -> Image.Image:
    """Square-ish artwork (the usual case): branded card, logo where the globe sits."""
    img = base(False).copy()
    side = 300
    cx, cy = 930, 315
    tile = square(src, side)
    corner = 36
    # A plate behind the logo, so a logo with a transparent or white background
    # still reads against the dark card.
    plate = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    rounded = with_rounded_corners(tile, corner)
    img.paste(plate, (cx - side // 2, cy - side // 2), with_rounded_corners(plate, corner))
    img.paste(rounded, (cx - side // 2, cy - side // 2), rounded)
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        (cx - side // 2 - 10, cy - side // 2 - 10, cx + side // 2 + 10, cy + side // 2 + 10),
        radius=corner + 10,
        outline=RING,
        width=2,
    )
    wordmark(draw, ACCENT, (142, 172, 160))
    title_block(draw, title, subtitle, 118, cx - side // 2 - 46)
    return img


def card_from_globe(title: str, subtitle: str) -> Image.Image:
    img = base(True).copy()
    draw = ImageDraw.Draw(img)
    wordmark(draw, ACCENT, (142, 172, 160))
    title_block(draw, title, subtitle, 118, 655)
    return img


def draw_card(path: Path, title: str, subtitle: str, image_url: str | None = None) -> None:
    if path.exists() and not force:
        return

    src = None
    if image_url:
        cached = fetch_logo(image_url)
        if cached is not None:
            src = open_source(str(cached))

    # A logo blown up to 1200x630 is a blur, so only artwork that is already
    # wide — and big enough to survive the crop — becomes the whole card.
    # Only artwork that can carry a card is printed on one. Plenty of stations in
    # the catalogue point at a 16-32 px site favicon — Radio-Browser's `favicon`
    # field is often the broadcaster's icon rather than a logo, sometimes behind an
    # icon proxy — and blown up to a tile that is a blur, which looks worse than
    # the branded card it would replace. Small artwork falls back to the globe.
    if src is not None and src.width >= 600 and src.width / max(1, src.height) >= 1.35:
        card = card_from_artwork(src, title, subtitle)
    elif src is not None and min(src.width, src.height) >= 160:
        card = card_from_logo(src, title, subtitle)
    else:
        card = card_from_globe(title, subtitle)

    path.parent.mkdir(parents=True, exist_ok=True)
    card.convert("RGB").save(path, "JPEG", quality=82, optimize=True, progressive=True)


if __name__ == "__main__":
    globals()["force"] = "--force" in sys.argv
    if not MANIFEST.exists():
        print(f"og-cards: no manifest at {MANIFEST} — run tools/prerender.mjs first")
        raise SystemExit(0)

    entries = json.loads(MANIFEST.read_text())
    wanted = sorted({e["image"] for e in entries if e.get("image")})
    if wanted:
        LOGO_DIR.mkdir(parents=True, exist_ok=True)
        print(f"og-cards: fetching {len(wanted)} station images into {LOGO_DIR}")
        got = prefetch(wanted)
        print(
            f"og-cards: {got} of {len(wanted)} usable, "
            f"{len(wanted) - got} fall back to the branded card"
        )

    drawn = skipped = failed = 0
    for i, entry in enumerate(entries, 1):
        target = Path(entry["file"])
        try:
            existed = target.exists() and not force
            draw_card(target, entry["title"], entry.get("subtitle", ""), entry.get("image"))
            if existed:
                skipped += 1
            else:
                drawn += 1
        except Exception as err:  # a broken card must never fail a deploy
            failed += 1
            print(f"og-cards: {target.name} failed — {err}")
        if i % 200 == 0:
            print(f"  {i}/{len(entries)}")

    total_mb = (
        sum(f.stat().st_size for f in Path(entries[0]["file"]).parent.parent.rglob("*.jpg")) / 1e6
        if entries
        else 0
    )
    print(f"og-cards: {drawn} drawn, {skipped} already present, {failed} failed — {total_mb:.1f} MB total")
