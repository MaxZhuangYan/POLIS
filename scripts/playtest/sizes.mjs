#!/usr/bin/env node
// Playtest "sizes": one lived-in save, every panel, at four window sizes (two desktop, two phone).
//
//   builds the save through the API (create, the three forks, three days of fast-forward), then for each size:
//   title -> 继续 -> town; 烙印 drawer; 公告栏; 账本; the postcards; a fork if one is pending; key help.
//   Each screen is screenshotted; the run fails on page errors, HTTP 5xx or a horizontally scrolling page.
//
//   npm run playtest:sizes          (output: playtest-output/sizes/)

import { btn, clickBtn, dismissCoach, horizontalOverflow, isVisible, pressEscape, runPlaytest, sec } from "./lib.mjs";

const SIZES = [
  { tag: "1280", viewport: { width: 1280, height: 720 } },
  { tag: "1440", viewport: { width: 1440, height: 900 } },
  { tag: "390", viewport: { width: 390, height: 844 }, mobile: true },
  { tag: "360", viewport: { width: 360, height: 640 }, mobile: true }
];

const { ok } = await runPlaytest("sizes", { title: "one save, every panel, 1280 / 1440 / 390 / 360" }, async (t) => {
  await t.step("build a three-day save through the API", async () => {
    const s0 = await t.state();
    if (s0.world.hour >= 12 || s0.world.hour < 7) await t.advance({ to: "morning" });
    await t.api("POST", "/api/player/create", { name: "阿守", sprite: "rookie", tz: "Asia/Shanghai" });
    for (let i = 0; i < 3; i++) {
      const m = (await t.state()).player.pendingMoments[0];
      if (!m) break;
      await t.api("POST", `/api/decisions/${m.id}/choose`, { optionId: m.options[0].id });
    }
    await t.waitState((x) => x.player.principles.length >= 3, { label: "imprints", timeout: sec(30) });
    await t.api("POST", "/api/player/onboarding");
    for (let h = 0; h < 3 * 24; h += 6) {
      await t.advance({ hours: 6 });
      const p = (await t.state()).player;
      for (const m of p.pendingMoments.slice(0, 1)) await t.api("POST", `/api/decisions/${m.id}/choose`, { optionId: m.options[0].id });
      const j = (await t.state()).player.pendingJudgment;
      if (j) await t.api("POST", `/api/judgments/${j.id}/resolve`, { action: j.decision === "refuse" ? "accept" : j.decision === "adjust" ? "adopt" : "accept" });
    }
    await t.advance({ to: "morning" });
    await t.advance({ hours: 4 });
    const s = await t.state();
    t.story(`save: day ${s.player.dayIndex + 1}, ${s.player.principles.length} imprints, ${s.player.postcards.items.length} postcards, ${s.player.pendingMoments.length} forks pending`);
  });

  for (const size of SIZES) {
    await t.step(`${size.tag}: every panel`, async () => {
      const page = await t.newPage({ tag: size.tag, viewport: size.viewport, mobile: !!size.mobile });
      const tap = !!size.mobile;
      await page.goto(t.base, { waitUntil: "domcontentloaded" });
      const start = btn(page, /^(▶\s*)?(继续|开始)/);
      await start.waitFor({ state: "visible", timeout: sec(90) });
      await t.shot(page, `${size.tag}-title`);
      if (tap) await start.tap();
      else await start.click();
      await page.waitForTimeout(3500);
      await dismissCoach(page, { tap });
      if (await isVisible(page, /^稍后再说/)) await pressEscape(page);
      await pressEscape(page);
      await t.shot(page, `${size.tag}-town`);
      const open = async (label, how, name) => {
        await how();
        await page.waitForTimeout(800);
        await t.shot(page, `${size.tag}-${label}`);
        if (name) t.check(`${size.tag}: ${label} opens`, await page.getByRole("dialog", { name }).isVisible().catch(() => false));
        const o = await horizontalOverflow(page);
        t.check(`${size.tag}: no horizontal scroll with ${label} open`, o.scrollWidth <= o.innerWidth, `${o.scrollWidth} > ${o.innerWidth}`);
        await pressEscape(page);
        await page.waitForTimeout(300);
      };
      if (size.mobile) {
        await open("imprints", () => clickBtn(page, /^烙印$/, { tap: true }));
        await open("board", () => clickBtn(page, /^公告栏$/, { tap: true }), "公告栏");
        await open("ledger", () => clickBtn(page, /^账本$/, { tap: true }), "账本");
        await open("postcards", () => page.locator('[data-coach="postcard"]').tap(), "明信片");
      } else {
        await open("imprints", () => page.keyboard.press("r"));
        await open("board", () => page.keyboard.press("b"), "公告栏");
        await open("ledger", () => page.keyboard.press("l"), "账本");
        await open("postcards", () => page.keyboard.press("p"), "明信片");
        await open("keys", () => page.keyboard.press("?"), "按键说明");
      }
      const p = (await t.state()).player;
      if (p.pendingMoments.length > 0) await open("fork", () => (tap ? page.locator('[data-coach="decisions"]').tap() : page.locator('[data-coach="decisions"]').click()));
      await t.closePage(page);
    });
  }
});

process.exit(ok ? 0 : 1);
