#!/usr/bin/env python3
"""
Composite the small tank from two separate layers:
  - tank_small_bg.jpg : room background (full screen, swappable)
  - tank_small_fg.png : aquarium (transparent, positioned on table)

To change the background later: replace tank_small_bg.jpg and re-run this script.
The output tank_small.jpg is what the game loads.

Tank position (in background pixels, bg is 1125x1688):
  - width: 750px, centered horizontally
  - bottom: at y=1365 (middle of table)
"""
from PIL import Image
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TANKS = os.path.join(HERE, "public", "assets", "tanks")

BG_FILE = os.path.join(TANKS, "tank_small_bg.jpg")
FG_FILE = os.path.join(TANKS, "tank_small_fg.png")
OUT_FILE = os.path.join(TANKS, "tank_small.jpg")

# Tank placement (tuned with user)
TANK_W = 1060
TANK_BOTTOM_Y = 1365  # middle of table

def main():
    bg = Image.open(BG_FILE).convert("RGB")
    fg = Image.open(FG_FILE)  # RGBA
    bw, bh = bg.size
    print(f"bg: {bw}x{bh}, fg: {fg.size}")

    th = int(fg.height * TANK_W / fg.width)
    fg_s = fg.resize((TANK_W, th), Image.LANCZOS)
    x = (bw - TANK_W) // 2
    y = TANK_BOTTOM_Y - th
    print(f"placing tank at ({x}, {y}), size {TANK_W}x{th}")

    bg_rgba = bg.convert("RGBA")
    bg_rgba.paste(fg_s, (x, y), fg_s)
    bg_rgba.convert("RGB").save(OUT_FILE, quality=92)
    print(f"saved {OUT_FILE}")

    # Also save a preview
    preview = os.path.expanduser("~/workspace/previews/small_tank_composite.jpg")
    bg_rgba.convert("RGB").save(preview, quality=90)
    print(f"preview: {preview}")

if __name__ == "__main__":
    main()
