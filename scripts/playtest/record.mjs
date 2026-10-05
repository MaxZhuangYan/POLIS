#!/usr/bin/env node
// Playtest "record": a screen recording of the town running, for showing (not a test of any one feature).
//
//   builds a lived-in save through the API (the three forks, one day and a half), then records one desktop page:
//   title -> 继续 -> the town at NORMAL speed (~25 s: idle animation, speech bubbles, the HUD clock) ->
//   the camera finds the Agent (Space) -> six hours of LABELLED test fast-forward, one hour every ~6 s, so the
//   residents walk to work, meet, and the feed fills -> a fork answered through the UI if one is pending.
//   Output: playtest-output/record/desktop.webm + screenshots. Works with PLAYTEST_PROD=1.
//
//   npm run playtest:record

import { clearModals, clickBtn, dismissCoach, escapeRe, isVisible, passTitle, runPlaytest, sec } from "./lib.mjs";

const { ok } = await runPlaytest("record", { title: "screen recording: normal speed, then labelled fast-forward" }, async (t) => {
  await t.step("build a lived-in save through the API", async () => {
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
    await t.advance({ to: "morning" });
    await t.advance({ hours: 2 });
    const s = await t.state();
    t.story(`save: day ${s.player.dayIndex + 1}, ${String(s.world.hour).padStart(2, "0")}:00, ${s.player.principles.length} imprints`);
  });

  await t.step("record the town", async () => {
    const page = await t.newPage({ tag: "desktop", viewport: { width: 1280, height: 720 }, video: true });
    await page.goto(t.base, { waitUntil: "domcontentloaded" });
    await passTitle(page, t, { label: "title" });
    await page.waitForTimeout(3000);
    await dismissCoach(page);
    await clearModals(page);
    await t.shot(page, "town-normal-speed");
    await page.waitForTimeout(12_000); // normal speed: what a player sees between ticks
    await page.keyboard.press("Space"); // find my Agent
    await page.waitForTimeout(10_000);
    await t.shot(page, "following-the-agent");
    for (let h = 0; h < 6; h++) {
      await t.advance({ hours: 1 }); // the labelled test fast-forward
      await page.waitForTimeout(6000);
      if (h % 2 === 1) await t.shot(page, `fast-forward-${h + 1}h`);
    }
    const p = (await t.state()).player;
    const m = p.pendingMoments[0];
    if (m) {
      await clearModals(page);
      await page.locator('[data-coach="decisions"]').click().catch(() => undefined);
      await page.waitForTimeout(1500);
      const opt = m.options[0];
      if (await isVisible(page, new RegExp(`^${escapeRe(opt.label)}$`))) {
        await t.shot(page, `fork-${m.templateId}`);
        await clickBtn(page, new RegExp(`^${escapeRe(opt.label)}$`));
        await page.waitForTimeout(4000);
        t.story(`  fork ${m.templateId} answered on camera → ${opt.label}`);
      }
    }
    await clearModals(page);
    await page.waitForTimeout(4000);
    await t.shot(page, "end");
    await t.closePage(page);
  });
});

process.exit(ok ? 0 : 1);
