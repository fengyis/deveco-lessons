# A/B 实践：单次 Agent vs. Ralph Loop

这套实践只比较一个变量：**同一模型解决同一 SWE-bench Lite issue 时，是否拥有 reviewer 反馈与后续轮次**。

- A 组执行 `ralph.sh once`：一个 worker 会话，idle 后立即结束；没有 reviewer，也不续轮。
- B 组执行 `ralph.sh run`：worker 与 reviewer 循环，直到 reviewer 验收或达到轮次上限。

实践输入是 [`instance.json`](./instance.json)：`django__django-12589`，基线提交
`895f28f9cbed817c00ab68770433170d83132d90`。它只包含公开 Issue 字段，不包含 gold patch、
`test_patch`、`FAIL_TO_PASS`、`PASS_TO_PASS` 或 hints。

> 单次模型具有随机性，因此程序不会伪造“单次必败”。最终对比以两份 prediction 的官方 harness
> 结果为准；这个复杂 ORM issue 用来提高单次无法完整解决、而循环可以收敛的可观察性。

## 1. 建立完全相同的两份基线

以下命令都从本项目根目录执行：

```bash
PROJECT_ROOT="$PWD"
INSTANCE="$PROJECT_ROOT/examples/swebench/django__django-12589/instance.json"
BASE_COMMIT="895f28f9cbed817c00ab68770433170d83132d90"
TARGET_ONCE="$HOME/swebench-practice/django__django-12589-once"
TARGET_LOOP="$HOME/swebench-practice/django__django-12589-loop"
PRED_ONCE="$PROJECT_ROOT/outputs/django__django-12589.once.jsonl"
PRED_LOOP="$PROJECT_ROOT/outputs/django__django-12589.loop.jsonl"

mkdir -p "$HOME/swebench-practice"
git clone https://github.com/django/django.git "$TARGET_ONCE"
git clone https://github.com/django/django.git "$TARGET_LOOP"
git -C "$TARGET_ONCE" checkout --detach "$BASE_COMMIT"
git -C "$TARGET_LOOP" checkout --detach "$BASE_COMMIT"
```

两个目录的 `git rev-parse HEAD` 都必须等于 `$BASE_COMMIT`，且 `git status --short` 都没有输出。
重做实验时请重新创建干净目录，不要复用上次的半成品。

## 2. 注入同一输入与同一模型配置

```bash
"$PROJECT_ROOT/ralph.sh" swebench prepare "$TARGET_ONCE" "$INSTANCE" \
  --model-name same-model-once
"$PROJECT_ROOT/ralph.sh" swebench prepare "$TARGET_LOOP" "$INSTANCE" \
  --model-name same-model-ralph-loop

cmp "$TARGET_ONCE/.ralph/GOAL.md" "$TARGET_LOOP/.ralph/GOAL.md"
python3 - "$TARGET_ONCE/.ralph/config.json" "$TARGET_LOOP/.ralph/config.json" <<'PY'
import json, pathlib, sys
a, b = (json.loads(pathlib.Path(p).read_text()) for p in sys.argv[1:])
assert a["workerModel"] == b["workerModel"]
print("same worker model:", a["workerModel"])
PY
```

`--model-name` 只是给最终 prediction 标记实验组；真正调用的 `workerModel` 来自两边相同的
`.ralph/config.json`。如需换模型，请在两个文件中写入完全相同的 `workerModel`。

历史 Django 测试建议使用 Python 3.8。测试环境放在目标仓库外，且运行两组实验时保持激活：

```bash
TEST_ENV="$HOME/.cache/ralph-swebench/django__django-12589-py38"
uv venv --python 3.8 "$TEST_ENV"
source "$TEST_ENV/bin/activate"
python -m pip install -r "$TARGET_ONCE/tests/requirements/py3.txt"
```

## 3. A 组：只给一次机会

```bash
"$PROJECT_ROOT/ralph.sh" once "$TARGET_ONCE" 4097
"$PROJECT_ROOT/ralph.sh" swebench export "$TARGET_ONCE" "$PRED_ONCE" --once
```

完成标志是 `.ralph/ONCE_DONE`。该模式即使没有产生补丁也会导出 prediction，因为空补丁本身就是
有效的失败实验结果；它不会伪装成 reviewer 已验收。

## 4. B 组：运行 Ralph Loop

```bash
"$PROJECT_ROOT/ralph.sh" run "$TARGET_LOOP" 4098
"$PROJECT_ROOT/ralph.sh" swebench export "$TARGET_LOOP" "$PRED_LOOP"
```

B 组只有在 plugin 日志中存在真实 Reviewer `DONE`、产品改动已提交且补丁非空时才允许导出。
`.ralph/STOPPED` 表示轮次耗尽，不代表已解决。

## 5. 用官方 harness 分别判定

在独立 Python 环境安装 `swebench`，然后分别评测，不能把两个相同 `instance_id` 混在一份 JSONL：

```bash
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path "$PRED_ONCE" \
  --instance_ids django__django-12589 \
  --max_workers 1 \
  --run_id django-12589-once

python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path "$PRED_LOOP" \
  --instance_ids django__django-12589 \
  --max_workers 1 \
  --run_id django-12589-ralph-loop
```

要展示的对比只有这一行：

| 组别 | Worker 模型 | Worker 会话 | Reviewer | 后续轮次 | Harness 结果 |
| --- | --- | ---: | ---: | ---: | --- |
| A：`once` | 相同 | 1 | 0 | 0 | 记录实际 `resolved/unresolved` |
| B：`run` | 相同 | ≥1 | ≥1 | 按裁决继续 | 记录实际 `resolved/unresolved` |

理想演示结果是 A 为 `unresolved`、B 为 `resolved`。若 A 偶然一次解决，则如实记录，并更换随机种子、
模型或另一个困难 issue 后重新建立两份干净基线；不要修改 A 组的输入或验收标准来制造失败。

Prediction 的三个字段与评测命令遵循
[SWE-bench evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/) 和
[evaluation harness reference](https://www.swebench.com/SWE-bench/reference/harness/)。
