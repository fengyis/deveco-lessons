# 冒烟：30 秒验证整条链路通不通

最小的目标（建一个 hello.txt 并提交），用来在真正干活之前确认环境是好的：
模型凭证、插件加载、worker 干活、reviewer 裁决、DONE 落盘。

第一次用 ralph loop、或者换了模型/换了机器，先跑这个。

```bash
../../ralph.sh init ~/ralph-smoke
../../ralph.sh sample smoke ~/ralph-smoke
../../ralph.sh run ~/ralph-smoke
```

看到 `✅ DONE` 就说明链路是通的。如果卡住，按这个顺序查：

- `.ralph/plugin.log` **压根没生成** → 插件没被加载，检查 `.deveco/plugin/` 目录名（不是 `.opencode/`）
- 日志里 `reviewer session create FAILED: status=401` → shell 里设了 `DEVECO_SERVER_PASSWORD`，unset 掉
- `.ralph/serve.log` 里有报错 → server 没起来，多半是端口占用或模型凭证问题
