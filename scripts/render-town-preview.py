#!/usr/bin/env python3
"""Composite public/assets/town/polis-town.tmj into a PNG so the town can be inspected without a browser.

    python3 scripts/render-town-preview.py [--scale 2] [--out path.png] [--debug] [--crop x0,y0,x1,y1]

* layers are drawn in file order (ground, paths, water, deco, buildings, collision(skipped), above) —
  exactly what Phaser draws, residents sit between `buildings` and `above`
* --debug overlays the collision layer (red), location areas (cyan), door / home_door points and
  interactable rectangles, so the walkable layout can be checked at a glance
* --crop takes tile coordinates
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TOWN = ROOT / "public" / "assets" / "town"
FLIP_H = 0x80000000
FLIP_V = 0x40000000
FLIP_D = 0x20000000


def load_tileset(ts: dict) -> dict:
    img = Image.open(TOWN / ts["image"]).convert("RGBA")
    return {
        "img": img,
        "first": ts["firstgid"],
        "tw": ts["tilewidth"],
        "th": ts["tileheight"],
        "margin": ts.get("margin", 0),
        "spacing": ts.get("spacing", 0),
        "cols": ts["columns"],
        "count": ts["tilecount"],
    }


def tile_image(ts: dict, gid: int) -> Image.Image:
    raw = gid & 0x1FFFFFFF
    lid = raw - ts["first"]
    c = lid % ts["cols"]
    r = lid // ts["cols"]
    x = ts["margin"] + c * (ts["tw"] + ts["spacing"])
    y = ts["margin"] + r * (ts["th"] + ts["spacing"])
    t = ts["img"].crop((x, y, x + ts["tw"], y + ts["th"]))
    if gid & FLIP_D:
        t = t.transpose(Image.TRANSPOSE)
    if gid & FLIP_H:
        t = t.transpose(Image.FLIP_LEFT_RIGHT)
    if gid & FLIP_V:
        t = t.transpose(Image.FLIP_TOP_BOTTOM)
    return t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--out", default=None)
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--no-above", action="store_true")
    ap.add_argument("--crop", default=None)
    a = ap.parse_args()

    tmj = json.loads((TOWN / "polis-town.tmj").read_text())
    ts = load_tileset(tmj["tilesets"][0])
    W, H, TW, TH = tmj["width"], tmj["height"], tmj["tilewidth"], tmj["tileheight"]
    canvas = Image.new("RGBA", (W * TW, H * TH), (11, 16, 32, 255))
    cache: dict[int, Image.Image] = {}
    collision = None
    for layer in tmj["layers"]:
        if layer["type"] != "tilelayer" or not layer.get("visible", True):
            continue
        if layer["name"] == "collision":
            collision = layer["data"]
            continue
        if a.no_above and layer["name"] == "above":
            continue
        for i, gid in enumerate(layer["data"]):
            if gid == 0:
                continue
            t = cache.get(gid)
            if t is None:
                t = tile_image(ts, gid)
                cache[gid] = t
            canvas.alpha_composite(t, ((i % W) * TW, (i // W) * TH))

    s = a.scale
    big = canvas.resize((W * TW * s, H * TH * s), Image.NEAREST)
    if a.debug:
        ov = Image.new("RGBA", big.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        if collision:
            for i, gid in enumerate(collision):
                if gid:
                    x, y = (i % W) * TW * s, (i // W) * TH * s
                    d.rectangle([x, y, x + TW * s - 1, y + TH * s - 1], fill=(255, 0, 0, 80))
        font = ImageFont.load_default()
        for layer in tmj["layers"]:
            if layer["type"] != "objectgroup":
                continue
            for o in layer["objects"]:
                props = {p["name"]: p["value"] for p in o.get("properties", [])}
                x, y, w, h = o["x"] * s, o["y"] * s, o.get("width", 0) * s, o.get("height", 0) * s
                t = o.get("type") or o.get("class")
                if o.get("point"):
                    col = (255, 255, 0, 255) if t == "door" else (255, 120, 255, 255)
                    d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=col, outline=(0, 0, 0, 255))
                    d.text((x + 6, y - 6), str(props.get("location", props.get("slot", ""))), fill=(255, 255, 255, 255), font=font)
                elif t == "location":
                    d.rectangle([x, y, x + w, y + h], outline=(0, 255, 255, 255), fill=(0, 255, 255, 40))
                    d.text((x + 3, y + 3), o["name"], fill=(255, 255, 255, 255), font=font)
                elif t == "interactable":
                    d.rectangle([x, y, x + w, y + h], outline=(80, 255, 80, 255))
        big = Image.alpha_composite(big, ov)
    if a.crop:
        x0, y0, x1, y1 = [int(v) for v in a.crop.split(",")]
        big = big.crop((x0 * TW * s, y0 * TH * s, x1 * TW * s, y1 * TH * s))
    out = Path(a.out) if a.out else ROOT / "doc" / "town-preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    big.convert("RGB").save(out)
    print(f"wrote {out}  {big.size[0]}x{big.size[1]}")


if __name__ == "__main__":
    main()
