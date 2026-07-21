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

```bash
git clone <本仓库> && cd deveco-lessons
./setup.sh            # 一键环境:node/bun/cannbot 依赖与数据库,幂等可重跑
deveco auth login     # 唯一需要你自己完成的一步:配模型凭证
```

前置:已安装 deveco(`npm install -g @deveco/deveco-code`)。
其余依赖(含 cannbot-insight 本体,vendor 在 `vendor/` 下)全部由
`setup.sh` 就地装好,不需要手工配置。

**Windows 用户(Git Bash)**:三个脚本都适配了 Git Bash,额外前置只有一条——
自己装好 **Node.js**(https://nodejs.org ;setup.sh 在 Windows 上不代装 node,也不卡版本)。
装依赖时,原生扩展 better-sqlite3 按顺序走三条路:官方预编译包(node 18/20/22/23 有)
→ 仓库离线包(`vendor/prebuilds/`,覆盖 node 20)→ 本机源码编译(有 VS Build Tools +
Python 就能过)。三条全不通才失败——推荐 20/22 LTS(免编译最省事),
有编译工具链的机器用什么版本都行。

**必须用 node 24+?** 有编译工具链(VS Build Tools + Python)的机器可以自编预编译包
供全班离线复用——在装好依赖的 `vendor/cannbot-insight/node_modules/better-sqlite3`
里(此时 npm 已现场编译成功),把产物按官方资产名打包并放进 `vendor/prebuilds/`:

```bash
cd vendor/cannbot-insight/node_modules/better-sqlite3
ABI=$(node -e "console.log(process.versions.modules)")          # node 24 是 137
PLAT=$(node -e "console.log(process.platform + '-' + process.arch)")
tar -czf ../../../prebuilds/better-sqlite3-v11.10.0-node-v${ABI}-${PLAT}.tar.gz \
    build/Release/better_sqlite3.node
```

其他没有工具链的机器装依赖时会直接命中这个包,不再触发本机编译。

常见报错:
- `EINTEGRITY`(npm ci 校验和不匹配):先 `npm cache clean --force` 重试;仍失败则
  `npm config get registry` 看源——lockfile 钉的是官方源,公司内部源重新打包过的
  tarball 校验和对不上。能直连就 `npm ci --registry=https://registry.npmjs.org`;
  只能走内部源就删掉 `node_modules` 和 `package-lock.json` 后 `npm install` 重新生成。
- better-sqlite3 编译报错:node 版本不是 20.x,见上一条。已装 node 24 想共存的话用
  [nvm-windows](https://github.com/coreybutler/nvm-windows):`nvm install 20.19.5 && nvm use 20.19.5`。
- better-sqlite3 预编译包「拉不到」:它默认从 GitHub releases 下载,公司网络挡 GitHub 会失败。
  **本仓已自带 Windows(x64 + node 20)的预编译包**(`vendor/prebuilds/`),setup.sh 会让
  npm 优先用它,不需要联网到 GitHub。如果你换了别的 node 大版本或架构,再按镜像方案兜底:
  ```ini
  registry=https://registry.npmmirror.com
  better_sqlite3_binary_host_mirror=https://npmmirror.com/mirrors/better-sqlite3/
  ```
- prisma 报错(`binaries.prisma.sh` 连不上 / checksum 失败):Prisma 引擎二进制走独立 CDN。
  **本仓已自带 Windows 的两个引擎**(`vendor/prebuilds/prisma/windows/`,校验和与官方一致),
  setup.sh 会把它们种进 Prisma 的本地缓存,generate/migrate 直接命中、不联网;同时默认设了
  npmmirror 镜像(`PRISMA_ENGINES_MIRROR`,可覆盖)作为兜底。
  如果之前装到一半失败,先 `rm -rf vendor/cannbot-insight/node_modules` 再重跑 `./setup.sh`。
bun 由 setup.sh 走 PowerShell 自动安装;sqlite3 不需要装(观测脚本会用 vendor
里的 better-sqlite3 兜底)。或者直接用 WSL2,和 macOS/Linux 完全同一套流程。

装完从 [Lesson 1](lesson1-insight/README.md) 开始。

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
vendor/cannbot-insight  会话观测器(源码 vendor,依赖由 setup.sh 现场安装)
lesson1-insight/        第一课:观测对接(observe.sh + 教学文档)
lesson2-goal-plugin/    第二课:opencode-goal-plugin 移植成 deveco 的 /goal 插件(goal.sh + vendor + 测试)
lesson3-ralph-loop/     第三课:ralph loop(ralph.sh + 模板 + 案例 + 测试)
```
