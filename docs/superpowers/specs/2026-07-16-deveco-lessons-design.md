# Spec: deveco-lessons — 两课制 DevEco 长程任务教学仓库

## 目标

把 `~/Workspace/others/longrunning_practice` 的内容重组为一个全新的教学仓库
`~/Workspace/others/deveco-lessons`,分成两个可动手的 lesson:

- **Lesson 1(lesson1-insight)**:用 DevEco 对接 cannbot-insight——把任意 DevEco
  项目的会话导入 cannbot-insight,turn-by-turn 回看 token 消耗、上下文增长、工具调用。
  独立成章,不依赖 ralph loop。
- **Lesson 2(lesson2-ralph-loop)**:对 DevEco 实现 ralph loop——worker → reviewer
  自循环直到验收通过;进阶章节为 SWE-bench Lite A/B 对比。复用 Lesson 1 的观测能力。

学员体验:`git clone` → `./setup.sh` → `deveco auth login` → 直接进 lesson1,
**不需要手工配置任何环境或依赖**。

## 非目标

- 不修改原仓库 `longrunning_practice`(保留原样,作为素材来源)。
- 不迁移旧课件(`outputs/`、`.deck-work/`)。
- **不打包/不代装 deveco 本体**:setup.sh 只检测 `deveco` 命令在不在,
  不在则打印安装提示(`npm install -g @deveco/deveco-code`)后退出。
- 不自动化 `deveco auth login`(模型凭证必须学员自己登录)。

## 仓库结构

```
deveco-lessons/
├── README.md                 # 课程总览:两课目标、学习顺序、快速开始(clone → setup → auth login)
├── setup.sh                  # 一键环境脚本(见下)
├── vendor/
│   └── cannbot-insight/      # cannbot-insight 源码整体 vendor
│                             #   来源:/Users/fengyi/Workspace/others/cannbot-skills-master-…/cannbot-insight
│                             #   排除:node_modules/、.next/、prisma/dev.db(运行时生成物)
│                             #   保留:package-lock.json(供 npm ci 精确复原依赖)
├── lesson1-insight/
│   ├── README.md             # 教学文档:目标 → 原理 → 动手步骤 → 验收 → 坑
│   └── observe.sh            # 独立观测脚本(从 ralph.sh 抽出)
└── lesson2-ralph-loop/
    ├── README.md             # 教学文档(含「适配 deveco 的四个坑」、进阶 SWE-bench)
    ├── ralph.sh              # 现 ralph.sh 迁入,observe 委托给 lesson1
    ├── template/             # .deveco 插件 + worker/reviewer agent 模板,原样迁入
    ├── examples/             # smoke/json/csv/semver/rustwrap + swebench/,原样迁入
    └── test/                 # ralph-loop.test.ts + swebench-cli.test.ts,原样迁入
```

## setup.sh(一键环境)

幂等、可重跑,每步「已满足则跳过」;bash 3.2 兼容,风格沿用 ralph.sh
(小函数、路径全引号、fail closed)。

步骤:

1. **deveco 检测**(不代装):`command -v deveco` 不在 → 打印
   `npm install -g @deveco/deveco-code` 提示并 `exit 1`。
2. **nvm + node 20**:cannbot-insight 的原生依赖 better-sqlite3 只在 node 20
   编得过(node 26 编不过 V8,homebrew node@22 有 dylib 问题)。nvm 不在则装
   (官方 install 脚本),再 `nvm install 20`。
3. **bun 检测/安装**:lesson2 测试与验收测试需要;不在则 `brew install oven-sh/bun/bun`
   或官方脚本。
4. **cannbot-insight 依赖**:在 `vendor/cannbot-insight` 下用 node 20 跑 `npm ci`;
   `node_modules` 已存在且完好则跳过。
5. **prisma 初始化**:生成空 `prisma/dev.db`(`npx prisma db push` 或等价命令),
   已存在则跳过。
6. **自检收尾**:逐项打印 `deveco --version`、node 20 下 `require('better-sqlite3')`
   成功、`bun --version`,全部 ✅ 后提示:「环境就绪。还差一步:`deveco auth login`
   配置模型凭证,然后进 lesson1-insight/」。

## Lesson 1:observe.sh

从 `ralph.sh` 抽出 `cmd_observe`、`_cannbot_node20`、`_cannbot_ensure_server`
(约 90 行,自成一体),改动:

- `CANNBOT_INSIGHT_DIR` 默认值从写死的个人路径改为**仓库相对路径**
  `<repo>/vendor/cannbot-insight`(按脚本自身位置解析,不依赖 cwd);
  环境变量仍可覆盖。
- 用法:`./observe.sh <项目目录>`——按 `session.directory` 把该项目下所有 root
  会话导入 cannbot-insight,幂等(按 taskId 去重)。
- 软失败语义保留:cannbot 没装好、server 起不来、node 版本不对,都只提示并跳过,
  退出码 0(observe 是旁路,绝不影响调用方)。
- 环境变量语义不变:`CANNBOT_INSIGHT_DIR` / `CANNBOT_INSIGHT_PORT`(默认 21025)/
  `DEVECO_DB`(默认 `~/.local/share/deveco/deveco.db`)。

Lesson 1 教学流程(README 骨架):

1. 目标:看懂一个 agent 会话到底怎么烧 token、调工具。
2. 原理:deveco 是 opencode 派生,`deveco.db` 的 `session`/`message`/`part`
   表结构与 cannbot-insight 的 opencode-db 适配器完全一致,零改码直读。
3. 动手:随便建个目录用 deveco 跑两三个会话 → `./observe.sh <目录>` →
   开 `http://localhost:21025` 点开会话看轨迹。
4. 验收:能在 Web 界面里指出某轮的 token 数与工具调用序列。
5. 坑:better-sqlite3 只认 node 20(setup.sh 已处理,此处解释为什么)。

## Lesson 2:ralph loop

`ralph.sh` 迁入后的改动(其余逻辑原样):

- `cmd_observe` 及两个 cannbot helper 删除,`observe` 子命令与 `run` 收工后的
  自动观测改为调用 `../lesson1-insight/observe.sh`(按脚本自身位置解析路径)。
  lesson1 脚本缺失时同样软失败。
- `RALPH_NO_OBSERVE=1` 跳过自动观测的行为保留。
- `template/`、`examples/`(含 swebench)、`test/` 原样迁入,路径引用随目录结构修正。

Lesson 2 教学流程(README 骨架,基于现 RUNBOOK 拆分):

1. 三件套:worker(最小可验证子任务 + PROGRESS.md + commit)、reviewer
   (只读裁判,`DONE`/`CONTINUE:`)、插件(session.idle → 裁决 → 续轮/收工)。
2. 装与跑分离:`init` / `once` / `run` 的语义,`init --update` 才覆盖模板。
3. 动手:`sample smoke` 30 秒链路验证 → json/csv 等案例;验收测试为何放
   `.ralph/verify.test.ts`(worker 摸不到)。
4. 观测:`./ralph.sh observe`(即 lesson1)回看每轮循环。
5. 「适配 deveco 的四个坑」:`.deveco/` 目录、`deveco.json(c)`、hey-api 风格
   SDK 参数、`DEVECO_SERVER_PASSWORD` 的 401;附「server 只能按端口杀」。
6. 进阶:SWE-bench Lite A/B(prepare/once/run/export/官方 harness 评测)。

## 验收标准

- 新仓根目录 `./setup.sh` 在本机重跑两次:第一次全装、第二次全跳过,均以自检 ✅ 结束。
- `bun test lesson2-ralph-loop/test/ralph-loop.test.ts lesson2-ralph-loop/test/swebench-cli.test.ts` 通过。
- `lesson1-insight/observe.sh <某个跑过 deveco 会话的目录>` 成功导入并打印
  `http://localhost:21025`;对不存在 vendor 的模拟场景软失败退出码 0。
- `lesson2-ralph-loop/ralph.sh sample list` 正常列出案例;`grep` 确认 ralph.sh
  中不再有 cannbot 实现代码、observe 委托指向 lesson1。
- 仓库内 `grep -r "cannbot-skills-master"` 无个人绝对路径残留。
- 原仓库 `longrunning_practice` git status 无变化。

## 边界

- Always:原仓库只读;vendor 时排除 node_modules/.next/dev.db;不提交任何凭证。
- Ask first:需要联网大装依赖之外的系统级改动(如升级 brew 包)。
