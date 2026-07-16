# 案例:测试修复 —— 让红灯的 CSV 解析器变绿(含回归守门)

演示 **L1 任务内循环**:实现 → 测试 → 修复 → **回归**。和 semver 案例(从零写)不同,
这个案例**开局就是红的**——仓库里先埋了一个只会 `split(",")` 的天真实现和一份测试,
worker 的活是把它**修对**,而修的过程会踩到一个真实的回归陷阱。

## 跑

```bash
../../ralph.sh init   ~/csv-demo
../../ralph.sh sample csv ~/csv-demo     # 灌入目标 + 定制 reviewer + 隐藏测试 + 种子红灯代码
../../ralph.sh run    ~/csv-demo
```

`sample csv` 会把 `seed/`(天真实现 `src/csv.ts` + 测试 `test/csv.test.ts`)拷进项目
并提交成基线,所以 `run` 之前 `bun test` 就是红的——这正是要修的起点。

跑完独立复验(**别只信 reviewer 说 DONE**):

```bash
cd ~/csv-demo && bun test ./.ralph/verify.test.ts
```

## 这个案例真正想教的事

`parseLine` 的四类规则里,普通分隔和空字段**天真实现本来就能过**,红的只有引号那几条。
worker 一旦动手把 `split(",")` 换成认引号的状态机,最容易犯的错是**忘了在循环结束后
flush 最后一个字段**——于是:

- `"x,y,z"` 掉了 `z`
- `"x,"` 掉了尾部空字段

也就是**修好了引号,却把本来绿的普通分隔 / 空字段搞回归了**。

这就是 L1 的核心:**每一轮都全量重跑,回归当场现形**。reviewer 被要求每轮跑两遍测试
(可见的 `bun test` + 隐藏的 `.ralph/verify.test.ts`),只有**四类规则同时全绿**才判 DONE。
学员会亲眼看到某一轮 `CONTINUE: 修引号导致尾部空字段回归`,然后 worker 补上 flush 才收工。

## 两道测试为什么都要有

| | 位置 | 作用 | worker 能改吗 |
|---|---|---|---|
| `test/csv.test.ts` | 项目里(可见) | 日常红/绿反馈,worker 靠它自查 | 能(所以可能被删/弱化作弊)|
| `.ralph/verify.test.ts` | `.ralph/`(隐藏) | 独立验收,**用不同输入**测同样性质 | 不能(`bun test` 不扫隐藏目录)|

隐藏测试用的是**和可见测试不一样的输入**——所以 worker 若对着可见测试的字符串硬编码,
在隐藏测试里立刻露馅。reviewer 的第 3 条规则专门用 `git diff` 盯"有没有靠删测试蒙混"。

## 想让回归戏更稳定地出现

强模型可能一轮就写对、根本不回归。想稳定复现"修引号→碰坏空字段"这一幕,
把 worker 换成弱模型即可(编辑 `~/csv-demo/.ralph/config.json` 的 `workerModel`)。
弱 worker 更容易忘掉最后的 flush,回归戏几乎必现,而全量重跑照样把它逮住——
这恰好说明:**回归守门这个不变量,和模型多强无关**。
