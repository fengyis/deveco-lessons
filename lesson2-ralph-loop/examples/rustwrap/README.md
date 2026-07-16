# A/B 实践:盲验收下的单次 Agent vs. Ralph Loop(Python→Rust 移植)

这套实践只比较一个变量:**同一模型解决同一移植任务时,是否拥有「验收反馈 + 后续轮次」**。

- A 组 `ralph.sh once`:一个 worker 会话,一次生成,idle 即终;没人告诉它哪错了。
- B 组 `ralph.sh run`:worker 循环推进,reviewer 每轮跑隐藏验收,把**失败样例**(输入/期望/实际)写进 `CONTINUE` 喂回去,直到满分才 `DONE`。

任务:把 CPython `textwrap`(wrap/fill/dedent/indent/shorten,12 个选项)移植成**行为等价**的 Rust。
验收:816 条「输入→CPython 期望输出」向量(`gen_vectors.py` 机器生成,确定性可复跑),
**对两组 worker 都完全隐藏**——藏在 `.ralph/` 且不进 git(`init` 会把控制面写进
`.git/info/exclude`,worker 用 `git show` 也挖不到)。

为什么选这个任务:它是我们试过的第六种设计里**第一个能让单次 agent 真实掉步**的。
真实 bug(pytest/django)、算法题(JSON parser,给全量/局部/零 oracle)全被强模型
单次通关——只要正确性能在本地验证(可跑的测试、可对拍的参考、可镜像的既有模式),
内循环就足够。移植任务的死角在**长尾语义**(`wordsep` 断连字符的精确位置、
`drop_whitespace` 组合……),弱模型自测扫不全,这才轮到外循环出场。

## 跑

```bash
# 两组,除了 once/run 之外完全一致
../../ralph.sh init   ~/rustwrap-once && ../../ralph.sh sample rustwrap ~/rustwrap-once
../../ralph.sh init   ~/rustwrap-loop && ../../ralph.sh sample rustwrap ~/rustwrap-loop

../../ralph.sh once ~/rustwrap-once 4111     # A 组:单次
../../ralph.sh run  ~/rustwrap-loop 4112     # B 组:loop

# 赛后评分(任何时刻都能跑,打印 QA SCORE: X/816 和失败样例)
cd ~/rustwrap-once && python3 .ralph/run_qa.py
cd ~/rustwrap-loop && python3 .ralph/run_qa.py
```

worker 模型要选**弱的**(我们用 `deepseek/deepseek-v4-flash`),reviewer 用强的
(`deepseek/deepseek-reasoner`),写在 `.ralph/config.json`。这不是削弱实验——
「便宜 worker + 强验收循环」正是 loop engineering 的经济学卖点。
强模型(deepseek-chat 级)会靠对拍 CPython 参考自收敛到满分,A/B 就没有对比了。

## 实测结果(2026-07-16,worker=deepseek-v4-flash,盲验收)

| 组 | 结果 | 用时 | 过程 |
|---|---|---|---|
| A:once | **795/816,自认完成** | ~10.5 min | 一次性写完 → 自测全绿 → 收工;21 条失败全部聚集在 `break_on_hyphens` 断点语义,它不知道自己错了 |
| B:loop | 【B 组收工后填:最终分 / 轮数 / reviewer 首轮反馈原文】 | 【填】 | 【填】 |

A 组失败样例(它的「本地绿」vs 隐藏验收):

```
wrap("short and-then-a-very-long-hyphenated-compound-word here", width=10)
期望: ["short and-", "then-a-", "very-long-", "hyphenated", "-compound-", "word here"]
实际: ["short and-", "then-", "a-very-", "long-hyphe", "nated-", "compound-", "word here"]
```

## 这个案例真正想教的事

1. **内循环人人都有**:A 组也会自测自改(曲线 0→795 就是它的内循环),这不是 loop
   engineering。外循环加的是「一个它骗不过、也漏不掉的验收面」。
2. **"本地绿了" ≠ 完成**:A 组停手时自测全绿。掉的 21 条是它的测试没想到的角——
   谁来替它想?reviewer 拿着完整验收跑出来的失败样例。
3. **反馈要具体**:reviewer 的 `CONTINUE` 必须逐字抄失败样例(输入/期望/实际),
   这是 worker 唯一的测试信号;只说「还有错」等于没说。
4. **盲验收必须防 Goodhart**:第一次跑这个实验时,flash 在**第 17 秒**就把
   `.ralph/vectors.jsonl` 读走了,816 满分全是对着答案刷的。修复:验收数据不进 git、
   GOAL 写明红线、赛后逐条审计 worker 的执行记录(`deveco.db` 里全有)。
   对全工具 agent,「藏」不是安全边界,「规则 + 审计」才是。

## 文件

- `GOAL.md` — 装进 `<项目>/.ralph/GOAL.md`(含红线与自检指引)
- `ralph-reviewer.md` — 案例专用裁判:只认 `run_qa.py` 的分数,`CONTINUE` 必须带失败样例
- `seed/` — cargo 脚手架:`main.rs`(验收 CLI 协议,预写死)+ `lib.rs`(五个 `todo!()`)
- `hidden/` — 装进 `<项目>/.ralph/`:`vectors.jsonl`(816 条)+ `run_qa.py`(计分器)
- `gen_vectors.py` — 向量生成器(需要本机 CPython;重跑可复现)
