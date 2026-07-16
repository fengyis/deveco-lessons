# Lesson 2:对 DevEco 实现 Ralph Loop

给 deveco 一个目标,它自己 worker → reviewer → worker 循环推进,直到 reviewer 判定验收通过。

## 你会学到

- ralph loop 的三件套:worker / reviewer / 插件,以及为什么裁判和执行者要分离
- 装(init)与跑(once/run)分离的工程理由
- 独立验收测试为什么必须藏在 worker 摸不到的地方
- 把 opencode 生态的东西适配到 deveco 时的四个坑
- (进阶)用 SWE-bench Lite 做单次执行 vs loop 的 A/B 对比

## 前置条件

完成 [Lesson 1](../lesson1-insight/README.md)(本课收工后自动复用它回看轨迹);
仓库根跑过 `./setup.sh`,`deveco auth login` 已配好模型;
shell 里**不能有** `DEVECO_SERVER_PASSWORD`(脚本会 unset,手动起 server 时要注意)。

## 三件套

- **worker**(`ralph-worker`):每轮挑一个最小可验证子任务做掉,写进 `.ralph/PROGRESS.md`,git commit。
- **reviewer**(`ralph-reviewer`):只读裁判,用 git log / git diff 核实,最后一行必须是 `DONE` 或 `CONTINUE: <还差什么>`。
- **插件**(`.deveco/plugin/ralph-loop.ts`):监听 worker 的 `session.idle` → 开一个 reviewer 会话要裁决 → `DONE` 就写 `.ralph/DONE` 收工,否则把 worker 再踢一轮。到 `maxIterations` 仍未 DONE 则写 `.ralph/STOPPED`。

## 用法

以下命令都在本目录(`lesson2-ralph-loop/`)下执行:

```bash
./ralph.sh init ~/my-project        # 装:插件、agent、git、配置、GOAL 骨架(会改你的仓库)
vim ~/my-project/.ralph/GOAL.md     # 写目标 + 「能被 git/测试客观核实」的验收标准
./ralph.sh once ~/my-project        # 单次基线:一个 worker,无 reviewer、无续轮
./ralph.sh run  ~/my-project        # 跑:起 server、点火、盯到收工、自动关 server
```

**装和跑是分开的**,因为装是有副作用的一次性动作(git init、生成配置),而跑应该可重复。
`run` **绝不覆盖**你在项目里改过的插件或 agent 提示词,只在检测到差异时提示一句;
真要拿模板覆盖回去,显式 `init --update`。

先拿现成案例练手(`examples/` 下):

```bash
./ralph.sh sample list                    # 看有哪些案例
./ralph.sh init   ~/ralph-smoke
./ralph.sh sample smoke ~/ralph-smoke     # 30 秒验证链路通不通
./ralph.sh run    ~/ralph-smoke
```

`sample` 会把案例的目标、定制版 reviewer、以及**独立验收测试**一起装进去。
验收测试故意放 `.ralph/verify.test.ts` 而不是 `test/` —— worker 有全部工具权限,
能改甚至删掉 `test/` 下的用例把 `bun test` 弄绿;`bun test` 不扫隐藏目录,
放这儿它看不见也动不了,跑完你自己 `bun test ./.ralph/verify.test.ts` 复验。

想实时看它每轮在干什么,另开一个终端挂 TUI(脚本会把命令打出来):

```bash
deveco attach http://127.0.0.1:4097 --session $(cat ~/my-project/.ralph/session_id)
```

结束标志:`.ralph/DONE`(验收通过)或 `.ralph/STOPPED`(到达 maxIterations 仍未通过)。

`.ralph/config.json`:`workerAgent` / `reviewerAgent` / `maxIterations`(默认 20,第一次跑建议先设 3 验证链路)。

## 观测这个 loop(复用 Lesson 1)

`run` **收工后会自动跑一次**观测——调的就是第一课的
[`../lesson1-insight/observe.sh`](../lesson1-insight/observe.sh),把这轮 loop 的
worker / reviewer 会话导进 cannbot-insight,开 http://localhost:21025
turn-by-turn 回看:每轮烧了多少 token、上下文怎么涨、各调了哪些工具。

- 不想要自动观测:`RALPH_NO_OBSERVE=1 ./ralph.sh run ...`
- 手动补一次:`./ralph.sh observe ~/my-project`
- 观测是**旁路**:lesson1 脚本不在、cannbot 没装好、server 起不来,都只是跳过并提示一句,
  **绝不影响本次 run 的结论**。
- 环境变量(`CANNBOT_INSIGHT_DIR` 等)见 [Lesson 1 的表](../lesson1-insight/README.md#环境变量),原样透传。

worker(`ralph`)和 reviewer(`ralph-reviewer`)各是独立的 root 会话,靠
`session.directory` 归到一起,所以 observe 一次就能把两边全导进去;重复导入幂等。

## 适配 deveco 时踩到的四个坑

这套东西最早是照 opencode 的约定写的,直接搬到 deveco 上四处都不通,逐个记下来:

1. **配置目录是 `.deveco/` 不是 `.opencode/`**。deveco 只从 `.deveco/plugin/*.ts` 发现插件、从 `.deveco/agent/*.md` 读 agent(见 `config/paths.ts` 的 `targets: [".deveco"]`)。放在 `.opencode/` 下是**静默无效**——不报错,插件根本不加载。判断插件到底有没有加载,看 `.ralph/plugin.log` 有没有生成。
2. **配置文件是 `deveco.json(c)` 不是 `opencode.json`**。
3. **SDK 是 hey-api 风格,参数要包起来**:`session.create({ body: { title } , query: { directory } })`、`session.prompt({ path: { id }, query: { directory }, body: { agent, parts } })`。写成扁平的 `{ title, agent }` / `{ sessionID, parts }` 会创建不出会话。(deveco 0.1.1 自己的 `cli/cmd/run.ts` 就写成了扁平的,所以 `deveco run --attach` 本身是坏的,只会报 `Session not found` —— 别用它点火,直接打 HTTP API,`ralph.sh` 就是这么做的。)
4. **不要设 `DEVECO_SERVER_PASSWORD`**。一设,`deveco serve` 就开 basic auth,而插件里注入的 `client` 不带凭证,它调自己 server 时会吃 **401**,表现为 reviewer 会话创建失败、循环空转。

另外:**server 只能按端口杀**。`pkill -f "deveco serve"` 杀不掉,`kill` 掉 `deveco serve` 的进程号也杀不掉——真正监听的是它 fork 出来的 `deveco-code-darwin-arm` 子进程。用 `lsof -ti:4097 | xargs kill -9`。否则你以为重启了,其实跑的还是旧进程里的旧插件。

## 进阶:跑 SWE-bench Lite 实例

完整的困难实例已经放在
[`examples/swebench/django__django-12589/`](./examples/swebench/django__django-12589/README.md):
包含可直接传给 `swebench prepare` 的盲测 JSON,以及从克隆官方基线到 harness 最终验收的全部命令。

做 A/B 对比时准备三个东西:

1. 两份都 checkout 到同一个 `base_commit` 的干净 Git 仓库;
2. SWE-bench Lite 的单条实例 JSON(至少含 `repo`、`instance_id`、`base_commit`、`problem_statement`)。
3. 两边完全相同的 `.ralph/config.json` 中的 `workerModel`。

```bash
./ralph.sh swebench prepare ~/work/issue-once ./instance.json --model-name same-model-once
./ralph.sh swebench prepare ~/work/issue-loop ./instance.json --model-name same-model-ralph-loop

./ralph.sh once ~/work/issue-once
./ralph.sh swebench export ~/work/issue-once ./once.jsonl --once

./ralph.sh run ~/work/issue-loop
./ralph.sh swebench export ~/work/issue-loop ./loop.jsonl
```

`prepare` 会把原始 Issue 转成模式中立的「复现 → 定位 → 修复 → 反证 → 回归」证据目标。
两组的 `GOAL.md` 完全相同;`once` 只运行一个 worker 会话,`run` 才启用 reviewer 和续轮。
它只复制解题必需字段,明确不把 `patch`、`test_patch`、`FAIL_TO_PASS`、`PASS_TO_PASS` 或
hints 写进 agent 工作区;Ralph 自身的控制文件也不会进入最终补丁。

普通 `export` 仍要求 Reviewer 真实 `DONE` 且补丁非空;`export --once` 要求单次会话确实结束,
但允许空补丁,以便官方 harness 如实记录失败。两者都要求工作区干净且 HEAD 从 `base_commit` 派生。
输出都只有官方格式的 `instance_id`、`model_name_or_path`、`model_patch` 三个字段。

官方容器评测:

```bash
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path ./loop.jsonl \
  --instance_ids django__django-12589 \
  --max_workers 1 \
  --run_id ralph
```

## 测试

```bash
bun test test/ralph-loop.test.ts test/swebench-cli.test.ts
            # 裁决解析 + 配置合并 + SWE-bench prepare/export
```

端到端验证过:干净 git 仓库 + `hello ralph` 目标 → worker 建文件并提交 → reviewer 裁决 DONE → `.ralph/DONE` 落盘。
