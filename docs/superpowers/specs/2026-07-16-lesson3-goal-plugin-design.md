# Lesson 3:devecocode-goal-plugin —— 把 opencode-goal-plugin 全量移植到 DevEco Code

日期:2026-07-16
状态:已与用户确认(改造起点、上游选型、移植范围、使用形态、落地方式均经决策)

## 目标

以开源 [willytop8/OpenCode-goal-plugin](https://github.com/willytop8/OpenCode-goal-plugin)
(v0.6.5,commit `2d3e97edeb6e1ecfbe21b193616987df335f047f`,MIT)为上游,
全量移植为 deveco 适配的 **devecocode-goal-plugin**,作为课程 Lesson 3。

goal plugin 与 lesson2 的 ralph loop 是不同形态:**单会话内**的目标自续航——
用户在 deveco TUI 里 `/goal <目标>` 设定持久目标,插件在会话空转时自动续推,
直到证据门控判定完成、出现阻塞、或触发安全限制(轮数/时长/token/无进展)。
无需外部 shell 起 server 点火。

教学主题:**真实世界 opencode 插件的完整移植方法论**(承接 lesson2 的四个坑)。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 改造起点 | 移植开源 opencode-goal-plugin(非改造 ralph-loop.ts、非从零写) |
| 上游选型 | willytop8 版:纯 JS + d.ts、无 TUI 耦合、证据门控/多目标/ledger/verifier 全功能 |
| 移植范围 | 全量:src(~4900 行)+ 测试(~6800 行)都搬,只做 deveco 适配 |
| 使用形态 | 交互式 TUI 为主,安装脚本只负责装(`goal.sh init`) |
| 落地方式 | 方案 A:源码多文件 vendor 进 `.deveco/plugin/`,不 bundle、不走 npm |
| 内部命名 | 文件名/函数名保持与上游一致,最大化 git diff 可审性;只改用户可见品牌字符串 |
| 测试运行器 | 保持上游 `node --test`(node ≥18),不迁 bun test |

## 可行性依据(已探测验证)

deveco 0.1.1 二进制字符串探测,上游用到的 4 个 hook 全部存在:

- `command.execute.before`(拦截 /goal 命令)
- `session.idle`(空转自续触发)
- `experimental.chat.system.transform`(目标注入系统提示 + compaction 保活)
- `config`(注册原生 goal/goal-verify agent)

另确认:`$ARGUMENTS` 命令模板支持;`.deveco/plugin/`、`.deveco/command/` 目录被发现。

上游自带双形状 session API 适配层(`opencode-session-api.js`):
"flat" 为扁平参数,"legacy" 恰为 deveco 需要的 hey-api 风格(`{ path: { id }, body }`)。
默认 `preferredShape: "flat"`,且变更类调用(prompt/create/update/delete/abort)
失败**不会**自动换形状重试 —— 在 deveco 上必须显式配 `"legacy"`。

## 目录结构

```
lesson3-goal-plugin/
├── README.md            # 教学文档:用法 + 移植方法论 + 新踩的坑
├── goal.sh              # 只管「装」:init [--update] / status / observe
├── upstream.lock        # 上游 repo URL + commit hash,diff/升级凭据
├── template/.deveco/plugin/
│   ├── devecocode-goal-plugin.ts    # 入口(deveco 只发现顶层 *.ts),re-export 工厂
│   └── devecocode-goal-plugin/      # vendor 的 6 个源文件,文件名与上游一致
│       ├── goal-plugin.js
│       ├── opencode-session-api.js
│       ├── native-agent-config.js
│       ├── completion-claim.js
│       ├── goal-tool-result.js
│       └── persistence-lease.js
└── test/                # 上游 test/ 全量搬入 + 适配
```

## 安装与使用流

```bash
./goal.sh init ~/my-project     # 拷模板 + 往 deveco.json merge 两块配置
cd ~/my-project && deveco       # 进 TUI
/goal 把所有失败的测试修绿       # 设目标,之后空转自续、证据门控完成
./goal.sh status ~/my-project   # 场外看 .deveco/goals/state.json 摘要
```

- `init` merge 进 `deveco.json` 的两块:`command.goal`
  (`description` + `template: "$ARGUMENTS"` + `agent`)与插件配置块。
- `--update` 才覆盖用户改过的 vendor 文件;默认绝不覆盖(语义与 lesson2 一致)。
- `observe` 子命令委托 lesson1 的 `observe.sh`,旁路失败不影响主流程(同 lesson2)。

## 适配点清单(教学核心,每处都可 diff 上游看出)

1. **入口壳**:新增 `devecocode-goal-plugin.ts` re-export 插件工厂;
   vendor 源码放子目录,避免被 `.deveco/plugin/*.ts` 发现机制误加载。
2. **SDK 形状**:`createOpenCodeSessionApi(client, { preferredShape: "legacy" })`;
   必要时给 legacy 形状补 `query: { directory }`(lesson2 坑 #3 续集)。
3. **状态路径**:`.opencode/goals/state.json` → `.deveco/goals/state.json`
   (保留上游的迁移回退逻辑结构,只改常量)。
4. **配置文件**:`opencode.json` → `deveco.json`,示例配置同步改。
5. **环境变量**:`OPENCODE_GOAL_*` 改为双前缀都认,`DEVECO_GOAL_*` 优先。
6. **品牌字符串**:用户可见提示语中 "OpenCode" → "DevEco Code";
   内部文件名、函数名、类型名一律不动。

## 测试策略

- 上游 9 个测试文件全量搬入,`node --test test/*.test.js` 原样跑。
- 测试全绿 = 移植正确性的机械证据(适配路径/品牌断言处逐条改)。
- 不迁 bun test:node:test 在 bun 下兼容性不完整,不值得冒险;README 说明取舍。

## E2E 验证

- 自动化:全量测试套件 + 「插件加载冒烟」脚本
  (起 `deveco serve`,确认插件被发现、`.deveco/goals/` 状态目录落盘)。
- 交互:README 提供手动 TUI 走查清单
  (/goal 设目标 → 观察空转自续 → 证据门控完成 → /goal status);
  交付前按清单跑一遍真实会话。

## README 教学结构

沿用 lesson2 文体:

1. 你会学到
2. 前置条件(lesson1 观测 + lesson2 的 deveco 认知)
3. 用法(init → TUI → /goal → status)
4. **移植方法论**:定位上游 hook 依赖 → 二进制字符串探测 deveco 能力 →
   vendor 布局让适配 diff 可审 → 用上游测试套件锁定正确性
5. 这次新踩的坑(实现中如实记录)
6. 测试

## 风险与开放问题

- `command.execute.before` 在 deveco 0.1.1 上的实际行为(入参形状、能否吞掉命令)
  只在二进制里确认了字符串存在,未跑通过 —— 实现第一步先做最小 hook 验证。
- 插件内 client 调自身 server 是否需要 `query: { directory }` 未定,实现时实测。
- `DEVECO_SERVER_PASSWORD` 的 401 坑(lesson2 坑 #4)同样适用,README 需继承警告。
