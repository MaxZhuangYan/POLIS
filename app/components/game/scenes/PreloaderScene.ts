// PreloaderScene: loads the blocking sections of the asset pack (character sheets, facesets, emote icons, HUD frames)
// with load.pack() and the active map (its .tmj, then the tileset images the .tmj embeds), draws a pixel-style progress
// bar with the percentage and the file in flight (the React loading screen shows the same percentage from the
// `load-progress` event), defines the character animations once from data, launches the background AudioScene and
// starts the town.
//
// The map comes from the registry (town/maps.ts), chosen by PhaserTown through the game registry ("mapId"). Its tileset
// images are only known once the .tmj is in, so they are queued from the .tmj's own completion event; the loader
// counts them in the progress like any other file.
//
// The audio sections of the pack are NOT loaded here: decoding three 70 s music loops must never delay the town.

import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { BG_COLOR, BLOCKING_PACK_SECTIONS, KEYS, PIXEL_FONT, SCENES, tilesetTextureKey } from "../keys";
import { createCharacterAnims } from "../anims";
import { resolveMap } from "../../town/maps";
import { readTilesets, type TiledMap } from "../../town/tiled";
import { BAR_H, BAR_W } from "./BootScene";

const SEG = 4; // fill granularity: one bar tile = 4 px

export class PreloaderScene extends Phaser.Scene {
  private fills: Phaser.GameObjects.Image[] = [];
  private pct!: Phaser.GameObjects.Text;
  private file!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private frame!: Phaser.GameObjects.Image;
  private scale0 = 2;

  constructor() {
    super({ key: SCENES.preloader });
  }

  preload(): void {
    this.cameras.main.setBackgroundColor(BG_COLOR);
    this.buildBar();
    this.scale.on("resize", this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off("resize", this.layout, this));

    this.load.on("progress", (v: number) => {
      this.setProgress(v);
      EventBus.emit("load-progress", v, "");
    });
    this.load.on("fileprogress", (file: Phaser.Loader.File) => {
      this.file.setText(file.key);
      EventBus.emit("load-progress", this.load.progress, file.key);
    });

    // the map: the .tmj first, its tileset images as soon as the .tmj tells which ones
    const map = resolveMap(this.registry.get("mapId") as string | undefined);
    this.load.once(`${Phaser.Loader.Events.FILE_KEY_COMPLETE}tilemapJSON-${KEYS.map}`, (_key: string, _type: string, data: TiledMap) => {
      try {
        for (const ts of readTilesets(data, map.tmj)) this.load.image(tilesetTextureKey(ts.name), ts.imageUrl);
      } catch (e) {
        // never throw inside the loader (it would stall at 99 %); the town scene stops with a clear message instead
        console.error(`[polis] map "${map.id}" (${map.tmj}): ${e instanceof Error ? e.message : String(e)} — run \`npm run map:check\``);
      }
    });
    this.load.tilemapTiledJSON(KEYS.map, map.tmj);

    // the manifest was fetched by BootScene; load.pack accepts the ready-made object. Only the blocking sections.
    const manifest = this.cache.json.get(KEYS.manifest) as object;
    for (const section of BLOCKING_PACK_SECTIONS) {
      this.load.pack({ key: `${KEYS.pack}-${section}`, url: manifest, dataKey: section });
    }
  }

  create(): void {
    this.setProgress(1);
    EventBus.emit("load-progress", 1, "");
    createCharacterAnims(this.anims);
    // audio loads (and may fail) on its own, in the background
    if (!this.scene.get(SCENES.audio)?.scene.isActive()) this.scene.launch(SCENES.audio);
    this.scene.start(SCENES.town);
  }

  // ── bar ──

  private buildBar(): void {
    this.frame = this.add.image(0, 0, KEYS.barFrame).setOrigin(0.5, 0.5);
    const segs = BAR_W / SEG;
    for (let i = 0; i < segs; i++) this.fills.push(this.add.image(0, 0, KEYS.barFill).setOrigin(0, 0).setVisible(false));
    // pixel font at 36 / 12 px: whole multiples of its 12 px grid
    this.title = this.add
      .text(0, 0, "POLIS", { fontFamily: PIXEL_FONT, fontSize: "36px", color: "#f2c75c", stroke: "#2b180d", strokeThickness: 6 })
      .setOrigin(0.5, 1);
    this.pct = this.add.text(0, 0, "0%", { fontFamily: PIXEL_FONT, fontSize: "12px", color: "#fbeed6" }).setOrigin(0.5, 0);
    this.file = this.add.text(0, 0, "", { fontFamily: PIXEL_FONT, fontSize: "12px", color: "#b89a6a" }).setOrigin(0.5, 0);
    this.layout();
  }

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    if (w <= 0 || h <= 0) return;
    // integer scale so the pixel bar stays crisp
    this.scale0 = Math.max(1, Math.min(4, Math.floor(Math.min(w / (BAR_W + 40), 4))));
    const s = this.scale0;
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    this.frame.setPosition(cx, cy).setScale(s);
    const left = cx - (BAR_W / 2) * s;
    this.fills.forEach((img, i) => img.setPosition(left + i * SEG * s, cy - (BAR_H / 2) * s).setScale(s));
    this.title.setPosition(cx, cy - (BAR_H / 2 + 8) * s);
    this.pct.setPosition(cx, cy + (BAR_H / 2 + 8) * s);
    this.file.setPosition(cx, cy + (BAR_H / 2 + 8) * s + 22);
  }

  private setProgress(v: number): void {
    const n = Math.round(Phaser.Math.Clamp(v, 0, 1) * this.fills.length);
    this.fills.forEach((img, i) => img.setVisible(i < n));
    this.pct.setText(`${Math.round(v * 100)}%`);
  }
}
