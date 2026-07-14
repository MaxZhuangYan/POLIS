# Polis Asset Requirements

Assets needed to complete the AIvilization-style pixel town UI. All sprites should be pixel art style, matching the aesthetic of `polis-pixel-town-map.png`.

---

## 1. Building Sprites (6 buildings)

Each building should be a standalone pixel sprite that can overlay the town map as a clickable landmark. Recommended size: **82×70 px** at 2× pixel density.

| Building | File path | Notes |
|----------|-----------|-------|
| HOME | `/public/assets/buildings/home.png` | Cozy house, warm yellow/brown tones |
| SCHOOL | `/public/assets/buildings/school.png` | Small schoolhouse, blue roof |
| MINE | `/public/assets/buildings/mine.png` | Mineshaft entrance, grey/brown |
| MARKET | `/public/assets/buildings/market.png` | Market stall with canopy, orange/green |
| OFFICE | `/public/assets/buildings/office.png` | Official building, grey/white, flag |
| ARCHIVE | `/public/assets/buildings/archive.png` | Library/archive, dark purple roof |

Current implementation: text signs (CSS `.building-sign`) are used as placeholders. Replace with `<Image>` once sprites are ready.

---

## 2. Map Background (enhanced)

Current file: `/public/assets/polis-pixel-town-map.png`

Requirements for an enhanced version:
- Clearer zone demarcation: farming area, town center, forest/mine area, market area, civic plaza
- Road/path network connecting zones
- Suggested resolution: **1600×900 px**, pixel art, top-down 2D view
- Green/earthy color palette (village feel, not sci-fi)

---

## 3. Agent Role Sprites (6 roles)

Current sprites exist in `/public/assets/polis-sprites/`. If higher-quality versions are needed:

| Role | File | Suggested style |
|------|------|-----------------|
| Architect | `architect.png` | Hard hat, blueprint scroll |
| Broker | `broker.png` | Business attire, coin bag |
| Scout | `scout.png` | Explorer hat, binoculars |
| Mediator | `mediator.png` | Calm expression, handshake gesture |
| Archivist | `archivist.png` | Glasses, books |
| Maker | `maker.png` | Apron, tools |

Recommended sprite sheet size: **48×48 px** per frame, 2 frames (walk cycle), transparent background.

---

## 4. Status Bar Icons (pixel icons)

Used in the left panel agent stat bars. 5 icons needed, **16×16 px** pixel art.

| Stat | Icon | Suggested color |
|------|------|-----------------|
| Health | `health-icon.png` | Red heart ♥ |
| Energy | `energy-icon.png` | Yellow bolt ⚡ |
| Satiety | `satiety-icon.png` | Green bowl ● |
| Scrip (贡献券) | `scrip-icon.png` | Orange coin ◎ |
| Compute | `compute-icon.png` | Cyan chip ▰ |

Current implementation: text characters (♥ ⚡ ● ◎ ▰) used as placeholders.

---

## 5. Event Kind Icons (optional)

Small 12×12 px icons for the event feed chip labels:

| Kind | Color | Icon idea |
|------|-------|-----------|
| contract | #ff9a18 (orange) | scroll |
| social | #c7ff7e (green) | speech bubble |
| rule | #45f6ff (cyan) | gavel |
| culture | #c4a8ff (purple) | star |
| settlement | #ffffff (white) | hourglass |

---

## Usage Notes

- All sprites should use `image-rendering: pixelated` (already applied via `.pixel-icon` CSS class)
- Transparent backgrounds (PNG with alpha) preferred
- Consistent pixel grid: recommend 2px per pixel at normal display size
