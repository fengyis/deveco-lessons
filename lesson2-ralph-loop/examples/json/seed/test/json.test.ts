import { expect, test } from "bun:test"
import { parse } from "../src/json"

// —— 字面量(半成品已经能过,别把它改回归了)——
test("null", () => {
  expect(parse("null")).toBe(null)
})
test("true / false", () => {
  expect(parse("true")).toBe(true)
  expect(parse("false")).toBe(false)
})

// —— 非负整数(已经能过,同样别改回归)——
test("非负整数", () => {
  expect(parse("0")).toBe(0)
  expect(parse("42")).toBe(42)
})

// —— 数组(已经能过,同样别改回归)——
test("空数组", () => {
  expect(parse("[]")).toEqual([])
})
test("扁平数组", () => {
  expect(parse("[1,2,3]")).toEqual([1, 2, 3])
})
test("嵌套数组", () => {
  expect(parse("[[1],[2,[3]]]")).toEqual([[1], [2, [3]]])
})

// —— 以下都是红的:半成品不认 ——

// 空白
test("token 之间允许空白", () => {
  expect(parse(" [ 1 , 2 ] ")).toEqual([1, 2])
})
test("空白包括 tab/换行/回车", () => {
  expect(parse("[\n\t1,\r\n2\n]")).toEqual([1, 2])
})

// 数字
test("负数", () => {
  expect(parse("-1")).toBe(-1)
})
test("小数", () => {
  expect(parse("1.5")).toBe(1.5)
})
test("科学计数法", () => {
  expect(parse("1e3")).toBe(1000)
  expect(parse("1.5e-3")).toBe(0.0015)
})
test("负零", () => {
  expect(Object.is(parse("-0"), -0)).toBe(true)
})
test("严格数字:拒绝前导零 / .5 / 1.", () => {
  expect(() => parse("01")).toThrow()
  expect(() => parse(".5")).toThrow()
  expect(() => parse("1.")).toThrow()
})

// 字符串
test("字符串", () => {
  expect(parse('"hello"')).toBe("hello")
})
test("字符串里的空格必须保留", () => {
  expect(parse('"a b"')).toBe("a b")
})
test("转义:\\\" \\\\ \\/ \\n \\t", () => {
  expect(parse('"a\\"b"')).toBe('a"b')
  expect(parse('"a\\\\b"')).toBe("a\\b")
  expect(parse('"a\\/b"')).toBe("a/b")
  expect(parse('"a\\nb"')).toBe("a\nb")
})
test("\\uXXXX 转义", () => {
  expect(parse('"\\u0041"')).toBe("A")
})
test("\\uXXXX 代理对(emoji)", () => {
  expect(parse('"\\ud83d\\ude00"')).toBe("😀")
})
test("拒绝字符串里的裸控制字符", () => {
  expect(() => parse('"a\nb"')).toThrow()
})

// 对象
test("空对象", () => {
  expect(parse("{}")).toEqual({})
})
test("对象", () => {
  expect(parse('{"a":1}')).toEqual({ a: 1 })
})
test("嵌套对象", () => {
  expect(parse('{"a":{"b":[1,{"c":null}]}}')).toEqual({ a: { b: [1, { c: null }] } })
})

// 错误
test("拒绝尾随逗号", () => {
  expect(() => parse("[1,]")).toThrow()
  expect(() => parse('{"a":1,}')).toThrow()
})
test("拒绝多余的尾部内容", () => {
  expect(() => parse("1 2")).toThrow()
})
test("拒绝空输入", () => {
  expect(() => parse("")).toThrow()
})
