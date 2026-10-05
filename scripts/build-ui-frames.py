#!/usr/bin/env python3
"""Builds the 9-slice UI frames in public/assets/ui/ (parchment panels, wood bars, bevel buttons, portrait frames).

Every frame is drawn pixel by pixel with the palette of the Ninja Adventure HUD art (CC0, Pixel-boy / Sparklin Labs):
the cream dialogue box with its dark outline + terracotta / orange / tan rings (hud/dialogue-bubble.png) and the
blue-grey faceset box (hud/faceset-box.png). The CSS draws them with `border-image` at 2x (`image-rendering: pixelated`).

    python3 scripts/build-ui-frames.py

Output (all 1 art px = 1 image px):
  frame-paper.png      16x16  slice 5  cream parchment panel (outline / terracotta / orange / tan rings)
  frame-paper-s.png    12x12  slice 4  the same, slimmer
  frame-notice.png     12x12  slice 4  gold notice plate (test panel, "connection lost" banner)
  frame-alert.png      12x12  slice 4  red alert plate (error banner)
  frame-wood.png       16x16  slice 5  dark wood bar (HUD / dock / rail), transparent middle
  frame-slot.png       12x12  slice 4  dark inset well (counters, progress troughs)
  frame-input.png      12x12  slice 4  parchment text field (inset)
  frame-portrait.png   16x16  slice 5  blue-grey faceset box   (frame-portrait-gold.png for my Agent)
  btn-<kind>[-hover|-down].png 12x12 slice 4   bevel buttons: orange, gold, red, off
  tile[-hover|-down|-on].png   12x12 slice 4   cream inventory tile (dock / rail buttons)
"""
from PIL import Image
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "public", "assets", "ui")
os.makedirs(OUT_DIR, exist_ok=True)

T = (0, 0, 0, 0)


def rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


OUT = rgb("2b180d")  # deep brown outline
TERRA = rgb("b7604f")  # pack: terracotta ring
ORNG = rgb("ffb66e")  # pack: orange ring
TAN = rgb("d49b74")  # pack: tan inner line
PAPER = rgb("fbeed6")  # parchment
PAPER2 = rgb("efd9ae")  # parchment, darker (insets)
W0 = rgb("24140a")  # wood outline
W1 = rgb("4a2c18")  # dark wood
W2 = rgb("6b4128")  # mid wood
W3 = rgb("93602f")  # light wood edge
W4 = rgb("b98245")  # wood highlight


def save(name, im):
    im.save(os.path.join(OUT_DIR, name))
    print("wrote", name, im.size)


def blank(w, h):
    return Image.new("RGBA", (w, h), T)


def ring_frame(size, rings, fill, chamfer=2):
    """concentric rings (outer -> inner) + fill, with stepped corners of radius `chamfer` (1 or 2)"""
    im = blank(size, size)
    px = im.load()
    n = len(rings)
    for y in range(size):
        for x in range(size):
            m = min(x, y, size - 1 - x, size - 1 - y)
            px[x, y] = rings[m] if m < n else fill
    # stepped corner: cut the corner pixels, push the outline round them
    for cx, cy, sx, sy in ((0, 0, 1, 1), (size - 1, 0, -1, 1), (0, size - 1, 1, -1), (size - 1, size - 1, -1, -1)):
        if chamfer >= 1:
            px[cx, cy] = T
        if chamfer >= 2:
            px[cx + sx, cy] = T
            px[cx, cy + sy] = T
            px[cx + sx, cy + sy] = rings[0]  # the outline turns the corner
    return im


def paper(size, slice_, rings=None, fill=None):
    rings = (rings or [OUT, TERRA, ORNG, TAN])[:slice_ - 1]
    im = ring_frame(size, rings, fill or PAPER, 2)
    px = im.load()
    # soften the inner corner of the tan ring so the cream area has a rounded corner too
    k = len(rings)
    for cx, cy, sx, sy in ((k - 1, k - 1, 1, 1), (size - k, k - 1, -1, 1), (k - 1, size - k, 1, -1), (size - k, size - k, -1, -1)):
        px[cx, cy] = rings[k - 2]
    return im


def wood(size, slice_):
    # outline, dark, light highlight, mid
    rings = [W0, W1, W3, W2, W2][:slice_]
    im = ring_frame(size, rings, T, 2)
    px = im.load()
    # top-left highlight, bottom-right shade
    k = 2
    for i in range(2, size - 2):
        px[i, k] = W4  # top edge highlight
        px[k, i] = W3
        px[i, size - 1 - k] = W1
        px[size - 1 - k, i] = W1
    return im


def slot(size):
    rings = [W0, rgb("33200f")]
    im = ring_frame(size, rings, rgb("46301c"), 1)
    px = im.load()
    for i in range(2, size - 2):
        px[i, size - 1] = W3  # lip at the bottom: the well is cut into the bar
    return im


def inp(size):
    rings = [OUT, TAN]
    return ring_frame(size, rings, PAPER2, 1)


def portrait(size, hi, mid, lo, deep):
    # outer rim, 2px bright body with a top-left bevel, 1px shade, black well
    rings = [deep, mid, mid, lo, rgb("000000")]
    im = ring_frame(size, rings, rgb("000000"), 2)
    px = im.load()
    for i in range(3, size - 3):
        px[i, 1] = hi
        px[1, i] = hi
    return im


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3)) + (255,)


def button(size, base, light, dark, outline, pressed=False):
    """bevel button: outline, light top/left edge, dark bottom/right edge with a thicker underside (flipped when pressed)"""
    im = blank(size, size)
    px = im.load()
    for y in range(size):
        for x in range(size):
            m = min(x, y, size - 1 - x, size - 1 - y)
            px[x, y] = outline if m == 0 else base
    tl, br = (dark, light) if pressed else (light, dark)
    for i in range(1, size - 1):
        px[i, 1] = tl
        px[1, i] = tl
        px[i, size - 2] = br
        px[size - 2, i] = br
    if not pressed:
        for i in range(2, size - 2):
            px[i, size - 3] = br
            px[size - 3, i] = br
    # stepped corners
    for cx, cy in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)):
        px[cx, cy] = T
    px[1, size - 2] = base
    px[size - 2, 1] = base
    return im


def kind(name, base, light, dark, outline=OUT):
    hover = lerp(base, (255, 255, 255), 0.18)
    save(f"btn-{name}.png", button(12, base, light, dark, outline))
    save(f"btn-{name}-hover.png", button(12, hover, lerp(light, (255, 255, 255), 0.25), dark, outline))
    save(f"btn-{name}-down.png", button(12, lerp(base, (0, 0, 0), 0.08), light, dark, outline, pressed=True))


def main():
    save("frame-paper.png", paper(16, 5))
    save("frame-paper-s.png", paper(12, 4))
    save("frame-notice.png", paper(12, 4, [rgb("4a3208"), rgb("b98a1f"), rgb("f2c75c"), rgb("fff0b0")], rgb("fdf0bf")))
    save("frame-alert.png", paper(12, 4, [rgb("4a140d"), rgb("8f2f22"), rgb("d9654f"), rgb("f2a592")], rgb("f9d9cc")))
    save("frame-wood.png", wood(16, 5))
    save("frame-slot.png", slot(12))
    save("frame-input.png", inp(12))
    save("frame-portrait.png", portrait(16, rgb("cac7d0"), rgb("6c7caa"), rgb("9690a2"), rgb("1a1020")))
    save("frame-portrait-gold.png", portrait(16, rgb("fff0b0"), rgb("f2c75c"), rgb("b98a1f"), rgb("2a1a05")))

    kind("orange", rgb("e69a45"), rgb("ffd08a"), rgb("a85a22"))
    kind("gold", rgb("f2c75c"), rgb("fff3bd"), rgb("b98a1f"))
    kind("red", rgb("c4533f"), rgb("ee9078"), rgb("7d2a1f"))
    kind("off", rgb("cdb892"), rgb("e4d5b6"), rgb("9b8765"), rgb("5b4630"))
    # cream inventory tiles for the dock / rail
    kind("tile", rgb("f7e6c0"), rgb("fff8e2"), rgb("c9a56c"))
    # selected tile: gold
    kind("tile-on", rgb("ffdf86"), rgb("fff6c8"), rgb("c2922a"))


if __name__ == "__main__":
    main()
