import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { parse } from "../src/json"

// 本地自检 —— JSON conformance 用例的**局部抽样**(nst/JSONTestSuite, MIT)。
//
//   y_*.json  必须**接受**(parse 不抛)
//   n_*.json  必须**拒绝**(parse 必须抛)
//
// ⚠️ 这份只是**你本地的局部测试**,不是完整验收。最终验收跑的是完整 conformance
//    QA(283 条,你接触不到),以 RFC 8259 严格语义为准 —— 本地全绿 ≠ 验收通过,
//    规格里每一条规则的**边界**都会被 QA 逐一检查,别只满足于把这 78 条弄绿。
//
// 想看本地得分:  bun test test/conformance.test.ts

const SUITE = join(import.meta.dir, "..", "jsontestsuite")
const files = readdirSync(SUITE)
  .filter((f) => f.endsWith(".json"))
  .sort()

function read(f: string): string {
  return readFileSync(join(SUITE, f), "utf8")
}

function ok(f: string): boolean {
  let threw = false
  try {
    parse(read(f))
  } catch {
    threw = true
  }
  return f.startsWith("y_") ? !threw : threw
}

for (const f of files.filter((f) => f.startsWith("y_"))) {
  test(`y 必须接受: ${f}`, () => {
    expect(() => parse(read(f))).not.toThrow()
  })
}
for (const f of files.filter((f) => f.startsWith("n_"))) {
  test(`n 必须拒绝: ${f}`, () => {
    expect(() => parse(read(f))).toThrow()
  })
}

test("本地局部得分(不是最终验收)", () => {
  const failed = files.filter((f) => !ok(f))
  console.log(`\nLOCAL SCORE: ${files.length - failed.length}/${files.length} (partial self-check)`)
  if (failed.length) {
    console.log(`FAILING (${failed.length}):`)
    for (const f of failed) console.log("  -", f)
  }
  expect(failed).toEqual([])
})
