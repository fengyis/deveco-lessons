#!/usr/bin/env bash
# 一键环境:检测 deveco,装 nvm+node20、bun、cannbot-insight 依赖与数据库。
# 幂等可重跑:每步「已满足则跳过」。deveco 本体不代装,只检测。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$HERE/vendor/cannbot-insight"
NVM_VERSION="v0.40.3"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
die() { echo "❌ $*" >&2; exit 1; }
ok()  { printf "   ✅ %s\n" "$*"; }

# ---- 1. deveco:只检测,不代装 --------------------------------------------
command -v deveco >/dev/null 2>&1 \
  || die "没找到 deveco。请先自行安装:npm install -g @deveco/deveco-code"
ok "deveco $(deveco --version 2>/dev/null | head -1)"

# ---- 平台检测 ---------------------------------------------------------------
IS_WINDOWS=0
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;; esac

# ---- 2. node 20 -------------------------------------------------------------
# cannbot 的原生依赖 better-sqlite3 需要 node 20(macOS 上 node 26 编不过 V8,
# homebrew 的 node@22 还有 dylib 问题)。
if [ "$IS_WINDOWS" = "1" ]; then
  # Windows(Git Bash):nvm 不可用,node 由用户自装,这里只检测版本
  command -v node >/dev/null 2>&1 || die "没找到 node。请先安装 Node.js 20:https://nodejs.org"
  NODE_MAJOR="$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  [ "$NODE_MAJOR" -ge 20 ] || die "需要 node >= 20(当前 $(node -v));请从 https://nodejs.org 安装 20.x"
  ok "node $(node -v)(系统安装)"
else
  if [ ! -s "$HOME/.nvm/nvm.sh" ]; then
    say "→ 安装 nvm ${NVM_VERSION} ..."
    curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
  fi
  set +u
  . "$HOME/.nvm/nvm.sh"
  if ! nvm ls 20 >/dev/null 2>&1; then
    say "→ 安装 node 20 ..."
    nvm install 20
  fi
  nvm use 20 >/dev/null
  set -u
  ok "node $(node -v)(经 nvm)"
fi

# ---- 3. bun(lesson2 的测试与独立验收测试用)-----------------------------
if ! command -v bun >/dev/null 2>&1; then
  say "→ 安装 bun ..."
  if [ "$IS_WINDOWS" = "1" ]; then
    # Windows 官方安装走 PowerShell 脚本;bun 装到 ~/.bun/bin
    powershell.exe -NoProfile -Command "irm bun.sh/install.ps1 | iex" \
      || die "bun 安装失败;手动装:https://bun.sh"
  else
    curl -fsSL https://bun.sh/install | bash
  fi
  export PATH="$HOME/.bun/bin:$PATH"
fi
ok "bun $(bun --version)"

# ---- 4. cannbot-insight 依赖(npm ci 按 lockfile 精确复原)----------------
cd "$VENDOR"
if [ -d node_modules ] && node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  ok "cannbot-insight 依赖已就绪(跳过 npm ci)"
else
  say "→ npm ci(首次要几分钟,better-sqlite3 会现场编译)..."
  npm ci
fi

# ---- 5. prisma 数据库 ------------------------------------------------------
# 相对路径按 prisma/schema.prisma 所在目录解析;Git Bash 的 /c/... 绝对路径 prisma 解析不了
export DATABASE_URL="file:./dev.db"
if [ -f prisma/dev.db ]; then
  ok "prisma/dev.db 已存在(跳过初始化)"
else
  say "→ 初始化 cannbot 数据库(prisma migrate deploy)..."
  npx prisma migrate deploy
fi

# ---- 6. 生产构建 ------------------------------------------------------------
# next dev 每个页面首次访问都现场编译,冷缓存下点一页等十几秒;build 一次,
# 以后 observe 用 next start 秒开。NEXT_PUBLIC_* 是构建期烙进产物的,
# 高级标签页(subagents/interactions)的开关必须在这里带上。
if [ -f .next/BUILD_ID ]; then
  ok "cannbot 生产构建已存在(跳过 next build)"
else
  say "→ next build(一次性,约 1-3 分钟)..."
  NEXT_PUBLIC_SHOW_ADVANCED_TABS=true npx next build
fi

# ---- 7. 自检收尾 -----------------------------------------------------------
echo
say "环境自检:"
ok "deveco:$(deveco --version 2>/dev/null | head -1)"
node -e "require('better-sqlite3')" >/dev/null 2>&1 \
  && ok "better-sqlite3 可加载(node $(node -v))" \
  || die "better-sqlite3 加载失败——确认在 node 20 下重跑一次 ./setup.sh"
ok "bun:$(bun --version)"
[ -f "$VENDOR/prisma/dev.db" ] && ok "cannbot 数据库就绪" || die "prisma/dev.db 没生成"
[ -f "$VENDOR/.next/BUILD_ID" ] && ok "cannbot 生产构建就绪" || die ".next/BUILD_ID 没生成"
echo
say "✅ 环境就绪。还差一步(需要你自己登录):deveco auth login"
say "   然后从 lesson1-insight/README.md 开始第一课。"
