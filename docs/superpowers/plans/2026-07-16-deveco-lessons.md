# deveco-lessons 两课制教学仓库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `~/Workspace/others/longrunning_practice` 重组为全新教学仓库 `~/Workspace/others/deveco-lessons`,两个 lesson(观测对接、ralph loop),学员 clone → `./setup.sh` → `deveco auth login` 即可动手,零手工配置。

**Architecture:** 仓库根放一键 `setup.sh` 与 `vendor/cannbot-insight`(源码 vendor);`lesson1-insight/observe.sh` 是从 ralph.sh 抽出的独立观测脚本,默认指向仓内 vendor;`lesson2-ralph-loop/` 整体迁入 ralph.sh + template + examples + test,其 observe 委托 lesson1。

**Tech Stack:** bash 3.2 兼容 shell、bun test、node 20(nvm)、npm ci + prisma(vendor 内)、rsync。

## Global Constraints

- 源仓库 `/Users/fengyi/Workspace/others/longrunning_practice` **只读**,全程不得修改(终验收 `git -C … status --porcelain` 为空)。
- cannbot-insight 源:`/Users/fengyi/Workspace/others/cannbot-skills-master-plugins-community-cannbot-insight/plugins-community/cannbot-insight`;vendor 时排除 `node_modules/`、`.next/`、`prisma/dev.db`。
- **不代装 deveco**:setup.sh 只检测,缺失则提示 `npm install -g @deveco/deveco-code` 并 exit 1。
- 不自动化 `deveco auth login`。
- shell 风格沿用 ralph.sh:bash 3.2 兼容(无关联数组、`${f}` 花括号紧邻中文必须保留)、小函数、路径全引号、fail closed。
- observe 全程软失败:环境不满足 → 提示 + 退出码 0。
- 新仓中不得残留个人绝对路径(`grep -r "cannbot-skills-master" --exclude-dir=node_modules --exclude-dir=.git` 无命中;`docs/` 下 spec/plan 除外)。
- 提交信息末尾统一加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 仓库骨架 + vendor cannbot-insight

**Files:**
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/.gitignore`
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/vendor/cannbot-insight/`(rsync 整树)

**Interfaces:**
- Produces: `vendor/cannbot-insight/`(含 `package.json`、`package-lock.json`、`prisma/schema.prisma`、`prisma/migrations/`、`src/cli/index.ts`),供 Task 2 的 setup.sh 与 Task 3 的 observe.sh 使用。

- [ ] **Step 1: 写 .gitignore**

```gitignore
# vendor 运行时生成物(setup.sh 现场生成,不入库)
vendor/cannbot-insight/node_modules/
vendor/cannbot-insight/.next/
vendor/cannbot-insight/prisma/dev.db*

# 通用
.DS_Store
*.log
```

- [ ] **Step 2: rsync vendor 源码**

```bash
SRC="/Users/fengyi/Workspace/others/cannbot-skills-master-plugins-community-cannbot-insight/plugins-community/cannbot-insight"
mkdir -p /Users/fengyi/Workspace/others/deveco-lessons/vendor
rsync -a \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude 'prisma/dev.db' \
  --exclude 'prisma/dev.db-journal' \
  "$SRC/" /Users/fengyi/Workspace/others/deveco-lessons/vendor/cannbot-insight/
```

- [ ] **Step 3: 验证排除物没进来、关键文件在**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
test ! -e vendor/cannbot-insight/node_modules && \
test ! -e vendor/cannbot-insight/.next && \
test ! -e vendor/cannbot-insight/prisma/dev.db && \
test -f vendor/cannbot-insight/package-lock.json && \
test -f vendor/cannbot-insight/prisma/schema.prisma && \
test -d vendor/cannbot-insight/prisma/migrations && \
test -f vendor/cannbot-insight/src/cli/index.ts && \
du -sh vendor/cannbot-insight && echo VENDOR_OK
```

Expected: 输出体积(约 5-10M)+ `VENDOR_OK`。

- [ ] **Step 4: 敏感信息与个人路径扫描**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
cat vendor/cannbot-insight/.env
grep -rl "fengyi" vendor/cannbot-insight 2>/dev/null || echo NO_PERSONAL_PATH
```

Expected: `.env` 只有一行 `DATABASE_URL="file:./dev.db"`(非敏感,保留);`NO_PERSONAL_PATH`(若有命中,逐个查看——个人绝对路径要清理,普通署名可保留)。

- [ ] **Step 5: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
git add -A
git commit -m "feat: vendor cannbot-insight 源码(排除 node_modules/.next/dev.db)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: setup.sh 一键环境脚本

**Files:**
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/setup.sh`

**Interfaces:**
- Consumes: `vendor/cannbot-insight/`(Task 1)。
- Produces: 可重复执行的 `./setup.sh`;运行后 `vendor/cannbot-insight/node_modules/` 与 `prisma/dev.db` 就绪。lesson 文档(Task 5/6/7)引用命令名 `./setup.sh`。

- [ ] **Step 1: 写 setup.sh**

```bash
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

# ---- 2. nvm + node 20 -----------------------------------------------------
# cannbot 的原生依赖 better-sqlite3 只在 node 20 编得过(node 26 编不过 V8,
# homebrew 的 node@22 还有 dylib 问题),所以统一走 nvm 的 node 20。
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

# ---- 3. bun(lesson2 的测试与独立验收测试用)-----------------------------
if ! command -v bun >/dev/null 2>&1; then
  say "→ 安装 bun ..."
  curl -fsSL https://bun.sh/install | bash
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
export DATABASE_URL="file:$VENDOR/prisma/dev.db"
if [ -f prisma/dev.db ]; then
  ok "prisma/dev.db 已存在(跳过初始化)"
else
  say "→ 初始化 cannbot 数据库(prisma migrate deploy)..."
  npx prisma migrate deploy
fi

# ---- 6. 自检收尾 -----------------------------------------------------------
echo
say "环境自检:"
ok "deveco:$(deveco --version 2>/dev/null | head -1)"
node -e "require('better-sqlite3')" >/dev/null 2>&1 \
  && ok "better-sqlite3 可加载(node $(node -v))" \
  || die "better-sqlite3 加载失败——确认在 node 20 下重跑一次 ./setup.sh"
ok "bun:$(bun --version)"
[ -f "$VENDOR/prisma/dev.db" ] && ok "cannbot 数据库就绪" || die "prisma/dev.db 没生成"
echo
say "✅ 环境就绪。还差一步(需要你自己登录):deveco auth login"
say "   然后从 lesson1-insight/README.md 开始第一课。"
```

- [ ] **Step 2: 赋权并首跑(全装路径)**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
chmod +x setup.sh
./setup.sh
```

Expected: 本机 nvm/bun 已有 → 对应步骤打「✅ 跳过」;`npm ci` 与 `prisma migrate deploy` 实际执行;结尾 `✅ 环境就绪`,退出码 0。

- [ ] **Step 3: 二跑(全跳过路径,验证幂等)**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons && ./setup.sh; echo "exit=$?"
```

Expected: 所有步骤走「已就绪(跳过)」分支,几秒内结束,`exit=0`。

- [ ] **Step 4: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
git add setup.sh
git commit -m "feat: 一键环境脚本 setup.sh(检测 deveco,自动装 node20/bun/依赖/数据库)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: lesson1-insight/observe.sh 独立观测脚本

**Files:**
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/lesson1-insight/observe.sh`

**Interfaces:**
- Consumes: `vendor/cannbot-insight/`(Task 1)、setup.sh 装好的 node20 依赖(Task 2)。
- Produces: `observe.sh <项目目录>`——按 `session.directory` 导入该项目全部 root 会话;环境不满足时软失败退出码 0。Task 4 的 ralph.sh 以 `"$RALPH_ROOT/lesson1-insight/observe.sh"` 调用它。

- [ ] **Step 1: 写 observe.sh**

内容 = 原 `ralph.sh` 598-671 行的 observe 段落抽出,改动只有三处:`CANNBOT_INSIGHT_DIR` 默认改为仓内 vendor、加独立的 usage/入口、nvm 提示指向 setup.sh:

```bash
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
DEVECO_DB="${DEVECO_DB:-$HOME/.local/share/deveco/deveco.db}"

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
    export DATABASE_URL="file:$CANNBOT_INSIGHT_DIR/prisma/dev.db"
    nohup npx next dev --port "$CANNBOT_INSIGHT_PORT" >/tmp/cannbot-insight.log 2>&1 &
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
  target="$(cd "$target" && pwd)"

  # ${VAR} 的花括号不能省:macOS bash 3.2 会把紧跟 $VAR 的中文字符当成变量名的一部分
  [ -f "$CANNBOT_INSIGHT_DIR/package.json" ] || { say "ℹ️  没找到 cannbot-insight(${CANNBOT_INSIGHT_DIR}),跳过观测。先跑仓库根的 ./setup.sh,装在别处就设 CANNBOT_INSIGHT_DIR。"; return 0; }
  [ -f "$DEVECO_DB" ] || { say "ℹ️  没找到 deveco.db(${DEVECO_DB}),跳过观测。"; return 0; }
  command -v sqlite3 >/dev/null 2>&1 || { say "ℹ️  没有 sqlite3,跳过观测。"; return 0; }

  # 单引号转义(目录名可能带引号),防它把下面的 SQL 打断
  local esc="${target//\'/\'\'}"
  local ids
  ids=$(sqlite3 "$DEVECO_DB" "SELECT id FROM session WHERE directory='$esc' AND (parent_id IS NULL OR parent_id='') ORDER BY time_created;" 2>/dev/null || true)
  [ -n "$ids" ] || { say "ℹ️  deveco.db 里没有 $target 的会话(这个项目还没用 deveco 跑过?),跳过观测。"; return 0; }

  _cannbot_node20
  _cannbot_ensure_server || { say "⚠️  cannbot server 起不来,跳过观测(见 /tmp/cannbot-insight.log)"; return 0; }

  say "→ 导入 $target 的 deveco 会话到 cannbot-insight ..."
  (
    cd "$CANNBOT_INSIGHT_DIR" || exit 0
    export DATABASE_URL="file:$CANNBOT_INSIGHT_DIR/prisma/dev.db"
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
```

- [ ] **Step 2: 软失败场景验证(vendor 缺失 → 退出码 0)**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
chmod +x lesson1-insight/observe.sh
CANNBOT_INSIGHT_DIR=/nonexistent lesson1-insight/observe.sh "$HOME"; echo "exit=$?"
```

Expected: 打印「ℹ️ 没找到 cannbot-insight(/nonexistent)…跳过观测」,`exit=0`。

- [ ] **Step 3: 无参用法验证(usage → 退出码 1)**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
lesson1-insight/observe.sh; echo "exit=$?"
```

Expected: stderr 打印用法,`exit=1`。

- [ ] **Step 4: 真实导入验证**

用一个确实跑过 deveco 会话的目录(源仓库当时的 ralph 练习项目,或先随便用 deveco 跑一个会话的目录;可用 `sqlite3 ~/.local/share/deveco/deveco.db "SELECT DISTINCT directory FROM session LIMIT 10;"` 找现成的):

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
lesson1-insight/observe.sh <一个有会话的目录>; echo "exit=$?"
curl -s "http://localhost:21025/api/observe/data?pageSize=1" | head -c 200
```

Expected: 打印导入行与 `✅ 观测就绪: http://localhost:21025`,`exit=0`;curl 返回 JSON。验证完把 server 收掉:`lsof -ti:21025 | xargs kill -9 2>/dev/null || true`。

- [ ] **Step 5: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
git add lesson1-insight/observe.sh
git commit -m "feat(lesson1): 独立观测脚本 observe.sh,默认指向仓内 vendor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: lesson2-ralph-loop 迁移(ralph.sh 改造 + template/examples/test)

**Files:**
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/lesson2-ralph-loop/ralph.sh`(从源仓库拷贝后修改)
- Create: `lesson2-ralph-loop/template/`、`lesson2-ralph-loop/examples/`、`lesson2-ralph-loop/test/`(原样拷贝)

**Interfaces:**
- Consumes: `../lesson1-insight/observe.sh`(Task 3,以脚本自身位置解析)。
- Produces: `lesson2-ralph-loop/ralph.sh` 的全部子命令(init/sample/once/run/observe/swebench)行为与源版一致,仅 observe 实现改为委托。

- [ ] **Step 1: 原样拷贝四个目录/文件**

```bash
SRC=/Users/fengyi/Workspace/others/longrunning_practice
DST=/Users/fengyi/Workspace/others/deveco-lessons/lesson2-ralph-loop
mkdir -p "$DST"
cp "$SRC/ralph.sh" "$DST/ralph.sh"
rsync -a "$SRC/template/" "$DST/template/"
rsync -a "$SRC/examples/" "$DST/examples/"
rsync -a "$SRC/test/" "$DST/test/"
chmod +x "$DST/ralph.sh"
```

- [ ] **Step 2: 修改 ralph.sh——observe 段整体替换为委托**

把 `# ---------------------------------------------------------------- observe (cannbot-insight)` 到 `cmd_observe()` 函数结束(原 598-671 行,含 `CANNBOT_INSIGHT_DIR`/`CANNBOT_INSIGHT_PORT`/`DEVECO_DB` 三个变量定义与 `_cannbot_node20`/`_cannbot_ensure_server`/`cmd_observe` 三个函数)替换为:

```bash
# ---------------------------------------------------------------- observe (委托 lesson1)

# 观测能力(cannbot-insight 对接)是第一课的内容,实现全在 lesson1-insight/observe.sh,
# 这里只是委托过去。观测是旁路:脚本不在、环境不满足都只提示并跳过,
# 绝不影响本次 run 的结论。环境变量(CANNBOT_INSIGHT_DIR 等)原样透传。
OBSERVE_SH="$(cd "$HERE/.." && pwd)/lesson1-insight/observe.sh"

cmd_observe() {
  if [ -x "$OBSERVE_SH" ]; then
    "$OBSERVE_SH" "$@"
  else
    # ${OBSERVE_SH} 的花括号不能省:macOS bash 3.2 会把紧跟的中文字符当成变量名的一部分
    say "ℹ️  没找到 lesson1 的 observe.sh(${OBSERVE_SH}),跳过观测。"
  fi
}
```

同时把 usage 里环境变量一节的第一行:

```
  CANNBOT_INSIGHT_DIR   cannbot-insight 装在哪（默认按本机已装路径）
```

改为:

```
  CANNBOT_INSIGHT_DIR   cannbot-insight 装在哪（默认用本仓 vendor/cannbot-insight）
```

其余(`run` 末尾的 `cmd_observe "$target" || true`、`RALPH_NO_OBSERVE` 判断、main 的 `observe)` 分支)**一律不动**。

- [ ] **Step 3: 验证个人路径清零 + 委托指向正确**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
grep -c "cannbot-skills-master" lesson2-ralph-loop/ralph.sh || echo NO_HARDCODED_PATH
grep -n "OBSERVE_SH=" lesson2-ralph-loop/ralph.sh
grep -c "_cannbot_ensure_server" lesson2-ralph-loop/ralph.sh || echo NO_INLINE_IMPL
bash -n lesson2-ralph-loop/ralph.sh && echo SYNTAX_OK
```

Expected: `NO_HARDCODED_PATH`、OBSERVE_SH 一行、`NO_INLINE_IMPL`、`SYNTAX_OK`。

- [ ] **Step 4: 跑既有测试套件(回归门)**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons/lesson2-ralph-loop
bun test test/ralph-loop.test.ts test/swebench-cli.test.ts
```

Expected: 全部 PASS(测试用相对路径 `../template/`、`import.meta.dir/..`,迁移后无需改动;若有失败,先看是不是路径假设,修 ralph.sh 不改测试断言)。

- [ ] **Step 5: sample list + observe 委托冒烟**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons/lesson2-ralph-loop
./ralph.sh sample list
CANNBOT_INSIGHT_DIR=/nonexistent ./ralph.sh observe "$HOME"; echo "exit=$?"
```

Expected: 列出 csv/json/rustwrap/semver/smoke 五个案例(swebench 目录无 GOAL.md,不出现在列表,正常);observe 打印 lesson1 脚本里的「跳过观测」提示,`exit=0`。

- [ ] **Step 6: 检查 examples 文档里的路径引用**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
grep -rn "ralph\.sh\|\.\./\.\." lesson2-ralph-loop/examples/*/README.md lesson2-ralph-loop/examples/swebench/*/README.md 2>/dev/null
```

对命中的相对路径逐个核对:在新目录层级下(`lesson2-ralph-loop/` 为根)是否仍然成立,失效的改为以 `lesson2-ralph-loop/` 为基准的写法。没命中则跳过。

- [ ] **Step 7: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
git add lesson2-ralph-loop
git commit -m "feat(lesson2): 迁入 ralph loop(ralph.sh/template/examples/test),observe 委托 lesson1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: lesson1-insight/README.md 教学文档

**Files:**
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/lesson1-insight/README.md`

**Interfaces:**
- Consumes: `observe.sh`(Task 3)、`../setup.sh`(Task 2)。
- Produces: 第一课完整教学文档,顶层 README(Task 7)链接它。

- [ ] **Step 1: 写 README.md**

```markdown
# Lesson 1:用 DevEco 对接 cannbot-insight

给 DevEco 的 agent 会话装上「回放镜头」:任意项目跑过的会话,都能导进
cannbot-insight,turn-by-turn 看每一轮烧了多少 token、上下文怎么涨、
调了哪些工具。

## 你会学到

- DevEco 的会话数据长什么样、存在哪
- 为什么 cannbot-insight 能**零改码**直读 DevEco 的会话库
- 用 `observe.sh` 把任意项目的会话导入并在 Web 界面回看

## 前置条件

仓库根跑过 `./setup.sh`(会装好 node 20、cannbot-insight 依赖与数据库),
并且 `deveco auth login` 已配好模型。

## 原理:一次「免费」的适配

deveco 是 opencode 派生的,它的会话库
`~/.local/share/deveco/deveco.db` 里 `session` / `message` / `part`
三张表的结构,和 cannbot-insight 的 `opencode-db` 适配器要求的**一模一样**。
所以对接不需要写任何转换代码——`observe.sh` 做的只是:

1. 按 `session.directory` 从 deveco.db 里捞出目标项目的所有 root 会话;
2. 逐个调 cannbot 的 CLI `import --source opencode-db` 导入(按 taskId 去重,幂等);
3. 起好 cannbot 的 Web server 让你回看。

## 动手

### 1. 造几条会话

随便建个目录,用 deveco 跑两三个会话(内容不重要,有工具调用更好看):

```bash
mkdir -p ~/play/hello-deveco && cd ~/play/hello-deveco
deveco run "写一个 fizzbuzz.py 并运行它"
deveco run "把 fizzbuzz 改成 1 到 30 并重新运行"
```

### 2. 导入观测

```bash
cd <本仓库>
./lesson1-insight/observe.sh ~/play/hello-deveco
```

看到 `✅ 观测就绪: http://localhost:21025` 就成了。

### 3. 回看

浏览器开 http://localhost:21025,点进刚导入的会话,逐个看分析页:
tokens/成本、上下文增长、工具调用、工作流阶段、概念传播……

重复跑 `observe.sh` 是幂等的(按 taskId 去重,更新而非新增),放心多导几次。

## 验收

- [ ] 能在 Web 界面指出某一轮的输入/输出 token 数
- [ ] 能说出该会话调用了哪些工具、各调了几次
- [ ] 对同一项目重跑 `observe.sh`,会话数不翻倍(幂等)

## 坑

- **node 版本**:cannbot 的原生依赖 better-sqlite3 只在 node 20 编得过
  (node 26 编不过 V8,homebrew 的 node@22 有 dylib 问题)。`setup.sh`
  和 `observe.sh` 都会自动切 nvm 的 node 20,但你手动在 vendor 里
  `npm install` 时要记得先 `nvm use 20`。
- **observe 是旁路**:cannbot 没装好、server 起不来、deveco.db 不存在,
  都只是提示一句然后退出码 0——它被设计成绝不影响调用方(第二课的
  ralph loop 收工后会自动调它,不能因为观测挂了污染跑分结论)。
- **server 日志**在 `/tmp/cannbot-insight.log`,起不来先看它。

## 环境变量

| 变量 | 默认 | 作用 |
|------|------|------|
| `CANNBOT_INSIGHT_DIR` | 本仓 `vendor/cannbot-insight` | cannbot-insight 装在哪 |
| `CANNBOT_INSIGHT_PORT` | `21025` | cannbot Web/API 端口 |
| `DEVECO_DB` | `~/.local/share/deveco/deveco.db` | deveco 会话库 |

## 下一课

[Lesson 2:对 DevEco 实现 ralph loop](../lesson2-ralph-loop/README.md)——
让 agent 自己 worker → reviewer 循环推进一个目标,再用这一课的观测
回看整个 loop 的轨迹。
```

- [ ] **Step 2: 核对文档中的命令真实可跑**

逐条核对:`./lesson1-insight/observe.sh`(存在且可执行)、端口 21025、`deveco run` 是合法子命令(`deveco --help | grep -q run`)。表格中的默认值与 observe.sh 代码一致(grep 对照)。

- [ ] **Step 3: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
git add lesson1-insight/README.md
git commit -m "docs(lesson1): 教学文档(原理/动手/验收/坑)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: lesson2-ralph-loop/README.md 教学文档

**Files:**
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/lesson2-ralph-loop/README.md`

**Interfaces:**
- Consumes: 源仓库 `RUNBOOK.md` 的内容骨架、Task 4 迁入的 ralph.sh。
- Produces: 第二课完整教学文档,顶层 README(Task 7)链接它。

- [ ] **Step 1: 写 README.md**

以源仓库 `/Users/fengyi/Workspace/others/longrunning_practice/RUNBOOK.md` 为底本改写,结构与改动点:

```markdown
# Lesson 2:对 DevEco 实现 Ralph Loop

给 deveco 一个目标,它自己 worker → reviewer → worker 循环推进,
直到 reviewer 判定验收通过。

## 你会学到

- ralph loop 的三件套:worker / reviewer / 插件,以及为什么裁判和执行者要分离
- 装(init)与跑(once/run)分离的工程理由
- 独立验收测试为什么必须藏在 worker 摸不到的地方
- 把 opencode 生态的东西适配到 deveco 时的四个坑
- (进阶)用 SWE-bench Lite 做单次执行 vs loop 的 A/B 对比

## 前置条件

完成 [Lesson 1](../lesson1-insight/README.md)(本课收工后自动复用它回看轨迹);
仓库根跑过 `./setup.sh`,`deveco auth login` 已配好。

## 三件套
(RUNBOOK 开头三条原样迁入:worker / reviewer / 插件各自职责)

## 用法
(RUNBOOK「用法」一节原样迁入,命令前缀统一为 ./ralph.sh,在本目录下执行;
「先拿现成案例练手」smoke 流程原样保留)

## 观测这个 loop
(改写:run 收工后自动调 ../lesson1-insight/observe.sh,即第一课的内容;
RALPH_NO_OBSERVE=1 可关;环境变量表指向 lesson1 README,不再重复)

## 适配 deveco 时踩到的四个坑
(RUNBOOK 同名一节原样迁入,含「server 只能按端口杀」补记)

## 进阶:跑 SWE-bench Lite 实例
(RUNBOOK 同名一节原样迁入,examples/swebench 相对路径核对后保留)

## 测试

```bash
bun test test/ralph-loop.test.ts test/swebench-cli.test.ts
```
```

其中「原样迁入」= 从 RUNBOOK.md 对应小节复制全文,仅修正:路径前缀(如 `examples/` 在本目录下不变)、观测一节指向 lesson1、删除 RUNBOOK 里已过时的表述。**不留任何「见 RUNBOOK」的悬空引用**(新仓没有 RUNBOOK)。

- [ ] **Step 2: 核对无悬空引用与路径**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
grep -n "RUNBOOK" lesson2-ralph-loop/README.md || echo NO_DANGLING_RUNBOOK
grep -n "longrunning_practice" lesson2-ralph-loop/README.md || echo NO_OLD_REPO_REF
grep -on "examples/[a-z_/-]*" lesson2-ralph-loop/README.md | while IFS=: read -r _ p; do
  test -e "lesson2-ralph-loop/$p" || echo "BROKEN: $p"
done
```

Expected: `NO_DANGLING_RUNBOOK`、`NO_OLD_REPO_REF`、无 `BROKEN:` 行。

- [ ] **Step 3: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
git add lesson2-ralph-loop/README.md
git commit -m "docs(lesson2): 教学文档(三件套/用法/观测/四个坑/SWE-bench 进阶)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 顶层 README + 终验收

**Files:**
- Create: `/Users/fengyi/Workspace/others/deveco-lessons/README.md`

**Interfaces:**
- Consumes: 两课 README(Task 5/6)、setup.sh(Task 2)。
- Produces: 课程入口文档;整仓通过 spec 验收清单。

- [ ] **Step 1: 写顶层 README.md**

```markdown
# deveco-lessons:DevEco 长程任务两课

用两个动手 lesson,学会「让 agent 长时间自主干活,并且看得见它在干什么」:

| | 主题 | 你得到什么 |
|---|------|-----------|
| [Lesson 1](lesson1-insight/README.md) | 用 DevEco 对接 cannbot-insight | 任意 DevEco 会话的 turn-by-turn 回放:token、上下文、工具调用 |
| [Lesson 2](lesson2-ralph-loop/README.md) | 对 DevEco 实现 ralph loop | worker → reviewer 自循环直到验收通过;进阶 SWE-bench A/B |

两课递进:第一课装好「镜头」,第二课跑起 loop 并用镜头回看它。

## 快速开始

```bash
git clone <本仓库> && cd deveco-lessons
./setup.sh            # 一键环境:node20/bun/cannbot 依赖与数据库,幂等可重跑
deveco auth login     # 唯一需要你自己完成的一步:配模型凭证
```

唯一前置:已安装 deveco(`npm install -g @deveco/deveco-code`)。
其余依赖(含 cannbot-insight 本体,vendor 在 `vendor/` 下)全部由
`setup.sh` 就地装好,不需要手工配置。

装完从 [Lesson 1](lesson1-insight/README.md) 开始。

## 仓库结构

```
setup.sh              一键环境脚本
vendor/cannbot-insight  会话观测器(源码 vendor,依赖由 setup.sh 现场安装)
lesson1-insight/      第一课:观测对接(observe.sh + 教学文档)
lesson2-ralph-loop/   第二课:ralph loop(ralph.sh + 模板 + 案例 + 测试)
```
```

- [ ] **Step 2: spec 终验收清单逐条跑**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
# 1. setup 幂等(第二次全跳过)
./setup.sh && ./setup.sh && echo SETUP_IDEMPOTENT
# 2. lesson2 测试
(cd lesson2-ralph-loop && bun test test/ralph-loop.test.ts test/swebench-cli.test.ts)
# 3. observe 软失败
CANNBOT_INSIGHT_DIR=/nonexistent lesson1-insight/observe.sh "$HOME" && echo OBSERVE_SOFTFAIL_OK
# 4. sample list + 委托检查
(cd lesson2-ralph-loop && ./ralph.sh sample list)
grep -L "_cannbot_ensure_server" lesson2-ralph-loop/ralph.sh >/dev/null && echo DELEGATED
# 5. 无个人路径残留(docs/ 下 spec/plan 除外)
grep -rn "cannbot-skills-master" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs . || echo NO_PERSONAL_PATH
# 6. 源仓库未被改动
[ -z "$(git -C /Users/fengyi/Workspace/others/longrunning_practice status --porcelain)" ] && echo ORIGIN_UNTOUCHED
```

Expected: `SETUP_IDEMPOTENT`、bun 全 PASS、`OBSERVE_SOFTFAIL_OK`、案例列表、`DELEGATED`、`NO_PERSONAL_PATH`、`ORIGIN_UNTOUCHED` 全部出现。

注:第 6 条对照的是本 session 开始时源仓库的原始状态——源仓库本来就有未跟踪文件(`.deck-work`、`.omc/`、`RUNBOOK.md`、`examples/` 等),`status --porcelain` 非空不算失败,只要**没有新增改动**(对比会话开头 gitStatus 快照)即可;实际检查改为 `git -C … diff --stat` 为空 + 未跟踪清单与快照一致。

- [ ] **Step 3: Commit**

```bash
cd /Users/fengyi/Workspace/others/deveco-lessons
git add README.md
git commit -m "docs: 课程总览 README(快速开始/两课导航/仓库结构)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
