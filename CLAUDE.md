@AGENTS.md

## Claude Code 补充

- 用中文回复项目负责人，技术名词保留英文。
- 改动后先跑 `npm test`；改了界面再跑 `npm run playtest:new`，并且真的打开 `playtest-output/new/` 里的截图看一遍。
- 子代理做并行工作时用 worktree 隔离；合并回来前在主检出里跑一遍 `npm test`。
- 提交信息结尾按会话要求附署名行；不要在提交、代码或文档里写模型名称。
