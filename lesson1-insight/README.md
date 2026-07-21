# Lesson 1:用 DevEco 对接 cannbot-insight

给 DevEco 的 agent 会话装上「回放镜头」:任意项目跑过的会话,都能导进
cannbot-insight,turn-by-turn 看每一轮烧了多少 token、上下文怎么涨、
调了哪些工具。

## 你会学到

- DevEco 的会话数据长什么样、存在哪
- 为什么 cannbot-insight 能**零改码**直读 DevEco 的会话库
- 用 `observe.sh` 把任意项目的会话导入并在 Web 界面回看

## 前置条件

仓库根跑过 `./setup.sh`(会备好 node、cannbot-insight 依赖与数据库),
并且 `deveco auth login` 已配好模型。

## 原理:一次「免费」的适配

deveco 是 opencode 派生的,它的会话库
`~/.local/share/deveco/deveco.db` 里 `session` / `message` / `part`
三张表的结构,和 cannbot-insight 的 `opencode-db` 适配器要求的**一模一样**。
所以对接不需要写任何转换代码——`observe.sh` 做的只是:

1. 按 `session.directory` 从 deveco.db 里捞出目标项目的所有 root 会话;
2. 逐个调 cannbot 的 CLI `import --source opencode-db` 导入(按 taskId 去重,幂等);
3. 起好 cannbot 的 Web server 让你回看。

## 动手

### 1. 造几条会话

随便建个目录,用 deveco 跑两三个会话(内容不重要,有工具调用更好看):

```bash
mkdir -p ~/play/hello-deveco && cd ~/play/hello-deveco
deveco run "写一个 fizzbuzz.js 并用 node 运行它"
deveco run "把 fizzbuzz 改成 1 到 30 并重新运行"
```

### 2. 导入观测

```bash
cd <本仓库>
./lesson1-insight/observe.sh ~/play/hello-deveco
```

看到 `✅ 观测就绪: http://localhost:21025` 就成了。

### 3. 回看

浏览器开 http://localhost:21025,点进刚导入的会话,逐个看分析页:
tokens/成本、上下文增长、工具调用、工作流阶段、概念传播……

重复跑 `observe.sh` 是幂等的(按 taskId 去重,更新而非新增),放心多导几次。

## 验收

- [ ] 能在 Web 界面指出某一轮的输入/输出 token 数
- [ ] 能说出该会话调用了哪些工具、各调了几次
- [ ] 对同一项目重跑 `observe.sh`,会话数不翻倍(幂等)

## 坑

- **node 版本**:不强卡。better-sqlite3(11.10.0)对 node 18/20/22/23 有
  预编译包、免编译直装;其他版本走本机编译路径,有工具链(VS Build
  Tools / Xcode CLT)就能过,没有就换 20/22。`observe.sh` 先试当前
  node 能否加载,不行再自动切 nvm 的 20。
- **observe 是旁路**:cannbot 没装好、server 起不来、deveco.db 不存在,
  都只是提示一句然后退出码 0——它被设计成绝不影响调用方(第三课的
  ralph loop 收工后会自动调它,不能因为观测挂了污染跑分结论)。
- **server 日志**在 `/tmp/cannbot-insight.log`,起不来先看它。
- **删项目目录清不掉会话**:会话存在 `~/.local/share/deveco/deveco.db` 里,按「目录路径」
  记账,永久保留;cannbot 的导入也是增量的。删掉项目再在同一路径重建,observe 仍会把
  历史会话全捞出来。想要干净视图:**每次实验换个新目录名**(路径即隔离);想清空 cannbot
  页面:杀掉 21025 的 server → 删 `vendor/cannbot-insight/prisma/dev.db` → 重跑 `./setup.sh`
  重建空库(deveco.db 不动,历史随时能重新导入)。

## 环境变量

| 变量 | 默认 | 作用 |
|------|------|------|
| `CANNBOT_INSIGHT_DIR` | 本仓 `vendor/cannbot-insight` | cannbot-insight 装在哪 |
| `CANNBOT_INSIGHT_PORT` | `21025` | cannbot Web/API 端口 |
| `DEVECO_DB` | `~/.local/share/deveco/deveco.db` | deveco 会话库 |

## 下一课

[Lesson 2:deveco 的 /goal 目标循环插件](../lesson2-goal-plugin/README.md)——
给会话一个「完成条件」,单会话自续推进到证据门控完成;
到 [Lesson 3](../lesson3-ralph-loop/README.md) 的 ralph loop,再用这一课的观测回看整个跨会话循环的轨迹。
