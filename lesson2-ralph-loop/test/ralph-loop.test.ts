import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  loadConfig,
  parseModel,
  parseVerdict,
  RalphLoop,
} from "../template/.deveco/plugin/ralph-loop"

test("verdict is read from the last line, not from analysis text", () => {
  expect(parseVerdict("DONE").done).toBe(true)
  expect(parseVerdict("分析：目标已达成。\n\nDONE\n").done).toBe(true)
  expect(parseVerdict("CONTINUE: 还缺 git commit").done).toBe(false)
})

test("a reviewer that merely mentions DONE mid-analysis does not end the loop", () => {
  const text = "worker 声称 DONE，但 git log 里没有对应提交。\nCONTINUE: 还没提交"
  expect(parseVerdict(text)).toEqual({ done: false, reason: "CONTINUE: 还没提交" })
})

test("empty or silent reviewer keeps the loop running instead of falsely finishing", () => {
  expect(parseVerdict("").done).toBe(false)
  expect(parseVerdict("\n \n").done).toBe(false)
})

test("model spec splits on the first slash only (model ids may contain slashes)", () => {
  expect(parseModel("deveco/GLM-5.1")).toEqual({ providerID: "deveco", modelID: "GLM-5.1" })
  expect(parseModel("deepseek/deepseek-chat")).toEqual({ providerID: "deepseek", modelID: "deepseek-chat" })
  expect(parseModel("openrouter/meta/llama-3")).toEqual({ providerID: "openrouter", modelID: "meta/llama-3" })
})

test("an unset or malformed model falls back to the project default, never to a broken request", () => {
  // undefined 会被 SDK 省略掉 → 走 deveco.json 的项目默认模型
  expect(parseModel(undefined)).toBeUndefined()
  expect(parseModel("")).toBeUndefined()
  expect(parseModel("no-slash")).toBeUndefined()
  expect(parseModel("/leading")).toBeUndefined()
  expect(parseModel("trailing/")).toBeUndefined()
})

test("worker and reviewer models are read independently", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ralph-models-"))
  mkdirSync(path.join(dir, ".ralph"), { recursive: true })
  writeFileSync(
    path.join(dir, ".ralph", "config.json"),
    JSON.stringify({ workerModel: "deveco/GLM-5.1", reviewerModel: "deepseek/deepseek-chat" }),
  )
  const cfg = loadConfig(dir)
  expect(parseModel(cfg.workerModel)).toEqual({ providerID: "deveco", modelID: "GLM-5.1" })
  expect(parseModel(cfg.reviewerModel)).toEqual({ providerID: "deepseek", modelID: "deepseek-chat" })
})

test("config falls back to defaults and merges .ralph/config.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ralph-cfg-"))
  expect(loadConfig(dir)).toEqual({
    workerAgent: "ralph-worker",
    reviewerAgent: "ralph-reviewer",
    maxIterations: 40,
  })

  mkdirSync(path.join(dir, ".ralph"), { recursive: true })
  writeFileSync(path.join(dir, ".ralph", "config.json"), JSON.stringify({ maxIterations: 3 }))
  expect(loadConfig(dir).maxIterations).toBe(3)
  expect(loadConfig(dir).workerAgent).toBe("ralph-worker")
})

test("once mode stops after the worker idles without creating a reviewer", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ralph-once-"))
  mkdirSync(path.join(dir, ".ralph"), { recursive: true })
  writeFileSync(path.join(dir, ".ralph", "ONCE"), "single attempt\n")
  const calls: string[] = []
  const client = {
    session: {
      create: async () => {
        calls.push("reviewer.create")
        return { id: "reviewer" }
      },
      prompt: async () => {
        calls.push("session.prompt")
        return { parts: [{ type: "text", text: "DONE" }] }
      },
    },
  }
  const hooks = await RalphLoop({ client, directory: dir } as any)

  await hooks["chat.message"]!({ agent: "ralph-once", sessionID: "worker" } as any, {} as any)
  await hooks.event!({
    event: { type: "session.idle", properties: { sessionID: "worker" } },
  } as any)

  expect(calls).toEqual([])
  expect(existsSync(path.join(dir, ".ralph", "ONCE_DONE"))).toBe(true)
  expect(existsSync(path.join(dir, ".ralph", "DONE"))).toBe(false)
  expect(existsSync(path.join(dir, ".ralph", "STOPPED"))).toBe(false)
})
