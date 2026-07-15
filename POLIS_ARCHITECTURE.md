# Polis 架构约束（每次开工前必读）

## 相关文件
- 详细工程决策与理由 → 见同目录 `POLIS_BUILD_DECISIONS.md`（七条关键决策：埋点三分法、偏好与原则分离、部署形态、时间尺度分离、回归测试纪律、进度节奏、subagent 并行拆分方法论）。遇到这几个话题前，先查那份文件，不要重新讨论已经拍板的事。

## LM Studio 环境
生产/开发默认：`LMSTUDIO_URL=http://192.168.0.105:1234/v1/chat/completions`
（局域网 GPU 机器）+ `LMSTUDIO_MODEL=qwen/qwen3.6-35b-a3b`（已写入 `.env.local`）。
所有蒸馏请求带 `reasoning_effort: "none"`（`lib/distillation.ts` 已加），
在 Qwen 上稳定关闭隐藏推理（reasoning_content 恒为 0，热身后每次约 1.5 秒）。
本机 127.0.0.1 的 `google/gemma-4-e4b` 是备选/对照——它是推理型模型，同样
参数下推理泄漏率高、耗时 6-24 秒，蒸馏合规率明显更差（详见
`POLIS_BUILD_DECISIONS.md` 决策⑨⑩的对照实验数据）。换模型前先跑
`npm run test:distillation-regression` 看真实合规率，不要只凭手测判断。

## 技术栈（已定死，不得更换，不得添加新框架）
- 框架：Next.js（React + Node 后端二合一）
- 数据库：SQLite（better-sqlite3）→ 未来 PostgreSQL
- 游戏渲染：Phaser（烙印+自主性验证通过后再引入，不占用独立 Phase）
- 实时通信：轮询（Phase 0-3 全程）；WebSocket 留到 Phase 4+
- LLM：锁 OpenAI 兼容接口，引擎独立于 llm-service/（Phase 2 开始接）
- LLM 引擎开发期用 LM Studio；禁止用 Ollama

## 部署形态（已定死，不得改用 serverless）
Polis 是"永远在跑的世界"，不是"响应请求的网站"——世界时钟、夜间批处理、
本地 LLM 服务都需要长驻进程。**禁止部署在 Vercel/Netlify 等 serverless 平台**
——"按请求唤醒"的模型与"持续运转的世界"结构性冲突，不是配置能解决的。
内测部署 = 自己的 VPS/服务器 + Docker（docker-compose 三件套：前端/后端/DB，
LLM 引擎独立进程，不进容器）。现有 `lib/worldClock.ts` 的 `setInterval` +
`globalThis` 单例写法，在此前提下不需要改。详见 `POLIS_BUILD_DECISIONS.md` 决策③。

## ⚠️ 已知范围限制：当前只支持单一玩家（内测前必须解决）
所有 API（`/api/player/*`、`/api/decisions/*`、`/api/principles`、`/api/wavering/*`）
都直接查询全局唯一的 `is_player = 1` 行——**整个部署只能存在一个玩家 Agent**。
第二个人调用 `POST /api/player/create` 会永远收到 409，且所有查询接口返回的
都是同一个人的数据。**这是当前 Phase 0-3 单机验证阶段的刻意简化，不是遗漏，
但在真正开始 50-100 人内测之前，这是一个硬性部署阻塞项**——需要引入真实的
玩家账号/会话概念（如何做、何时做，是内测筹备阶段单独要决定的架构问题，
现在不做，只是明确记录这个边界，不要在没人提醒的情况下被当成"能内测了"）。

## 核心架构原则
- LLM 无状态：Agent 身份全在数据库（原则/记忆/关系/状态），
  LLM 只是被调用的语言器官。换模型不换灵魂。
- 约 92% 的 Agent 行为走规则引擎（零 LLM）；只有蒸馏、
  拒绝解释等少数动作调 LLM。
- 值钱的东西放在服务器/数据库（用户碰不到），不做代码加密。

## Phase 路线（严格按《V1开发落地文档》编号，不得跳跃或提前）
- Phase 0：世界时钟 + 任务底座 + Scrip 账本（纯规则，无 AI）✅ 已完成并验证
- Phase 1：Decision Moment 生成器 + 种子 NPC 档案 + 首会话三岔路 ✅ 已完成并验证
- Phase 2：烙印（蒸馏 + 存储 + 注入 + 衰减 + 动摇事件）——LLM 第一次接入 ✅ 已完成并验证
- Phase 3：自主性引擎（偏离判定 + 解释门 + 强制执行 + Trust 变动）← 当前
- Phase 4：夜间摘要 + 埋点看板 + Day7 问卷
- 地图/Phaser：不占用独立 Phase，全程用文字/色块占位，Phase 3 验证通过后再投入美术
- 冻结（现在绝不碰）：上链、$NOM、DePIN、碑文、多城邦

## 铁律
- 不提前实现后续 Phase 的功能
- 遇到需要引入新库/新技术的选择，先问人类，不自作主张
- 每个任务完成后停下来，说明如何验证，等人类确认再继续
