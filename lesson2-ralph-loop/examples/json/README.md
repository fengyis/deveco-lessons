# 案例:从半成品补全 RFC 8259 JSON 解析器(283 条 conformance 验收)

种子只认 `null/true/false`、非负整数和数组(基线 192/283);目标是补全成严格 JSON
解析器,拿到 [nst/JSONTestSuite](https://github.com/nst/JSONTestSuite) 283 条
(`y_` 必须接受 / `n_` 必须拒绝)满分。基线 `JSON.parse` 是 283/283,满分可达。

```bash
../../ralph.sh init   ~/json-demo
../../ralph.sh sample json ~/json-demo    # 种子 + 可见测试 + 隐藏计分副本
../../ralph.sh run    ~/json-demo
cd ~/json-demo && bun test ./.ralph/verify.test.ts   # 独立复验
```

## 实测警示:别拿它做「once vs loop」对比

我们试过(2026-07-16,GLM-5.1):**无论给全量、局部还是零 oracle,强模型都单次满分**——
JSON 解析器在训练数据里烂大街,它是**默写**的(一次编辑 192→283,不需要任何测试反馈;
执行记录审计确认没有偷看隐藏测试)。

这个案例适合教「隐藏计分防篡改」和「conformance 驱动开发」,
不适合证明外循环的价值。要做 A/B 对比,用 `examples/rustwrap`(那个任务默写不了)。
