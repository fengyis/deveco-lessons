import { expect, test } from "bun:test"
import { parseLine } from "../src/csv"

// —— 普通分隔(天真实现已经能过,别把它改回归了)——
test("普通逗号分隔", () => {
  expect(parseLine("a,b,c")).toEqual(["a", "b", "c"])
})
test("单个字段", () => {
  expect(parseLine("hello")).toEqual(["hello"])
})

// —— 空字段(天真实现也能过,同样别改回归)——
test("中间空字段", () => {
  expect(parseLine("a,,c")).toEqual(["a", "", "c"])
})
test("开头空字段", () => {
  expect(parseLine(",a")).toEqual(["", "a"])
})
test("结尾空字段", () => {
  expect(parseLine("a,")).toEqual(["a", ""])
})

// —— 引号(天真实现现在挂在这几条上,先让它们绿)——
test("引号内的逗号是字面量", () => {
  expect(parseLine('"a,b",c')).toEqual(["a,b", "c"])
})
test("引号内的 \"\" 是一个字面双引号", () => {
  expect(parseLine('"she said ""hi"""')).toEqual(['she said "hi"'])
})
test("空引号是一个空字段", () => {
  expect(parseLine('"",x')).toEqual(["", "x"])
})
