# Lesson 3: devecocode-goal-plugin 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 willytop8/OpenCode-goal-plugin 全量移植为 deveco 适配的 devecocode-goal-plugin，作为课程 Lesson 3（交互式 TUI 形态：`/goal <目标>` → 空转自续 → 证据门控完成）。

**Architecture:** 上游 6 个 JS 源文件原样 vendor 进 `template/.deveco/plugin/devecocode-goal-plugin/` 子目录（deveco 只发现顶层 `*.ts`，子目录不会被误加载），新增一个薄入口 `devecocode-goal-plugin.ts` re-export；适配点全部做成可 git-diff 的最小改动。上游 9 个测试文件全量搬入用 `node --test` 跑，全绿即移植正确性的机械证据。`goal.sh` 只负责装（init/--update/status/observe）。

**Tech Stack:** bash（goal.sh，需兼容 macOS bash 3.2）、Node.js ≥18（插件源码 + node --test）、deveco 0.1.1（宿主）、curl + python3（冒烟脚本 HTTP 调用，沿用 lesson2 惯例）。

**Spec:** `docs/superpowers/specs/2026-07-16-lesson3-goal-plugin-design.md`

## Global Constraints

- 上游固定为 `https://github.com/willytop8/OpenCode-goal-plugin` commit `2d3e97edeb6e1ecfbe21b193616987df335f047f`（v0.6.5，MIT）。
- vendor 文件名、函数名、类型名与上游**完全一致**；只允许改：路径常量、环境变量读取、session API 的 directory 注入、用户可见品牌字符串（"OpenCode" → "DevEco Code"）。注释一律不改。
- 测试运行器固定 `node --test`（node ≥18），不迁 bun test。
- goal.sh 必须兼容 macOS bash 3.2：`${f}` 后紧跟中文时花括号不能省（lesson2 已踩过）。
- 脚本起 deveco server 前必须 `unset DEVECO_SERVER_PASSWORD`（否则插件内 client 调自身 server 吃 401，lesson2 坑 #4）。
- 杀 server 只能按端口：`lsof -ti:<port> | xargs kill -9`（`pkill -f "deveco serve"` 杀不掉，真正监听的是 fork 出的子进程）。
- 提交直接落 master（仓库惯例），commit message 用中文、`feat:`/`docs:`/`fix:` 前缀，格式参照 `git log`。
- 所有命令默认在仓库根 `/Users/fengyi/Workspace/others/deveco-lessons` 执行；`node --test` 在 `lesson3-goal-plugin/` 下执行。

## 文件结构（最终形态）

```
lesson3-goal-plugin/
├── README.md                    # Task 9：教学文档
├── goal.sh                      # Task 6：init [--update] / status / observe
├── upstream.lock                # Task 1：上游 pin
├── docs/probe-notes.md          # Task 2：deveco hook 实测记录
├── scripts/smoke.sh             # Task 7：插件加载冒烟
├── template/.deveco/plugin/
│   ├── devecocode-goal-plugin.ts        # Task 5：入口壳
│   └── devecocode-goal-plugin/          # Task 1 vendor；Task 3/4/8 适配
│       ├── goal-plugin.js               #   (4469 行，主体)
│       ├── opencode-session-api.js      #   (110 行，SDK 形状适配层)
│       ├── native-agent-config.js
│       ├── completion-claim.js
│       ├── goal-tool-result.js
│       ├── persistence-lease.js
│       ├── index.d.ts                   #   类型参考
│       └── LICENSE                      #   MIT 保留义务
└── test/
    ├── <上游 9 个 *.test.js>            # Task 1 搬入（import 路径重定向）
    ├── deveco-adaptation.test.js        # Task 3/4：适配点专属测试
    └── goal-sh.test.js                  # Task 6：goal.sh 行为测试
```

---

### Task 1: Vendor 上游源码 + 测试基线全绿

**Files:**
- Create: `lesson3-goal-plugin/upstream.lock`
- Create: `lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin/`（6 个 .js + index.d.ts + LICENSE，逐字节复制）
- Create: `lesson3-goal-plugin/test/`（上游 9 个 .test.js，仅改 import 路径）

**Interfaces:**
- Produces: 后续所有 Task 的被改对象。vendor 路径 `template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js` 导出 `GoalPlugin`（`async (context, pluginOptions) => hooks`）与 `testInternals`。

- [ ] **Step 1: 克隆上游并锁定 commit，先在克隆里跑一遍测试拿基线**

```bash
git clone https://github.com/willytop8/OpenCode-goal-plugin.git /tmp/goal-upstream
git -C /tmp/goal-upstream checkout 2d3e97edeb6e1ecfbe21b193616987df335f047f
cd /tmp/goal-upstream && node --test test/*.test.js 2>&1 | tail -5
```

Expected: 末尾 `# pass N` / `# fail 0`。**记下 N**（后续每次跑全量测试都对照这个数）。若上游本身有 fail，停下来报告，不要继续。

- [ ] **Step 2: 复制源码与测试**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
mkdir -p lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin lesson3-goal-plugin/test
cp /tmp/goal-upstream/src/*.js lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin/
cp /tmp/goal-upstream/index.d.ts /tmp/goal-upstream/LICENSE lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin/
cp /tmp/goal-upstream/test/*.test.js lesson3-goal-plugin/test/
```

- [ ] **Step 3: 重定向测试的 import 路径**

上游测试统一从 `../src/` import，重定向到 vendor 位置：

```bash
cd lesson3-goal-plugin
sed -i '' 's|"\.\./src/|"../template/.deveco/plugin/devecocode-goal-plugin/|g' test/*.test.js
grep -rn '"\.\./src/' test/ && echo "还有漏网" || echo OK
```

Expected: `OK`

- [ ] **Step 4: 写 upstream.lock**

```
repo: https://github.com/willytop8/OpenCode-goal-plugin
commit: 2d3e97edeb6e1ecfbe21b193616987df335f047f
version: 0.6.5
license: MIT (LICENSE 已随源码 vendor)
vendored:
  src/*.js index.d.ts LICENSE -> template/.deveco/plugin/devecocode-goal-plugin/
  test/*.test.js -> test/ (仅改 ../src/ import 前缀)
date: 2026-07-16
diff 上游: git clone 上游、checkout 该 commit，然后 diff -r src/ 与 vendor 目录
```

- [ ] **Step 5: 跑全量测试确认基线全绿**

```bash
cd lesson3-goal-plugin && node --test test/*.test.js 2>&1 | tail -5
```

Expected: `# fail 0`，pass 数与 Step 1 的 N 一致。

- [ ] **Step 6: Commit**

```bash
git add lesson3-goal-plugin
git commit -m "feat(lesson3): vendor opencode-goal-plugin v0.6.5 原样源码与测试（基线全绿）"
```

---

### Task 2: deveco hook 行为探针（spike）

**Files:**
- Create: `lesson3-goal-plugin/docs/probe-notes.md`
- 临时（不提交）: `/tmp/goal-probe/` 探针项目

**Interfaces:**
- Produces: `docs/probe-notes.md`，必须回答四个问题：(1) `command.execute.before` 的 input 形状与 output 用法；(2) 有没有 HTTP 端点能触发命令执行（供 Task 7 冒烟用）；(3) 插件实例何时加载（server 起时 / 首个会话建时）；(4) `session.prompt` 不带 `query.directory` 是否可用。

- [ ] **Step 1: 搭探针项目**

```bash
mkdir -p /tmp/goal-probe/.deveco/plugin
cat > /tmp/goal-probe/deveco.json <<'EOF'
{
  "model": "deveco/GLM-5.1",
  "command": {
    "probe": { "description": "probe", "template": "$ARGUMENTS", "agent": "build" }
  }
}
EOF
cat > /tmp/goal-probe/.deveco/plugin/probe.ts <<'EOF'
import fs from "fs"
import path from "path"

export const Probe = async ({ client, directory }: any) => {
  const log = (msg: string) =>
    fs.appendFileSync(path.join(directory, ".probe.log"), `${new Date().toISOString()} ${msg}\n`)
  log("plugin loaded")
  return {
    "command.execute.before": async (input: any, output: any) => {
      log(`command.execute.before input=${JSON.stringify(input)} outputKeys=${JSON.stringify(Object.keys(output || {}))}`)
      output.parts = [{ type: "text", text: "probe intercepted" }]
    },
    "chat.message": async (input: any) => {
      log(`chat.message input=${JSON.stringify(input)}`)
    },
    event: async ({ event }: any) => log(`event ${event?.type}`),
  }
}
export default { id: "probe", server: Probe }
EOF
```

- [ ] **Step 2: 起 server、建会话**

```bash
unset DEVECO_SERVER_PASSWORD || true
lsof -ti:4098 | xargs kill -9 2>/dev/null || true
cd /tmp/goal-probe && nohup deveco serve --port 4098 > serve.log 2>&1 &
sleep 5
SID=$(curl -s -X POST "http://127.0.0.1:4098/session?directory=/tmp/goal-probe" \
  -H 'Content-Type: application/json' -d '{"title":"probe"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "SID=$SID"; sleep 2; cat /tmp/goal-probe/.probe.log
```

Expected: `SID=` 非空。记录 `.probe.log` 里 `plugin loaded` 出现的时机（server 起时还是建会话时）→ 写进 probe-notes 问题 (3)。

- [ ] **Step 3: 探命令触发端点**

依次尝试，第一个返回非 404 的就是答案（写进 probe-notes 问题 (2)）：

```bash
curl -si -X POST "http://127.0.0.1:4098/session/$SID/command?directory=/tmp/goal-probe" \
  -H 'Content-Type: application/json' -d '{"command":"probe","arguments":"hello"}' | head -1
# 若 404，再试把 /probe 当消息文本发：
curl -si -X POST "http://127.0.0.1:4098/session/$SID/message?directory=/tmp/goal-probe" \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"/probe hello"}]}' | head -1
sleep 3; cat /tmp/goal-probe/.probe.log
```

Expected: `.probe.log` 出现 `command.execute.before input=...`（记下完整 input JSON → 问题 (1)），或两条路都不触发（也如实记录，此时命令链路只能 TUI 手动验证）。

- [ ] **Step 4: 探 prompt 是否必须 query.directory**

```bash
curl -s -X POST "http://127.0.0.1:4098/session/$SID/message" \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"say hi"}]}' | head -c 300; echo
```

Expected: 记录是成功还是报错（`Session not found` 之类）→ 问题 (4)。

- [ ] **Step 5: 写 probe-notes.md、收尾、提交**

`lesson3-goal-plugin/docs/probe-notes.md` 按四个问题组织，逐条贴实测输出（curl 返回行 + `.probe.log` 原文摘录）。

```bash
lsof -ti:4098 | xargs kill -9 2>/dev/null || true
cd /Users/fengyi/Workspace/others/deveco-lessons
git add lesson3-goal-plugin/docs/probe-notes.md
git commit -m "docs(lesson3): deveco 0.1.1 hook 行为探针实测记录"
```

---

### Task 3: 状态路径与环境变量适配（TDD）

**Files:**
- Create: `lesson3-goal-plugin/test/deveco-adaptation.test.js`
- Modify: `lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js:27`（路径常量）、`:1012` 附近 `resolveStateFilePath`（环境变量）
- Modify: `lesson3-goal-plugin/test/goal-plugin.test.js`、`test/host-lifecycle.test.js`（约 12 处 `.opencode/goals` 断言）

**Interfaces:**
- Consumes: Task 1 的 vendor 与 `testInternals.resolveStateFilePath`（签名 `({ stateFilePath, env, cwd }) => string`）。
- Produces: 状态文件落 `.deveco/goals/state.json`；env 优先级 `stateFilePath 选项 > DEVECO_GOAL_STATE_PATH > OPENCODE_GOAL_STATE_PATH > 项目默认`。Task 6/7 依赖此路径。

- [ ] **Step 1: 写失败测试**

新建 `test/deveco-adaptation.test.js`：

```js
import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { testInternals } from "../template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js"

const { resolveStateFilePath } = testInternals

test("项目默认状态路径落在 .deveco 下", () => {
  assert.equal(
    resolveStateFilePath({ cwd: "/proj", env: {} }),
    join("/proj", ".deveco", "goals", "state.json"),
  )
})

test("DEVECO_GOAL_STATE_PATH 优先于 OPENCODE_GOAL_STATE_PATH", () => {
  assert.equal(
    resolveStateFilePath({
      cwd: "/proj",
      env: { DEVECO_GOAL_STATE_PATH: "/a/state.json", OPENCODE_GOAL_STATE_PATH: "/b/state.json" },
    }),
    "/a/state.json",
  )
})

test("OPENCODE_GOAL_STATE_PATH 仍作为回退被承认", () => {
  assert.equal(
    resolveStateFilePath({ cwd: "/proj", env: { OPENCODE_GOAL_STATE_PATH: "/b/state.json" } }),
    "/b/state.json",
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd lesson3-goal-plugin && node --test test/deveco-adaptation.test.js
```

Expected: 第 1、2 条 FAIL（路径还是 `.opencode`、DEVECO 前缀未识别），第 3 条 PASS。

- [ ] **Step 3: 改源码（两处最小改动）**

`goal-plugin.js:27`，旧：

```js
const PROJECT_LOCAL_STATE_SUBPATH = join(".opencode", "goals", "state.json")
```

新：

```js
const PROJECT_LOCAL_STATE_SUBPATH = join(".deveco", "goals", "state.json")
```

`resolveStateFilePath`（约 :1014 起），在 `stateFilePath` 分支之后、`OPENCODE_GOAL_STATE_PATH` 分支**之前**插入：

```js
  const devecoEnvPath = env?.DEVECO_GOAL_STATE_PATH
  if (typeof devecoEnvPath === "string" && devecoEnvPath.trim()) {
    const configured = devecoEnvPath.trim()
    return isAbsolute(configured) ? configured : resolvePath(base, configured)
  }
```

注意：`:36` 的 `.opencode-goal-plugin` 与 XDG 的 `opencode-goal-plugin/state.json` 是**迁移回退路径，保持原样不改**。

- [ ] **Step 4: 跑新测试确认通过，再跑全量看上游断言炸了哪些**

```bash
node --test test/deveco-adaptation.test.js   # Expected: 3 pass
node --test test/*.test.js 2>&1 | tail -5    # Expected: 若干 fail，全部与 .opencode/goals 路径断言相关
```

- [ ] **Step 5: 更新上游测试断言**

```bash
grep -n '\.opencode.\{0,3\}goals\|"\.opencode", *"goals"' test/goal-plugin.test.js test/host-lifecycle.test.js
```

对列出的每一处（约 12 处），把 `.opencode`/`".opencode"` 改成 `.deveco`/`".deveco"`。**只改和 `goals` 连用的**；`.opencode-goal-plugin`（legacy home 目录断言）不动。

- [ ] **Step 6: 全量测试回到全绿**

```bash
node --test test/*.test.js 2>&1 | tail -5
```

Expected: `# fail 0`，pass 数 = Task 1 的 N + 3。

- [ ] **Step 7: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons && git add lesson3-goal-plugin
git commit -m "feat(lesson3): 状态路径迁到 .deveco/goals，环境变量双前缀（DEVECO_ 优先）"
```

---

### Task 4: session API 注入 query.directory（TDD）

**Files:**
- Modify: `lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin/opencode-session-api.js`（`createOpenCodeSessionApi` 增加 `directory` 选项）
- Modify: `.../goal-plugin.js:2889`（主 sessionApi 穿线）及 `:2824`、`:2852`、`:2872`（auditor 路径穿线）
- Modify: `lesson3-goal-plugin/test/deveco-adaptation.test.js`（追加用例）

**Interfaces:**
- Consumes: `createOpenCodeSessionApi(client, { preferredShape, directory? })`；`createGoalPlugin({ client, directory })` 已解构出 `directory`（goal-plugin.js:2880）。
- Produces: legacy 形状的所有调用带 `query: { directory }`（lesson2 实证 deveco 需要，见 ralph-loop.ts:94-96）；不传 `directory` 时行为与上游完全一致（上游测试不受影响的部分保持绿）。

- [ ] **Step 1: 追加失败测试**

`test/deveco-adaptation.test.js` 追加：

```js
import { createOpenCodeSessionApi } from "../template/.deveco/plugin/devecocode-goal-plugin/opencode-session-api.js"

function recordingClient() {
  const calls = []
  const record = (operation) => async (input) => {
    calls.push({ operation, input })
    return { data: { id: "s1" } }
  }
  return {
    calls,
    session: {
      create: record("create"),
      prompt: record("prompt"),
      promptAsync: record("promptAsync"),
      get: record("get"),
      messages: record("messages"),
      update: record("update"),
      delete: record("delete"),
      abort: record("abort"),
    },
  }
}

test("legacy 形状在配置 directory 时注入 query.directory", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy", directory: "/proj" })
  await api.prompt("s1", { parts: [] })
  assert.deepEqual(client.calls[0].input.path, { id: "s1" })
  assert.deepEqual(client.calls[0].input.query, { directory: "/proj" })
})

test("createChild 在 legacy 形状下也注入 query.directory", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy", directory: "/proj" })
  await api.createChild("parent", { title: "audit" })
  assert.deepEqual(client.calls[0].input.query, { directory: "/proj" })
})

test("不配置 directory 时 legacy 形状与上游一致（无 query 注入）", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy" })
  await api.prompt("s1", { parts: [] })
  assert.equal(client.calls[0].input.query, undefined)
})

test("flat 形状从不注入 query.directory", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "flat", directory: "/proj" })
  await api.get("s1")
  assert.equal(client.calls[0].input.query, undefined)
})

test("messages 的 legacy 形状把 directory 合并进已有 query", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy", directory: "/proj" })
  await api.messages("s1", { limit: 5 })
  assert.deepEqual(client.calls[0].input.query, { limit: 5, directory: "/proj" })
})
```

- [ ] **Step 2: 跑测试确认新用例失败**

```bash
node --test test/deveco-adaptation.test.js
```

Expected: 新增 5 条中前 2 条与 messages 条 FAIL（`query` 为 undefined 或缺 directory）。

- [ ] **Step 3: 实现 opencode-session-api.js 的 directory 注入**

在 `createOpenCodeSessionApi` 内、`preferredShape` 校验之后加：

```js
  const directory =
    typeof options.directory === "string" && options.directory.trim() ? options.directory.trim() : undefined

  function withDirectory(legacyInput) {
    if (!directory) return legacyInput
    return { ...legacyInput, query: { ...(legacyInput.query || {}), directory } }
  }
```

然后把返回对象里每个方法的 **legacy 入参**（`invoke` 的第 3 个实参）包一层 `withDirectory(...)`，例如：

```js
    prompt(sessionID, input = {}) {
      return invoke(
        "prompt",
        { sessionID, ...input },
        withDirectory({ path: { id: sessionID }, body: input }),
      )
    },
```

`messages`/`promptAsync`/`createChild`/`update`/`get`/`delete`/`abort` 同样处理（flat 入参一律不动；`createChild` 的 legacy 入参是 `{ body }`，包完变 `withDirectory({ body })`）。

- [ ] **Step 4: goal-plugin.js 穿线**

`goal-plugin.js:2889` 改为：

```js
  const sessionApi = createOpenCodeSessionApi(client, {
    preferredShape: pluginOptions.sdkShape === "flat" ? "flat" : "legacy",
    directory,
  })
```

再看 `:2824`、`:2852`、`:2872` 三处 auditor 路径的 `createOpenCodeSessionApi(client, { preferredShape: sdkShape })` 调用：顺着 `sdkShape` 这个值当前是怎么传进所在函数的（参数或闭包），用同样的方式把 `directory` 传到位，然后给这三处调用同样补上 `directory` 字段。

- [ ] **Step 5: 跑全量测试，修上游形状断言**

```bash
node --test test/*.test.js 2>&1 | tail -8
```

Expected: 两种结果都可能——(a) 全绿（上游测试造 GoalPlugin 时没给 directory 或没断言 query）；(b) 少量 fail，全是「断言 prompt/create 入参精确形状、现在多了 query.directory」。对 (b)：逐个把期望值补上 `query: { directory: <该测试用的目录> }`，这是移植后的**预期行为**而非破坏。除形状断言外若出现其它性质的 fail，停下来排查，不许硬改断言掩盖。

- [ ] **Step 6: 全绿后 Commit**

```bash
node --test test/*.test.js 2>&1 | tail -3   # Expected: # fail 0
cd /Users/fengyi/Workspace/others/deveco-lessons && git add lesson3-goal-plugin
git commit -m "feat(lesson3): session API legacy 形状注入 query.directory（deveco 需要，lesson2 坑 #3 续）"
```

---

### Task 5: 入口壳 devecocode-goal-plugin.ts

**Files:**
- Create: `lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin.ts`

**Interfaces:**
- Consumes: `GoalPlugin(context, pluginOptions)`（vendor 导出）；deveco 插件上下文 `{ client, directory }`（形状同 lesson2 ralph-loop.ts:64）。
- Produces: deveco 可发现的插件入口；加载即写 `.deveco/goals/plugin.log`（Task 7 冒烟与 README 排障都依赖这个信号）；可选配置文件 `<项目>/.deveco/goal-plugin.json`（内容即上游 pluginOptions）。

- [ ] **Step 1: 写入口文件（完整内容）**

```ts
import type { Plugin } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"
import { GoalPlugin } from "./devecocode-goal-plugin/goal-plugin.js"

// 可选配置：<项目>/.deveco/goal-plugin.json，内容就是上游的 pluginOptions
// （maxTurns / maxTokens / commandName / completionAudit / ...），缺省全走上游默认值。
export function loadPluginOptions(directory: string): Record<string, unknown> {
  const file = path.join(directory, ".deveco", "goal-plugin.json")
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, "utf-8"))
}

export const DevecocodeGoalPlugin: Plugin = async (ctx) => {
  const directory = (ctx as { directory: string }).directory
  // 判断插件到底加载没加载，看这个文件——lesson2 的 .ralph/plugin.log 同款经验：
  // 插件放错目录是静默失效，必须有个落盘信号。
  fs.mkdirSync(path.join(directory, ".deveco", "goals"), { recursive: true })
  fs.appendFileSync(
    path.join(directory, ".deveco", "goals", "plugin.log"),
    `${new Date().toISOString()} devecocode-goal-plugin loaded\n`,
  )
  return GoalPlugin(ctx as Parameters<typeof GoalPlugin>[0], loadPluginOptions(directory))
}

export default { id: "devecocode-goal-plugin", server: DevecocodeGoalPlugin }
```

说明：导出辅助函数是安全的——lesson2 的 ralph-loop.ts 同样导出了 `loadConfig`/`parseVerdict` 且端到端验证过。

- [ ] **Step 2: 语法自检**

node 不能直接跑 .ts，用 bun 只做解析级检查（不引入 bun test）：

```bash
cd lesson3-goal-plugin
bun build --no-bundle template/.deveco/plugin/devecocode-goal-plugin.ts --outdir /tmp/goal-entry-check
```

Expected: exit 0。运行时行为由 Task 7 冒烟覆盖。

- [ ] **Step 3: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons && git add lesson3-goal-plugin
git commit -m "feat(lesson3): 插件入口壳（加载信号落盘 + 可选 goal-plugin.json 配置）"
```

---

### Task 6: goal.sh（init / --update / status / observe）+ 测试

**Files:**
- Create: `lesson3-goal-plugin/goal.sh`（可执行）
- Create: `lesson3-goal-plugin/test/goal-sh.test.js`

**Interfaces:**
- Consumes: Task 1/5 的 template 文件清单。
- Produces: `goal.sh init <dir> [--update]`（装模板 + merge deveco.json 的 `command.goal`）、`status <dir>`、`observe <dir>`。Task 7 冒烟与 README 用法都建立在它之上。

- [ ] **Step 1: 写失败测试**

新建 `test/goal-sh.test.js`（node --test，真实跑 bash）：

```js
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const lessonDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const goalSh = path.join(lessonDir, "goal.sh")

function run(args) {
  return execFileSync("bash", [goalSh, ...args], { encoding: "utf-8" })
}

test("init 装好插件文件并 merge deveco.json", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-init-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  run(["init", dir])
  assert.ok(fs.existsSync(path.join(dir, ".deveco/plugin/devecocode-goal-plugin.ts")))
  assert.ok(fs.existsSync(path.join(dir, ".deveco/plugin/devecocode-goal-plugin/goal-plugin.js")))
  assert.ok(fs.existsSync(path.join(dir, ".deveco/plugin/devecocode-goal-plugin/LICENSE")))
  const config = JSON.parse(fs.readFileSync(path.join(dir, "deveco.json"), "utf-8"))
  assert.equal(config.command.goal.template, "$ARGUMENTS")
})

test("init 不覆盖本地改动，--update 才覆盖", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-update-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  run(["init", dir])
  const entry = path.join(dir, ".deveco/plugin/devecocode-goal-plugin.ts")
  fs.appendFileSync(entry, "\n// local edit\n")
  run(["init", dir])
  assert.match(fs.readFileSync(entry, "utf-8"), /local edit/)
  run(["init", dir, "--update"])
  assert.doesNotMatch(fs.readFileSync(entry, "utf-8"), /local edit/)
})

test("init 保留 deveco.json 已有字段", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-merge-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "deveco.json"), JSON.stringify({ model: "deepseek/deepseek-chat" }))
  run(["init", dir])
  const config = JSON.parse(fs.readFileSync(path.join(dir, "deveco.json"), "utf-8"))
  assert.equal(config.model, "deepseek/deepseek-chat")
  assert.equal(config.command.goal.template, "$ARGUMENTS")
})

test("status 在无状态文件时给出提示而不报错", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-status-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  run(["init", dir])
  const out = run(["status", dir])
  assert.match(out, /还没有目标状态/)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd lesson3-goal-plugin && node --test test/goal-sh.test.js
```

Expected: 4 条全 FAIL（goal.sh 不存在，`ENOENT`）。

- [ ] **Step 3: 写 goal.sh（完整内容）**

```bash
#!/usr/bin/env bash
# devecocode-goal-plugin for DevEco Code
#
#   ./goal.sh init <项目目录> [--update]   装：插件 + /goal 命令配置（改你的仓库）
#   ./goal.sh status <项目目录>            看目标状态（.deveco/goals/state.json）
#   ./goal.sh observe <项目目录>           把会话导进 cannbot-insight 回看（委托 lesson1）
#
# 装好后：cd <项目目录> && deveco ，会话里输入 /goal <目标>。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/template"

PLUGIN_ENTRY=".deveco/plugin/devecocode-goal-plugin.ts"
PLUGIN_DIR=".deveco/plugin/devecocode-goal-plugin"
VENDOR_FILES=(goal-plugin.js opencode-session-api.js native-agent-config.js completion-claim.js goal-tool-result.js persistence-lease.js index.d.ts LICENSE)

say() { printf "\033[1m%s\033[0m\n" "$*"; }
die() { echo "❌ $*" >&2; exit 1; }

usage() {
  cat >&2 <<EOF
用法:
  $0 init   <项目目录> [--update]   装插件 + merge deveco.json 的 /goal 命令
  $0 status <项目目录>              看当前目标状态
  $0 observe <项目目录>             导会话进 cannbot-insight（委托 lesson1）

  --update  重新覆盖项目里的插件文件（会丢掉你在项目里的改动）
EOF
  exit 1
}

install_file() {
  local f="$1" update="$2"
  if [ -f "$f" ] && [ "$update" = "0" ]; then
    if ! cmp -s "$TEMPLATE/$f" "$f"; then
      # ${f} 的花括号不能省：macOS 的 bash 3.2 会把紧跟其后的中文字符当成变量名的一部分
      say "→ 保留你改过的 ${f}（要覆盖成模板版本用 --update）"
    fi
    return 0
  fi
  cp "$TEMPLATE/$f" "$f"
  say "→ 装好 $f"
}

cmd_init() {
  local target="${1:-}" update=0
  shift || true
  for a in "$@"; do
    case "$a" in
      --update) update=1 ;;
      *) usage ;;
    esac
  done
  [ -n "$target" ] || usage

  mkdir -p "$target"
  target="$(cd "$target" && pwd)"
  cd "$target"

  # deveco 只认 .deveco/，放 .opencode/ 下是静默失效（lesson2 坑 #1）
  mkdir -p "$PLUGIN_DIR"
  install_file "$PLUGIN_ENTRY" "$update"
  local f
  for f in "${VENDOR_FILES[@]}"; do
    install_file "$PLUGIN_DIR/$f" "$update"
  done

  # /goal 命令必须注册在 deveco.json（$ARGUMENTS 模板）；插件只负责拦截执行。
  # 已有字段一律不覆盖——merge 而不是重写。
  node - "$target" <<'JS'
const fs = require("fs")
const path = require("path")
const file = path.join(process.argv[2], "deveco.json")
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : {}
config.model ||= "deveco/GLM-5.1"
config.command ||= {}
config.command.goal ||= {
  description: "设定会话级目标并自动续推到完成",
  template: "$ARGUMENTS",
  agent: "build",
}
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
JS
  say "→ deveco.json 已 merge /goal 命令（已有字段不覆盖）"

  echo
  say "✅ 装好了: $target"
  say "   下一步: cd $target && deveco ，会话里输入 /goal <目标>"
}

cmd_status() {
  local target="${1:-}"
  [ -n "$target" ] || usage
  [ -d "$target" ] || die "$target 不存在"
  target="$(cd "$target" && pwd)"
  local state="$target/.deveco/goals/state.json"
  if [ ! -f "$state" ]; then
    say "还没有目标状态（${state} 不存在）——先在 deveco 会话里 /goal <目标>"
    return 0
  fi
  cat "$state"
}

# 观测是第一课的内容，这里只委托；旁路失败不影响主流程（同 lesson2）。
OBSERVE_SH="$(cd "$HERE/.." && pwd)/lesson1-insight/observe.sh"
cmd_observe() {
  if [ -x "$OBSERVE_SH" ]; then
    "$OBSERVE_SH" "$@"
  else
    say "ℹ️  没找到 lesson1 的 observe.sh（${OBSERVE_SH}），跳过观测。"
  fi
}

case "${1:-}" in
  init) shift; cmd_init "$@" ;;
  status) shift; cmd_status "$@" ;;
  observe) shift; cmd_observe "$@" ;;
  *) usage ;;
esac
```

```bash
chmod +x lesson3-goal-plugin/goal.sh
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd lesson3-goal-plugin && node --test test/goal-sh.test.js
```

Expected: 4 pass。再跑全量确认没碰坏别的：`node --test test/*.test.js 2>&1 | tail -3` → `# fail 0`。

- [ ] **Step 5: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons && git add lesson3-goal-plugin
git commit -m "feat(lesson3): goal.sh 安装脚本（init/--update/status/observe）与行为测试"
```

---

### Task 7: 冒烟脚本 scripts/smoke.sh

**Files:**
- Create: `lesson3-goal-plugin/scripts/smoke.sh`（可执行）

**Interfaces:**
- Consumes: `goal.sh init`（Task 6）、入口的 `plugin.log` 加载信号（Task 5）、`docs/probe-notes.md` 的问题 (2)(3) 结论（Task 2）。
- Produces: 一条命令验证「插件在真实 deveco server 里被发现并加载」，README 的排障一节引用它。

- [ ] **Step 1: 写 smoke.sh 主体（完整内容）**

```bash
#!/usr/bin/env bash
# 冒烟：goal.sh init 一个临时项目 → 起 deveco serve → 确认插件真的加载了。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-4099}"
WORK="$(mktemp -d /tmp/goal-smoke-XXXXXX)"

cleanup() {
  # server 只能按端口杀：真正监听的是 deveco serve fork 出的子进程（lesson2 经验）
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

"$HERE/goal.sh" init "$WORK" >/dev/null

# 一设这个变量 serve 就开 basic auth，插件内 client 会 401（lesson2 坑 #4）
unset DEVECO_SERVER_PASSWORD || true
lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
( cd "$WORK" && nohup deveco serve --port "$PORT" > serve.log 2>&1 & )
for _ in $(seq 1 25); do
  lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1 && break
  sleep 1
done
lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1 || { echo "❌ server 没起来"; cat "$WORK/serve.log"; exit 1; }

SID=$(curl -s -X POST "http://127.0.0.1:$PORT/session?directory=$WORK" \
  -H 'Content-Type: application/json' -d '{"title":"goal-smoke"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
[ -n "$SID" ] || { echo "❌ 建会话失败"; cat "$WORK/serve.log"; exit 1; }

sleep 2
grep -q "devecocode-goal-plugin loaded" "$WORK/.deveco/goals/plugin.log" 2>/dev/null \
  || { echo "❌ 插件没加载（.deveco/goals/plugin.log 无加载记录）"; cat "$WORK/serve.log"; exit 1; }
echo "✅ 插件已被 deveco 发现并加载（session $SID）"
```

```bash
chmod +x lesson3-goal-plugin/scripts/smoke.sh
```

- [ ] **Step 2: 依 probe-notes 补 /goal 命令链路段**

读 `docs/probe-notes.md` 问题 (2) 的结论：

- 若存在可用的命令触发端点（探针 Step 3 的 A 路或 B 路成功），在 `echo "✅ 插件已被 deveco 发现并加载..."` 之后追加（按探针验证过的端点写，下面以 A 路为例）：

```bash
OUT=$(curl -s -X POST "http://127.0.0.1:$PORT/session/$SID/command?directory=$WORK" \
  -H 'Content-Type: application/json' -d '{"command":"goal","arguments":"status"}')
echo "$OUT" | grep -q "No active goal" \
  || { echo "❌ /goal status 没有走到插件拦截"; echo "$OUT" | head -c 500; exit 1; }
echo "✅ /goal 命令拦截链路通"
```

- 若两条路都触发不了命令 hook：不加这段，在脚本头部注释和 README 里如实写「命令链路只能在 TUI 里验证（见手动走查清单）」。

- [ ] **Step 3: 跑冒烟**

```bash
lesson3-goal-plugin/scripts/smoke.sh
```

Expected: 至少 `✅ 插件已被 deveco 发现并加载`；若 Step 2 加了命令段，还有 `✅ /goal 命令拦截链路通`。若加载信号步失败，先检查探针记录的加载时机（可能要先发一条消息才实例化插件——按 probe-notes 调整 smoke 顺序，把「发一条消息」加在 grep 之前）。

- [ ] **Step 4: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons && git add lesson3-goal-plugin
git commit -m "feat(lesson3): 插件加载冒烟脚本（server 实测发现与加载）"
```

---

### Task 8: 用户可见品牌字符串适配

**Files:**
- Modify: `lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js`（约 4-8 处字符串字面量）
- Modify: 断言这些字符串的上游测试（跑挂了哪个改哪个）

**Interfaces:**
- Consumes/Produces: 无接口变化，纯文案。

- [ ] **Step 1: 枚举用户可见的 "OpenCode" 字符串**

```bash
cd lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin
grep -n '"[^"]*OpenCode[^"]*"\|`[^`]*OpenCode[^`]*`' goal-plugin.js
```

已知至少 4 处（`:311`、`:334`、`:335`、`:1929`）。对列出的每一处判断：是**发给用户/模型看的文案**（history 记录、暂停原因、compaction 提示、continue 消息）→ 把 "OpenCode" 改成 "DevEco Code"；是**注释、标识符、`loadOpencodePluginModule` 这类 API 名** → 不动。

- [ ] **Step 2: 跑全量测试，修文案断言**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons/lesson3-goal-plugin
node --test test/*.test.js 2>&1 | tail -8
```

Expected: 若有 fail，全部是断言旧文案的用例——把期望字符串同步改成 "DevEco Code" 版本。其它性质的 fail 不许出现。

- [ ] **Step 3: 全绿后 Commit**

```bash
node --test test/*.test.js 2>&1 | tail -3   # Expected: # fail 0
cd /Users/fengyi/Workspace/others/deveco-lessons && git add lesson3-goal-plugin
git commit -m "feat(lesson3): 用户可见文案 OpenCode → DevEco Code（标识符与注释不动）"
```

---

### Task 8b: goal.sh / smoke.sh 的 Windows Git Bash 适配（执行期新增，用户拍板）

背景：并行会话的 commit `9127b12` 给 lesson1/2 建立了 Windows Git Bash 约定
（`IS_WINDOWS` 检测、`_port_pids`/`_port_kill`/`_port_listening`、`$PYTHON`、node ≥20 前置）。
用户决定 lesson3 同步适配，保持全仓库一致。

**Files:**
- Modify: `lesson3-goal-plugin/goal.sh`（无 lsof/python3 依赖可加可不加——目前只有 node，主要是保持结构一致无需改动则说明）
- Modify: `lesson3-goal-plugin/scripts/smoke.sh`（lsof → `_port_*` 三件套；python3 → `$PYTHON`）

**Interfaces:**
- Consumes: `lesson2-ralph-loop/ralph.sh:22-49` 的 `IS_WINDOWS` 检测与 `_port_pids`/`_port_kill`/`_port_listening`/`PYTHON` 实现——**逐字复制**这段惯例代码（含注释），不要重新发明。
- Produces: lesson3 脚本与仓库 Windows 约定一致；macOS 行为不回归。

- [ ] **Step 1: 核对 goal.sh 是否真的有平台依赖**

`grep -n 'lsof\|python3\|pkill' lesson3-goal-plugin/goal.sh`——按 Task 6 交付的版本应为空
（goal.sh 只用 bash/cp/node）。为空则 goal.sh 不改，在报告里记一句核对结论即可。

- [ ] **Step 2: smoke.sh 适配**

把 ralph.sh:22-49 的 `IS_WINDOWS`/`PYTHON`/`_port_*` 段复制进 smoke.sh 头部（`set -euo pipefail` 之后），
然后替换：所有 `lsof -ti:"$PORT" | xargs kill -9 ...` → `_port_kill "$PORT"`；
`lsof -iTCP:"$PORT" -sTCP:LISTEN ...` 探测 → `_port_listening "$PORT"`；
`python3 -c` → `"$PYTHON" -c`（并在脚本开头对 `$PYTHON` 为空 fail-closed，报错文案参照 ralph.sh 的做法）。

- [ ] **Step 3: macOS 回归**

```bash
bash -n lesson3-goal-plugin/scripts/smoke.sh
lesson3-goal-plugin/scripts/smoke.sh   # 完整真实跑一遍，期望两条 ✅、exit 0、端口无泄漏
cd lesson3-goal-plugin && node --test test/*.test.js 2>&1 | tail -3   # 275 pass / 0 fail
```

- [ ] **Step 4: Commit**

```bash
git add lesson3-goal-plugin
git commit -m "feat(lesson3): smoke.sh 适配 Windows Git Bash（对齐 9127b12 的 _port_*/\$PYTHON 约定）"
```

---

### Task 9: README 教学文档 + 根 README 导航

**Files:**
- Create: `lesson3-goal-plugin/README.md`
- Modify: `README.md`（仓库根，加 lesson3 一行导航与最小跑法）

**Interfaces:**
- Consumes: 前 8 个 Task 的全部产出与其中踩到的坑（如实记录）。

- [ ] **Step 1: 写 lesson3-goal-plugin/README.md**

文体对齐 `lesson2-ralph-loop/README.md`（短句、把「为什么」讲透、坑用编号列表）。章节与要点：

1. `# Lesson 3：把 opencode-goal-plugin 移植成 devecocode-goal-plugin` —— 一句话说清 goal plugin 是什么（会话内 /goal 设目标 → 空转自续 → 证据门控完成），以及与 lesson2 ralph loop 的形态区别（无外部 shell 点火、单会话、裁决靠 evidence 而不是独立 reviewer 会话）。
2. `## 你会学到`：真实插件移植方法论四步（定位上游 hook 依赖 → 用 `strings` 探测 deveco 二进制能力 → vendor 布局让适配 diff 可审 → 上游测试套件锁定移植正确性）；`/goal` 的证据门控设计为什么比「模型自己说完成」可靠。
3. `## 前置条件`：完成 lesson1/2；`deveco auth login`；node ≥18；不能设 `DEVECO_SERVER_PASSWORD`；
   Windows 用户走 Git Bash（对齐根 README 的 Windows 前置说明与 `9127b12` 约定，node ≥20 自装）。
4. `## 用法`：`./goal.sh init ~/my-project` → `cd ~/my-project && deveco` → `/goal <目标>`、`/goal status`、`/goal history`；`./goal.sh status`；可选 `.deveco/goal-plugin.json`（maxTurns 等，列 3-4 个常用键和上游默认值：maxTurns 10 / maxDurationMs 900000 / maxTokens 200000）；排障第一句：**看 `.deveco/goals/plugin.log` 有没有加载记录**。
5. `## 移植方法论`：按 Task 1-8 的真实过程写，重点是「怎么确定 deveco 0.1.1 支持哪些 hook」（strings 探测 + probe 插件实测，引用 `docs/probe-notes.md`）和「为什么内部命名一律不改」（`git diff` 上游可审）。
6. `## 适配点`：逐条列 Task 3/4/5/8 的改动（路径、环境变量、query.directory、入口壳、文案），每条一句「为什么 deveco 需要这个」。
7. `## 这次新踩的坑`：实现过程中真实遇到的记这里（probe-notes 里的意外、测试断言炸法、smoke 的加载时机等），没踩到的不编。
8. `## 观测（复用 Lesson 1）`：`./goal.sh observe ~/my-project`，旁路语义同 lesson2。
9. `## 测试`：`node --test test/*.test.js`（说明为什么是 node 不是 bun）+ `scripts/smoke.sh`。
10. 结尾一行「端到端验证过：…」——**Task 10 完成后才填**，此时先留 `<!-- Task 10 后补 -->` 占位注释。

- [ ] **Step 2: 更新根 README**

在根 `README.md` 的两课导航/最小跑法处，按既有格式追加 lesson3 行：导航一行（`lesson3-goal-plugin/` —— 把 opencode-goal-plugin 移植成 deveco 的 /goal 插件），最小跑法三行（`./goal.sh init ~/my-project`、`cd ~/my-project && deveco`、会话里 `/goal <目标>`）。

- [ ] **Step 3: Commit**

```bash
git add README.md lesson3-goal-plugin/README.md
git commit -m "docs(lesson3): 教学 README（移植方法论/适配点/坑）+ 根 README 导航"
```

---

### Task 10: 手动 TUI 端到端走查 + 收尾

**Files:**
- Modify: `lesson3-goal-plugin/README.md`（填「端到端验证过」一行 + 走查中新发现的坑）

**Interfaces:**
- Consumes: 全部前序 Task。这是交付门槛：走查不过 = 移植未完成，回去修。

- [ ] **Step 1: 准备真实项目**

```bash
lesson3-goal-plugin/goal.sh init /tmp/goal-e2e
cd /tmp/goal-e2e && git init -q && git commit -q --allow-empty -m init
```

- [ ] **Step 2: TUI 走查（人工或 tmux 驱动）**

在 `/tmp/goal-e2e` 里起 `deveco`（确认 shell 无 `DEVECO_SERVER_PASSWORD`），依次验证并记录每步实际输出：

1. `/goal status` → 期望回 "No active goal. Set one with `/goal <condition>`."（Task 8 后为 DevEco 品牌文案）
2. `/goal 创建 hello.txt，内容为 hello devecocode-goal-plugin，并 git commit` → 期望目标被登记、agent 开始干活
3. 等 agent 空转 → 期望插件自动发续推消息（TUI 里能看到非人工的 continue turn）
4. 完成后 → 期望出现证据门控的完成汇报；`cat /tmp/goal-e2e/.deveco/goals/state.json` 有归档记录；`hello.txt` 存在且已 commit
5. `/goal history` → 期望列出 lifecycle 事件
6. `lesson3-goal-plugin/goal.sh status /tmp/goal-e2e` → 输出 state.json
7. `lesson3-goal-plugin/goal.sh observe /tmp/goal-e2e` → cannbot-insight 可回看（lesson1 环境不在则提示跳过，也算通过）

任何一步不符 → 回对应 Task 修（问题多半落在 probe-notes 没覆盖的 hook 行为上），修完重走。

- [ ] **Step 3: 回填 README 与最终提交**

把 README 结尾占位换成一行事实陈述（照 lesson2 格式）：`端到端验证过：<实际路径与结果一句话>`；走查中新发现的坑补进「这次新踩的坑」。

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
node --test lesson3-goal-plugin/test/*.test.js 2>&1 | tail -3   # 最后一次全绿确认
git add lesson3-goal-plugin
git commit -m "docs(lesson3): 端到端走查通过，回填验证结论与新坑"
```

---

### Task 10b: 修复「创建即 paused」——命令消息豁免的 deveco 适配（执行期新增，用户拍板）

背景（Task 10 E2E 实测）：`/goal <目标>` 提交后 6ms 内目标被自己 pause 掉
（`Paused immediately when a new human message arrived`）。根因：上游 `chat.message` 靠
`text.startsWith("/goal ")` 豁免命令消息本身，但 deveco 按 `$ARGUMENTS` 模板展开后落盘的
用户消息**不带前缀**（探针问题 1 的 sqlite 证据：`/probe hello` 落盘为 `"hello"`），豁免失效。
后果：目标常驻 `stopped:true`，`session.idle` 自动续推永不触发——核心机制失效。

**Files:**
- Modify: `lesson3-goal-plugin/template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js`
  （`command.execute.before` 记录本次命令参数 + `chat.message` 同文本豁免，~10-15 行）
- Modify: `lesson3-goal-plugin/test/deveco-adaptation.test.js`（新增用例）
- Modify: `lesson3-goal-plugin/README.md`（坑 #1 的表述从「绕法」改为「已修 + 修法」）

**设计（还原上游语义，不发明新行为）:**
1. runtime 增加一个 per-session 的 `pendingCommandTexts: Map<sessionID, string>`（放进
   `createRuntimeState()`，跟随现有 runtime 生命周期清理）。
2. `command.execute.before` 开头（校验通过后）：`pendingCommandTexts.set(sessionID, args)`
   （args 为 trim 后的 arguments 原文）。
3. `chat.message` 的现有前缀豁免之后追加：若 `text.trim()` 与 `pendingCommandTexts.get(sessionID)`
   相等，`delete` 该记录并 `return`（一次性豁免，防误吞后续同文本真人消息）。
4. 上游前缀检查**保留**（双保险，也保住 diff 可读性）。

**TDD:**
- RED: 用例 A「命令展开消息不触发 pause」：构造 GoalPlugin hooks，先调 `command.execute.before`
  （command=goal, arguments=X, sessionID=s）建目标，再调 `chat.message`（同 sessionID，text=X），
  断言目标未被 pause（`stopped !== true`）。当前实现应 FAIL。
- 用例 B「真人新消息仍触发 pause」：同上但 `chat.message` 的 text 为不同文本，断言 pause 发生。
- 用例 C「豁免一次性」：同文本连发两条，第二条应触发 pause。
- GREEN 后全量 `node --test test/*.test.js` 归零（基线 275 + 新增 3）。

**E2E 复验（真实 deveco，tmux）:**
`goal.sh init` 新临时项目 → `/goal <一个一轮做不完的目标>` → 断言:
(a) 创建后 `state.json` 里目标**非** paused；(b) 首轮结束后观测到**插件发起的自动续推 turn**
（上一轮 E2E 没观测到的路径）；(c) 证据门控完成归档。

**Commit:** `fix(lesson3): 命令消息豁免适配 deveco 的 $ARGUMENTS 展开（修「创建即 paused」）`

### Task 10c: observe.sh 路径归一化修复（执行期新增，用户拍板，一行）

Task 10 E2E 发现：macOS 上 `/tmp` 是 `/private/tmp` 的软链，`lesson1-insight/observe.sh` 的
`cmd_observe()` 用逻辑 `pwd` 归一化目录，与 deveco 落盘的物理路径对不上，SQL 精确匹配落空，
误报「这个项目还没用 deveco 跑过」。

- Modify: `lesson1-insight/observe.sh`（`pwd` → `pwd -P`，单行）
- 复验：`goal.sh observe /tmp/goal-e2e`（字面软链路径）应成功导入而非跳过
- 注意：lesson1 归并行会话维护，本任务单独成 commit、只改这一行，便于对方 review/回滚
- Commit: `fix(lesson1): observe.sh 目录归一化用物理路径（/tmp 软链下误报未运行）`

## 任务依赖

```
Task 1 (vendor) ──> Task 3 (路径/env) ──> Task 4 (query.directory) ──> Task 8 (文案)
Task 2 (probe) ────────────────────────────> Task 7 (smoke)
Task 1,5 ──> Task 6 (goal.sh) ──> Task 7 ──> Task 9 (README) ──> Task 10 (E2E)
Task 5 (入口) 依赖 Task 1；Task 2 与 Task 1/3/4/5 可并行
```
