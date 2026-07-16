# 目标:把 CPython textwrap 移植成行为等价的 Rust

仓库是一个预建好的 cargo 工程。`src/lib.rs` 里五个函数全是 `todo!()`:

```
wrap(text, opts)              ≡ textwrap.wrap(text, **options)
fill(text, opts)              ≡ textwrap.fill(text, **options)
dedent(text)                  ≡ textwrap.dedent(text)
indent(text, prefix)          ≡ textwrap.indent(text, prefix)   # 默认 predicate
shorten(text, width, ph)      ≡ textwrap.shorten(text, width, placeholder=ph)
```

你的活:把它们实现到与 **CPython `textwrap`** 在相同输入、相同选项下输出**逐字符一致**。
`WrapOptions` 的全部字段(width / initial_indent / subsequent_indent / expand_tabs /
tabsize / replace_whitespace / fix_sentence_endings / break_long_words /
drop_whitespace / break_on_hyphens / max_lines / placeholder)都要生效,
默认值与 CPython 一致(已在 `Default` 里写好)。

## 验收方式(你拿不到测试)

验收是一份**隐藏的行为向量集**(约 800 条「输入+选项 → CPython 期望输出」,
覆盖各函数、各选项组合、各种边界:空串、纯空白、tab、长词、连字符、句末双空格、
unicode、max_lines 截断……)。**你无法运行它**;验收者会运行,并告诉你结果。

**你的对策不是猜测试,而是把行为对齐参考实现:**

- 参考实现就在这台机器上:`python3 -c "import textwrap; print(textwrap.wrap(...))"`,
  任何拿不准的边界,跑一下参考对照 —— 这就是移植工程的日常;
- CPython textwrap 的源码也可以读:`python3 -c "import textwrap,inspect; print(inspect.getsource(textwrap))"`;
- 自己写测试对拍(比如用 python3 生成期望输出),测到你有信心为止。

## 边界提醒(容易做不严的地方)

- `expand_tabs`/`tabsize` 与 `replace_whitespace` 的先后关系
- `drop_whitespace=False` 时空白 chunk 的保留
- `break_on_hyphens` 的断点规则(CPython 用的是 wordsep 正则语义)
- `break_long_words=False` 时超宽词的处理
- `max_lines` + `placeholder` 的截断和去尾空白
- `fix_sentence_endings` 只认「小写字母+句末标点+空格」式启发
- 空输入 / 纯空白输入在各函数下的行为
- `indent` 对「只含空白的行」不加前缀(默认 predicate 的语义)

## 红线

- **不许修改 `src/main.rs` 和 `Cargo.toml`** —— 它们是验收接口。
- **不许在 Rust 里调外部进程**(`std::process` 一律不许)—— 移植的意义是脱离 Python 运行时;
  在实现里 shell 出去调 python 视为作弊。
- **不许读取、复制或运行 `.ralph/` 下的任何文件**(只有 `GOAL.md` 和 `PROGRESS.md` 例外)——
  验收向量就在里面,看一眼就是作弊。你的执行记录会被逐条审计,违者直接判零分。
- 不许改 `.ralph/` 下任何东西。
- 允许:读 CPython 源码、跑 python3 对拍、自己在 `tests/` 下加你自己的测试。

## 建议节奏

`dedent` → `indent` → `wrap` 主干(空白/切词/装行)→ 各选项逐个对齐 → `fill` →
`shorten` → 边界扫尾。每完成一块,把「实现了什么 / 和参考对拍过哪些输入 / 还有哪些
选项没对齐」写进 `.ralph/PROGRESS.md`,`cargo build` 通过后 git commit。
