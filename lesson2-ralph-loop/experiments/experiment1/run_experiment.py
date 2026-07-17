#!/usr/bin/env python3
"""Experiment 1 跨平台驱动(Windows 原生 / macOS / Linux / WSL)。

    python run_experiment.py prepare   环境体检 + 建双臂
    python run_experiment.py once      跑 A 组并打分
    python run_experiment.py loop      跑 B 组并打分
    python run_experiment.py report    对比 + 审计
    python run_experiment.py audit <项目目录> [session_id]
    python run_experiment.py all       一条龙

不依赖 ralph.sh / bash / lsof / sqlite3 CLI:自己拉起 deveco serve、走 HTTP API
点火、盯哨兵文件收工、内置曲线采样与偷看审计(Python 自带 sqlite3)。
重做实验:先删掉 ~/ralph-experiment1(或你的 RALPH_EXP1_DIR)。
"""
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request

# 中文 Windows 的 locale 编码是 GBK:subprocess 解码 deveco 的 UTF-8 输出会在读线程里
# 炸掉(stdout 变 None),read_text/write_text 读写中文模板同样遭殃。整个进程切到
# UTF-8 模式重跑自己;PYTHONUTF8 会传给 run_qa.py 等所有子进程。
if sys.platform == "win32" and not sys.flags.utf8_mode:
    os.environ["PYTHONUTF8"] = "1"
    sys.exit(subprocess.call([sys.executable] + sys.argv))

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = pathlib.Path(os.environ.get("RALPH_EXP1_DIR", str(pathlib.Path.home() / "ralph-experiment1")))
WORKER = os.environ.get("RALPH_EXP1_WORKER", "deepseek/deepseek-v4-flash")
REVIEWER = os.environ.get("RALPH_EXP1_REVIEWER", "deepseek/deepseek-reasoner")
PORT = {"once": int(os.environ.get("RALPH_EXP1_PORT_ONCE", "4121")),
        "loop": int(os.environ.get("RALPH_EXP1_PORT_LOOP", "4122"))}
WIN = sys.platform == "win32"

TEMPLATE_FILES = [
    ".deveco/plugin/ralph-loop.ts",
    ".deveco/agent/ralph-worker.md",
    ".deveco/agent/ralph-reviewer.md",
    ".deveco/agent/ralph-once.md",
]


def say(msg):
    print(msg, flush=True)


def die(msg):
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(1)


def sh(cmd, cwd=None, **kw):
    # 编码必须锁死 UTF-8:交给 locale 的话,GBK 解不动 deveco/git 的输出;
    # errors="replace" 保证个别脏字节也不会把 stdout 炸成 None。
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", **kw)


def deveco_bin():
    exe = shutil.which("deveco") or (WIN and (shutil.which("deveco.cmd") or shutil.which("deveco.exe")))
    return exe or die("找不到 deveco,请先安装并加入 PATH")


def deveco_db():
    cand = [os.environ.get("DEVECO_DB", "")]
    home = pathlib.Path.home()
    cand += [str(home / ".local/share/deveco/deveco.db")]
    if WIN:
        for var in ("LOCALAPPDATA", "APPDATA"):
            base = os.environ.get(var)
            if base:
                cand.append(str(pathlib.Path(base) / "deveco" / "deveco.db"))
    for c in cand:
        if c and pathlib.Path(c).is_file():
            return c
    return None


# ---------------------------------------------------------------- prepare

def init_project(target: pathlib.Path):
    """等价于 ralph.sh init:模板、config、git(控制面进 exclude,绝不 commit)。"""
    (target / ".deveco/plugin").mkdir(parents=True, exist_ok=True)
    (target / ".deveco/agent").mkdir(parents=True, exist_ok=True)
    (target / ".ralph").mkdir(parents=True, exist_ok=True)
    for f in TEMPLATE_FILES:
        shutil.copy(ROOT / "template" / f, target / f)
    (target / ".ralph/config.json").write_text(json.dumps({
        "workerAgent": "ralph-worker", "workerModel": WORKER,
        "reviewerAgent": "ralph-reviewer", "reviewerModel": REVIEWER,
        "maxIterations": 20,
    }, ensure_ascii=False, indent=2) + "\n")
    (target / ".ralph/PROGRESS.md").write_text("# 进展\n")

    sh(["git", "init", "-q"], cwd=target)
    sh(["git", "config", "user.email", "ralph@local"], cwd=target)
    sh(["git", "config", "user.name", "ralph"], cwd=target)
    exclude = target / ".git/info/exclude"
    exclude.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude.read_text() if exclude.exists() else ""
    for pat in ("/.ralph/", "/.deveco/", "/deveco.json"):
        if pat not in existing:
            existing += pat + "\n"
    exclude.write_text(existing)
    sh(["git", "add", "-A"], cwd=target)
    sh(["git", "commit", "-q", "-m", "ralph: initial", "--allow-empty"], cwd=target)


def sample_rustwrap(target: pathlib.Path):
    """等价于 ralph.sh sample rustwrap:GOAL + 专用 reviewer + 隐藏验收 + 种子 + 基线提交。"""
    src = ROOT / "examples/rustwrap"
    shutil.copy(src / "GOAL.md", target / ".ralph/GOAL.md")
    shutil.copy(src / "ralph-reviewer.md", target / ".deveco/agent/ralph-reviewer.md")
    for f in (src / "hidden").iterdir():
        shutil.copy(f, target / ".ralph" / f.name) if f.is_file() else shutil.copytree(f, target / ".ralph" / f.name)
    shutil.copytree(src / "seed", target, dirs_exist_ok=True)
    sh(["git", "add", "-A"], cwd=target)
    sh(["git", "commit", "-q", "-m", "ralph: seed (failing baseline)"], cwd=target)


def strip_task_false(target: pathlib.Path):
    p = target / ".deveco/agent/ralph-once.md"
    p.write_text("".join(l for l in p.read_text().splitlines(keepends=True)
                         if l.strip() != "task: false"))


def cmd_prepare():
    say("=== 环境体检 ===")
    for tool in ("cargo", "git"):
        shutil.which(tool) or die(f"缺 {tool}(cargo 装 rustup: https://rustup.rs)")
    dv = deveco_bin()
    auth = sh([dv, "auth", "list"])
    "deepseek" in (auth.stdout + auth.stderr).lower() or die("deveco 里没配 DeepSeek 凭证;先 deveco auth login")
    if os.environ.get("DEVECO_SERVER_PASSWORD"):
        say("⚠️  检测到 DEVECO_SERVER_PASSWORD,运行时会剔除(否则插件调不动自己的 server)")
    say(f"✅ 依赖齐全  worker={WORKER}  reviewer={REVIEWER}")

    if WORK.exists():
        die(f"{WORK} 已存在;重做实验请先删除它(不要复用半成品)")

    for arm in ("once", "loop"):
        say(f"=== 建 {arm} 臂 ===")
        init_project(WORK / arm)
        sample_rustwrap(WORK / arm)
        strip_task_false(WORK / arm)

    a, b = (WORK / "once/.ralph/GOAL.md"), (WORK / "loop/.ralph/GOAL.md")
    a.read_bytes() == b.read_bytes() or die("两臂 GOAL 不一致(不应发生)")
    tracked = sh(["git", "ls-files", ".ralph"], cwd=WORK / "once").stdout.strip()
    not tracked or die(".ralph 进了 git(不应发生,验收数据会泄漏)")

    say("=== 校准:种子基线应为 0/816(首次要编译依赖,约 1 分钟)===")
    r = sh([sys.executable, ".ralph/run_qa.py", "--samples", "0"], cwd=WORK / "once")
    say("\n".join((r.stdout + r.stderr).splitlines()[:2]))
    say(f"✅ prepare 完成。下一步: {sys.executable} {sys.argv[0]} once")


# ---------------------------------------------------------------- serve / kickoff

def port_in_use(port):
    import socket
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def kill_tree(proc):
    if WIN:
        sh(["taskkill", "/PID", str(proc.pid), "/T", "/F"])
    else:
        import signal
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            proc.kill()


# localhost 控制面必须绕过一切代理:urllib 会读环境变量甚至 macOS 系统代理设置,
# 学员机器普遍挂代理,127.0.0.1 的请求一旦进代理就会被掐断(实测踩过)。
_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_json(url, body, retries=0):
    """POST JSON(直连,不走代理)。server 刚起时 TCP 已通但 HTTP 层未就绪,
    首发请求可能被掐断——对连接级错误重试;HTTP 4xx/5xx 不吞。"""
    import http.client
    import urllib.error
    last = None
    for _ in range(retries + 1):
        req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with _NO_PROXY.open(req, timeout=7200) as r:
                return json.loads(r.read())
        except (http.client.RemoteDisconnected, ConnectionError, urllib.error.URLError) as e:
            if isinstance(e, urllib.error.HTTPError):
                raise
            last = e
            time.sleep(1)
    raise last


def start_sampler(arm_dir: pathlib.Path, sentinels):
    csv = arm_dir / ".ralph/score_curve.csv"
    csv.write_text("epoch,hhmmss,score\n")

    def loop():
        while True:
            r = sh([sys.executable, ".ralph/run_qa.py", "--samples", "0"], cwd=arm_dir)
            m = re.search(r"QA SCORE: (\d+)", r.stdout)
            with open(csv, "a") as f:
                f.write(f"{int(time.time())},{time.strftime('%H:%M:%S')},{m.group(1) if m else 'NA'}\n")
            if any((arm_dir / ".ralph" / s).exists() for s in sentinels):
                return
            time.sleep(90)

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return t


def run_arm(arm):
    arm_dir = WORK / arm
    (arm_dir / ".ralph").is_dir() or die("先跑 prepare")
    port = PORT[arm]
    port_in_use(port) and die(
        f"端口 {port} 被占;先清掉旧 server(Windows: netstat -ano | findstr :{port} 再 taskkill /PID <pid> /F;"
        f" mac/linux: lsof -ti:{port} | xargs kill -9)")

    ralph = arm_dir / ".ralph"
    for s in ("DONE", "STOPPED", "ONCE", "ONCE_DONE", "plugin.log"):
        (ralph / s).unlink(missing_ok=True)
    once = arm == "once"
    if once:
        (ralph / "ONCE").write_text("single worker attempt\n")
    sentinels = ("ONCE_DONE", "STOPPED") if once else ("DONE", "STOPPED")

    env = {k: v for k, v in os.environ.items() if k != "DEVECO_SERVER_PASSWORD"}
    serve_log = open(ralph / "serve.log", "w")
    kw = {}
    if WIN:
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    server = subprocess.Popen([deveco_bin(), "serve", "--port", str(port)],
                              stdout=serve_log, stderr=subprocess.STDOUT, env=env, **kw)
    try:
        for _ in range(50):
            if port_in_use(port):
                break
            time.sleep(0.5)
        else:
            die(f"server 没起来,见 {ralph}/serve.log")
        say(f"→ server http://127.0.0.1:{port}")

        base = f"http://127.0.0.1:{port}"
        created = http_json(f"{base}/session?directory={arm_dir}", {"title": "ralph"}, retries=15)
        sid = created.get("id") or created.get("data", {}).get("id") or die("创建会话失败")
        (ralph / "session_id").write_text(sid)
        say(f"→ worker session {sid}")

        cfg = json.loads((ralph / "config.json").read_text())
        body = {"agent": "ralph-once" if once else cfg["workerAgent"],
                "parts": [{"type": "text", "text":
                           "这是唯一一次执行机会，请完整解决 .ralph/GOAL.md 里的目标并提交改动。" if once
                           else "开始推进 .ralph/GOAL.md 里的目标。"}]}
        spec = cfg.get("workerModel", "")
        if "/" in spec:
            prov, model = spec.split("/", 1)
            body["model"] = {"providerID": prov, "modelID": model}
        threading.Thread(target=lambda: http_json(
            f"{base}/session/{sid}/message?directory={arm_dir}", body), daemon=True).start()

        start_sampler(arm_dir, sentinels)
        say("→ 运行中(哨兵: " + "/".join(sentinels) + ";实时围观: deveco attach "
            f"http://127.0.0.1:{port} --session {sid})")
        seen = 0
        while not any((ralph / s).exists() for s in sentinels):
            log = ralph / "plugin.log"
            if log.exists():
                lines = log.read_text().splitlines()
                for l in lines[seen:]:
                    say("   " + l)
                seen = len(lines)
            time.sleep(3)
        for s in sentinels:
            if (ralph / s).exists():
                say(f"→ {s}: {(ralph / s).read_text().strip()}")
    finally:
        kill_tree(server)
        serve_log.close()

    say(f"=== {arm} 组隐藏验收得分 ===")
    r = sh([sys.executable, ".ralph/run_qa.py", "--samples", "5"], cwd=arm_dir)
    say("\n".join((r.stdout + r.stderr).splitlines()[:8]))
    say(f"曲线: {ralph}/score_curve.csv")
    say(f"审计: {sys.executable} {sys.argv[0]} audit {arm_dir}")


# ---------------------------------------------------------------- audit / report

AUDIT_SQL = """
SELECT datetime(time_created/1000,'unixepoch','localtime'),
       json_extract(data,'$.tool'),
       substr(coalesce(json_extract(data,'$.state.input.command'),
                       json_extract(data,'$.state.input.filePath'), ''), 1, 100)
FROM part
WHERE session_id=? AND json_extract(data,'$.type')='tool' AND (
      coalesce(json_extract(data,'$.state.input.command'),'')  LIKE '%vectors.jsonl%'
   OR coalesce(json_extract(data,'$.state.input.filePath'),'') LIKE '%vectors.jsonl%'
   OR coalesce(json_extract(data,'$.state.input.command'),'')  LIKE '%run_qa%'
   OR ( ( coalesce(json_extract(data,'$.state.input.command'),'')  LIKE '%.ralph%'
       OR coalesce(json_extract(data,'$.state.input.filePath'),'') LIKE '%.ralph%' )
      AND coalesce(json_extract(data,'$.state.input.command'),'')  NOT LIKE '%GOAL.md%'
      AND coalesce(json_extract(data,'$.state.input.command'),'')  NOT LIKE '%PROGRESS.md%'
      AND coalesce(json_extract(data,'$.state.input.filePath'),'') NOT LIKE '%GOAL.md%'
      AND coalesce(json_extract(data,'$.state.input.filePath'),'') NOT LIKE '%PROGRESS.md%' )
) ORDER BY time_created;
"""


def cmd_audit(target, sid=None, quiet=False):
    target = pathlib.Path(target)
    db = deveco_db() or die("找不到 deveco.db;用 DEVECO_DB 环境变量指定")
    if not sid:
        f = target / ".ralph/session_id"
        f.is_file() or die(f"{f} 不存在(还没跑过?)")
        sid = f.read_text().strip()
    rows = sqlite3.connect(db).execute(AUDIT_SQL, (sid,)).fetchall()
    if not rows:
        say(f"✅ audit clean: {target.name} (session {sid})")
        return True
    say(f"🚨 audit HIT: {target.name} (session {sid}) —— 逐条人工复核:")
    for r in rows:
        say("  " + "  ".join(str(x) for x in r))
    say("判读标准:读过 vectors.jsonl / run_qa.py 的【内容】= 作弊,成绩作废;")
    say("          纯元数据访问(如 git ls-files 列文件名)可豁免,但要记录判读理由。")
    return False


def score_of(arm_dir):
    r = sh([sys.executable, ".ralph/run_qa.py", "--samples", "0"], cwd=arm_dir)
    m = re.search(r"QA SCORE: \d+/\d+", r.stdout)
    return m.group(0).replace("QA SCORE: ", "") if m else "?"


def cmd_report():
    a, b = WORK / "once", WORK / "loop"
    (a / ".ralph").is_dir() and (b / ".ralph").is_dir() or die("双臂不全,先跑 prepare/once/loop")
    say("\n================ Experiment 1 对比 ================")
    sa = "单次收工(它不知道自己差多少)" if (a / ".ralph/ONCE_DONE").exists() else "未完成"
    sb = ("reviewer 验收 DONE" if (b / ".ralph/DONE").exists()
          else "轮次耗尽 STOPPED" if (b / ".ralph/STOPPED").exists() else "未完成")
    say(f"  A once: {score_of(a):<10}  {sa}")
    say(f"  B loop: {score_of(b):<10}  {sb}")
    say("\nreviewer 逐轮反馈:")
    log = b / ".ralph/plugin.log"
    verdicts = [l for l in log.read_text().splitlines() if "verdict" in l] if log.exists() else []
    for v in verdicts or ["  (无)"]:
        say("  " + v.strip())
    say("\n偷看审计(两组都必须 clean,否则成绩作废):")
    for d in (a, b):
        try:
            cmd_audit(d)
        except SystemExit:
            say(f"  ({d.name}: 无法审计)")
    say(f"\n对照参考结果: {HERE}/reference-results/")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "prepare":
        cmd_prepare()
    elif cmd in ("once", "loop"):
        run_arm(cmd)
    elif cmd == "report":
        cmd_report()
    elif cmd == "audit":
        len(sys.argv) > 2 or die("用法: run_experiment.py audit <项目目录> [session_id]")
        ok = cmd_audit(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
        sys.exit(0 if ok else 1)
    elif cmd == "all":
        cmd_prepare(); run_arm("once"); run_arm("loop"); cmd_report()
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
