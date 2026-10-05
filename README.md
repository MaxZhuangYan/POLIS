# Polis

单人 AI 社会模拟原型。你是一个**守护灵**：没有身体，也不能操控你的 Agent。它在像素小镇里和 6 位 AI 居民
一起接活、合作、违约、记仇、借钱。它拿不定主意时会低声问你，它会记住你说过的话，但它有自己的立场：
证据站在它那边时，它会对你说“不”。

试玩说明见 **[doc/PLAY.md](doc/PLAY.md)**；给 AI 编程代理（和人）的工作手册见 **[AGENTS.md](AGENTS.md)**；
地图怎么改 / 怎么新建见 [doc/MAPS.md](doc/MAPS.md)；架构与取舍见 [POLIS_ARCHITECTURE.md](POLIS_ARCHITECTURE.md)、
[POLIS_BUILD_DECISIONS.md](POLIS_BUILD_DECISIONS.md)。

第一周之后：六位居民的长期矛盾、默契（猜它会怎么做）、记忆槽位与沉睡的烙印、称号与声望解锁、公告栏、
日结账本、每周的档案卷（含下周看点）与三词问卷、带出处的传闻、居民各自攒钱置业与互相借贷。

## 运行

```bash
npm install
npm run dev:test     # 测试模式：带标注的“测试快进”，存档 ./polis-test.db（推荐第一次试玩）
npm run dev          # 正式规则：1 tick = 现实 1 小时，存档 ./polis.db
```

打开 http://localhost:3000 。生产构建：`npm run build && npm run start:test`（或 `npm start`）。

## 技术栈

| 层 | 用的是什么 |
|---|---|
| 世界与规则 | Next.js 15 App Router 的 API 路由 + better-sqlite3（WAL、只做增量迁移）。服务端常驻 10 秒循环，按整点补跑 tick（停机后最多补 96 个） |
| 游戏客户端 | Phaser 3.90：Boot → Preloader（asset pack）→ Town（含标题模式）+ 常驻 AudioScene；React 19 HUD 通过 EventBus 与场景通信 |
| 地图 | Tiled `.tmj`（ground / paths / water / deco / buildings / collision / above + 对象层 locations / door / home_door / interactable），由 `scripts/build-town-map.mjs` 生成，tileset 经 `scripts/extrude-tileset.py` 防接缝 |
| 寻路 | 二叉堆 A*（octile 启发、按地块 cost 加权、禁止斜穿墙角、路径平滑、LRU 缓存），`npm run test:pathfinding` 校验全部地点互通 |
| 美术 / 音频 / 字体 | Ninja Adventure（CC0）的 tileset、角色、头像、BGM 与音效；Fusion Pixel 12px 简中像素字体（OFL）。署名见 `public/assets/**/CREDITS.md` |
| 模型 | 任意 OpenAI 兼容端点（可选）。不可用时整条链路自动走规则引擎 + 模板，界面标“离线模式（规则引擎）” |

## 环境变量

| 变量 | 作用 |
|---|---|
| `POLIS_TEST_MODE=1` | 打开测试快进（`/api/test/advance`、左下角面板、`/dev/town`）。正式模式下这些返回 403 / 404 |
| `POLIS_DB_PATH` | 存档路径，默认 `./polis.db` |
| `POLIS_LLM_URL` / `POLIS_LLM_MODEL` / `POLIS_LLM_API_KEY` | 模型端点（OpenAI 兼容 `/v1/chat/completions`）。兼容旧名 `LMSTUDIO_URL` / `LMSTUDIO_MODEL`；默认探测 `http://127.0.0.1:1234` |
| `POLIS_LLM=off` | 强制离线（规则引擎），不探测模型 |
| `POLIS_TZ` | 世界时区的兜底值（创建 Agent 时优先用浏览器时区），默认 `Asia/Shanghai` |
| `POLIS_LLM_CONCURRENCY` | 同时发给模型的请求上限，默认 3（托管端点常有并发限制） |
| `NEXT_PUBLIC_POLIS_MAP` | 用哪张注册过的地图（`app/components/town/maps.ts`），构建时写入 |
| `NEXT_DIST_DIR` | 构建输出目录（让多个构建并存，测试脚本用） |

## 检查

```bash
npm test                        # 一键：类型 → lint → 选择回归 → 寻路 → 地图校验 → 3 天模拟
npm run build
npm run test:sim -- careful 7   # 无界面整局模拟（careful | bold | none=不干预对照，天数；≥14 天附长线报告）；SIM_LLM=env 用 .env.local 的模型
npm run playtest:new            # 真浏览器：新玩家第一局（截图在 playtest-output/new/）
npm run playtest:week -- bold 9 # 真浏览器：一周多，所有动词和长线面板，最后测「新的存档」
npm run scenario -- d5-bait     # 造一个停在某个剧情节点的存档，再用 npm run dev:test 打开
npm run map:check               # 地图校验（doc/MAPS.md）
node scripts/llm-report.mjs <db>        # 模型调用 / 校验门 / 兜底占比
npm run test:distillation-regression    # 需要真实模型；没有模型时只输出“未连接”的报告
```

本地第一次跑浏览器试玩前执行一次 `npx playwright install chromium`。CI（`.github/workflows/ci.yml`）在每次 push 跑 `npm test` 和构建；浏览器试玩可以在 Actions 页手动触发。

## 不做的事

没有自由聊天，没有饥饿 / 孤独 / 心情条，没有战斗、上链、代币、DePIN、多城邦或多人账号。
