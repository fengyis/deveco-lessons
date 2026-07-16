# deveco 0.1.1 hook 行为探针实测记录

目的：opencode-goal-plugin 移植到 DevEco Code 前，先用最小探针插件（`/tmp/goal-probe`，未提交）实测
四个之前只能从二进制字符串猜测的运行时行为，作为后续改造任务（尤其 Task 7 冒烟脚本）的事实依据。

环境：
- `deveco --version` → `0.1.1`（`/opt/homebrew/bin/deveco`）
- 探针插件文件见 `lesson3-goal-plugin/docs/probe-notes.md` 本文的 Step 1 代码块，与
  `/Users/fengyi/Workspace/others/deveco-lessons/.superpowers/sdd/task-2-brief.md` 中给出的一致
- server: `deveco serve --port 4098`（`unset DEVECO_SERVER_PASSWORD` 后启动，未设密码，日志打印
  `Warning: DEVECO_SERVER_PASSWORD is not set; server is unsecured.`）
- 会话目录：`/tmp/goal-probe`，创建会话得到 `SID=ses_094fa725bffe12j1rAqQXKnj2n`

---

## 问题 (1)：`command.execute.before` 的 input 形状与 output 用法

**Input 形状**（`.probe.log` 原文）：

```
2026-07-16T13:02:45.654Z command.execute.before input={"command":"probe","sessionID":"ses_094fa725bffe12j1rAqQXKnj2n","arguments":"hello"} outputKeys=["parts"]
```

即 `input = { command: string, sessionID: string, arguments: string }`，与 opencode 插件契约一致。
`output` 进来时已经带有 `parts` 这个 key（`outputKeys=["parts"]`），说明 host 会预先给一个可写的
`output.parts` 容器。

**Output 用法 —— 关键发现（与预期不符）**：

探针里我们在 hook 内强制把 `output.parts` 覆写为 `[{type:"text", text:"probe intercepted"}]`，
期望这条命令的最终回复变成 "probe intercepted"（这正是 `goal-plugin.js` 里
`"command.execute.before"` hook（约在 `template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js:3174`）
的用法模式——通过设置 `output.parts` 来短路/替换命令执行，避免真的调用模型）。

但实测：命令触发之后依然发生了完整的一轮真实模型对话（`chat.message` → 一串
`message.part.delta` → `session.idle` → `command.executed`），最终会话消息里的实际回复是模型生成的
`"Hello! How can I help you today?"`，**不是**我们在 hook 里设置的 `"probe intercepted"`。取
`GET /session/$SID/message` 得到的最后一条消息内容（节选）：

```json
{
  "parts": [
    { "type": "step-start", ... },
    { "type": "reasoning", "text": "The user just said \"hello\". I should respond concisely" },
    { "type": "text", "text": "Hello! How can I help you today?" },
    { "type": "step-finish", "reason": "stop", ... }
  ]
}
```

**结论**：在 deveco 0.1.1 上，`command.execute.before` 的 `output.parts` 赋值**没有**实际短路/替换
命令的执行结果——hook 触发了、`input` 参数拿到了、但对 `output` 的修改被后续的正常模型调用流程覆盖或
忽略了。这对 goal-plugin 的核心机制（`/goal status`、`/goal history` 等只读子命令依赖
`output.parts` 直接返回文本、不经过模型）是一个需要在适配任务里重点验证/绕过的风险点——迁移后
可能需要换一种方式短路命令（例如直接在 hook 里抛错阻止，或者确认是否有别的字段名/别的时机能生效）。

---

## 问题 (2)：有没有 HTTP 端点能触发命令执行（供 Task 7 冒烟用）

**答案：有。`POST /session/{id}/command?directory=...` 能触发。**

请求：

```
curl -si -X POST "http://127.0.0.1:4098/session/$SID/command?directory=/tmp/goal-probe" \
  -H 'Content-Type: application/json' -d '{"command":"probe","arguments":"hello"}'
```

响应（首行 + 关键头）：

```
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 1392
```

`.probe.log` 立即出现 `command.execute.before` 记录（见问题 1 的原文摘录），说明这个端点确实走到了
插件的 `command.execute.before` hook，并触发了一整轮真实的模型对话（`session.idle` /
`command.executed` 事件收尾）。

因此没有必要再尝试第二条路径（把 `/probe hello` 当普通消息文本发到 `/session/{id}/message`）——
第一个端点已经是非 404 的正确答案，Task 7 的冒烟脚本可以直接用
`POST /session/{id}/command?directory=<dir>` 触发命令验证链路，不需要绕道消息接口。

注意：该请求会真实调用一次 LLM（约 8 秒内完成，`tokens.input=12017 tokens.output=25`），冒烟脚本要为此
预留时间和预算。

---

## 问题 (3)：插件实例何时加载（server 起时 / 首个会话建时）

**答案：首个会话创建时加载，不是 server 启动时。**

server 启动后（`sleep 5` 之后）检查 `.probe.log`：

```
=== .probe.log after server start (before session) ===
cat: /tmp/goal-probe/.probe.log: No such file or directory
(no .probe.log yet)
```

`serve.log` 只有：

```
Warning: DEVECO_SERVER_PASSWORD is not set; server is unsecured.
deveco server listening on http://127.0.0.1:4098
```

随后调用 `POST /session?directory=/tmp/goal-probe` 创建会话，`SID=ses_094fa725bffe12j1rAqQXKnj2n`，
再看 `.probe.log`：

```
2026-07-16T13:02:33.884Z plugin loaded
2026-07-16T13:02:33.900Z event session.created
```

`plugin loaded` 出现在 `session.created` 之前几毫秒（同一时间点附近，插件初始化是创建会话流程的一部分），
且是文件里的第一行——`.probe.log` 文件本身也是这时才第一次被创建。这确认插件的 server 工厂函数
（`export const Probe = async ({ client, directory }) => {...}`）在 **server 进程启动时不会执行**，
而是在**第一个会话被创建时**才被实例化执行一次。这意味着依赖插件全局状态初始化的逻辑（比如
goal-plugin 里的运行时单例）不能假设"server 一起来就绪"，需要等到有会话时才真正生效——这对
Task 7 冒烟脚本的"先起 server 再建会话"顺序是必须遵守的。

---

## 问题 (4)：`session.prompt`（即 `POST /session/{id}/message`）不带 `query.directory` 是否可用

**答案：可用。** 会话已经在创建时绑定了 `directory=/tmp/goal-probe`，之后同一会话再发消息，即使
URL 上不带 `?directory=...`，请求依然成功（HTTP 200），并且服务端用的仍是会话原本记录的工作目录。

请求（不带 `directory` 查询参数）：

```
curl -s -X POST "http://127.0.0.1:4098/session/$SID/message" \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"say hi"}]}'
```

响应（节选，`head -c 500`）：

```
{"info":{"parentID":"msg_f6b063c47001W7M38DtPApN0ft","role":"assistant","mode":"build","agent":"build",
"path":{"cwd":"/private/tmp/goal-probe","root":"/"},"cost":0,
"tokens":{"total":12077,"input":12031,"output":46,...},
"modelID":"GLM-5.1","providerID":"deveco",...
```

再次确认 HTTP 状态码：

```
curl -s -o /dev/null -w "%{http_code}\n" ... → 200
```

响应体里 `path.cwd` 是 `/private/tmp/goal-probe`（`/tmp` 在 macOS 上是 `/private/tmp` 的符号链接），
与会话创建时传入的 `directory=/tmp/goal-probe` 一致，说明 host 是从**会话记录**里取目录，而不是要求
每次请求都显式带 `query.directory`。

**结论/边界**：这个结论仅对"会话已经用某个 directory 创建过"的情况成立。没有测试"会话创建时也不带
directory"（brief 未要求，创建会话的两次调用都显式带了 `?directory=/tmp/goal-probe`），因此不能推广
为"session.prompt 完全不需要 directory 概念"，只能确认"会话建立后，后续 prompt 调用可以省略
query.directory"。

---

## 文件变更

- 新增：`lesson3-goal-plugin/docs/probe-notes.md`（本文件）
- 临时未提交：`/tmp/goal-probe/`（含 `deveco.json`、`.deveco/plugin/probe.ts`、`serve.log`、
  `.probe.log`，按任务要求保留在本机供后续调试参考，不纳入 git）

## 收尾

- `lsof -ti:4098 | xargs kill -9` 已执行，server 已停止
- `/tmp/goal-probe` 目录未删除（按 brief 要求保留）
