# deveco 0.1.1 hook 行为探针实测记录

目的：opencode-goal-plugin 移植到 DevEco Code 前，先用最小探针插件（`/tmp/goal-probe`，未提交）实测
四个之前只能从二进制字符串猜测的运行时行为，作为后续改造任务（尤其 Task 7 冒烟脚本）的事实依据。

环境：
- `deveco --version` → `0.1.1`（`/opt/homebrew/bin/deveco`）
- 探针插件文件见 `lesson2-goal-plugin/docs/probe-notes.md` 本文的 Step 1 代码块，与
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
`"Hello! How can I help you today?"`，**不是**我们在 hook 里设置的 `"probe intercepted"`。

用于核实的请求：

```
curl -s "http://127.0.0.1:4098/session/$SID/message"
```

（原始探针记录没有保留这次调用当时用的确切 curl flags，无法逐字复原；上面是根据同一探针会话里其它
GET/POST 调用的一致写法反推的等价形式，唯一确定的是端点和方法本身：`GET /session/{id}/message`。）
该端点返回的是**数组**——这一点本次补充复核时用 `sqlite3 -readonly` 直接读了 deveco 落盘的
`~/.local/share/deveco/deveco.db`（只读查询，未启动任何 server）得到了确认：探针命令这一轮在
`message` 表里对应恰好 2 条记录（1 条 `user` + 1 条 `assistant`，详见下方"追加核实"小节），因此
"最后一条消息"就是取数组最后一个元素，即该 assistant 消息。其内容（节选）：

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

**关于"output.parts 只是重写了发给模型的 prompt（而非替换最终响应）"这一替代解释**——这条解释在本轮 review
中被明确提出，且有实际依据：`goal-plugin.js` 自身的 `tool.execute.before` hook（约在
`template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js:3166-3173`）在只读子命令设置完
`output.parts` 之后仍会去阻止工具调用（注释是"for the routed model turn"），这暗示上游作者预期短路
之后模型轮次依然会跑——这个解释值得认真排除，不能想当然地否定。

上面引用的模型 reasoning trace 其实已经是排除它的证据：探针命令的 `arguments` 是 `"hello"`，hook 把
`output.parts` 覆写成了 `"probe intercepted"`；如果这次 mutation 真的重写了发给模型的 prompt，模型的
reasoning 应该会围绕 "probe intercepted" 展开，但实际记录是
`"The user just said \"hello\". I should respond concisely"`——模型显然看到的还是原始的 `"hello"`，
完全不知道 `output.parts` 被改写过。

为了不只依赖"reasoning 提到了什么"这种间接推断，本次修订额外用 `sqlite3 -readonly` 直接、只读地查询了
deveco 落盘的会话数据库（未启动任何 server，纯读盘，路径 `~/.local/share/deveco/deveco.db`，这是本机
`deveco serve` 用来持久化 session/message/part 的 sqlite 文件）：

```
$ sqlite3 -readonly ~/.local/share/deveco/deveco.db \
  "SELECT count(*) FROM part WHERE session_id='ses_094fa725bffe12j1rAqQXKnj2n' AND data LIKE '%probe intercepted%';"
0

$ sqlite3 -readonly ~/.local/share/deveco/deveco.db \
  "SELECT id, json_extract(data,'\$.type'), data FROM part WHERE message_id='msg_f6b05bb99001sI00oqDOSaFuFH';"
prt_f6b05bb9f001ikIQHUabrRAJAM|text|{"type":"text","text":"hello"}
```

即：整个探针会话（含探针命令这一轮）落盘的 `part` 表里，完全不存在字符串 `"probe intercepted"`；而探针
命令这一轮**持久化的用户消息本身**，其文本就是原始的 `"hello"`，不是 hook 覆写后的值。这说明
`output.parts` 的 mutation 既没有进入最终回复，也没有进入被持久化、会在后续轮次里作为历史喂给模型的
用户消息内容。

**结论**：综合以上两类证据（reasoning trace + 落盘 message/part 表），在 deveco 0.1.1 + 本探针配置下，
`command.execute.before` 的 `output.parts` 赋值**既没有短路/替换最终回复，也没有重写发给模型的
prompt**——两种解释都被证据排除，而不是停留在"存疑、未判断"。hook 触发了、`input` 参数拿到了，但对
`output` 的写入既没有体现在模型的推理内容里，也没有出现在会话落盘的任何一条消息/part 里，看起来是被
后续的正常模型调用流程完全绕开了。这对 goal-plugin 的核心机制（`/goal status`、`/goal history` 等只读
子命令依赖 `output.parts` 直接返回文本、不经过模型）是一个需要在适配任务里重点验证/绕过的风险点——迁移后
可能需要换一种方式短路命令（例如直接在 hook 里抛错阻止，或者确认是否有别的字段名/别的时机能生效）。

**追加核实（回答 review Important #2 ——消息列表完整性）**：

原始记录只检查了 `GET /session/$SID/message` 返回的"最后一条消息"，没有核实探针命令那一轮在真正的模型
回复之前，是否还额外产生过一条反映 `output.parts`（"probe intercepted"）的独立消息（例如一条命令结果
气泡，之后被模型回复追加或覆盖）。这个问题在会话数据仍留在磁盘上的前提下，可以不重启 server、纯读盘地
补充验证：

```
$ sqlite3 -readonly ~/.local/share/deveco/deveco.db \
  "SELECT id, time_created, json_extract(data,'\$.role') FROM message WHERE session_id='ses_094fa725bffe12j1rAqQXKnj2n' ORDER BY time_created;"
msg_f6b05bb99001sI00oqDOSaFuFH|1784206965657|user
msg_f6b05bbb1001RjtW9ggzPhXezF|1784206965681|assistant
msg_f6b063c47001W7M38DtPApN0ft|1784206998599|user
msg_f6b063c55001bDpIhv4Fbdez44|1784206998613|assistant
msg_f6b0650bc001e7s0oF2smQ6UcY|1784207003836|user
msg_f6b0650c20013M3ml37XhiiqYJ|1784207003842|assistant
```

这是本探针会话落盘的全部 6 条消息，对应 3 轮请求（问题 1 的 `probe hello` 命令 + 问题 4 的两次
`say hi`）。探针命令那一轮（会话里最早的一对）只有**恰好一条** user 消息
（`msg_f6b05bb99001sI00oqDOSaFuFH`）和**恰好一条** assistant 消息
（`msg_f6b05bbb1001RjtW9ggzPhXezF`），中间没有第三条消息；这条 assistant 消息只有 4 个 part
（`step-start` / `reasoning` / `text` / `step-finish`），且如上所述整个会话的 `part` 表里搜不到
`"probe intercepted"`。

**结论（回答 Important #2）**：就本次实际记录的这一次运行而言，可以定论——`command.execute.before`
短路失败之后，deveco **没有**额外产生一条反映 `output.parts` 注入内容的"命令结果消息"；从命令触发到
最终回复，全程只有一条 assistant 消息。但这只是**这一次、deveco 0.1.1、本探针最小配置**下的观察结果，
不代表所有 host 版本/配置都必然如此。**Task 10 的 E2E 在断言"`/goal status` 等控制命令只产生单条消息"
之前，仍建议针对目标运行环境跑一次同类型的落盘核实（或等价的集成测试）**，而不要仅凭本文档外推——本记录
只能排除"这次探针跑出了两条消息"这一具体假设，不能代替针对 goal-plugin 实际迁移后部署环境的独立验证。

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

`plugin loaded` 出现在 `session.created` 之前几毫秒（同一时间点附近；**推测**插件初始化是创建会话流程的
一部分——这只是从两行日志的时间戳顺序做的推断，**未验证** deveco 内部具体的触发机制/调用顺序，也没有看过
deveco 相关源码去确认因果关系），且是文件里的第一行——`.probe.log` 文件本身也是这时才第一次被创建。这确认插件的 server 工厂函数
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

- 新增：`lesson2-goal-plugin/docs/probe-notes.md`（本文件）
- 临时未提交：`/tmp/goal-probe/`（含 `deveco.json`、`.deveco/plugin/probe.ts`、`serve.log`、
  `.probe.log`，按任务要求保留在本机供后续调试参考，不纳入 git）
- 补充证据来源（Fix Round 1，回应 review Important #1/#2）：本机 `~/.local/share/deveco/deveco.db`
  （deveco serve 落盘的 sqlite 会话库），通过 `sqlite3 -readonly` 只读查询获取，**未启动任何 server**，
  该文件本身也不属于本仓库，不纳入 git。

## 收尾

- `lsof -ti:4098 | xargs kill -9` 已执行，server 已停止
- `/tmp/goal-probe` 目录未删除（按 brief 要求保留）
