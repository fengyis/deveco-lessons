# 目标
用 TypeScript 实现一个 semver（语义化版本）比较库，跑在 bun 上。

模块 `src/semver.ts` 需要导出两个函数：

- `parse(v: string)` —— 把 `"1.2.3"` / `"1.2.3-beta.1"` 解析成
  `{ major, minor, patch, prerelease }`。
  `major` / `minor` / `patch` 是 number；`prerelease` 是点分段数组，没有则为 `[]`，
  其中**纯数字的段必须是 number 类型**（`"1.2.3-beta.1"` → `prerelease: ["beta", 1]`）。
  遇到非法版本号（比如 `"1.2"`、`"x.y.z"`、`""`）必须 throw。
- `compare(a: string, b: string)` —— a 大于 b 返回 1，小于返回 -1，相等返回 0。
  先比 major/minor/patch；有预发布标识的版本小于对应正式版（`1.0.0-beta` < `1.0.0`）；
  两个都有预发布标识时逐段比较，数字段按**数值**比（所以 `1.0.0-alpha.2` < `1.0.0-alpha.10`）、
  非数字段按字典序比，数字段的优先级低于非数字段（`1.0.0-1` < `1.0.0-alpha`），
  前缀相同时段数少的更小（`1.0.0-alpha` < `1.0.0-alpha.1`）。

# 验收标准
- [ ] `src/semver.ts` 存在，且导出 `parse` 和 `compare`
- [ ] `parse("1.2.3-beta.1").prerelease` 深等于 `["beta", 1]`（注意 1 是 number 不是字符串）
- [ ] `test/semver.test.ts` 存在，覆盖：普通比较、相等、非法输入 throw、预发布 vs 正式版、
      两个预发布之间的比较、数字段的数值比较（alpha.2 < alpha.10）；用例数 >= 10
- [ ] `bun test` 全部通过（退出码 0）
- [ ] `README.md` 存在，包含 `parse` 和 `compare` 的用法示例
