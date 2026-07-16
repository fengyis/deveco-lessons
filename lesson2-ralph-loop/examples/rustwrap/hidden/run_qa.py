#!/usr/bin/env python3
"""隐藏 QA:cargo build + 把全部向量喂给 Rust 二进制,和 CPython 期望输出逐条比对。

用法:  python3 .ralph/run_qa.py [--samples N]
输出:  QA SCORE: X/816,以及最多 N 条失败样例(func/输入/期望/实际)。
退出码: 满分 0,否则 1 —— reviewer 只有看到满分才允许 DONE。
"""
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent          # <project>/.ralph
PROJECT = HERE.parent
VECTORS = HERE / "vectors.jsonl"
SAMPLES = int(sys.argv[sys.argv.index("--samples") + 1]) if "--samples" in sys.argv else 8


def main() -> int:
    build = subprocess.run(
        ["cargo", "build", "--release", "--quiet"],
        cwd=PROJECT, capture_output=True, text=True,
    )
    if build.returncode != 0:
        print("QA SCORE: 0/? (BUILD FAILED)")
        print(build.stderr[-3000:])
        return 1

    binary = PROJECT / "target" / "release" / "rustwrap"
    vectors = []
    with open(VECTORS) as f:
        for line in f:
            v = json.loads(line)
            if "_meta" not in v:
                vectors.append(v)

    requests = "".join(
        json.dumps({"func": v["func"], "text": v["text"], "kwargs": v["kwargs"]},
                   ensure_ascii=False) + "\n"
        for v in vectors
    )
    run = subprocess.run([str(binary)], input=requests, capture_output=True, text=True)
    lines = run.stdout.splitlines()
    if len(lines) != len(vectors):
        print(f"QA SCORE: 0/{len(vectors)} (protocol broken: {len(lines)} responses for {len(vectors)} requests)")
        return 1

    failures = []
    by_func = {}
    for v, line in zip(vectors, lines):
        try:
            resp = json.loads(line)
        except json.JSONDecodeError:
            resp = {"error": "unparseable response"}
        got = resp.get("result", f'<{resp.get("error", "no result")}>')
        ok = ("result" in resp) and (got == v["expected"])
        total_ok, total = by_func.get(v["func"], (0, 0))
        by_func[v["func"]] = (total_ok + (1 if ok else 0), total + 1)
        if not ok:
            failures.append((v, got))

    passed = len(vectors) - len(failures)
    print(f"QA SCORE: {passed}/{len(vectors)}")
    print("per-func:", "  ".join(f"{f}:{ok}/{n}" for f, (ok, n) in sorted(by_func.items())))
    if failures:
        print(f"\nFAILING SAMPLES (showing {min(SAMPLES, len(failures))}/{len(failures)}):")
        for v, got in failures[:SAMPLES]:
            print(f"  [{v['id']}] {v['func']}({json.dumps(v['text'], ensure_ascii=False)[:60]}, {json.dumps(v['kwargs'], ensure_ascii=False)})")
            print(f"      expected: {json.dumps(v['expected'], ensure_ascii=False)[:120]}")
            print(f"      got:      {json.dumps(got, ensure_ascii=False)[:120]}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
