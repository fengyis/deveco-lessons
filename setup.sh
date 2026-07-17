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

# ---- 2. node(20/22/23 任一)------------------------------------------------
# cannbot 的原生依赖 better-sqlite3(11.10.0)官方预编译覆盖 node 18/20/22/23
# (mac/linux/win 三平台全);cannbot 本体要求 >=20,所以 20/22/23 都能免编译直装。
# 没有预编译包的版本(24+,如 26)会回退源码编译,学员机器一般编不过——
# 当前 node 受支持就直接用,不受支持才回退 nvm 装 20(Windows 无 nvm,只检测)。
_node_supported() {
  command -v node >/dev/null 2>&1 || return 1
  case "$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null)" in
    20|22|23) return 0 ;;
  esac
  # 24+ 官方没有 11.10.0 的预编译包,但认自编包:按官方资产名放进 vendor/prebuilds/
  # 就放行(better-sqlite3-v<版本>-node-v<ABI>-<platform>-<arch>.tar.gz,见 README)
  local abi plat
  abi="$(node -e "console.log(process.versions.modules)" 2>/dev/null)"
  plat="$(node -e "console.log(process.platform + '-' + process.arch)" 2>/dev/null)"
  ls "$HERE/vendor/prebuilds/better-sqlite3-v"*"-node-v${abi}-${plat}.tar.gz" >/dev/null 2>&1
}
if _node_supported; then
  ok "node $(node -v)(已安装,better-sqlite3 有对应预编译包)"
elif [ "$IS_WINDOWS" = "1" ]; then
  die "需要 node 20 或 22(当前 $(node -v 2>/dev/null || echo 未安装))。推荐 20 LTS——仓库自带的离线预编译包只覆盖 node 20,22 需要能联网取包;24+ 没有官方预编译包,会在本机触发 C++ 编译然后失败(有编译工具链的话可以自编包放进 vendor/prebuilds/,见 README)。多版本共存可用 nvm-windows:https://github.com/coreybutler/nvm-windows"
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
# 仓库自带 better-sqlite3 的预编译包(vendor/prebuilds/,目前是 win32-x64 + node20)。
# prebuild-install 装的时候会先查这个目录,命中就不去 GitHub 下载——
# 公司网络挡 GitHub 也能装。文件名必须和官方发布的资产名完全一致。
export npm_config_better_sqlite3_local_prebuilds="$HERE/vendor/prebuilds"
# prisma 的引擎二进制从 binaries.prisma.sh 下载(npm ci 时由 @prisma/engines 的
# postinstall 触发),公司网络常被挡;默认改走 npmmirror 的镜像(二进制与官方一致)。
# 能直连官方或有内网镜像时,用 PRISMA_ENGINES_MIRROR 覆盖。
export PRISMA_ENGINES_MIRROR="${PRISMA_ENGINES_MIRROR:-https://registry.npmmirror.com/-/binary/prisma}"
cd "$VENDOR"
if [ -d node_modules ] && node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  ok "cannbot-insight 依赖已就绪(跳过 npm ci)"
else
  say "→ npm ci(首次要几分钟,better-sqlite3 会现场编译)..."
  npm ci
fi

# ---- 4.5 Windows:预置 prisma 引擎(离线可用)-----------------------------
# prisma 引擎二进制从 binaries.prisma.sh 下载,公司网络常被挡。仓库自带了
# windows 的两个引擎(vendor/prebuilds/prisma/windows/),种进 fetch-engine 的
# 缓存目录(Windows 上是 <项目>/node_modules/.cache/prisma/master/<commit>/windows,
# 文件名平台无关:libquery-engine / schema-engine,.sha256 内容是裸 hex)。
# 之后 generate / migrate 一律先命中缓存,不再联网。
if [ "$IS_WINDOWS" = "1" ] && [ -d "$HERE/vendor/prebuilds/prisma/windows" ]; then
  ENGINES_COMMIT="$(node -e "console.log(require('@prisma/engines-version/package.json').prisma.enginesVersion)")"
  PRISMA_CACHE="$VENDOR/node_modules/.cache/prisma/master/$ENGINES_COMMIT/windows"
  mkdir -p "$PRISMA_CACHE"
  gunzip -c "$HERE/vendor/prebuilds/prisma/windows/query_engine.dll.node.gz" > "$PRISMA_CACHE/libquery-engine"
  gunzip -c "$HERE/vendor/prebuilds/prisma/windows/schema-engine.exe.gz"     > "$PRISMA_CACHE/schema-engine"
  for n in libquery-engine schema-engine; do
    printf %s "$(sha256sum "$PRISMA_CACHE/$n" | cut -d' ' -f1)" > "$PRISMA_CACHE/$n.sha256"
  done
  ok "prisma 引擎已预置(离线缓存命中)"
  # @prisma/client 的 postinstall 在断网下会失败但不致命,这里显式补一次 generate
  export DATABASE_URL="file:./dev.db"
  npx prisma generate >/dev/null 2>&1 && ok "prisma client 已生成" \
    || say "⚠️  prisma generate 失败,稍后跑 migrate 时会再试"
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
  NEXT_PUBLIC_SHOW_ADVANCED_TABS=true NEXT_TELEMETRY_DISABLED=1 npx next build
fi

# ---- 7. 自检收尾 -----------------------------------------------------------
echo
say "环境自检:"
ok "deveco:$(deveco --version 2>/dev/null | head -1)"
node -e "require('better-sqlite3')" >/dev/null 2>&1 \
  && ok "better-sqlite3 可加载(node $(node -v))" \
  || die "better-sqlite3 加载失败——确认在 node 20/22 下重跑一次 ./setup.sh"
ok "bun:$(bun --version)"
[ -f "$VENDOR/prisma/dev.db" ] && ok "cannbot 数据库就绪" || die "prisma/dev.db 没生成"
[ -f "$VENDOR/.next/BUILD_ID" ] && ok "cannbot 生产构建就绪" || die ".next/BUILD_ID 没生成"
echo
say "✅ 环境就绪。还差一步(需要你自己登录):deveco auth login"
say "   然后从 lesson1-insight/README.md 开始第一课。"
