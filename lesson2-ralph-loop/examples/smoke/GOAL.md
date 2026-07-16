# 目标:观测演示 —— 跑出一条「什么都有」的会话

按顺序完成下面四件事。**一轮只做一件**,每做完一件:验证 → 追加写 `.ralph/PROGRESS.md` → `git commit`。

1. **规划**:用 `todowrite` 工具把这四件事登记成待办清单,然后完成第一项(本项)。
2. **写码并运行**:写 `greet.py`,接受一个名字参数,打印 `Hello, <名字>!`;用 bash 运行 `python3 greet.py Ralph` 验证输出。
3. **派 subagent**:用 `task` 工具(subagent_type 用 `stats-collector`)让子代理统计本项目的文件数与代码总行数,并把结果写进 `STATS.md`。这件事**必须由 subagent 完成**,你自己不要动手;它完成后你核对 `STATS.md` 存在再提交。
4. **调 skill**:用 `skill` 工具调用项目里的 `demo-banner` 技能,按技能说明生成 `BANNER.txt`。

# 验收标准

- [ ] `greet.py` 存在,`python3 greet.py Ralph` 输出 `Hello, Ralph!`
- [ ] `STATS.md` 存在且内容包含文件数与行数;`.ralph/PROGRESS.md` 注明它由 stats-collector subagent 产出
- [ ] `BANNER.txt` 存在;`.ralph/PROGRESS.md` 注明用了 demo-banner skill
- [ ] `git log` 至少有 3 个工作提交(不含 init/seed 提交),工作区干净
