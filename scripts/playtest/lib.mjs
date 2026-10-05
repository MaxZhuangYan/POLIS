// Shared harness for the committed browser playtests (new.mjs, week.mjs, sizes.mjs).
//
//   await runPlaytest("new", { title: "..." }, async (t) => { const page = await t.newPage(); ... });
//
// What a playtest run does, so each script only has to say what to click:
//   1. starts its OWN `next dev` on a free port against a temp save (test mode, model off, NEXT_DIST_DIR=.next-playtest)
//      and waits until /api/game/state answers (scripts/lib/dev-server.mjs);
//   2. launches headless Chromium. Every page gets timezoneId "Asia/Shanghai" (without it the world adopts the
//      browser's zone, UTC in CI) and locale zh-CN;
//   3. collects page errors, console errors / warnings and HTTP >= 400 for every page;
//   4. writes screenshots + summary.md + summary.json to playtest-output/<name>/ (gitignored);
//   5. stops the server by process group, and exits NON-ZERO on a page error, an HTTP 5xx, a failed check or a crash
//      (console errors are listed; they fail the run only with PLAYTEST_STRICT=1).
//
// Environment:
//   PLAYTEST_LLM=env       use the model configured in the environment / .env.local instead of the rules engine
//   PLAYTEST_KEEP_DB=1     keep the temp save and print its path (open it with POLIS_DB_PATH=<path> npm run dev:test)
//   PLAYTEST_STRICT=1      console errors fail the run too
//   PLAYTEST_HEADED=1      show the browser window (needs a display; locally `npx playwright install chromium` once)
//   PLAYTEST_DIST_DIR      Next build dir (default .next-playtest); use another one to run two playtests at once
//   PLAYTEST_REAL_TIME=1   do not fast-forward a night-time start to 07:00 before the player is created
//
// WebGL in headless Chromium is software-rendered: GPU / SwiftShader warnings in the console are expected.

import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, apiClient, removeDbFiles, sleep, startDevServer, tempDir } from "../lib/dev-server.mjs";

const TZ = "Asia/Shanghai";
export const sec = (n) => n * 1000;

/** a `Failed to load resource` console error is the browser echoing an HTTP error we record anyway */
const ECHO_OF_HTTP = /^Failed to load resource/;
/** HTTP statuses that are not worth failing over (the browser asks for a favicon the app does not ship) */
const IGNORED_HTTP = [/\/favicon\.ico(\?|$)/];
const BENIGN_WARNING = /GPU stall|ReadPixels|SwiftShader|WebGL|GroupMarkerNotSet|automatic fallback to software/i;

export async function runPlaytest(name, opts, body) {
  const started = Date.now();
  const outDir = path.join(ROOT, "playtest-output", name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const llm = process.env.PLAYTEST_LLM === "env" ? "env" : "off";
  const tmp = tempDir(`polis-playtest-${name}-`);
  const dbPath = path.join(tmp, "polis.db");

  const problems = []; // everything seen: { kind, text, fatal, page }
  const seen = new Set();
  const checks = [];
  const story = [];
  const facts = {};
  const shots = [];
  const stepTimes = [];
  const contexts = [];
  const pages = [];
  let crash = null;
  let server = null;
  let browser = null;
  let shotNo = 0;

  const t0log = Date.now();
  const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0log) / 1000)).padStart(4)}s]`, ...a);

  function addProblem(kind, text, fatal, tag) {
    const key = `${kind}|${tag}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ kind, text, fatal, page: tag });
    if (fatal || kind === "console-error") log(`!! ${kind}${tag ? ` [${tag}]` : ""}: ${text.slice(0, 300)}`);
  }

  function watch(page, tag) {
    page.on("pageerror", (e) => addProblem("pageerror", e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e.message, true, tag));
    page.on("console", (m) => {
      const type = m.type();
      const text = m.text();
      if (type === "error" && !ECHO_OF_HTTP.test(text)) addProblem("console-error", text, process.env.PLAYTEST_STRICT === "1", tag);
      else if (type === "warning" && !BENIGN_WARNING.test(text)) addProblem("console-warning", text, false, tag);
    });
    page.on("response", (r) => {
      const status = r.status();
      if (status < 400) return;
      const line = `HTTP ${status} ${r.request().method()} ${r.url().replace(server.base, "")}`;
      if (IGNORED_HTTP.some((re) => re.test(r.url()))) return;
      addProblem("http", line, status >= 500, tag);
    });
    page.on("requestfailed", (r) => {
      const err = r.failure()?.errorText ?? "";
      if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(err)) return; // navigation / reload cancelled it
      addProblem("request-failed", `${r.method()} ${r.url().replace(server.base, "")} ${err}`, false, tag);
    });
  }

  const t = {
    name,
    outDir,
    dbPath,
    llm,
    facts,
    log,
    sleep,
    get base() {
      return server.base;
    },
    api: null,
    /** the live game state, straight from the API (what the HUD renders) */
    async state() {
      const r = await t.api("GET", "/api/game/state");
      if (r.status !== 200) throw new Error(`GET /api/game/state -> ${r.status}`);
      return r.json;
    },
    /** poll the API until predicate(state) is truthy */
    async waitState(predicate, { timeout = sec(20), label = "state", every = 250 } = {}) {
      const end = Date.now() + timeout;
      let s = await t.state();
      while (!predicate(s)) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
        await sleep(every);
        s = await t.state();
      }
      return s;
    },
    advance: (body) => t.api("POST", "/api/test/advance", body),
    /** record a soft assertion; a failed check fails the run but does not stop it */
    check(label, ok, detail) {
      checks.push({ label, ok: !!ok, detail: detail === undefined ? "" : String(detail) });
      log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? ` - ${detail}` : ""}`);
      return !!ok;
    },
    story(line) {
      story.push(line);
      log(line.split("\n")[0]);
    },
    fact(key, value) {
      facts[key] = value;
    },
    async newPage(o = {}) {
      const tag = o.tag ?? `page${pages.length + 1}`;
      const context = await browser.newContext({
        viewport: o.viewport ?? { width: 1440, height: 900 },
        timezoneId: TZ,
        locale: "zh-CN",
        ...(o.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
      });
      context.setDefaultTimeout(sec(20));
      context.setDefaultNavigationTimeout(sec(120));
      const page = await context.newPage();
      watch(page, tag);
      contexts.push(context);
      pages.push({ tag, page });
      page.polisTag = tag;
      return page;
    },
    async closePage(page) {
      const ctx = page.context();
      await ctx.close().catch(() => undefined);
      const i = contexts.indexOf(ctx);
      if (i >= 0) contexts.splice(i, 1);
    },
    /** numbered screenshot in the output dir; returns the file name */
    async shot(page, label) {
      const file = `${String(++shotNo).padStart(2, "0")}-${label}.png`;
      try {
        await page.screenshot({ path: path.join(outDir, file) });
        shots.push(file);
      } catch (err) {
        log(`screenshot ${file} failed: ${err.message}`);
      }
      return file;
    },
    /** run a named step: logs its duration, and on failure takes a screenshot of every open page before rethrowing */
    async step(label, fn) {
      const t1 = Date.now();
      log(`> ${label}`);
      try {
        const out = await fn();
        stepTimes.push({ label, ms: Date.now() - t1 });
        return out;
      } catch (err) {
        stepTimes.push({ label, ms: Date.now() - t1, failed: true });
        for (const { tag, page } of pages) {
          try {
            if (!page.isClosed()) await page.screenshot({ path: path.join(outDir, `FAILED-${String(label).replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}-${tag}.png`) });
          } catch {
            /* the page may be gone */
          }
        }
        err.message = `step "${label}": ${err.message}`;
        throw err;
      }
    },
  };

  try {
    log(`playtest "${name}" - ${opts.title ?? ""}`);
    log(`model: ${llm === "env" ? "ENV (the configured endpoint)" : "off (rules engine)"} - output: ${path.relative(ROOT, outDir)}`);
    log("starting `next dev` on a free port (first compile can take a minute)...");
    server = await startDevServer({ dbPath, llm });
    t.api = apiClient(server.base);
    log(`server ready at ${server.base} (pid ${server.pid}, db ${dbPath})`);
    // compile the page once up front so the browser never waits for it
    await fetch(server.base + "/", { signal: AbortSignal.timeout(sec(180)) }).catch(() => undefined);
    browser = await chromium.launch({ headless: process.env.PLAYTEST_HEADED !== "1" });
    await body(t);
  } catch (err) {
    crash = err;
    console.error(`\nPLAYTEST CRASH: ${err.stack || err}`);
  } finally {
    for (const c of contexts) await c.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    const serverLog = server ? server.log() : "";
    if (server) await server.stop();
    // server-side errors are part of the verdict: a 500-less run can still log `[sim] step failed`
    const serverErrors = serverLog
      .split("\n")
      .filter((l) => /\[sim\] step failed|\[world\] loop error|SqliteError|unhandled|TypeError|ReferenceError/i.test(l) && !/ECONNREFUSED/.test(l));
    for (const l of serverErrors.slice(0, 10)) addProblem("server-log", l.trim().slice(0, 300), true, "");
    if (process.env.PLAYTEST_KEEP_DB === "1") log(`kept the save: ${dbPath}  (open: POLIS_TEST_MODE=1 POLIS_DB_PATH=${dbPath} npx next dev)`);
    else {
      removeDbFiles(dbPath);
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  const failedChecks = checks.filter((c) => !c.ok);
  const fatal = problems.filter((p) => p.fatal);
  const ok = !crash && failedChecks.length === 0 && fatal.length === 0;
  const secs = Math.round((Date.now() - started) / 1000);

  const summary = {
    name,
    title: opts.title ?? "",
    ok,
    seconds: secs,
    model: llm === "env" ? "env" : "off",
    crash: crash ? String(crash.message || crash) : null,
    checks,
    problems,
    facts,
    steps: stepTimes,
    screenshots: shots,
  };
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  const md = [];
  md.push(`# playtest ${name}: ${ok ? "PASS" : "FAIL"}`);
  md.push("");
  md.push(`${opts.title ?? ""}  `);
  md.push(`${secs} s - model: ${summary.model} - ${shots.length} screenshots`);
  if (crash) md.push("", "## Crash", "", "```", String(crash.stack || crash).slice(0, 2000), "```");
  md.push("", "## Checks", "");
  for (const c of checks) md.push(`- ${c.ok ? "PASS" : "FAIL"} ${c.label}${c.detail && !c.ok ? ` - ${c.detail}` : ""}`);
  if (checks.length === 0) md.push("- (none)");
  md.push("", "## Errors and warnings", "");
  if (problems.length === 0) md.push("- none");
  for (const p of problems) md.push(`- ${p.fatal ? "FATAL " : ""}${p.kind}${p.page ? ` [${p.page}]` : ""}: ${p.text.replace(/\n/g, " ").slice(0, 400)}`);
  if (Object.keys(facts).length) {
    md.push("", "## Facts", "");
    for (const [k, v] of Object.entries(facts)) md.push(`- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  if (story.length) {
    md.push("", "## Story", "");
    for (const s of story) md.push(`- ${s.replace(/\n/g, "\n  ")}`);
  }
  md.push("", "## Steps", "");
  for (const s of stepTimes) md.push(`- ${s.failed ? "FAILED " : ""}${s.label}: ${(s.ms / 1000).toFixed(1)} s`);
  md.push("", "## Screenshots", "");
  for (const s of shots) md.push(`- ${s}`);
  writeFileSync(path.join(outDir, "summary.md"), md.join("\n") + "\n");

  console.log(`\n=== playtest ${name}: ${ok ? "PASS" : "FAIL"} (${secs} s) ===`);
  console.log(`checks: ${checks.length - failedChecks.length}/${checks.length} passed`);
  for (const c of failedChecks) console.log(`  FAIL ${c.label}${c.detail ? ` - ${c.detail}` : ""}`);
  const byKind = {};
  for (const p of problems) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  console.log(`problems: ${problems.length === 0 ? "none" : Object.entries(byKind).map(([k, n]) => `${k} x${n}`).join(", ")}${fatal.length ? `  (${fatal.length} fatal)` : ""}`);
  for (const p of fatal.slice(0, 8)) console.log(`  FATAL ${p.kind}: ${p.text.slice(0, 240)}`);
  console.log(`output: ${path.relative(ROOT, outDir)}/ (summary.md, summary.json, ${shots.length} screenshots)`);
  return { ok, summary };
}

// ───────────────────────────── small UI helpers shared by the scripts ─────────────────────────────

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function btn(page, re) {
  return page.getByRole("button", { name: re }).first();
}

export async function isVisible(page, re) {
  return btn(page, re)
    .isVisible()
    .catch(() => false);
}

export async function clickBtn(page, re, { timeout = sec(8), tap = false, force = false } = {}) {
  const b = btn(page, re);
  await b.waitFor({ state: "visible", timeout });
  if (tap) await b.tap({ force });
  else await b.click({ force });
}

/** the title screen: wait for its button (Phaser has to load first), optionally screenshot it, press it */
export async function passTitle(page, t, { tap = false, label = "title" } = {}) {
  const start = btn(page, /^(▶\s*)?(开始|继续)/);
  await start.waitFor({ state: "visible", timeout: sec(90) });
  const text = ((await start.textContent()) ?? "").trim();
  if (label) await t.shot(page, label);
  if (tap) await start.tap();
  else await start.click();
  await page.waitForTimeout(2500); // the title -> game fade
  return text;
}

/** dismiss the first-run coach marks and the welcome-back card, whatever is there */
export async function dismissCoach(page, { tap = false } = {}) {
  for (let i = 0; i < 8; i++) {
    const b = btn(page, /知道了|看看小镇/);
    if (!(await b.isVisible().catch(() => false))) break;
    if (tap) await b.tap({ force: true }).catch(() => undefined);
    else await b.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

export async function pressEscape(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

/** no horizontal page scroll: the document is never wider than the viewport */
export async function horizontalOverflow(page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
}
