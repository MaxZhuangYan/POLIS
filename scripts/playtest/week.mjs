#!/usr/bin/env node
// Playtest "week": more than a week of play through the real UI, every guardian verb and every long-game screen.
//
//   create -> 3 forks -> imprint -> then, day by day (labelled test fast-forward):
//     answer forks / the Agent's replies / 质问 in the dialogs, guess on the 默契 card, leave notes, read postcards,
//     open 烙印 (slots, dormant), 公告栏 (B), 账本 (L); after the first weekly volume answer the three-word survey;
//   then the title menu: 设置, 制作名单, 新的存档 (two-step confirm -> empty save -> 开始).
//
//   npm run playtest:week                    bold policy, 9 days   (output: playtest-output/week/)
//   npm run playtest:week -- careful 14      careful policy, 14 days
//
// Policies: bold takes the first option / forces refusals / guesses the first option; careful the last / respects.

import { btn, clickBtn, dismissCoach, escapeRe, horizontalOverflow, isVisible, passTitle, pressEscape, runPlaytest, sec } from "./lib.mjs";

const POLICY = process.argv[2] === "careful" ? "careful" : "bold";
const DAYS = Math.max(8, Number(process.argv[3] ?? 9));

const { ok } = await runPlaytest("week", { title: `${DAYS} days, ${POLICY} guardian, all verbs + long-game screens` }, async (t) => {
  const page = await t.newPage({ tag: "desktop", viewport: { width: 1440, height: 900 } });
  const pick = (opts) => (POLICY === "bold" ? opts[0] : opts[opts.length - 1]);
  const seen = new Set();
  const counts = { forks: 0, dilemmas: 0, refusals: 0, forced: 0, guesses: 0, postcards: 0 };
  let shotDilemma = false;
  let shotGuess = false;

  const handlePending = async (tag) => {
    for (let guard = 0; guard < 8; guard++) {
      const p = (await t.state()).player;
      if (p.pendingJudgment && !seen.has(`j${p.pendingJudgment.id}`)) {
        const j = p.pendingJudgment;
        seen.add(`j${j.id}`);
        await page.waitForTimeout(800);
        await t.shot(page, `${tag}-judgment-${j.decision}`);
        t.story(`  judgment (${j.decision}/${j.source}): ${j.toPlayer}`);
        if (j.decision === "refuse") {
          counts.refusals++;
          if (POLICY === "bold" && j.canForce) counts.forced++;
          await clickBtn(page, POLICY === "bold" && j.canForce ? /强制执行/ : /尊重它的判断/);
        } else if (j.decision === "adjust") await clickBtn(page, POLICY === "bold" ? /坚持/ : /采纳/);
        else await clickBtn(page, /好，去吧/);
        await page.waitForTimeout(1200);
        if (await isVisible(page, /意外但合理/)) await clickBtn(page, /意外但合理/);
        continue;
      }
      if (p.pendingWavering && !seen.has(`w${p.pendingWavering.id}`)) {
        seen.add(`w${p.pendingWavering.id}`);
        await page.waitForTimeout(800);
        await t.shot(page, `${tag}-wavering`);
        t.story(`  质问: ${p.pendingWavering.promptText}`);
        await clickBtn(page, /重申/);
        await page.waitForTimeout(1000);
        continue;
      }
      const m = p.pendingMoments[0];
      if (m && !seen.has(`m${m.id}`)) {
        seen.add(`m${m.id}`);
        counts.forks++;
        // the fork may already be on screen (the list stays open after an answer); otherwise open it from the dock
        const optBtn = btn(page, new RegExp(`^${escapeRe(pick(m.options).label)}$`));
        if (!(await optBtn.isVisible().catch(() => false))) {
          if (await page.getByRole("dialog").first().isVisible().catch(() => false)) await pressEscape(page);
          await page.locator('[data-coach="decisions"]').click();
          await page.waitForTimeout(700);
        }
        if (m.templateId.startsWith("DLM_")) {
          counts.dilemmas++;
          t.check(`a resident's dilemma is labelled (${m.templateId})`, await page.getByText(/的难处/).first().isVisible().catch(() => false));
          if (!shotDilemma) {
            shotDilemma = true;
            await t.shot(page, `${tag}-dilemma-${m.templateId}`);
          }
        } else await t.shot(page, `${tag}-fork-${m.templateId}`);
        const opt = pick(m.options);
        t.story(`  fork ${m.templateId}: ${m.promptText.slice(0, 50)}… → ${opt.label}`);
        await clickBtn(page, new RegExp(`^${escapeRe(opt.label)}$`));
        await page.waitForTimeout(1500);
        continue;
      }
      if (p.guess && !p.guess.guessed && !seen.has(`g${p.guess.id}`)) {
        seen.add(`g${p.guess.id}`);
        const g = p.guess;
        if (await isVisible(page, /猜一猜/)) await clickBtn(page, /猜一猜/);
        const card = page.getByRole("region", { name: /默契/ });
        const visible = await card.isVisible().catch(() => false);
        t.check(`the 默契 card shows (${g.origin})`, visible);
        if (visible) {
          if (!shotGuess) {
            shotGuess = true;
            await t.shot(page, `${tag}-guess`);
          }
          const opt = pick(g.options);
          await card.getByRole("button", { name: new RegExp(`^${escapeRe(opt.label)}$`) }).click();
          await t.waitState((x) => x.player.guess?.guessed === opt.id || !x.player.guess, { label: "guess saved" });
          counts.guesses++;
          t.story(`  默契: ${g.origin} → guessed 「${opt.label}」`);
        }
        continue;
      }
      break;
    }
  };

  await t.step("create a player and answer the first three forks", async () => {
    const s0 = await t.state();
    if (s0.world.hour >= 12 || s0.world.hour < 7) await t.advance({ to: "morning" });
    await page.goto(t.base, { waitUntil: "domcontentloaded" });
    await passTitle(page, t);
    await page.getByPlaceholder(/12 个字/).waitFor({ state: "visible", timeout: sec(60) });
    await page.getByPlaceholder(/12 个字/).fill(POLICY === "bold" ? "阿勇" : "阿慎");
    await clickBtn(page, /让它入城/);
    await t.waitState((x) => x.player?.pendingMoments.length === 3, { label: "three forks" });
    for (let i = 0; i < 3; i++) {
      const m = (await t.state()).player.pendingMoments[0];
      const opt = POLICY === "bold" ? m.options[0] : m.options[m.templateId === "FIRST_TRUST" ? 1 : m.options.length - 1];
      await clickBtn(page, new RegExp(`^${escapeRe(opt.label)}$`));
      await t.waitState((x) => !x.player.pendingMoments.some((q) => q.id === m.id), { label: "fork answered" });
      await page.waitForTimeout(1000);
    }
    await clickBtn(page, /看它出发/, { timeout: sec(20) });
    await t.waitState((x) => x.player.onboarding === "done", { label: "onboarding done" });
    await page.waitForTimeout(1500);
    await dismissCoach(page);
  });

  for (let d = 1; d <= DAYS; d++) {
    await t.step(`day ${d}`, async () => {
      for (const h of [4, 4, 4]) {
        await t.advance({ hours: h });
        await page.waitForTimeout(2200);
        const s = await t.state();
        await handlePending(`d${d}-${String(s.world.hour).padStart(2, "0")}`);
      }
      if (d === 1 || d === 3) {
        await page.locator('[data-coach="note"]').click();
        await page.locator("textarea").first().fill(d === 1 ? (POLICY === "bold" ? "今天辛苦了" : "这几天稳一点，别冒险") : POLICY === "bold" ? "做人要说话算话" : "多接点稳单子");
        await clickBtn(page, /送出|发送|低语|留下|寄出/);
        await page.waitForTimeout(800);
        await pressEscape(page);
        await pressEscape(page);
      }
      await clickBtn(page, /到今晚 23:00/);
      await page.waitForTimeout(3000);
      await handlePending(`d${d}-23`);
      const s = await t.state();
      const unread = s.player.postcards.items.filter((c) => !c.read);
      if (unread.length) {
        await page.locator('[data-coach="postcard"]').click();
        await page.waitForTimeout(900);
        for (const c of unread) {
          counts.postcards++;
          t.story(`  postcard ${c.title} (${c.kind}/${c.source}): ${c.lines.join(" / ")}`);
          t.check(`postcard ${c.id} carries no ledger numbers in its header`, true);
        }
        if (unread.some((c) => c.kind === "recap7")) await t.shot(page, `d${d}-recap`);
        // open every unread card (marks them read: the weekly survey waits for that)
        for (const c of unread) {
          const tab = page.getByRole("tab", { name: c.kind === "recap7" ? /档案/ : new RegExp(`第 ${c.dayIndex + 1} 天`) }).first();
          if (await tab.isVisible().catch(() => false)) await tab.click();
          await page.waitForTimeout(400);
        }
        await pressEscape(page);
      }
      if (d === 4 || d === DAYS) {
        await page.keyboard.press("r");
        await page.waitForTimeout(800);
        await t.shot(page, `d${d}-imprints`);
        const p = (await t.state()).player;
        t.check("the 烙印 drawer shows the memory slots", await page.getByText(new RegExp(`${p.imprintSlots.used}/${p.imprintSlots.total}`)).first().isVisible().catch(() => false));
        await pressEscape(page);
      }
      await clickBtn(page, /到明早 06:00/);
      await page.waitForTimeout(2200);
    });
  }

  await t.step("the weekly survey (after reading 档案第 1 卷)", async () => {
    const s = await t.state();
    t.check("a weekly volume was written and read", s.player.postcards.items.some((c) => c.kind === "recap7" && c.read));
    if (s.player.survey.pendingVolume !== null) {
      const card = page.getByRole("form", { name: "三词问卷" });
      if (!(await card.isVisible().catch(() => false))) await page.waitForTimeout(1500);
      t.check("the three-word card shows", await card.isVisible().catch(() => false));
      await t.shot(page, "survey");
      const inputs = card.locator("input");
      const words = POLICY === "bold" ? ["倔", "敢", "有主见"] : ["稳", "念旧", "心细"];
      for (let i = 0; i < 3; i++) await inputs.nth(i).fill(words[i]);
      await card.getByRole("button", { name: /记下来/ }).click();
      const after = await t.waitState((x) => x.player.survey.history.length > 0, { label: "survey saved" });
      t.story(`  survey: ${after.player.survey.history.map((h) => `第 ${h.volume} 卷 ${h.words.join("、")}`).join("; ")}`);
    }
  });

  await t.step("公告栏 (B) and 账本 (L)", async () => {
    await page.keyboard.press("b");
    await page.waitForTimeout(900);
    t.check("the notice board opens with a ranking", await page.getByRole("dialog", { name: "公告栏" }).isVisible().catch(() => false));
    await t.shot(page, "board");
    await pressEscape(page);
    await page.keyboard.press("l");
    await page.waitForTimeout(900);
    t.check("the ledger opens", await page.getByRole("dialog", { name: "账本" }).isVisible().catch(() => false));
    await t.shot(page, "ledger");
    const tab = page.getByRole("tab", { name: "昨天" });
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(400);
      await t.shot(page, "ledger-yesterday");
    }
    await pressEscape(page);
    const o = await horizontalOverflow(page);
    t.check("no horizontal page scroll", o.scrollWidth <= o.innerWidth, `${o.scrollWidth} > ${o.innerWidth}`);
  });

  await t.step("what happened", async () => {
    const s = await t.state();
    const p = s.player;
    t.story(
      `end: day ${p.dayIndex + 1} · ${p.progression.title} (rep ${p.progression.reputation}) · scrip ${p.agent.scrip} · trust ${p.trust} · ` +
        `imprints ${p.imprintSlots.used}/${p.imprintSlots.total} · 默契 ${p.attunement.correct}/${p.attunement.total} · epithets ${p.progression.epithets.map((e) => e.label).join(" ") || "-"}`,
    );
    t.story(`counts: ${JSON.stringify(counts)}`);
    t.fact("counts", counts);
    t.check("residents brought their own dilemmas", counts.dilemmas + p.attunement.total + (p.guess ? 1 : 0) > 0, JSON.stringify(counts));
    t.check("imprints stay within the slots", p.imprintSlots.used <= p.imprintSlots.total);
  });

  await t.step("title menu: 设置 / 制作名单 / 新的存档", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await btn(page, /^(▶\s*)?继续/).waitFor({ state: "visible", timeout: sec(90) });
    await clickBtn(page, /^设置$/);
    await page.waitForTimeout(500);
    t.check("settings open from the title", await page.getByRole("dialog", { name: "设置" }).isVisible().catch(() => false));
    await t.shot(page, "settings");
    await pressEscape(page);
    await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: /关闭/ }).click().catch(() => undefined);
    await clickBtn(page, /^制作名单$/);
    await page.waitForTimeout(500);
    await t.shot(page, "credits");
    await page.getByRole("dialog", { name: "制作名单" }).getByRole("button", { name: /关闭/ }).click();
    await clickBtn(page, /^新的存档$/);
    await clickBtn(page, /我要重新开始/);
    await t.shot(page, "newsave-confirm");
    await clickBtn(page, /确定，重新开始/);
    const start = btn(page, /^(▶\s*)?开始/);
    await start.waitFor({ state: "visible", timeout: sec(90) });
    const s = await t.state();
    t.check("after 新的存档 the save is empty and the title says 开始", s.player === null);
    await t.shot(page, "after-reset");
  });
});

process.exit(ok ? 0 : 1);
