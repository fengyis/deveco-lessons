import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const ROOT = path.resolve(import.meta.dir, "..")
const RALPH = path.join(ROOT, "ralph.sh")
const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

function run(args: string[], cwd = ROOT) {
  return Bun.spawnSync(["bash", RALPH, ...args], {
    cwd,
    env: { ...process.env, RALPH_NO_OBSERVE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
}

function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ralph-swebench-"))
  cleanups.push(root)
  const repo = path.join(root, "repo")
  mkdirSync(repo)
  git(repo, "init", "-q")
  git(repo, "config", "user.email", "test@example.com")
  git(repo, "config", "user.name", "Test")
  writeFileSync(path.join(repo, "module.py"), "def value():\n    return 1\n")
  git(repo, "add", "module.py")
  git(repo, "commit", "-q", "-m", "base")
  const baseCommit = git(repo, "rev-parse", "HEAD")

  const instance = path.join(root, "instance.json")
  writeFileSync(
    instance,
    JSON.stringify({
      repo: "example/project",
      instance_id: "example__project-123",
      base_commit: baseCommit,
      problem_statement: "Nested parser state returns the wrong value.\nPreserve legacy behavior.",
      version: "1.0",
      patch: "GOLD_PATCH_MUST_NOT_LEAK",
      test_patch: "ORACLE_TEST_MUST_NOT_LEAK",
      FAIL_TO_PASS: '["secret::target"]',
      PASS_TO_PASS: '["secret::regression"]',
    }),
  )
  return { root, repo, instance, baseCommit }
}

test("prepare creates a blind mode-neutral workspace without moving the base commit", () => {
  const { repo, instance, baseCommit } = fixture()

  const result = run(["swebench", "prepare", repo, instance, "--model-name", "ralph-test"])

  expect(result.exitCode, result.stderr.toString()).toBe(0)
  expect(git(repo, "rev-parse", "HEAD")).toBe(baseCommit)
  const metadata = JSON.parse(readFileSync(path.join(repo, ".ralph", "swebench.json"), "utf8"))
  expect(metadata).toEqual({
    dataset_name: "princeton-nlp/SWE-bench_Lite",
    repo: "example/project",
    instance_id: "example__project-123",
    base_commit: baseCommit,
    version: "1.0",
    model_name_or_path: "ralph-test",
  })

  const visible = [
    readFileSync(path.join(repo, ".ralph", "GOAL.md"), "utf8"),
    readFileSync(path.join(repo, ".ralph", "PROGRESS.md"), "utf8"),
    readFileSync(path.join(repo, ".ralph", "swebench.json"), "utf8"),
  ].join("\n")
  expect(visible).toContain("Nested parser state returns the wrong value")
  expect(visible).toContain("复现")
  expect(visible).toContain("不可信输入")
  expect(visible).toContain("无论采用单次执行还是 Ralph Loop")
  expect(visible).not.toContain("不能靠一次猜测收工")
  expect(visible).not.toContain("GOLD_PATCH_MUST_NOT_LEAK")
  expect(visible).not.toContain("ORACLE_TEST_MUST_NOT_LEAK")
  expect(visible).not.toContain("secret::target")
  const onceAgent = readFileSync(path.join(repo, ".deveco", "agent", "ralph-once.md"), "utf8")
  expect(onceAgent).toContain("唯一一次")
  expect(onceAgent).toContain("task: false")

  const localExclude = readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8")
  expect(localExclude).toContain("/.ralph/")
  expect(localExclude).toContain("/.deveco/")
  expect(git(repo, "status", "--porcelain")).toBe("")
})

test("prepare refuses a dirty target repository", () => {
  const { repo, instance } = fixture()
  writeFileSync(path.join(repo, "module.py"), "dirty\n")

  const result = run(["swebench", "prepare", repo, instance])

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("工作区不干净")
})

test("prepare refuses a repository checked out at the wrong commit", () => {
  const { repo, instance } = fixture()
  writeFileSync(path.join(repo, "other.py"), "x = 1\n")
  git(repo, "add", "other.py")
  git(repo, "commit", "-q", "-m", "later")

  const result = run(["swebench", "prepare", repo, instance])

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("base_commit 不匹配")
})

test("prepare rejects instance metadata outside the official schema boundary", () => {
  const { repo, instance } = fixture()
  const record = JSON.parse(readFileSync(instance, "utf8"))
  record.instance_id = "../../escape"
  record.base_commit = "not-a-commit"
  writeFileSync(instance, JSON.stringify(record))

  const result = run(["swebench", "prepare", repo, instance])

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("格式不合法")
  expect(() => readFileSync(path.join(repo, ".ralph", "swebench.json"))).toThrow()
})

test("export writes one harness-ready JSONL record containing only the product patch", () => {
  const { root, repo, instance, baseCommit } = fixture()
  expect(run(["swebench", "prepare", repo, instance, "--model-name", "ralph-test"]).exitCode).toBe(0)
  writeFileSync(path.join(repo, "module.py"), "def value():\n    return 2\n")
  git(repo, "add", "module.py")
  git(repo, "commit", "-q", "-m", "fix parser value")
  writeFileSync(path.join(repo, ".ralph", "DONE"), "reviewed\n")
  writeFileSync(path.join(repo, ".ralph", "plugin.log"), "2026-01-01 reviewer verdict: DONE\n2026-01-01 DONE\n")
  const output = path.join(root, "predictions.jsonl")

  const result = run(["swebench", "export", repo, output])

  expect(result.exitCode, result.stderr.toString()).toBe(0)
  const lines = readFileSync(output, "utf8").trimEnd().split("\n")
  expect(lines).toHaveLength(1)
  const prediction = JSON.parse(lines[0])
  expect(Object.keys(prediction)).toEqual(["instance_id", "model_name_or_path", "model_patch"])
  expect(prediction.instance_id).toBe("example__project-123")
  expect(prediction.model_name_or_path).toBe("ralph-test")
  expect(prediction.model_patch).toContain("diff --git a/module.py b/module.py")
  expect(prediction.model_patch).toContain("+    return 2")
  expect(prediction.model_patch).not.toContain(".ralph")
  expect(prediction.model_patch).not.toContain(".deveco")
  expect(prediction.model_patch).not.toContain("GOLD_PATCH_MUST_NOT_LEAK")

  const checkRepo = path.join(root, "check")
  git(root, "clone", "-q", repo, checkRepo)
  git(checkRepo, "checkout", "-q", baseCommit)
  const patchFile = path.join(root, "model.patch")
  writeFileSync(patchFile, prediction.model_patch)
  git(checkRepo, "apply", "--check", patchFile)
})

test("export refuses a patch before the reviewer writes DONE", () => {
  const { root, repo, instance } = fixture()
  expect(run(["swebench", "prepare", repo, instance]).exitCode).toBe(0)
  writeFileSync(path.join(repo, "module.py"), "def value():\n    return 2\n")
  git(repo, "add", "module.py")
  git(repo, "commit", "-q", "-m", "candidate")

  const result = run(["swebench", "export", repo, path.join(root, "prediction.jsonl")])

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("Reviewer 尚未 DONE")
})

test("export --once emits a one-shot candidate without weakening normal export", () => {
  const { root, repo, instance } = fixture()
  expect(
    run(["swebench", "prepare", repo, instance, "--model-name", "same-model-once"]).exitCode,
  ).toBe(0)
  writeFileSync(path.join(repo, ".ralph", "ONCE_DONE"), "worker idle\n")
  const normalOutput = path.join(root, "normal.jsonl")
  const onceOutput = path.join(root, "once.jsonl")

  const normal = run(["swebench", "export", repo, normalOutput])
  const once = run(["swebench", "export", repo, onceOutput, "--once"])

  expect(normal.exitCode).not.toBe(0)
  expect(normal.stderr.toString()).toContain("Reviewer 尚未 DONE")
  expect(once.exitCode, once.stderr.toString()).toBe(0)
  const prediction = JSON.parse(readFileSync(onceOutput, "utf8"))
  expect(prediction).toEqual({
    instance_id: "example__project-123",
    model_name_or_path: "same-model-once",
    model_patch: "",
  })
})

test("export refuses dirty or empty product changes", () => {
  const dirty = fixture()
  expect(run(["swebench", "prepare", dirty.repo, dirty.instance]).exitCode).toBe(0)
  writeFileSync(path.join(dirty.repo, ".ralph", "DONE"), "reviewed\n")
  writeFileSync(path.join(dirty.repo, ".ralph", "plugin.log"), "2026-01-01 reviewer verdict: DONE\n")
  writeFileSync(path.join(dirty.repo, "module.py"), "uncommitted\n")
  const dirtyResult = run(["swebench", "export", dirty.repo, path.join(dirty.root, "dirty.jsonl")])
  expect(dirtyResult.exitCode).not.toBe(0)
  expect(dirtyResult.stderr.toString()).toContain("尚未提交")

  const empty = fixture()
  expect(run(["swebench", "prepare", empty.repo, empty.instance]).exitCode).toBe(0)
  writeFileSync(path.join(empty.repo, ".ralph", "DONE"), "reviewed\n")
  writeFileSync(path.join(empty.repo, ".ralph", "plugin.log"), "2026-01-01 reviewer verdict: DONE\n")
  const emptyResult = run(["swebench", "export", empty.repo, path.join(empty.root, "empty.jsonl")])
  expect(emptyResult.exitCode).not.toBe(0)
  expect(emptyResult.stderr.toString()).toContain("产品补丁为空")
})

test("export rejects a fabricated DONE sentinel without a reviewer verdict", () => {
  const { root, repo, instance } = fixture()
  expect(run(["swebench", "prepare", repo, instance]).exitCode).toBe(0)
  writeFileSync(path.join(repo, "module.py"), "def value():\n    return 2\n")
  git(repo, "add", "module.py")
  git(repo, "commit", "-q", "-m", "candidate")
  writeFileSync(path.join(repo, ".ralph", "DONE"), "fabricated\n")

  const result = run(["swebench", "export", repo, path.join(root, "prediction.jsonl")])

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("缺少 Reviewer DONE 裁决记录")
})
