// BootScene: as small as possible. Loads the asset-pack manifest (a plain JSON cache entry), generates the loading-bar
// textures and waits for the pixel font (Phaser caches text metrics when a Text is created, so no scene may create
// text before the font is usable), then hands over to PreloaderScene. Everything else is loaded from the manifest there.

import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { ASSET_PACK_URL, KEYS, SCENES, ensurePixelFont } from "../keys";

export const BAR_W = 160;
export const BAR_H = 12;

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENES.boot });
  }

  preload(): void {
    this.load.json(KEYS.manifest, ASSET_PACK_URL);
  }

  create(): void {
    // pixel-style loading bar: a wood-framed dark trough and a gold fill tile, drawn once into textures
    const frame = this.make.graphics({ x: 0, y: 0 }, false);
    frame.fillStyle(0x2b180d, 1).fillRect(0, 0, BAR_W + 8, BAR_H + 8);
    frame.fillStyle(0x93602f, 1).fillRect(2, 2, BAR_W + 4, BAR_H + 4);
    frame.fillStyle(0x4a2c18, 1).fillRect(3, 3, BAR_W + 2, BAR_H + 2);
    frame.fillStyle(0x1c0f07, 1).fillRect(4, 4, BAR_W, BAR_H);
    frame.generateTexture(KEYS.barFrame, BAR_W + 8, BAR_H + 8);
    frame.destroy();

    const fill = this.make.graphics({ x: 0, y: 0 }, false);
    fill.fillStyle(0xf2c75c, 1).fillRect(0, 0, 4, BAR_H);
    fill.fillStyle(0xb98a1f, 1).fillRect(0, BAR_H - 4, 4, 4);
    fill.fillStyle(0xfff3bd, 1).fillRect(0, 0, 4, 2);
    fill.generateTexture(KEYS.barFill, 4, BAR_H);
    fill.destroy();

    EventBus.emit("boot-ready");
    void ensurePixelFont().then(() => {
      if (this.scene.isActive(SCENES.boot)) this.scene.start(SCENES.preloader);
    });
  }
}
