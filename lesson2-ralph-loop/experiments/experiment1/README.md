# Experiment 1:单次 Agent vs. Ralph Loop(盲验收 A/B 对比)

你将亲手复现一个受控实验,回答一个问题:

> **同一个模型、同一份任务,「一次生成」和「带验收反馈的循环」到底差在哪?**

## 原理

任务是把 CPython `textwrap` 移植成行为等价的 Rust(5 个函数、12 个选项)。
验收是 816 条「输入 → CPython 期望输出」向量,**对 worker 完全隐藏**
(不在文件系统可见路径、不进 git 历史,红线禁读 + 赛后审计)。

- **A 组 `once`**:worker 一次会话,做完即止。没人告诉它哪错了。
- **B 组 `run`**:worker 循环推进;每轮结束,reviewer 跑隐藏验收,把
  **失败样例(输入/期望/实际)** 写进 `CONTINUE` 喂回去;满分才 `DONE`。

两组的 GOAL、模型、工具、盲验收完全一致。唯一被操纵的变量是**反馈环的有无**。

**为什么 worker 要用弱模型**(默认 `deepseek/deepseek-v4-flash`):这套课程反复实测过,
强模型(deepseek-chat 级)会靠对拍本机 CPython 参考自收敛到满分——只要正确性能在本地
验证,内循环就足够,A/B 就没有对比。弱模型自测扫不全长尾语义(`wordsep` 断连字符的
精确位置这类),才轮到外循环出场。这不是削弱实验:「便宜 worker + 强验收循环」正是
loop engineering 的经济学卖点。

## 前置条件

- `deveco` CLI 已装,模型二选一:
  - `deveco auth login` 配好 **DeepSeek** API(默认,worker/reviewer 都走它);
  - 或用 **OpenAI 兼容网关**:`cp local.env.example local.env` 填三行
    (`OPENAI_API_BASE`/`OPENAI_API_KEY`/`OPENAI_MODEL`),其余全部由 prepare 自动完成
- `cargo`/`rustc`(`brew install rust`)、`python3`、`git`、`sqlite3`、`lsof`
- shell 里**不能有** `DEVECO_SERVER_PASSWORD`(脚本会 unset,自己起 server 时注意)
- 预算:A 组约 10-15 分钟,B 组约 25-45 分钟;deepseek flash/reasoner 的 token 花费很小

## 步骤

**跨平台入口(Windows 原生 / macOS / Linux / WSL 都用它)**:

```bash
cd experiments/experiment1

python run_experiment.py prepare   # 环境体检 + 建双臂(~/ralph-experiment1/{once,loop})
python run_experiment.py once      # 跑 A 组,收工后自动打分
python run_experiment.py loop      # 跑 B 组(建议 A 组结束后再跑,避免抢限流)
python run_experiment.py report    # 对比表 + 两组偷看审计 + 曲线文件位置
```

嫌分步麻烦就 `python run_experiment.py all`。断了从对应步骤重来即可;
**重做实验请先删掉 `~/ralph-experiment1`,不要复用半成品**。
(mac/linux 也可以用等价的 `./run_experiment.sh`,unix 老习惯二选一。)

### Windows 说明

- 需要:`deveco` 在 PATH(装好后自带 Windows 原生二进制)、
  [rustup](https://rustup.rs)、Python 3.8+、Git。**不需要** WSL/bash/lsof/sqlite3。
- 驱动会自动处理平台差异:二进制名(`rustwrap.exe`)、进程回收(`taskkill /T`)、
  会话库路径(`%LOCALAPPDATA%`,不对就用 `DEVECO_DB` 环境变量指)。
- **挂代理的同学注意**:驱动对 `127.0.0.1` 的控制面请求强制直连(不走系统代理),
  这是实测踩过的坑——代理会把 localhost 请求掐断。
- Windows 路径尚未在真机回归过(mac 上开发验证);第一次跑遇到问题,`.ralph/serve.log`
  和报错原文发给助教。

实时围观(可选,另开终端):

```bash
deveco attach http://127.0.0.1:4121 --session $(cat ~/ralph-experiment1/once/.ralph/session_id)
```

## 你应该看到什么(参考结果,2026-07-16 实测)

| 组 | 结果 | 过程 |
|---|---|---|
| A:once | **795/816,自认完成** | 一次写完、自测全绿、收工;21 条失败聚集在 `break_on_hyphens` 断点语义,它不知道 |
| B:loop | **816/816,DONE** | 第 1 轮 815 → reviewer `CONTINUE` 精确点出最后一条的根因与修法 → 1 个 commit 修复 → 复核通过 |

这次实测的**原始数据**都在 [`reference-results/`](./reference-results/),跑完拿自己的对照:

| 文件 | 内容 |
|---|---|
| `once-final-score.txt` | A 组终分 795/816 + **全部 21 条失败样例**(期望 vs 实际) |
| `once-score_curve.csv` / `once-commits.txt` | A 组分数曲线(0→795 一次跳)与提交记录 |
| `loop-plugin.log` | B 组逐轮裁决日志,**含 reviewer `CONTINUE` 原文**(外循环喂给 worker 的那句话) |
| `loop-final-score.txt` / `loop-round1-score.txt` | B 组终分 816/816;第 1 轮半成品赛后重打分 815/816 |
| `loop-score_curve.csv` / `loop-commits.txt` | B 组曲线(阶梯型,中途归 0 属正常)与提交记录 |

LLM 有随机性,你的数字会不同,现象是概率的、但 loop 的优势是**结构性**的:

- A 组停在哪个分数都可能(780-816 都见过),关键观察是**它停手时不知道自己错了多少**
- 若 A 组撞出满分:如实记录,`rm -rf` 后重跑一次 A(弱模型满分是小概率)
- 若 B 组 `STOPPED`(20 轮未满分):读 `.ralph/plugin.log` 里每轮 reviewer 反馈,
  分析它为什么没收敛——这本身就是很好的实验报告素材

## 打分与审计(独立于 agent,随时可跑)

```bash
cd ~/ralph-experiment1/once && python3 .ralph/run_qa.py    # QA SCORE: X/816 + 失败样例
cd ~/ralph-experiment1/loop && python3 .ralph/run_qa.py

./audit_peeking.sh ~/ralph-experiment1/once                # 偷看审计(必须 clean)
./audit_peeking.sh ~/ralph-experiment1/loop
```

**审计不是仪式**:这套实验第一次跑的时候,flash 在**第 17 秒**就把验收向量读走了,
刷出满分假象。对全工具 agent,「藏」不是安全边界,「规则 + 审计」才是。

审计命中后要**人工判读**,不是机械作废:读过验收数据**内容** = 作弊作废;
纯元数据访问(比如 `git ls-files` 列文件名)可豁免但要记录理由。
参考判例(含一次真实作弊的完整记录)见 `reference-results/audit-notes.txt`。

## 实验报告要回答的问题

1. A 组收工时,它的 PROGRESS.md 自评和隐藏验收的真实分数差多少?差异集中在哪类语义?
2. B 组 reviewer 的第一次 `CONTINUE`(在 `.ralph/plugin.log`)给了什么信息?
   worker 下一个 commit 和这条反馈的对应关系?
3. 把 B 组曲线(`.ralph/score_curve.csv`)和 A 组画在一起:loop 的额外时间花在哪,买到了什么?
4. 如果把 worker 换成 `deepseek/deepseek-chat` 重跑 A 组,预测会发生什么?为什么?
   (答案在 `examples/rustwrap/README.md`,先预测再看)

## 常见坑

- **cargo 拉不到 crates.io**(`failed to get 'serde' as a dependency ...`):正常不该遇到——
  种子项目的依赖已 `cargo vendor` 进仓库(`seed/vendor/`,连 `.cargo/config.toml` 一起
  随 prepare 进入两臂),编译全程离线。还报这个错说明仓库是旧版本,`git pull` 后删掉
  `~/ralph-experiment1` 重跑 prepare。只有想**新增**依赖时才需要网络,那时再任选其一,
  写进 `~/.cargo/config.toml`(Windows: `%USERPROFILE%\.cargo\config.toml`):

  ```toml
  # ① 给 cargo 配上你 git 在用的代理(git config --get http.proxy 能查到)
  [http]
  proxy = "http://代理地址:端口"
  ```

  ```toml
  # ② 或改用国内镜像源(USTC;清华把 ustc 换成 tuna 的地址同理)
  [source.crates-io]
  replace-with = 'mirror'
  [source.mirror]
  registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
  ```

  验证方法:进 `~/ralph-experiment1/once` 跑
  `python .ralph/run_qa.py --samples 0`,看到 `QA SCORE: 0/816` 就说明编译链路是通的。
- **浏览器打开 http://127.0.0.1:412x 看不到会话**:deveco 的默认会话列表按
  「serve 工作目录对应的项目」过滤。驱动已把 serve 的 cwd 定在臂目录,运行期间直接
  能看到;但 server 是驱动临时起的,**跑完即杀**——事后回放用 lesson1 观测器
  (直接读 deveco.db,不依赖在跑的 server),或手动到臂目录里 `deveco serve` 再开浏览器。
- **端口被旧进程占着**:`deveco serve` 只能按端口杀:`lsof -ti:4121 | xargs kill -9`
- **worker 用 GLM-5.1 会在读大文件后挂死**(deveco 端点吃不下大 payload 的请求),
  所以本实验默认 deepseek;换模型用 `RALPH_EXP1_WORKER`/`RALPH_EXP1_REVIEWER` 环境变量,
  或配 `local.env` 走 OpenAI 兼容网关(见前置条件)
- 判断插件到底加载没有:看 `<项目>/.ralph/plugin.log` 是否生成
- B 组曲线里分数**中途掉到 0** 是正常的:worker 正在改 `lib.rs`,编译不过,计分器判 0
