#!/usr/bin/env node
// Playtest "new": a brand-new player's first session, through the real UI.
//
//   empty save -> title (开始) -> name the Agent -> 让它入城 -> answer the three forks -> the imprint reveal ->
//   看它出发 -> coach marks -> 留言 -> test fast-forward to 23:00 -> the first postcard -> reload -> 继续
//
//   npm run playtest:new            (output: playtest-output/new/)
//
// Starts its own server + temp save (see scripts/playtest/lib.mjs for the environment switches). Fails on page
// errors, HTTP 5xx, or when a step of the flow does not happen.

import { btn, clickBtn, dismissCoach, escapeRe, horizontalOverflow, passTitle, pressEscape, runPlaytest, sec } from "./lib.mjs";

const { ok } = await runPlaytest("new", { title: "new player: title -> name -> 3 forks -> imprint -> set off -> note -> night postcard -> reload" }, async (t) => {
  const page = await t.newPage({ tag: "desktop", viewport: { width: 1440, height: 900 } });

  await t.step("start from a morning (test fast-forward, labelled)", async () => {
    const s = await t.state();
    t.check("the save starts empty (no player)", s.player === null);
    t.check("the server runs in test mode", s.world.testMode === true);
    t.check("the model is off, the HUD says so", s.world.llm.mode === "offline" || process.env.PLAYTEST_LLM === "env", s.world.llm.label);
    if (process.env.PLAYTEST_REAL_TIME !== "1" && (s.world.hour >= 12 || s.world.hour < 7)) await t.advance({ to: "morning" });
  });

  await t.step("open the game: title screen says 开始", async () => {
    await page.goto(t.base, { waitUntil: "domcontentloaded" });
    const label = await passTitle(page, t, { label: "title" });
    t.check("an empty save's title button says 开始", /开始/.test(label), label);
  });

  await t.step("name the Agent and let it in", async () => {
    const name = page.getByPlaceholder(/12 个字/);
    await name.waitFor({ state: "visible", timeout: sec(60) });
    await t.shot(page, "landing");
    await name.fill("阿守");
    await t.shot(page, "named");
    await clickBtn(page, /让它入城/);
    const s = await t.waitState((x) => x.player?.pendingMoments.length === 3, { label: "3 first forks" });
    t.check("the three first-session forks are pending", s.player.pendingMoments.length === 3);
    t.check("the world adopted the browser's zone (Asia/Shanghai)", s.world.tz === "Asia/Shanghai", s.world.tz);
    await page.waitForTimeout(1500);
    await t.shot(page, "after-create");
  });

  await t.step("answer the three forks", async () => {
    for (let i = 0; i < 3; i++) {
      const before = await t.state();
      const m = before.player.pendingMoments[0];
      if (!m) throw new Error(`no pending fork at answer ${i + 1}`);
      t.story(`fork ${i + 1}: ${m.templateId} - ${m.promptText.slice(0, 40)}...`);
      await t.shot(page, `fork-${i + 1}`);
      const label = m.options[i === 1 ? 1 : 0].label;
      await clickBtn(page, new RegExp(`^${escapeRe(label)}$`));
      await t.waitState((x) => !x.player.pendingMoments.some((p) => p.id === m.id), { label: `fork ${m.templateId} answered` });
      await page.waitForTimeout(1200);
    }
  });

  await t.step("the imprint reveal", async () => {
    const s = await t.waitState((x) => x.player.onboarding === "imprint" && x.player.principles.length >= 3, { label: "three imprints", timeout: sec(30) });
    t.check("onboarding reaches the imprint card", s.player.onboarding === "imprint");
    t.check("the three answers became three principles", s.player.principles.length === 3, s.player.principles.map((p) => p.text).join(" | "));
    t.story(`imprints: ${s.player.principles.map((p) => `『${p.text}』(${p.source})`).join(" ")}`);
    await page.waitForTimeout(1500);
    await t.shot(page, "imprint");
  });

  await t.step("看它出发", async () => {
    await clickBtn(page, /看它出发/, { timeout: sec(15) });
    const s = await t.waitState((x) => x.player.onboarding === "done", { label: "onboarding done" });
    t.check("the Agent sets off at once (not left at the gate)", s.player.agent.location !== "gate", s.player.agent.location);
    t.story(`set off: ${s.player.agent.activityText} | because: ${s.player.agent.reason ?? "-"}`);
    await page.waitForTimeout(3000);
    await t.shot(page, "set-off");
    await dismissCoach(page);
    await t.shot(page, "after-coach");
  });

  await t.step("leave a note (留言)", async () => {
    await clickBtn(page, /留言/);
    await page.locator("textarea").first().waitFor({ state: "visible" });
    await t.shot(page, "note-open");
    await page.locator("textarea").first().fill("今天辛苦了");
    await clickBtn(page, /送出|发送|低语|留下|寄出/);
    const s = await t.waitState((x) => x.player.notes.items.length >= 1, { label: "the note saved" });
    t.check("the note is saved and not answered at once", s.player.notes.items[0].status === "pending", s.player.notes.items[0].status);
    await page.waitForTimeout(800);
    await t.shot(page, "note-sent");
    await pressEscape(page);
  });

  await t.step("fast-forward to 23:00 through the test panel", async () => {
    const ff = btn(page, /到今晚 23:00/);
    await ff.waitFor({ state: "visible" });
    t.check("the test panel is labelled as test-only", await page.getByText("测试快进（仅测试用）").first().isVisible());
    await ff.click();
    const s = await t.waitState((x) => x.player.postcards.items.length >= 1, { label: "the first postcard", timeout: sec(30) });
    const card = s.player.postcards.items[0];
    t.check("the first nightly postcard exists", !!card);
    t.check("it says where it came from (source)", ["template", "llm"].includes(card.source), card.source);
    t.check("it quotes a principle the Agent really has", card.lines.join("").match(/『(.+?)』/g)?.some((q) => s.player.principles.some((p) => q.includes(p.text))) ?? false, card.lines.join(" / "));
    t.story(`postcard (${card.kind}/${card.source}): ${card.lines.join(" / ")}`);
    await page.waitForTimeout(3000);
    await t.shot(page, "night");
    await clickBtn(page, /明信片/);
    await page.waitForTimeout(1200);
    await t.shot(page, "postcard");
    await pressEscape(page);
  });

  await t.step("reload: the save is still there (继续)", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    const label = await passTitle(page, t, { label: "after-reload-title" });
    t.check("after a reload the title button says 继续", /继续/.test(label), label);
    await page.waitForTimeout(3000);
    await dismissCoach(page);
    await t.shot(page, "after-reload");
    const s = await t.state();
    t.check("the Agent and its principles survived the reload", s.player?.agent.name === "阿守" && s.player.principles.length === 3);
    const o = await horizontalOverflow(page);
    t.check("no horizontal page scroll at 1440 px", o.scrollWidth <= o.innerWidth, `${o.scrollWidth} > ${o.innerWidth}`);
  });
});

process.exit(ok ? 0 : 1);
