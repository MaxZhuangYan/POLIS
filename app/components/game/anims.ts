// Character animations, defined ONCE from the data in town/characters.ts (4 facings x walk / idle per sheet).
// Called by PreloaderScene after the pack is loaded; scenes only ever play them by key.

import type { Animations } from "phaser";
import { DIRECTIONS, SHEET_NUMBERS, WALK_FPS, animKey, frameIndex, sheetTexture } from "@/app/components/town/characters";

export function createCharacterAnims(anims: Animations.AnimationManager, sheets: number[] = SHEET_NUMBERS): void {
  for (const sheet of sheets) {
    const texture = sheetTexture(sheet);
    for (const dir of DIRECTIONS) {
      const walk = animKey(texture, "walk", dir);
      if (!anims.exists(walk)) {
        anims.create({
          key: walk,
          // rows 0-3 of the sheet are the four walk frames of one facing
          frames: [0, 1, 2, 3].map((row) => ({ key: texture, frame: frameIndex(dir, row) })),
          frameRate: WALK_FPS,
          repeat: -1
        });
      }
      const idle = animKey(texture, "idle", dir);
      if (!anims.exists(idle)) anims.create({ key: idle, frames: [{ key: texture, frame: frameIndex(dir, 0) }], frameRate: 1, repeat: -1 });
    }
  }
  // the town dog has two poses: sitting (0) and lying down (1)
  if (!anims.exists("dog:sit")) anims.create({ key: "dog:sit", frames: [{ key: "char-dog", frame: 0 }], frameRate: 1, repeat: -1 });
  if (!anims.exists("dog:lie")) anims.create({ key: "dog:lie", frames: [{ key: "char-dog", frame: 1 }], frameRate: 1, repeat: -1 });
}
