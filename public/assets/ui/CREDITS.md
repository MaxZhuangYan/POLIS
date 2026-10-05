# UI art credits

The HUD art in this folder comes from the **Ninja Adventure** asset pack by **Pixel-boy**, published for
**Sparklin Labs**' Superpowers supporters under **CC0 1.0** (public domain dedication).

- Source: https://github.com/sparklinlabs/superpowers-asset-packs (folder `ninja-adventure`, `hud/`)
- License: https://github.com/sparklinlabs/superpowers-asset-packs/blob/master/LICENSE.txt (CC0)

## What is here

| Path | Origin |
| --- | --- |
| `pack/dialogue-bubble.png`, `pack/faceset-box.png`, `pack/yes-button.png`, `pack/no-button.png`, `pack/arrow.png`, `pack/heart.png`, `pack/kunai.png`, `pack/shuriken.png` | copied unchanged from the pack's `hud/` folder (`dialogue-bubble.png` is the 9-slice source of the in-world speech bubbles; `arrow.png` is the "continue" arrow) |
| `frame-*.png`, `btn-*.png` | **derived** by `scripts/build-ui-frames.py`: small 9-slice frames (parchment panel, wood bar, inset well, text field, portrait box, bevel buttons, inventory tiles) drawn pixel by pixel with the colours of `dialogue-bubble.png` (outline, terracotta, orange, tan, cream) and `faceset-box.png` (blue-grey, lavender, white). The CSS paints them with `border-image` at 2x and `image-rendering: pixelated`. |

The UI font is **Fusion Pixel 12px Proportional SC** (OFL-1.1, TakWolf, https://github.com/TakWolf/fusion-pixel-font),
installed through `@fontsource/fusion-pixel-12px-proportional-sc`.
