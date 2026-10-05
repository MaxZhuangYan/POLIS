# Polis

单人 AI 社会模拟原型。你是一个**守护灵**：没有身体，也不能操控你的 Agent。它在像素小镇里和 6 位 AI 居民
一起接活、合作、违约、记仇、借钱。它拿不定主意时会低声问你，它会记住你说过的话，但它有自己的立场：
证据站在它那边时，它会对你说“不”。

试玩说明见 **[doc/PLAY.md](doc/PLAY.md)**；架构与取舍见 [POLIS_ARCHITECTURE.md](POLIS_ARCHITECTURE.md)、
[POLIS_BUILD_DECISIONS.md](POLIS_BUILD_DECISIONS.md)。

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
| `NEXT_DIST_DIR` | 构建输出目录（让多个构建并存，测试脚本用） |

## 检查

```bash
npm run typecheck
npm run lint
npm run build
npm run test:choose-bugs        # 选择路由回归（临时库、离线）
npm run test:sim -- careful 7   # 7 天无界面整局模拟（careful | bold），断言事件链与明信片
npm run test:pathfinding        # 路网连通性与 A* 正确性
npm run test:distillation-regression   # 需要真实模型；没有模型时只输出“未连接”的报告
```

## 不做的事

没有自由聊天，没有饥饿 / 孤独 / 心情条，没有战斗、上链、代币、DePIN、多城邦或多人账号。
