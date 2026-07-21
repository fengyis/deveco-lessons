# deveco-lessons:DevEco 长程任务三课

用三个动手 lesson,学会「让 agent 长时间自主干活,并且看得见它在干什么」:

| | 主题 | 你得到什么 |
|---|------|-----------|
| [Lesson 1](lesson1-insight/README.md) | 用 DevEco 对接 cannbot-insight | 任意 DevEco 会话的 turn-by-turn 回放:token、上下文、工具调用 |
| [Lesson 2](lesson2-goal-plugin/README.md) | 把 opencode-goal-plugin 移植成 deveco 的 /goal 插件 | 单会话内 `/goal <目标>` 自续到证据门控完成,不用外部 shell 点火、不用独立 reviewer 会话 |
| [Lesson 3](lesson3-ralph-loop/README.md) | 对 DevEco 实现 ralph loop | worker → reviewer 自循环直到验收通过;smoke 案例跑出多轮/多工具/subagent/skill 的丰富会话 |

三课递进:第一课装好「镜头」,第二课用最轻量的方式给会话一个目标——单会话自续,裁决靠证据门控;
第三课升级成跨会话的 ralph loop——worker 与 reviewer 分离,独立裁判验收,并用镜头回看整个循环。

## 快速开始

前置(自装两样):

- deveco:`npm install -g @deveco/deveco-code`
- Node.js(推荐 20/22 LTS):https://nodejs.org

```bash
git clone <本仓库> && cd deveco-lessons
./setup.sh            # 一键环境:bun、依赖与数据库,幂等可重跑
deveco auth login     # 唯一需要你自己完成的一步:配模型凭证
```

Windows 在 Git Bash 里跑同样的命令。装不上看 [docs/troubleshooting.md](docs/troubleshooting.md)。

## 三课各自怎么跑(最小路径)

**Lesson 1**(详见 [lesson1-insight/README.md](lesson1-insight/README.md)):

```bash
# 1) 随便建个目录,用 deveco 造几条会话
mkdir -p ~/play/hello-deveco && cd ~/play/hello-deveco
deveco run "写一个 fizzbuzz.js 并用 node 运行它"

# 2) 回到本仓库,把会话导进 cannbot-insight
cd <本仓库>
./lesson1-insight/observe.sh ~/play/hello-deveco

# 3) 浏览器开 http://localhost:21025,点进会话看 token/上下文/工具调用
```

**Lesson 2**(详见 [lesson2-goal-plugin/README.md](lesson2-goal-plugin/README.md)):

```bash
cd lesson2-goal-plugin
./goal.sh init ~/my-project    # 装:插件 + /goal 命令(merge 进 deveco.json)
cd ~/my-project && deveco      # 起交互会话
# 会话里: /goal <目标>          # 设定目标,单会话自续到证据门控完成
```

**Lesson 3**(详见 [lesson3-ralph-loop/README.md](lesson3-ralph-loop/README.md)):

```bash
cd lesson3-ralph-loop
./ralph.sh init   ~/ralph-smoke
./ralph.sh sample smoke ~/ralph-smoke   # 观测演示案例:规划→写码→subagent→skill,约 2 分钟
./ralph.sh run    ~/ralph-smoke         # worker→reviewer 循环到验收;收工自动跑 lesson1 的观测
```

## 仓库结构

```
setup.sh                一键环境脚本
docs/troubleshooting.md 安装疑难排查(better-sqlite3/prisma/网络)
vendor/cannbot-insight  会话观测器(源码 vendor,依赖由 setup.sh 现场安装)
lesson1-insight/        第一课:观测对接(observe.sh + 教学文档)
lesson2-goal-plugin/    第二课:opencode-goal-plugin 移植成 deveco 的 /goal 插件(goal.sh + vendor + 测试)
lesson3-ralph-loop/     第三课:ralph loop(ralph.sh + 模板 + 案例 + 测试)
```
