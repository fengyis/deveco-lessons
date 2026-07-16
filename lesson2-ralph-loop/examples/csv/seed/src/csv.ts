// v0 —— 天真实现:直接按逗号切。
// 引号包裹、引号内的逗号、转义的 ""、空引号字段全都不认。
// 所以 test/csv.test.ts 里带引号的用例现在全是红的。你的活是把它修对。
export function parseLine(line: string): string[] {
  return line.split(",")
}
