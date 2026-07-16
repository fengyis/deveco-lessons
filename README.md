# deveco-lessons:DevEco 长程任务两课

用两个动手 lesson,学会「让 agent 长时间自主干活,并且看得见它在干什么」:

| | 主题 | 你得到什么 |
|---|------|-----------|
| [Lesson 1](lesson1-insight/README.md) | 用 DevEco 对接 cannbot-insight | 任意 DevEco 会话的 turn-by-turn 回放:token、上下文、工具调用 |
| [Lesson 2](lesson2-ralph-loop/README.md) | 对 DevEco 实现 ralph loop | worker → reviewer 自循环直到验收通过;smoke 案例跑出多轮/多工具/subagent/skill 的丰富会话 |

两课递进:第一课装好「镜头」,第二课跑起 loop 并用镜头回看它。

## 快速开始

```bash
git clone <本仓库> && cd deveco-lessons
./setup.sh            # 一键环境:node20/bun/cannbot 依赖与数据库,幂等可重跑
deveco auth login     # 唯一需要你自己完成的一步:配模型凭证
```

唯一前置:已安装 deveco(`npm install -g @deveco/deveco-code`)。
其余依赖(含 cannbot-insight 本体,vendor 在 `vendor/` 下)全部由
`setup.sh` 就地装好,不需要手工配置。

装完从 [Lesson 1](lesson1-insight/README.md) 开始。

## 两课各自怎么跑(最小路径)

**Lesson 1**(详见 [lesson1-insight/README.md](lesson1-insight/README.md)):

```bash
# 1) 随便建个目录,用 deveco 造几条会话
mkdir -p ~/play/hello-deveco && cd ~/play/hello-deveco
deveco run "写一个 fizzbuzz.py 并运行它"

# 2) 回到本仓库,把会话导进 cannbot-insight
cd <本仓库>
./lesson1-insight/observe.sh ~/play/hello-deveco

# 3) 浏览器开 http://localhost:21025,点进会话看 token/上下文/工具调用
```

**Lesson 2**(详见 [lesson2-ralph-loop/README.md](lesson2-ralph-loop/README.md)):

```bash
cd lesson2-ralph-loop
./ralph.sh init   ~/ralph-smoke
./ralph.sh sample smoke ~/ralph-smoke   # 观测演示案例:规划→写码→subagent→skill,约 2 分钟
./ralph.sh run    ~/ralph-smoke         # worker→reviewer 循环到验收;收工自动跑 lesson1 的观测
```

## 仓库结构

```
setup.sh                一键环境脚本
vendor/cannbot-insight  会话观测器(源码 vendor,依赖由 setup.sh 现场安装)
lesson1-insight/        第一课:观测对接(observe.sh + 教学文档)
lesson2-ralph-loop/     第二课:ralph loop(ralph.sh + 模板 + 案例 + 测试)
```
