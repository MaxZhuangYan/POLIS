// BootScene: as small as possible. Loads the asset-pack manifest (a plain JSON cache entry) and generates the
// loading-bar textures, then hands over to PreloaderScene. Everything else is loaded from the manifest there.

import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { ASSET_PACK_URL, KEYS, SCENES } from "../keys";

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
    // pixel-style loading bar: a gold-framed trough and a fill tile, drawn once into textures
    const frame = this.make.graphics({ x: 0, y: 0 }, false);
    frame.fillStyle(0xf2c75c, 1).fillRect(0, 0, BAR_W + 4, BAR_H + 4);
    frame.fillStyle(0x0b1020, 1).fillRect(2, 2, BAR_W, BAR_H);
    frame.fillStyle(0x1b2748, 1).fillRect(2, 2, BAR_W, 2);
    frame.generateTexture(KEYS.barFrame, BAR_W + 4, BAR_H + 4);
    frame.destroy();

    const fill = this.make.graphics({ x: 0, y: 0 }, false);
    fill.fillStyle(0xffe08a, 1).fillRect(0, 0, 4, BAR_H);
    fill.fillStyle(0xf2a93c, 1).fillRect(0, BAR_H - 4, 4, 4);
    fill.fillStyle(0xfff3c4, 1).fillRect(0, 0, 4, 2);
    fill.generateTexture(KEYS.barFill, 4, BAR_H);
    fill.destroy();

    EventBus.emit("boot-ready");
    this.scene.start(SCENES.preloader);
  }
}
