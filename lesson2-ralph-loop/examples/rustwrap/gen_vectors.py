#!/usr/bin/env python3
"""机器生成 textwrap 行为等价向量:输入 × 选项组合 → CPython 期望输出。

oracle 不是人写的断言,是参考实现(CPython textwrap)跑出来的。
确定性枚举(无随机),重跑结果一致。输出 JSONL,一行一个向量:
  {"id": 1, "func": "wrap", "text": "...", "kwargs": {...}, "expected": [...]}
"""
import itertools
import json
import sys
import textwrap

TEXTS = [
    # 基本
    "The quick brown fox jumps over the lazy dog",
    "hello",
    "",
    # 空白边界
    "   ",
    "  leading and trailing  ",
    "multiple   internal    spaces",
    "line one\nline two\nline three",
    "tabs\there\tand\tthere",
    "\n\n\n",
    "para one\n\npara two",
    # 长词
    "a supercalifragilisticexpialidocious word",
    "antidisestablishmentarianism",
    "short and-then-a-very-long-hyphenated-compound-word here",
    # 连字符
    "well-known state-of-the-art solutions",
    "pre- and post-processing",
    # 句末(fix_sentence_endings 的猎场)
    "First sentence.  Second one!  Third?  Yes.",
    "Dr. Smith went to Washington. He arrived Monday.",
    # unicode
    "中文字符 mixed with English words here",
    "naïve café résumé",
    # 数字与标点
    "1,000,000 dollars (approximately) -- give or take",
]

WIDTHS = [10, 20, 70]

# 选项组合:每个开关至少被翻转一次,组合覆盖交互效应
OPTION_SETS = [
    {},
    {"initial_indent": "* ", "subsequent_indent": "  "},
    {"expand_tabs": False},
    {"tabsize": 4},
    {"replace_whitespace": False},
    {"fix_sentence_endings": True},
    {"break_long_words": False},
    {"drop_whitespace": False},
    {"break_on_hyphens": False},
    {"max_lines": 2},
    {"max_lines": 1, "placeholder": " …"},
    {"break_long_words": False, "break_on_hyphens": False},
    {"drop_whitespace": False, "replace_whitespace": False},
]

DEDENT_TEXTS = [
    "    hello\n    world",
    "\thello\n\tworld",
    "    hello\n        world\n    end",
    "  mixed\n\ttabs",
    "no indent\n    some indent",
    "",
    "\n\n",
    "    only one line",
    "    trailing blank\n\n    line",
]

INDENT_CASES = [
    ("hello\nworld", "  "),
    ("hello\nworld\n", "> "),
    ("line\n\nblank line\n", "* "),
    ("", "x "),
    ("no trailing newline", "\t"),
]

SHORTEN_CASES = [
    ("Hello  world!", 12, " [...]"),
    ("Hello  world!", 11, " [...]"),
    ("Hello  world!", 10, " [...]"),
    ("The quick brown fox jumps over the lazy dog", 20, " [...]"),
    ("The quick brown fox jumps over the lazy dog", 20, "..."),
    ("short", 100, " [...]"),
    ("  lots   of   whitespace   collapses  ", 15, " [...]"),
    ("supercalifragilisticexpialidocious", 10, " [...]"),
]

def main() -> None:
    out = []
    n = 0

    for text, width, opts in itertools.product(TEXTS, WIDTHS, OPTION_SETS):
        kwargs = {"width": width, **opts}
        try:
            expected = textwrap.wrap(text, **kwargs)
        except Exception:
            continue  # 非法组合直接跳过,oracle 里只放确定行为
        n += 1
        out.append({"id": n, "func": "wrap", "text": text, "kwargs": kwargs, "expected": expected})

    # fill 是 wrap 的 join,抽样少量组合防止向量数爆炸
    for text, width in itertools.product(TEXTS[::3], [20, 70]):
        kwargs = {"width": width}
        n += 1
        out.append({"id": n, "func": "fill", "text": text, "kwargs": kwargs,
                    "expected": textwrap.fill(text, **kwargs)})

    for text in DEDENT_TEXTS:
        n += 1
        out.append({"id": n, "func": "dedent", "text": text, "kwargs": {},
                    "expected": textwrap.dedent(text)})

    for text, prefix in INDENT_CASES:
        n += 1
        out.append({"id": n, "func": "indent", "text": text, "kwargs": {"prefix": prefix},
                    "expected": textwrap.indent(text, prefix)})

    for text, width, placeholder in SHORTEN_CASES:
        n += 1
        out.append({"id": n, "func": "shorten", "text": text,
                    "kwargs": {"width": width, "placeholder": placeholder},
                    "expected": textwrap.shorten(text, width, placeholder=placeholder)})

    with open(sys.argv[1], "w") as f:
        meta = {"generator": "gen_vectors.py", "python": sys.version.split()[0], "count": len(out)}
        f.write(json.dumps({"_meta": meta}, ensure_ascii=False) + "\n")
        for v in out:
            f.write(json.dumps(v, ensure_ascii=False) + "\n")
    counts = {}
    for v in out:
        counts[v["func"]] = counts.get(v["func"], 0) + 1
    print(f"total {len(out)} vectors | {counts} | python {meta['python']}")

if __name__ == "__main__":
    main()
