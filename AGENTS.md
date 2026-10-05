# AGENTS.md — 给 AI 编程代理（和人）的工作手册

Polis 是一个单人 AI 社会模拟原型：玩家是**守护灵**，没有身体，不能操控自己的 Agent。Agent 和 6 位居民（Mira / Sol / Tao / Iris / Kade / Nova）在像素小镇里接活、合作、违约、记仇、借钱；它拿不定主意时问玩家，记住玩家的话（烙印），也会在证据站在它那边时说「不」。

玩家的四个动词：**回应岔路**、**回应质问**、**强制执行**、**留言**。另有被动 / 轻交互：明信片、偏离反馈、默契（猜它会怎么做）、公告栏、账本、三词问卷。

## 不做的事（产品红线）

自由聊天；饥饿 / 孤独 / 心情等需求条；战斗；上链 / 代币 / DePIN；多城邦；多人账号。新功能如果需要其中任何一个，先停下来问。

## 必须守住的规则（不变量）

1. **叙事只来自数据库里的事实。** 明信片、动态、回访台词、传闻、档案卷里的每个人名、数字、事件都必须对应真实的行。新内容写「发生了什么」时，同时写下那件事本身（状态变化 + 记忆 / 事件）——`lib/consequences.ts` 的 Steps 就是为此设计的。不许编造过去发生的交易、亏损、违约或关系。
2. **每个模型接口都有规则 / 模板兜底，每个产物都标 `source`。** 模型输出要过校验门（判定：引用的原则 id 必须在注入集合里、不许出现事实里没有的数字；明信片润色：不许新增数字或人名、必须保留引用的原则）。没有模型时游戏完整可玩，界面标「离线模式（规则引擎）」。
3. **游戏时间只用 `simNow()` / `atSimTime()`（`lib/clock.ts`）。** 游戏逻辑里不许用 `Date.now()`。测试快进（`POLIS_TEST_MODE=1`）只移动时钟偏移，所有规则跟着走，界面始终标「已测试快进 X 小时」。
4. **数据库只做加法迁移。** 新列用 `lib/db.ts` 的 `addColumns`，新表用 `CREATE TABLE IF NOT EXISTS`；不删列、不改类型。老存档必须能继续玩。
5. **岔路有频率上限**：同时 ≤3 个待回应、间隔 ≥4 小时、每天 ≤3 个、同一模板 48 小时一次、24 小时不回由它按原则自决（`lib/decisionMoments.ts`）。新的岔路来源都要走 `canAsk()`。Agent 自己能决定时（`canDecideAlone()`）就不问。
6. **明信片不写收益率**；数字在账本（日结）里，两者不同屏。
7. **密钥只放 `.env.local`**（已被 gitignore）。不打印、不提交、不写进文档或提交信息。

## 架构地图

```
instrumentation.ts            服务启动 → lib/sim.ts startWorld()（10 秒循环，按整点补跑 tick，停机后最多补 96 个）
lib/
  clock.ts         模拟时钟（真实时间 + 持久偏移）、时区、日界
  db.ts            SQLite schema + 加法迁移 + 种子数据；resetSave()（新的存档，留一份 .bak）
  content.ts       NPC 档案、任务模板、地点名、常量（指令券 30、启动金 100、每日留言 3）
  records.ts       事件 / 记忆 / 说话气泡 / 关系 / 旧怨 / 账本 / 声望 / 信任 / 埋点 的底层写入
  sim.ts           每个 tick：作息、计划、找活、提议合作、违约、傍晚相遇（含传闻）、D2–D7 节拍、夜间明信片
  tasks.ts         任务生命周期、结算（成败、5% 手续费销毁）、两段式协作、终检 / 还款等延迟事件
  consequences.ts  「后果即数据」：Steps（关系、转账、旧怨、记忆、事件、新任务、延迟、概率分支）
  decisionMoments.ts 岔路：模板、上限、自决、选项效果（含 kind:"steps"）、24h 过期自决
  dilemmas.ts      六位居民的长期矛盾 + 默契（Agent 傍晚前自己拿主意，玩家可以先猜）
  autonomy.ts      判定器：照做 / 调整 / 拒绝（模型 + 解释门，或规则判定），强制执行与信任
  distillation.ts  选择 → 烙印（模型或兜底句），同立场合并强化
  imprints.ts      记忆槽位（5 格，200/400/800 扩展）、沉睡 / 唤醒
  principleEngine.ts 原则检索、衰减、立场 → 性格偏移、引用、动摇（质问）
  notes.ts         留言分类、在明信片里回应
  postcards.ts     夜间明信片（只用事实）、D7 七日回顾；模型润色（校验后替换）
  progression.ts   称号 / 声望解锁、事实型外号、公告栏、日结账本、档案第 N 卷、三词问卷
  gossip.ts        傍晚居民聊起 Agent 的真事，听者的看法 ±1
  llm.ts           OpenAI 兼容客户端：并发上限、预热、thinking 输出剥离、调用统计
  snapshot.ts      GET /api/game/state 的完整快照（GameSnapshot，见 types.ts）
  types.ts         前后端契约（快照、视图类型）
app/api/**/route.ts            每个动词一个 POST；读只有 /api/game/state
app/page.tsx                   轮询快照（2 s，隐藏时 15 s）+ 实现 GameActions
app/components/
  GameShell.tsx    React HUD 的总装：标题、弹窗优先级、按键、提示、卡片
  actions.ts       GameActions 接口（UI 不自己 fetch）
  hud/             TopHud / SidePanels / Modals / Overlays / GameScreens / Progress（长线玩法面板）
  game/            Phaser：Boot → Preloader → Town（+标题模式）+ Audio；EventBus；keys / keymap
  town/            maps.ts 地图注册表、tiled.ts 地图解析、pathfinding.ts A*、PhaserTown.tsx
  devFixture.ts    /dev/town 的假数据（只在开发 / 测试模式）
public/assets/                 tileset、地图、角色、头像、UI 边框、音频（授权见各目录 CREDITS.md）
```

数据流：`tick（服务端）→ DB → snapshot → 客户端轮询 → GameShell → EventBus → TownScene`；玩家动作：`GameActions → POST → DB → 立即重新拉快照`。

## 命令

```bash
npm run dev:test          # 测试模式开发服务器（存档 ./polis-test.db，左下角有测试快进）
npm run dev               # 正式规则（存档 ./polis.db）
npm test                  # 一键检查：类型 → lint → 选择回归 → 寻路 → 地图校验 → 3 天模拟
npm run typecheck && npm run lint
npm run test:choose-bugs  # 选择路由的回归（临时库，离线）
npm run test:pathfinding  # 路网
npm run map:check         # 地图校验（doc/MAPS.md）
npm run test:sim -- careful 7     # 无界面整局模拟；bold | careful；SIM_LLM=env 用 .env.local 里的模型；SIM_KEEP_DB=1 保留存档
node scripts/llm-report.mjs <db>  # 模型调用、校验门、模型 vs 兜底占比
npm run playtest:new      # 真浏览器：新玩家第一局
npm run playtest:week -- bold 9   # 真浏览器：一周多，所有动词和长线面板
npm run scenario -- d5-bait       # 造一个停在某个剧情节点的存档：fresh | d1-forks | d2-morning | d5-bait | week2
npm run build             # 生产构建
```

**测试梯子**：改了逻辑至少跑 `npm test`；改了 UI 跑 `npm run playtest:new` 并**看截图**（`playtest-output/<name>/`）；改了节奏 / 内容跑 `test:sim` 的 bold 和 careful 各 7–14 天，读 STORY 段落是否通顺、是否和数据一致。

## 配方

**加一位居民**：`lib/content.ts` 的 `NPCS`（traits、核心原则、公开档案、homeSlot、sprite）+ `SEED_RELATIONS`；地图要有对应的 `home_door` slot；`public/assets/town/asset-pack.json` 里有它的角色和头像；`lib/dilemmas.ts` 可以给他写一条长期矛盾。

**加一种任务**：`lib/content.ts` 的 `TASK_TEMPLATES`（sector、mode routine/skilled/coop、reward、duration、successRate、seed 领域、可选 `dilemma`、可选 `minRep` 声望门槛）。成败后果写在 `TaskMeta.onSuccess / onFail / onDefault`（Steps）里。

**加一种岔路 / 居民难处**：优先在 `lib/dilemmas.ts` 里照现有六个写一个 builder：前提从真实的行里读（或在 `setup()` 里当场创建真实的行），每个选项有 `stance`（领域 + 方向，决定烙印推动的方向）、`fallbackPrinciple`（离线时的烙印句）、`effect: { kind: "steps", steps: [...] }`。把它加进 `BUILDERS`。频率上限会自动生效。

**加一个模型接口**：走 `chat()`（`lib/llm.ts`），给 `kind`、合理的 `timeoutMs`（玩家在等的 ≤15 s）；先 `llmAvailable()`；输出过校验（只许用注入的事实）；失败就用规则 / 模板，并把 `source` 写进数据；`node scripts/llm-report.mjs` 里能看到它。

**加一个 HUD 面板 / 弹窗**：组件放 `app/components/hud/`，样式用 CSS module 和 `GameShell.module.css` 里的 token（`--paper`、`--ink`、`--frame-paper`…）；弹窗用 `ModalFrame`；打开方式加进 `GameShell` 的 `UserModal` 和按键（`game/keymap.ts` 的 `KEY_HELP` 同步）；动作加进 `actions.ts` + `app/page.tsx` + `devFixture.ts`。

**加音效 / 音乐**：文件放 `public/assets/audio/`（ogg + mp3），登记到 `asset-pack.json` 的 `audio-core`，名字加进 `game/keys.ts`；BGM 是流式播放（`game/audio.ts`）。

**改地图 / 加地点**：见 [doc/MAPS.md](doc/MAPS.md)。

**加数据库列**：`lib/db.ts` 里对应表的 `addColumns`，给默认值；读的时候兼容旧行（可能为 NULL）。

## 坑（都真的踩过）

- 设了 `NEXT_DIST_DIR` 的构建会改写 `tsconfig.json` 和 `next-env.d.ts`：提交前 `git checkout tsconfig.json next-env.d.ts`（`scripts/lib/dev-server.mjs` 会自动还原）。
- `pkill -f <pattern>` 会杀掉命令行里也含这个 pattern 的你自己的 shell：按 PID / 进程组杀。
- 无头浏览器默认 UTC：Playwright 必须 `timezoneId: "Asia/Shanghai"`，否则世界会跟着变成 UTC（Agent 早上 8 点在睡觉）。
- Next 会自动加载 `.env.local`：要确定性的离线运行就设 `POLIS_LLM=off`（测试脚本默认如此）。
- 无头 Chromium 的 WebGL 是软件渲染：控制台的 GPU / SwiftShader 警告是正常的。
- 托管模型有冷启动（30–60 秒）和并发上限：`llmAvailable()` 在预热完成前返回 false，这段时间走规则引擎。
