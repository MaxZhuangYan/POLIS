// Character data, shared by the Phaser town (spritesheets + animations) and the React HUD (portraits).
// No Phaser import: the HUD imports this module on the server too.
//
// Art: Ninja Adventure pack (CC0, Pixel-boy) — see public/assets/town/CREDITS.md.
//   characters/<n>.png        64 x 112 sheet, 16 x 16 frames, 4 columns = facing down / up / left / right,
//                             rows 0-3 = a 4-frame walk cycle (row 0 doubles as the standing pose)
//   characters/faceset/<n>.png  38 x 38 portrait

export type SpriteKey = "architect" | "broker" | "maker" | "archivist" | "mediator" | "scout" | "rookie" | "courier" | "guide";

export const SPRITE_KEYS: SpriteKey[] = ["architect", "broker", "maker", "archivist", "mediator", "scout", "rookie", "courier", "guide"];

export interface CharacterDef {
  /** number of the Ninja Adventure character sheet */
  sheet: number;
  /** who it is, for tooltips / docs */
  note: string;
}

/** logical sprite key (AgentView.sprite) -> Ninja Adventure character */
export const CHARACTERS: Record<SpriteKey, CharacterDef> = {
  architect: { sheet: 14, note: "Mira 营造师 — hard-hat explorer in a tan coat" },
  broker: { sheet: 13, note: "Sol 掮客 — dark fedora, sly dealer" },
  maker: { sheet: 16, note: "Tao 工匠 — older craftsman, red cap and apron" },
  archivist: { sheet: 3, note: "Iris 档案员 — scholar in a quiet jacket" },
  mediator: { sheet: 5, note: "Kade 调解人 — calm monk under a straw hat" },
  scout: { sheet: 1, note: "Nova 斥候 — green hooded scout" },
  rookie: { sheet: 25, note: "新人 — brown hair, green scarf" },
  courier: { sheet: 6, note: "信使 — red hair, light shirt, blue scarf" },
  guide: { sheet: 17, note: "向导 — blonde with a bandana" }
};

export const FRAME_SIZE = 16;
export const DIRECTIONS = ["down", "up", "left", "right"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const WALK_FPS = 8;

/** all distinct sheets (sprites may share one; the dog is extra scenery) */
export const SHEET_NUMBERS: number[] = Array.from(new Set(SPRITE_KEYS.map((k) => CHARACTERS[k].sheet)));
export const DOG_SHEET = "dog";

export function normalizeSprite(sprite: string): SpriteKey {
  return (SPRITE_KEYS as string[]).includes(sprite) ? (sprite as SpriteKey) : "rookie";
}

/** Phaser texture key of a character sheet */
export const sheetTexture = (sheet: number | string): string => `char-${sheet}`;
export const spriteTexture = (sprite: string): string => sheetTexture(CHARACTERS[normalizeSprite(sprite)].sheet);

/** Phaser animation key: `char-14:walk-left`, `char-14:idle-down` */
export const animKey = (texture: string, kind: "walk" | "idle", dir: Direction): string => `${texture}:${kind}-${dir}`;

/** frame index of a (row, direction) cell in a character sheet (4 columns) */
export const frameIndex = (dir: Direction, row = 0): number => row * 4 + DIRECTIONS.indexOf(dir);

/** HUD portrait (38x38 faceset) of a logical sprite */
export const facePath = (sprite: string): string => `/assets/town/faceset/${CHARACTERS[normalizeSprite(sprite)].sheet}.png`;
