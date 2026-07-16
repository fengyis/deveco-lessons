// v0 —— 半成品:只认 null/true/false、非负整数,以及由它们组成的数组。
//
// 不认:字符串、对象、负数/小数/科学计数法、**任何空白字符**、转义、严格数字校验、
// 错误位置。所以 test/json.test.ts 里这几类用例现在是红的。你的活是把它补全。
//
// 注意:literals / 非负整数 / 数组这三类**现在是绿的**,别把它们改回归了。

export function parse(text: string): unknown {
  let i = 0

  function value(): unknown {
    if (text.startsWith("null", i)) {
      i += 4
      return null
    }
    if (text.startsWith("true", i)) {
      i += 4
      return true
    }
    if (text.startsWith("false", i)) {
      i += 5
      return false
    }
    if (text[i] === "[") return array()
    return number()
  }

  function array(): unknown[] {
    i++ // 吃掉 [
    const out: unknown[] = []
    if (text[i] === "]") {
      i++
      return out
    }
    for (;;) {
      out.push(value())
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "]") {
        i++
        return out
      }
      throw new SyntaxError("数组格式错误")
    }
  }

  function number(): number {
    const start = i
    while (i < text.length && text[i] >= "0" && text[i] <= "9") i++
    if (start === i) throw new SyntaxError("无法识别的 token")
    return Number(text.slice(start, i))
  }

  return value()
}
