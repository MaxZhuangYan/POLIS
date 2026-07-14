
第二段：在项目根目录建一个 POLIS_ARCHITECTURE.md，让 Claude Code 始终记得约束
这个文件的作用是：以后每次开新对话让 Claude Code 干活，让它先读这个，就不会忘记架构、不会跑偏、不会重复纠结已定的事。
把下面内容存成项目根目录的 POLIS_ARCHITECTURE.md：

# Polis 架构约束（Claude Code 每次开工前必读）

## 技术栈（已定死，不得更换，不得添加新框架）
- 框架：Next.js（React + Node 后端二合一）
- 数据库：SQLite（better-sqlite3）→ 未来 PostgreSQL
- 游戏渲染：Phaser（Phase 1 才引入，Phase 0 不用）
- 实时通信：Phase 0-1 用轮询；WebSocket 留到 Phase 2+
- LLM：锁 OpenAI 兼容接口，引擎独立在 llm-service/（Phase 1 才接）
- LLM 引擎开发期用 LM Studio；禁止用 Ollama

## 核心架构原则
- LLM 无状态：Agent 身份全在数据库（原则/记忆/关系/状态），
  LLM 只是被调用的语言器官。换模型不换灵魂。
- 约 92% 的 Agent 行为走规则引擎（零 LLM）；只有蒸馏、
  拒绝解释等少数动作调 LLM。
- 值钱的东西放在服务器/数据库（用户碰不到），不做代码加密。

## Phase 路线（严格按顺序，不得跳跃或提前）
- Phase 0：世界时钟 + 任务底座 + Scrip 账本（纯规则，无 AI）← 当前
- Phase 1：接入蒸馏（决策→原则）+ 地图（Phaser + Tiled）
- Phase 2：接入注入（原则→决定）+ 解释门 + Decision Moment
- Phase 3：FTUE 七日体验 + 完整循环
- 冻结（现在绝不碰）：上链、$NOM、DePIN、碑文、多城邦

## 铁律
- 不提前实现后续 Phase 的功能
- 遇到需要引入新库/新技术的选择，先问人类，不自作主张
- 每个任务完成后停下来，说明如何验证，等人类确认再继续