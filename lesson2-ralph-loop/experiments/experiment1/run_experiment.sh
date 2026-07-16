#!/usr/bin/env bash
# Experiment 1 驱动:单次 Agent vs. Ralph Loop(盲验收 A/B)
#
#   ./run_experiment.sh prepare   环境体检 + 建双臂
#   ./run_experiment.sh once      跑 A 组并打分
#   ./run_experiment.sh loop      跑 B 组并打分
#   ./run_experiment.sh report    对比 + 审计
#   ./run_experiment.sh all       一条龙
#
# 重做实验:先 rm -rf ~/ralph-experiment1(或你的 RALPH_EXP1_DIR)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="${RALPH_EXP1_DIR:-$HOME/ralph-experiment1}"
WORKER="${RALPH_EXP1_WORKER:-deepseek/deepseek-v4-flash}"
REVIEWER="${RALPH_EXP1_REVIEWER:-deepseek/deepseek-reasoner}"
PORT_ONCE="${RALPH_EXP1_PORT_ONCE:-4121}"
PORT_LOOP="${RALPH_EXP1_PORT_LOOP:-4122}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,9p' "$0"; exit 1; }

# ---------------------------------------------------------------- prepare

cmd_prepare() {
  say "=== 环境体检 ==="
  local tool
  for tool in deveco cargo python3 git sqlite3 lsof; do
    command -v "$tool" >/dev/null 2>&1 || die "缺 $tool(cargo 用 brew install rust)"
  done
  deveco auth list 2>/dev/null | grep -qi deepseek \
    || die "deveco 里没配 DeepSeek 凭证;先 deveco auth login"
  [ -z "${DEVECO_SERVER_PASSWORD:-}" ] || say "⚠️  检测到 DEVECO_SERVER_PASSWORD,运行时会 unset(否则插件调不动自己的 server)"
  say "✅ 依赖齐全  worker=$WORKER  reviewer=$REVIEWER"

  [ ! -d "$WORK" ] || die "$WORK 已存在;重做实验请先 rm -rf $WORK(不要复用半成品)"

  local arm
  for arm in once loop; do
    say "=== 建 $arm 臂 ==="
    "$ROOT/ralph.sh" init "$WORK/$arm" >/dev/null
    "$ROOT/ralph.sh" sample rustwrap "$WORK/$arm" >/dev/null
    # 统一模型;并去掉 once agent 的 task:false,保证两臂工具面对称
    python3 - "$WORK/$arm" "$WORKER" "$REVIEWER" <<'PY'
import json, pathlib, sys
base = pathlib.Path(sys.argv[1])
p = base / ".ralph" / "config.json"
c = json.loads(p.read_text())
c["workerModel"], c["reviewerModel"] = sys.argv[2], sys.argv[3]
p.write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n")
a = base / ".deveco" / "agent" / "ralph-once.md"
if a.exists():
    a.write_text("".join(l for l in a.read_text().splitlines(keepends=True)
                         if l.strip() != "task: false"))
PY
  done

  cmp -s "$WORK/once/.ralph/GOAL.md" "$WORK/loop/.ralph/GOAL.md" || die "两臂 GOAL 不一致(不应发生)"
  [ -z "$(git -C "$WORK/once" ls-files .ralph)" ] || die ".ralph 进了 git(不应发生,验收数据会泄漏)"

  say "=== 校准:种子基线应为 0/816(首次要编译依赖,约 1 分钟)==="
  # run_qa 非满分时退出码为 1,这里只看输出,预期就是 0/816
  ( cd "$WORK/once" && python3 .ralph/run_qa.py --samples 0 2>&1 | head -2 ) || true
  say "✅ prepare 完成。下一步: $0 once"
}

# ---------------------------------------------------------------- 曲线采样

# 后台每 90 秒给隐藏验收打一次分,收工标志出现后自动停。
# 和 worker 的 cargo build 抢锁会排队,属正常;分数中途归 0 = 代码正在改、编译不过。
start_sampler() { # <arm_dir> <sentinel...>
  local dir="$1"; shift
  local csv="$dir/.ralph/score_curve.csv"
  (
    echo "epoch,hhmmss,score" > "$csv"
    while true; do
      s=$(cd "$dir" && python3 .ralph/run_qa.py --samples 0 2>/dev/null \
            | grep -oE 'QA SCORE: [0-9]+' | grep -oE '[0-9]+$' || true)
      echo "$(date +%s),$(date +%H:%M:%S),${s:-NA}" >> "$csv"
      for f in "$@"; do [ -f "$dir/.ralph/$f" ] && exit 0; done
      sleep 90
    done
  ) &
  SAMPLER_PID=$!
}

stop_sampler() { kill "${SAMPLER_PID:-0}" 2>/dev/null || true; }

# ---------------------------------------------------------------- once / loop

cmd_once() {
  [ -d "$WORK/once/.ralph" ] || die "先跑 $0 prepare"
  say "=== A 组:once(单次,无反馈)port=$PORT_ONCE ==="
  start_sampler "$WORK/once" ONCE_DONE STOPPED
  "$ROOT/ralph.sh" once "$WORK/once" "$PORT_ONCE" || { stop_sampler; die "once 运行失败"; }
  stop_sampler
  echo
  say "=== A 组隐藏验收得分 ==="
  ( cd "$WORK/once" && python3 .ralph/run_qa.py --samples 5 2>&1 | head -8 ) || true
  say "曲线: $WORK/once/.ralph/score_curve.csv"
  say "别忘了审计: $HERE/audit_peeking.sh $WORK/once"
}

cmd_loop() {
  [ -d "$WORK/loop/.ralph" ] || die "先跑 $0 prepare"
  say "=== B 组:loop(reviewer 反馈 + 续轮)port=$PORT_LOOP ==="
  start_sampler "$WORK/loop" DONE STOPPED
  "$ROOT/ralph.sh" run "$WORK/loop" "$PORT_LOOP" || { stop_sampler; die "loop 运行失败"; }
  stop_sampler
  echo
  say "=== B 组隐藏验收得分 ==="
  ( cd "$WORK/loop" && python3 .ralph/run_qa.py --samples 5 2>&1 | head -8 ) || true
  say "逐轮裁决(reviewer 反馈原文): $WORK/loop/.ralph/plugin.log"
  say "曲线: $WORK/loop/.ralph/score_curve.csv"
  say "别忘了审计: $HERE/audit_peeking.sh $WORK/loop"
}

# ---------------------------------------------------------------- report

score_of() { # <arm_dir> -> "QA SCORE: X/816" or "?"
  local s
  s=$( ( cd "$1" && python3 .ralph/run_qa.py --samples 0 2>/dev/null \
      | grep -oE 'QA SCORE: [0-9]+/[0-9]+' | head -1 ) || true )
  echo "${s:-?}"
}

cmd_report() {
  local a b sa sb
  a="$WORK/once"; b="$WORK/loop"
  [ -d "$a/.ralph" ] && [ -d "$b/.ralph" ] || die "双臂不全,先跑 prepare/once/loop"
  sa="$(score_of "$a")"; sb="$(score_of "$b")"
  echo
  say "================ Experiment 1 对比 ================"
  printf '  A once: %-12s  %s\n' "${sa#QA SCORE: }" \
    "$([ -f "$a/.ralph/ONCE_DONE" ] && echo '单次收工(它不知道自己差多少)' || echo '未完成')"
  printf '  B loop: %-12s  %s\n' "${sb#QA SCORE: }" \
    "$([ -f "$b/.ralph/DONE" ] && echo 'reviewer 验收 DONE' || { [ -f "$b/.ralph/STOPPED" ] && echo '轮次耗尽 STOPPED' || echo '未完成'; })"
  echo
  say "reviewer 逐轮反馈:"
  grep -E "verdict" "$b/.ralph/plugin.log" 2>/dev/null | sed 's/^/  /' || echo "  (无)"
  echo
  say "偷看审计(两组都必须 clean,否则成绩作废):"
  # 审计命中/未跑过时退出码非 0,是要展示的结果而不是 report 的失败
  "$HERE/audit_peeking.sh" "$a" 2>&1 | sed 's/^/  /' || true
  "$HERE/audit_peeking.sh" "$b" 2>&1 | sed 's/^/  /' || true
  echo
  say "对照参考结果: $HERE/reference-results/"
}

cmd_all() { cmd_prepare; cmd_once; cmd_loop; cmd_report; }

# ---------------------------------------------------------------- main

case "${1:-}" in
  prepare) cmd_prepare ;;
  once)    cmd_once ;;
  loop)    cmd_loop ;;
  report)  cmd_report ;;
  all)     cmd_all ;;
  *)       usage ;;
esac
