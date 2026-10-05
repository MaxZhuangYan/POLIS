#!/usr/bin/env python3
"""Prepare the Ninja Adventure tileset (CC0, Pixel-boy) for Tiled + Phaser.

    python3 scripts/extrude-tileset.py

Reads   scripts/town-src/tileset.png      (448x640 = 28 x 40 tiles of 16x16, no margin / spacing)
Writes  public/assets/town/tileset.png    (every tile extruded by 1px: margin 1, spacing 2)

1. Appends a few *derived* tiles below the original 40 rows (row 40+):
     col 0..3  sand road concave ("inner") corners  TL TR BL BR   - the pack ships the 9-slice of the sand
                                                                    patch (convex corners only); T / L / plus
                                                                    junctions need these.
     col 4     collision marker tile                                - the `collision` tile layer convention:
                                                                    any non-empty tile = blocked.
   They are computed from the original edge tiles (no new art is invented), see derive_inner_corners().
2. Extrudes every tile by one pixel in all directions so WebGL texture sampling at fractional camera
   positions never bleeds neighbouring tiles into a tile ("seams").

The Tiled tileset therefore uses  tilewidth=16 tileheight=16 margin=1 spacing=2 columns=28.
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "town-src" / "tileset.png"
OUT = ROOT / "public" / "assets" / "town" / "tileset.png"

T = 16
COLS = 28
SRC_ROWS = 40
EXTRA_ROWS = 2  # row 40, 41

# sand road 9-slice in the source sheet (col, row)
SAND = {
    "tl": (20, 12), "t": (21, 12), "tr": (22, 12),
    "l": (20, 13), "c": (21, 13), "r": (22, 13),
    "bl": (20, 14), "b": (21, 14), "br": (22, 14),
}


def tile(img: Image.Image, c: int, r: int) -> Image.Image:
    return img.crop((c * T, r * T, c * T + T, r * T + T)).convert("RGBA")


def rank(px) -> int:
    """How 'inside the road' a sand-patch pixel is: 0 outer ground, 1 rim, 2 road fill."""
    r, g, b, a = px
    if (r, g, b) == (255, 203, 141):
        return 2
    if (r, g, b) == (255, 188, 117):
        return 1
    return 0


def derive_inner_corners(sheet: Image.Image) -> dict[str, Image.Image]:
    """Concave corners for the sand road.

    A concave corner cell is road everywhere except a small bite at one corner. Its pixels are the
    per-pixel *innermost* (max rank) of the two adjacent edge tiles, e.g. for the top-left bite the left-edge
    tile (outer band along the left side) and the top-edge tile (outer band along the top side): the bite is
    where *both* bands overlap, and the result joins the neighbouring edge tiles pixel-exactly.
    """
    t = {k: tile(sheet, *v) for k, v in SAND.items()}

    def combine(a: Image.Image, b: Image.Image) -> Image.Image:
        out = Image.new("RGBA", (T, T))
        for y in range(T):
            for x in range(T):
                pa = a.getpixel((x, y))
                pb = b.getpixel((x, y))
                out.putpixel((x, y), pa if rank(pa) >= rank(pb) else pb)
        return out

    corners = {
        "itl": combine(t["l"], t["t"]),
        "itr": combine(t["r"], t["t"]),
        "ibl": combine(t["l"], t["b"]),
        "ibr": combine(t["r"], t["b"]),
    }
    # soften the sharp notch of the bite (pixel at the junction of both bands) so it reads as a rounded dent
    for name, img in corners.items():
        fill = t["c"].getpixel((8, 8))
        rim = t["t"].getpixel((8, 5))
        # corner point of the bite: the innermost rim pixel diagonal to the corner
        xs = {"itl": (5, 6), "itr": (10, 6), "ibl": (5, 9), "ibr": (10, 9)}[name]
        img.putpixel(xs, fill)
        # and the neighbours get the rim colour so the dent stays closed
        for dx, dy in {"itl": [(4, 6), (5, 5)], "itr": [(11, 6), (10, 5)], "ibl": [(4, 9), (5, 10)], "ibr": [(11, 9), (10, 10)]}[name]:
            img.putpixel((dx, dy), rim)
    return corners


def collision_marker() -> Image.Image:
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, T - 1, T - 1], fill=(255, 40, 40, 70), outline=(255, 40, 40, 200))
    d.line([(2, 2), (T - 3, T - 3)], fill=(255, 40, 40, 220))
    d.line([(T - 3, 2), (2, T - 3)], fill=(255, 40, 40, 220))
    return img


def main() -> None:
    sheet = Image.open(SRC).convert("RGBA")
    assert sheet.size == (COLS * T, SRC_ROWS * T), sheet.size

    full = Image.new("RGBA", (COLS * T, (SRC_ROWS + EXTRA_ROWS) * T), (0, 0, 0, 0))
    full.paste(sheet, (0, 0))
    corners = derive_inner_corners(sheet)
    for i, name in enumerate(["itl", "itr", "ibl", "ibr"]):
        full.paste(corners[name], (i * T, SRC_ROWS * T))
    full.paste(collision_marker(), (4 * T, SRC_ROWS * T))

    rows = SRC_ROWS + EXTRA_ROWS
    out = Image.new("RGBA", (COLS * (T + 2), rows * (T + 2)), (0, 0, 0, 0))
    for r in range(rows):
        for c in range(COLS):
            tl = full.crop((c * T, r * T, c * T + T, r * T + T))
            ox = c * (T + 2)
            oy = r * (T + 2)
            out.paste(tl, (ox + 1, oy + 1))
            # extrude: replicate the border pixels one pixel outward (edges + corners)
            top = tl.crop((0, 0, T, 1))
            bottom = tl.crop((0, T - 1, T, T))
            left = tl.crop((0, 0, 1, T))
            right = tl.crop((T - 1, 0, T, T))
            out.paste(top, (ox + 1, oy))
            out.paste(bottom, (ox + 1, oy + T + 1))
            out.paste(left, (ox, oy + 1))
            out.paste(right, (ox + T + 1, oy + 1))
            for (sx, sy, dx, dy) in [(0, 0, 0, 0), (T - 1, 0, T + 1, 0), (0, T - 1, 0, T + 1), (T - 1, T - 1, T + 1, T + 1)]:
                out.putpixel((ox + dx, oy + dy), tl.getpixel((sx, sy)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}  {out.size[0]}x{out.size[1]}  ({COLS} cols x {rows} rows, margin 1, spacing 2)")


if __name__ == "__main__":
    main()
