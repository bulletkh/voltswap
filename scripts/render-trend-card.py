#!/usr/bin/env python3
"""
Deterministic 1600x900 Voltswap live-data trend card renderer.
Works on both Ubuntu (GitHub Actions) and Windows with zero paid AI image APIs.

Usage:
  python3 scripts/render-trend-card.py --input card.json --output card.png
"""

import argparse
import json
import os
import textwrap
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 900

BOLD_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]
REG_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def load_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def clean_ascii_safe(text):
    # Strip emojis/surrogates that standard TTF fonts can't render as clean glyphs
    s = str(text or "").strip()
    repl = {
        "→": "->",
        "←": "<-",
        "—": "-",
        "–": "-",
        "’": "'",
        "‘": "'",
        "“": '"',
        "”": '"',
        "•": "|",
        "·": "|",
        "⚡": "",
        "🐋": "",
        "🚨": "",
        "🟢": "",
        "🔴": "",
        "🟠": "",
        "🔥": "",
        "✨": "",
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    return "".join(ch for ch in s if ord(ch) < 0x2600).strip()


def wrap_to_width(draw, text, font, max_w, max_lines):
    words = clean_ascii_safe(text).split()
    if not words:
        return []
    lines = []
    cur = words[0]
    for w in words[1:]:
        test = cur + " " + w
        if draw.textlength(test, font=font) <= max_w:
            cur = test
        else:
            lines.append(cur)
            cur = w
            if len(lines) == max_lines - 1:
                break
    remaining = words[len(" ".join(lines + [cur]).split()):] if len(lines) < max_lines else []
    if remaining:
        tail = cur + " " + " ".join(remaining)
        while draw.textlength(tail + "...", font=font) > max_w and len(tail) > 4:
            tail = tail[:-1].rstrip()
        cur = tail + "..."
    lines.append(cur)
    return lines[:max_lines]


def add_glow(img, cx, cy, rx, ry, color_rgba, blur_radius=120):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=color_rgba)
    layer = layer.filter(ImageFilter.GaussianBlur(blur_radius))
    return Image.alpha_composite(img, layer)


def draw_bolt(draw, x, y, scale=1.0, fill=(255, 214, 10, 255)):
    pts = [
        (13.5, 2),
        (5, 13.5),
        (11, 13.5),
        (10, 22),
        (19, 9.5),
        (12.8, 9.5),
    ]
    poly = [(x + px * scale, y + py * scale) for px, py in pts]
    draw.polygon(poly, fill=fill)


def render(data, out_path):
    img = Image.new("RGBA", (W, H), (7, 10, 20, 255))
    img = add_glow(img, 360, 120, 480, 260, (255, 214, 10, 46), 130)
    img = add_glow(img, 1320, 760, 520, 320, (70, 110, 255, 58), 150)

    # Subtle background grid
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for gx in range(0, W, 80):
        gd.line([(gx, 0), (gx, H)], fill=(255, 255, 255, 8), width=1)
    for gy in range(0, H, 80):
        gd.line([(0, gy), (W, gy)], fill=(255, 255, 255, 8), width=1)
    img = Image.alpha_composite(img, grid)

    draw = ImageDraw.Draw(img, "RGBA")

    # Outer frame border + top gold accent line
    draw.rounded_rectangle((36, 36, W - 36, H - 36), radius=34, fill=(11, 16, 32), outline=(42, 52, 82), width=2)
    draw.line([(90, 37), (620, 37)], fill=(255, 214, 10), width=3)

    f_brand = load_font(BOLD_FONTS, 34)
    f_badge = load_font(BOLD_FONTS, 20)
    f_date = load_font(REG_FONTS, 20)
    f_head = load_font(BOLD_FONTS, 62)
    f_sub = load_font(REG_FONTS, 27)
    f_stat_lbl = load_font(BOLD_FONTS, 19)
    f_stat_val = load_font(BOLD_FONTS, 40)
    f_stat_note = load_font(REG_FONTS, 19)
    f_foot = load_font(REG_FONTS, 21)
    f_foot_b = load_font(BOLD_FONTS, 21)

    # Header: Bolt + Voltswap + live pill
    draw_bolt(draw, 84, 78, scale=1.85, fill=(255, 214, 10))
    draw.text((130, 82), "Voltswap", font=f_brand, fill=(246, 248, 255))

    badge = clean_ascii_safe(data.get("badge") or "SUI LIVE PULSE").upper()[:36]
    bw = int(draw.textlength(badge, font=f_badge)) + 48
    bx1 = 335
    draw.rounded_rectangle((bx1, 82, bx1 + bw, 122), radius=20, fill=(40, 36, 20), outline=(145, 122, 26), width=2)
    draw.ellipse((bx1 + 15, 97, bx1 + 25, 107), fill=(255, 214, 10))
    draw.text((bx1 + 34, 90), badge, font=f_badge, fill=(255, 224, 90))

    date_str = datetime.now(timezone.utc).strftime("%b %d, %Y | %H:%M UTC")
    dw = draw.textlength(date_str, font=f_date)
    draw.text((W - 88 - dw, 92), date_str, font=f_date, fill=(148, 162, 196))

    # Main Headline (2 lines max, auto-wrapped)
    headline = data.get("headline") or "Live Sui Capital & Whale Flow"
    h_lines = wrap_to_width(draw, headline, f_head, W - 176, 2)
    y = 188
    for ln in h_lines:
        draw.text((88, y), ln, font=f_head, fill=(248, 250, 255, 255))
        y += 78

    # Subline (2 lines max)
    subline = data.get("subline") or "Real-time on-chain liquidity, TVL & whale swaps across Sui DEX pools."
    s_lines = wrap_to_width(draw, subline, f_sub, W - 176, 2)
    y += 14
    for ln in s_lines:
        draw.text((88, y), ln, font=f_sub, fill=(166, 179, 212, 245))
        y += 39

    # 3 Live Stat Cards
    stats = list(data.get("stats") or [])[:3]
    while len(stats) < 3:
        stats.append({"label": "VOLTSWAP FEE", "value": "0.10% -> 0.00%", "note": "6 on-chain ranks", "tone": "gold"})

    tones = {
        "up": (34, 197, 94, 255),
        "down": (249, 115, 22, 255),
        "gold": (255, 214, 10, 255),
        "neutral": (111, 141, 255, 255),
    }

    card_y1, card_y2 = 508, 724
    gap = 26
    total_w = W - 176
    card_w = (total_w - gap * 2) // 3

    for i, st in enumerate(stats):
        cx1 = 88 + i * (card_w + gap)
        cx2 = cx1 + card_w
        tone_rgb = tones.get(str(st.get("tone") or "gold").lower(), tones["gold"])

        draw.rounded_rectangle(
            (cx1, card_y1, cx2, card_y2),
            radius=22,
            fill=(17, 24, 46),
            outline=(42, 54, 86),
            width=1,
        )
        # Top accent bar on tile
        draw.rounded_rectangle((cx1 + 22, card_y1 + 18, cx1 + 78, card_y1 + 24), radius=3, fill=tone_rgb)

        lbl = clean_ascii_safe(st.get("label") or "METRIC").upper()[:28]
        val = clean_ascii_safe(st.get("value") or "-")
        note = clean_ascii_safe(st.get("note") or "")

        draw.text((cx1 + 24, card_y1 + 40), lbl, font=f_stat_lbl, fill=(148, 163, 198, 240))

        # Fit value cleanly inside card width
        vf = f_stat_val
        if draw.textlength(val, font=vf) > card_w - 48:
            vf = load_font(BOLD_FONTS, 31)
        if draw.textlength(val, font=vf) > card_w - 48:
            vf = load_font(BOLD_FONTS, 25)
        val_lines = wrap_to_width(draw, val, vf, card_w - 48, 1)
        draw.text((cx1 + 24, card_y1 + 78), val_lines[0] if val_lines else "-", font=vf, fill=tone_rgb)

        if note:
            n_lines = wrap_to_width(draw, note, f_stat_note, card_w - 48, 2)
            ny = card_y1 + 140
            for nl in n_lines:
                draw.text((cx1 + 24, ny), nl, font=f_stat_note, fill=(182, 194, 224, 225))
                ny += 26

    # Footer bar
    draw.line([(88, 768), (W - 88, 768)], fill=(36, 46, 74), width=1)
    draw.text((88, 794), "Non-Custodial Sui DEX Aggregator  |  Free Live Whale Radar  |  25%-50% Atomic Rev-Share", font=f_foot, fill=(155, 168, 201, 235))

    cta = clean_ascii_safe(data.get("cta") or "voltswap.org")
    cw = int(draw.textlength(cta, font=f_foot_b)) + 44
    draw.rounded_rectangle((W - 88 - cw, 782, W - 88, 830), radius=24, fill=(255, 214, 10, 255))
    draw.text((W - 88 - cw + 22, 794), cta, font=f_foot_b, fill=(20, 16, 0, 255))

    img.convert("RGB").save(out_path, format="PNG", optimize=True)
    print(f"[render-card] saved {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)
    render(data, args.output)


if __name__ == "__main__":
    main()
