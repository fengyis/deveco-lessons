#!/usr/bin/env bash
# Lesson 1: 把一个项目的 deveco 会话导进 cannbot-insight,turn-by-turn 回看轨迹。
#
#   ./observe.sh <项目目录>
#
# cannbot-insight 是个会话观测器:它的 opencode-db 适配器要的表结构
# (session / message / part)和 deveco 的 ~/.local/share/deveco/deveco.db
# 一模一样(deveco 本就是 opencode 派生的),所以不用改它一行代码就能直读。
#
# 环境变量(都可选):
#   CANNBOT_INSIGHT_DIR   cannbot-insight 在哪(默认用本仓 vendor/cannbot-insight)
#   CANNBOT_INSIGHT_PORT  cannbot Web 端口(默认 21025)
#   DEVECO_DB             deveco 会话库(默认 ~/.local/share/deveco/deveco.db)
#
# 观测是旁路:环境不满足只提示并跳过(退出码 0),绝不影响调用方的结论。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
die() { echo "❌ $*" >&2; exit 1; }

usage() {
  echo "用法: $0 <项目目录>" >&2
  exit 1
}

CANNBOT_INSIGHT_DIR="${CANNBOT_INSIGHT_DIR:-$REPO_ROOT/vendor/cannbot-insight}"
CANNBOT_INSIGHT_PORT="${CANNBOT_INSIGHT_PORT:-21025}"
# deveco.db 默认在 ~/.local/share(Git Bash 下 $HOME 是 /c/Users/<你>,通常也在这);
# 个别 Windows 安装会落在 %LOCALAPPDATA%,探测一下
DEVECO_DB="${DEVECO_DB:-$HOME/.local/share/deveco/deveco.db}"
if [ ! -f "$DEVECO_DB" ] && [ -n "${LOCALAPPDATA:-}" ] && [ -f "$LOCALAPPDATA/deveco/deveco.db" ]; then
  DEVECO_DB="$LOCALAPPDATA/deveco/deveco.db"
fi

# cannbot 的原生依赖(better-sqlite3)只在 node 20 装得起来、跑得动;node 26 编不过。
# 有 nvm 就切到 20,切不了就照当前 node 硬试(大概率失败,但不拦着)。
_cannbot_node20() {
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    set +u
    . "$HOME/.nvm/nvm.sh"
    nvm use 20 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
    set -u
  fi
}

# CLI 要连 cannbot 的 HTTP server。没起就后台拉起来,等到能连上;起不来返回 1。
_cannbot_ensure_server() {
  local base="http://localhost:$CANNBOT_INSIGHT_PORT"
  curl -s "$base/api/observe/data?pageSize=1" >/dev/null 2>&1 && return 0
  say "→ cannbot server 没运行,后台拉起 :$CANNBOT_INSIGHT_PORT ..."
  (
    cd "$CANNBOT_INSIGHT_DIR" || exit 1
    # 相对路径按 prisma/schema.prisma 所在目录解析 → vendor 的 prisma/dev.db。
    # 不能用绝对路径:Git Bash 的 /c/... 形式 prisma 解析不了
    export DATABASE_URL="file:./dev.db"
    # 开高级标签页(subagents / interactions / AI workflow),看子代理轨迹要靠它。
    # 生产模式下这个开关在 setup.sh 的 next build 时已烙进产物,这里只对 dev 兜底生效。
    export NEXT_PUBLIC_SHOW_ADVANCED_TABS=true
    if [ -f "$CANNBOT_INSIGHT_DIR/.next/BUILD_ID" ]; then
      # 生产模式:页面预编译,秒开
      nohup npx next start --port "$CANNBOT_INSIGHT_PORT" >/tmp/cannbot-insight.log 2>&1 &
    else
      # 没构建过就退回 dev 模式(能用,但每页首开要现场编译,很慢;跑一次 setup.sh 会补上构建)
      nohup npx next dev --port "$CANNBOT_INSIGHT_PORT" >/tmp/cannbot-insight.log 2>&1 &
    fi
  )
  for _ in $(seq 1 40); do
    curl -s "$base/api/observe/data?pageSize=1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# 把某个项目的所有 root 会话(worker 和 reviewer 都是各自独立的 root,
# 靠 directory 归到一起)导进 cannbot-insight。整个观测是旁路,任何一步都软失败。
cmd_observe() {
  local target="${1:-}"
  [ -n "$target" ] || usage
  [ -d "$target" ] || die "$target 不存在"
  target="$(cd "$target" && pwd -P)"

  # ${VAR} 的花括号不能省:macOS bash 3.2 会把紧跟 $VAR 的中文字符当成变量名的一部分
  [ -f "$CANNBOT_INSIGHT_DIR/package.json" ] || { say "ℹ️  没找到 cannbot-insight(${CANNBOT_INSIGHT_DIR}),跳过观测。先跑仓库根的 ./setup.sh,装在别处就设 CANNBOT_INSIGHT_DIR。"; return 0; }
  # 依赖没装就别去 npx——它会现场拉包或干等 40 秒超时,报错还只指向 /tmp 日志
  [ -d "$CANNBOT_INSIGHT_DIR/node_modules" ] || { say "ℹ️  cannbot-insight 依赖还没装(${CANNBOT_INSIGHT_DIR}/node_modules 不存在),先跑仓库根的 ./setup.sh。跳过观测。"; return 0; }
  [ -f "$DEVECO_DB" ] || { say "ℹ️  没找到 deveco.db(${DEVECO_DB}),跳过观测。"; return 0; }

  # 必须先切 node 20:下面的兜底查询和后面的导入都会加载 better-sqlite3,
  # 它是按 node 20 编译的,默认 node(如 26)加载会 ERR_DLOPEN_FAILED
  _cannbot_node20

  # Windows(Git Bash)上 deveco.db 里存的是原生路径(C:\... 或 C:/...),
  # 用 /c/... 查永远查不着;把三种形式都当候选,命中哪个算哪个
  local d1="$target" d2="" d3=""
  if command -v cygpath >/dev/null 2>&1; then
    d2="$(cygpath -w "$target" 2>/dev/null || true)"
    d3="$(cygpath -m "$target" 2>/dev/null || true)"
  fi

  local ids
  if command -v sqlite3 >/dev/null 2>&1; then
    # 单引号转义(目录名可能带引号),防它把下面的 SQL 打断。
    # 替换串不能写成 \'\':bash 3.2 会把反斜杠原样保留进结果,悄悄改掉路径
    local esc1=${d1//"'"/"''"} esc2=${d2//"'"/"''"} esc3=${d3//"'"/"''"}
    ids=$(sqlite3 "$DEVECO_DB" "SELECT id FROM session WHERE directory IN ('$esc1','$esc2','$esc3') AND (parent_id IS NULL OR parent_id='') ORDER BY time_created;" 2>/dev/null || true)
  elif [ -d "$CANNBOT_INSIGHT_DIR/node_modules/better-sqlite3" ]; then
    # 没有 sqlite3 CLI(Git Bash 默认没有)就借 vendor 里现成的 better-sqlite3,参数化查询免转义
    ids=$(cd "$CANNBOT_INSIGHT_DIR" && node -e "
      const db = require('better-sqlite3')(process.argv[1], { readonly: true });
      db.prepare(\"SELECT id FROM session WHERE directory IN (?,?,?) AND (parent_id IS NULL OR parent_id='') ORDER BY time_created\")
        .all(process.argv[2], process.argv[3] || '', process.argv[4] || '').forEach(r => console.log(r.id));
    " "$DEVECO_DB" "$d1" "$d2" "$d3" 2>/dev/null || true)
  else
    say "ℹ️  没有 sqlite3,vendor 依赖也没装(先跑仓库根的 ./setup.sh),跳过观测。"
    return 0
  fi
  [ -n "$ids" ] || { say "ℹ️  deveco.db 里没有 $target 的会话(这个项目还没用 deveco 跑过?),跳过观测。"; return 0; }

  _cannbot_ensure_server || { say "⚠️  cannbot server 起不来,跳过观测(见 /tmp/cannbot-insight.log)"; return 0; }

  say "→ 导入 $target 的 deveco 会话到 cannbot-insight ..."
  (
    cd "$CANNBOT_INSIGHT_DIR" || exit 0
    # 相对路径按 prisma/schema.prisma 所在目录解析 → vendor 的 prisma/dev.db。
    # 不能用绝对路径:Git Bash 的 /c/... 形式 prisma 解析不了
    export DATABASE_URL="file:./dev.db"
    local id
    for id in $ids; do
      npx tsx src/cli/index.ts import --source opencode-db --file "$DEVECO_DB" --session-id "$id" --yes 2>&1 \
        | grep -E "Imported|skipped|turns|已" | sed 's/^/   /' || true
    done
  ) || true

  echo
  say "✅ 观测就绪: http://localhost:$CANNBOT_INSIGHT_PORT"
  say "   点会话看 9 个分析页:tokens/成本、上下文增长、工具调用、工作流阶段、概念传播……"
}

cmd_observe "$@"
