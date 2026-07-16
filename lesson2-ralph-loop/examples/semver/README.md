# 案例：让 ralph loop 从零写一个 semver 库

一个完整的、跑通过的例子。包含三样东西：目标、定制过的 reviewer、以及**独立于 loop 的验收测试**。

## 跑

```bash
../../ralph.sh init ~/semver-demo
cp GOAL.md ~/semver-demo/.ralph/GOAL.md
cp ralph-reviewer.md ~/semver-demo/.deveco/agent/ralph-reviewer.md   # 定制版 reviewer
../../ralph.sh run ~/semver-demo --keep
```

`run` 会提示 `ℹ️ .deveco/agent/ralph-reviewer.md 与模板不同（用的是你项目里的版本）`——这是对的，
说明你的定制生效了，`run` 不会覆盖它（只有 `init --update` 才会）。

跑完独立复验（**别只信 reviewer 说 DONE**）：

```bash
cp verify.test.ts ~/semver-demo/test/verify.test.ts
cd ~/semver-demo && bun test
```

## 实测结果

worker `deveco/GLM-5.1` + reviewer `deepseek/deepseek-chat`，一轮 DONE，约 3 分钟。
reviewer 的会话记录里能看到它真的执行了 `git log --oneline -20` 和 `bun test 2>&1`，
然后逐条对着验收标准打勾才判的 DONE——这是 `ralph-reviewer.md` 里那条
「必须自己跑一遍 bun test 才能判 DONE」起的作用。

## 这个案例真正想教的事

第一版 GOAL 里我只写了「`prerelease` 是点分段数组」，没说数字段要不要转成 number。
结果三次跑出了两种实现：有的返回 `["beta", 1]`，有的返回 `["beta", "1"]`。
两种都通过了验收——**因为验收标准没管这件事**。

`compare` 的行为一直是对的（数值比较在内部做了转换），所以库能用；
但如果你依赖 `parse` 的返回结构，就会被这个不确定性坑到。

所以现在的 `GOAL.md` 里把它钉死了：

```
- [ ] `parse("1.2.3-beta.1").prerelease` 深等于 `["beta", 1]`（注意 1 是 number 不是字符串）
```

**验收标准没钉死的地方，模型就有自由发挥空间。** 这是写 GOAL.md 时最该记住的一条。
