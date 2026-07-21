# 观测演示:一次跑出多轮、多工具、subagent 与 skill 的会话

四步目标(规划 → 写码运行 → task 派 subagent → skill 生成横幅),worker 一轮全部做完、
小步提交,reviewer 一次验收;跑完导进 cannbot-insight,一条会话里 token/上下文增长、
工具调用(todowrite/bash/write/task/skill)、子代理轨迹全都有得看。

案例自带三样东西,`sample` 会一并装进项目:

- `ralph-worker.md` —— 案例专用 worker 提示词(演示目标,一轮跑完;默认 worker 是一轮一步)
- `.deveco/skills/demo-banner/SKILL.md` —— 项目技能,worker 用 `skill` 工具调用
- `.deveco/agent/stats-collector.md` —— `mode: subagent` 的子代理,worker 用 `task` 工具派它

```bash
../../ralph.sh init ~/ralph-smoke
../../ralph.sh sample smoke ~/ralph-smoke
../../ralph.sh run ~/ralph-smoke        # 约 2 分钟,收工自动导入观测
```

看到 `✅ DONE` 就说明链路是通的。如果卡住,按这个顺序查:

- `.ralph/plugin.log` **压根没生成** → 插件没被加载,检查 `.deveco/plugin/` 目录名(不是 `.opencode/`)
- 日志里 `reviewer session create FAILED: status=401` → shell 里设了 `DEVECO_SERVER_PASSWORD`,unset 掉
- `.ralph/serve.log` 里有报错 → server 没起来,多半是端口占用或模型凭证问题
- 循环转满仍不 DONE → 看 `.ralph/PROGRESS.md` 卡在哪一步;模型不会用 task/skill 工具时,
  会话里能看到它的挣扎,这本身就是很好的观测素材
