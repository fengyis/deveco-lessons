# Lesson 3:把 opencode-goal-plugin 移植成 devecocode-goal-plugin

会话内 `/goal <目标>` 设一个目标,插件挂在 `session.idle` 上自己续着往下推,直到证据门控判定完成——
不用你手动喊「继续」。跟 [Lesson 2](../lesson2-ralph-loop/README.md) 的 ralph loop 形态不一样:
ralph loop 靠外部 shell 起 server、点火、拉 worker/reviewer 两个独立会话;这一课**不点火、单会话**,
裁决也不是独立 reviewer 会话说了算,而是插件自己按 evidence(工具调用记录、turn/token/时长上限)门控。

## 你会学到

真实插件移植的方法论,四步:

1. **定位上游 hook 依赖**——先读上游源码,搞清楚它挂了哪些 host hook(`command.execute.before`、
   `tool.execute.before`、`session.idle` 等),这些 hook 是移植后必须在新 host 上逐个验证的清单。
2. **探测 deveco 二进制到底支持哪些能力**——光看上游代码猜不出 deveco 0.1.1 的真实行为,必须写最小
   探针插件实测。本课的探针实测记在 [`docs/probe-notes.md`](docs/probe-notes.md),四个问题都有
   curl 请求 + 响应原文 + 落盘证据。
3. **vendor 布局让适配 diff 可审**——上游源码原样复制进 `template/`,改动全部走 `git diff`,不在
   复制过程中顺手"整理"代码,这样任何人都能看清楚移植改了什么、没改什么。
4. **上游测试套件锁定移植正确性**——上游的 275 条测试原样搬过来跑,一处没改就是最强的回归保证:
   移植出错第一时间就是某条上游测试变红,而不是等到跑起来才发现语义漂移。

`/goal` 的证据门控比「模型自己说完成」可靠,原因很直接:模型在长会话里判断"我做完了"这件事本身
不可靠(容易过早收尾或者自我复述),而插件用**可核实的信号**——工具调用记录、turn 数、耗时、
token 消耗——去卡完成条件,不看模型嘴上怎么说。

## 前置条件

- 完成 [Lesson 1](../lesson1-insight/README.md) 和 [Lesson 2](../lesson2-ralph-loop/README.md)。
- `deveco auth login` 已配好模型。
- node ≥18(跑本课的 `node --test`)。
- shell 里**不能有** `DEVECO_SERVER_PASSWORD`(同 [Lesson 2 坑 #4](../lesson2-ralph-loop/README.md#适配-deveco-时踩到的四个坑):一设,插件内 `client` 调自己 server 会吃 401)。
- **Windows 用户**走 Git Bash,对齐根 [README 的 Windows 前置说明](../README.md#windows-用户git-bash):
  node ≥20(`better-sqlite3` 只对 20/22 有 Windows 预编译包),自己装好,`setup.sh` 不代装。

## 用法

```bash
cd lesson3-goal-plugin
./goal.sh init ~/my-project        # 装:插件 + /goal 命令(merge 进 deveco.json,已有字段不覆盖)
cd ~/my-project && deveco          # 起一个交互会话
```

会话里:

```
/goal 把 fizzbuzz.js 写出来并跑通       # 设定目标,自动续推
/goal status                          # 看当前目标状态
/goal history                         # 看历史记录
```

Agent 工具面(`get_goal` / `set_goal` / `get_goal_history` 等)在 deveco 上同样注册成功——冒烟脚本
实测过,模型能准确说出 `set_goal` 这个工具名(见下方"这次新踩的坑" #1)。

其它命令:

```bash
./goal.sh status ~/my-project   # 不进会话,直接看 .deveco/goals/state.json
./goal.sh observe ~/my-project  # 复用 Lesson 1 把会话导进 cannbot-insight
```

可选配置 `<项目>/.deveco/goal-plugin.json`,内容就是上游的 pluginOptions,缺省全走上游默认值。
常用几个键:

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxTurns` | `10` | 自动续推轮数上限 |
| `maxDurationMs` | `900000`(15 分钟) | 耗时上限 |
| `maxTokens` | `200000` | 上下文 token 上限 |
| `commandName` | `"goal"` | 命令名,改了就是 `/<你的名字>` 而不是 `/goal` |

**排障第一句:看 `.deveco/goals/plugin.log` 有没有加载记录。** 没有就说明插件根本没被 deveco 发现
(通常是路径不对或者还没建过会话——见下方"适配点" #1 和"这次新踩的坑" #2)。

## 移植方法论

按 Task 1-8 的真实过程走的,不是先写文档再补代码:

**先原样 vendor,再谈适配。** Task 1 把上游 `opencode-goal-plugin` v0.6.5(commit
`2d3e97e`,见 [`upstream.lock`](upstream.lock))的 6 个 `.js` 源文件和全部测试文件原样复制进
`template/.deveco/plugin/devecocode-goal-plugin/` 和 `test/`,测试导入路径改了一处前缀,**逐字节
不改源码**。跑一遍上游测试确认基线:263 pass(vendor 前后结果一致),后面每个 Task 加了新场景测试,
最终到 275 pass。这一步的意义是:后续所有"这处要不要改"的争论,都能用"改了会不会让这条上游测试变红"
来裁决,而不是靠直觉。

**怎么确定 deveco 0.1.1 支持哪些 hook。** 光读上游代码只知道它*想*挂哪些 hook,不知道 deveco 这个
host *实际*怎么执行这些 hook——尤其是 `output.parts` 这种"写了就该生效"的写法,不同 host 实现可能
完全不同。Task 2 写了一个最小探针插件(`/tmp/goal-probe`,未提交,代码见
`docs/probe-notes.md` 第一段落),直接挂上跟上游同名的 hook,用 curl 打真实 HTTP 请求触发,再从两处
拿证据核实行为:一是模型的 reasoning trace(模型"看到"了什么),二是 `~/.local/share/deveco/deveco.db`
的**只读** sqlite 查询(host 到底往磁盘写了什么)。四个问题、四个实测结论,逐条记在
[`docs/probe-notes.md`](docs/probe-notes.md),Task 7 的冒烟脚本、Task 3/4 的适配代码全部引用这份笔记
作为事实依据,而不是重新猜一遍。

**为什么内部命名一律不改。** Task 8 只改了 5 处**用户/模型可见**的字符串(品牌文案,`OpenCode` →
`DevEco Code`),标识符、注释、SDK 契约报错字符串一律原样保留——哪怕注释里写着过时的
`.opencode-goal-plugin` 路径也不动。理由是 `git diff` 要能审:review 时只需要看"这处改动是不是用户
会看到的文案",不用逐行猜"这个改动是不是顺手重构了什么"。`upstream.lock` 里专门写了
"diff 上游"这一行,说明这套 vendor 之后要能随时跟上游对比。

## 适配点

逐条列 Task 3/4/5/8 的改动,每条都有"为什么 deveco 需要这个":

1. **状态目录 `.opencode/` → `.deveco/`**(Task 3,`goal-plugin.js:27` 的
   `PROJECT_LOCAL_STATE_SUBPATH`)。deveco 只认 `.deveco/` 下的插件和配置(跟
   [Lesson 2 坑 #1](../lesson2-ralph-loop/README.md#适配-deveco-时踩到的四个坑)同一个原因),状态文件
   路径跟着改,否则装完插件也找不到自己的状态。
2. **新增 `DEVECO_GOAL_STATE_PATH` 环境变量,优先于上游原有的 `OPENCODE_GOAL_STATE_PATH`**
   (Task 3,`goal-plugin.js` `resolveStateFilePath`)。给用惯 deveco 命名习惯的用户一个对齐的入口,
   上游的 home/XDG 迁移回退逻辑原样保留,`OPENCODE_GOAL_STATE_PATH` 仍作为回退被承认——不破坏已有集成。
3. **session API 的 legacy 入参注入 `query: { directory }`**(Task 4,`opencode-session-api.js`)。
   上游自带 flat/legacy 双形状适配层,legacy 形状恰好是 deveco 要的 hey-api 形状且已是默认——但 deveco
   的 SDK 还要求 `query.directory` 才能定位到正确的项目目录,给适配层加了一个 **opt-in** 的
   `directory` 选项:不传时跟上游逐字节同行为,传了才在 8 个方法(`messages` / `promptAsync` /
   `createChild` / `prompt` / `update` / `get` / `delete` / `abort`)的 legacy 入参上都补一层
   `query.directory`,flat 入参不受影响。
4. **入口壳 `devecocode-goal-plugin.ts`**(Task 5)。deveco 的插件发现机制要求 `.deveco/plugin/*.ts`
   下有个入口文件,这个壳做两件事:一是把加载信号写进 `.deveco/goals/plugin.log`(判断插件到底有没有
   被发现的唯一依据,同 Lesson 2 `.ralph/plugin.log` 的经验);二是读可选的
   `.deveco/goal-plugin.json` 当 pluginOptions 传给上游 `GoalPlugin` 工厂函数。
5. **品牌文案 5 处**(Task 8,含一次评审补漏)。只改用户/模型可见的叙述文案:`goal-plugin.js` 里
   `history` 字段的 3 处暂停原因描述、`buildCompactionContext` 里的 1 行压缩上下文提示(连带冠词
   `An OpenCode` → `A DevEco Code`,因为 "DevEco Code" 辅音开头),以及评审复扫时补的
   `persistence-lease.js:87` 一处并发锁报错文案。标识符(`createOpenCodeSessionApi` 等)、注释、
   `OPENCODE_GOAL_STATE_PATH` 这类协议层字符串全部保留。

## 这次新踩的坑

实现过程中真实遇到的,按教学价值取舍(没踩到的不编):

1. **`command.execute.before` 的 `output.parts` 在 deveco 0.1.1 上既不进模型 prompt 也不进落盘响应。**
   探针实测发现:hook 里把 `output.parts` 覆写成 `"probe intercepted"`,期望短路命令直接返回这段文本,
   但命令依然触发了完整的真实模型对话,最终回复是模型自己生成的内容。用两重证据钉死这个结论:模型的
   reasoning trace 里完全没提到覆写内容,只字不差围绕原始输入展开;`~/.local/share/deveco/deveco.db`
   的只读查询也确认落盘的 `part` 表里根本搜不到覆写字符串。上游 `/goal` 的只读子命令(`status` /
   `history`)原本是靠 `output.parts` 短路、不经过模型的,这条路在 deveco 上走不通——但整体功能依然
   能工作:命令照样触发真实模型轮次,靠已注册的 `get_goal`/`set_goal` 工具 + `tool.execute.before`
   只读守卫兜住语义。冒烟实测里模型准确回了 `"No active goal set. Use `set_goal` to define one."`——
   模型能说出 `set_goal` 这个确切工具名,就是插件确实挂上了的证据。详见
   [`docs/probe-notes.md`](docs/probe-notes.md) 问题 1。
2. **插件在首个会话创建时才加载,不是 server 启动时。** 探针记录:server 起来后 `sleep 5`,
   `.probe.log` 文件都还不存在;直到 `POST /session?directory=...` 建了第一个会话,`.probe.log` 才
   第一次出现,`plugin loaded` 排在 `session.created` 之前几毫秒。这条结论直接决定了冒烟脚本的检查
   顺序——`.deveco/goals/plugin.log` 的 `grep` 必须放在建会话之后,放在 server 刚起来那一刻永远
   grep 不到,不代表插件没装对。见 [`docs/probe-notes.md`](docs/probe-notes.md) 问题 3。
3. **`POST /session/{id}/command?directory=...` 端点可以直接触发命令执行**,不用绕消息接口。探针
   验证过这个端点返回 200 并真实触发了 `command.execute.before`,冒烟脚本(`scripts/smoke.sh`)直接
   用它打 `/goal status`。代价是每次调用都是一次真实 LLM 请求:约 12-13k input tokens、8 秒左右,
   冒烟脚本要为此预留超时和轮询时间。
4. **macOS bash 3.2 的 `${VAR}` 花括号紧跟中文/全角字符,连咬两口。** `goal.sh` 的
   `install_file()` 里 `${f}` 后面紧跟中文字符,`scripts/smoke.sh` 里 `${SID}` 后面紧跟全角右括号
   `）`、`${MATCH_SOURCE}` 同样紧跟全角右括号——三处都因为省略花括号在 macOS 自带的 bash 3.2 下炸出
   `unbound variable`。[Lesson 2](../lesson2-ralph-loop/README.md) 已经记过一次同款坑,这一课又踩了
   两次,说明这不是运气问题而是习惯问题:**变量后面紧跟非 ASCII 字符,花括号必须写**,写代码时的
   第一直觉常常漏掉这条。
5. **`set -euo pipefail` 下 `VAR=$(curl ...)` 在循环里会整个杀死脚本。** `smoke.sh` 的轮询循环里,
   一次 `curl` 瞬时失败(超时/连接被重置)会让这次赋值命令本身返回非零,`set -e` 直接中断整个脚本,
   连带下面负责 dump 诊断信息的分支都跳过——症状是脚本莫名其妙提前退出,连一行错误提示都没有。
   评审抓出来的这个问题,修复方式是 `VAR=$(curl ... || true)`,让单次网络抖动落到"这轮没拿到数据,
   继续轮询"而不是"脚本直接死"。修复后跑了负向验证(人为让 curl 失败一次,确认脚本能继续走完轮询)。
6. **SDK 形状是 lesson2 坑 #3 的续集。** 上游自带的 flat/legacy 双形状适配层,legacy 形状恰好就是
   deveco 要的 hey-api 形状而且已经是默认——这点省了一次踩坑;但 deveco 还额外要求 `query.directory`,
   所以给适配层加了 opt-in 的 `directory` 选项(详见"适配点" #3)。
7. **测试为什么用 `node --test` 不用 `bun test`。** 上游本来就是 `node --test`,`node:test` 在
   bun 下兼容性不完整;改用别的跑法会削弱"上游测试套件锁定移植正确性"这条证据链——测试跑法本身也是
   验证基线的一部分,换了跑法就不再是同一套基线。

## 观测(复用 Lesson 1)

```bash
./goal.sh observe ~/my-project
```

把这个会话导进 cannbot-insight,turn-by-turn 回看 `/goal` 每一轮续推烧了多少 token、工具调了什么。
旁路语义同 [Lesson 2](../lesson2-ralph-loop/README.md#观测这个-loop复用-lesson-1):lesson1 脚本不在、
cannbot 没装好,都只是跳过并提示一句,不影响 `/goal` 本身的结论。

## 测试

```bash
node --test test/*.test.js   # 275 条:上游原有 + 本课新增的适配/goal.sh/smoke 场景
scripts/smoke.sh              # 起真实 deveco serve,验证插件加载 + /goal 命令拦截链路,实测过两次
```

<!-- 端到端验证结论:Task 10 走查后回填 -->
