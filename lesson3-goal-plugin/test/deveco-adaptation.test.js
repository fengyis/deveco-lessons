import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { testInternals } from "../template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js"
import { createOpenCodeSessionApi } from "../template/.deveco/plugin/devecocode-goal-plugin/opencode-session-api.js"

const { resolveStateFilePath } = testInternals

test("项目默认状态路径落在 .deveco 下", () => {
  assert.equal(
    resolveStateFilePath({ cwd: "/proj", env: {} }),
    join("/proj", ".deveco", "goals", "state.json"),
  )
})

test("DEVECO_GOAL_STATE_PATH 优先于 OPENCODE_GOAL_STATE_PATH", () => {
  assert.equal(
    resolveStateFilePath({
      cwd: "/proj",
      env: { DEVECO_GOAL_STATE_PATH: "/a/state.json", OPENCODE_GOAL_STATE_PATH: "/b/state.json" },
    }),
    "/a/state.json",
  )
})

test("OPENCODE_GOAL_STATE_PATH 仍作为回退被承认", () => {
  assert.equal(
    resolveStateFilePath({ cwd: "/proj", env: { OPENCODE_GOAL_STATE_PATH: "/b/state.json" } }),
    "/b/state.json",
  )
})

function recordingClient() {
  const calls = []
  const record = (operation) => async (input) => {
    calls.push({ operation, input })
    return { data: { id: "s1" } }
  }
  return {
    calls,
    session: {
      create: record("create"),
      prompt: record("prompt"),
      promptAsync: record("promptAsync"),
      get: record("get"),
      messages: record("messages"),
      update: record("update"),
      delete: record("delete"),
      abort: record("abort"),
    },
  }
}

test("legacy 形状在配置 directory 时注入 query.directory", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy", directory: "/proj" })
  await api.prompt("s1", { parts: [] })
  assert.deepEqual(client.calls[0].input.path, { id: "s1" })
  assert.deepEqual(client.calls[0].input.query, { directory: "/proj" })
})

test("createChild 在 legacy 形状下也注入 query.directory", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy", directory: "/proj" })
  await api.createChild("parent", { title: "audit" })
  assert.deepEqual(client.calls[0].input.query, { directory: "/proj" })
})

test("不配置 directory 时 legacy 形状与上游一致（无 query 注入）", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy" })
  await api.prompt("s1", { parts: [] })
  assert.equal(client.calls[0].input.query, undefined)
})

test("flat 形状从不注入 query.directory", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "flat", directory: "/proj" })
  await api.get("s1")
  assert.equal(client.calls[0].input.query, undefined)
})

test("messages 的 legacy 形状把 directory 合并进已有 query", async () => {
  const client = recordingClient()
  const api = createOpenCodeSessionApi(client, { preferredShape: "legacy", directory: "/proj" })
  await api.messages("s1", { limit: 5 })
  assert.deepEqual(client.calls[0].input.query, { limit: 5, directory: "/proj" })
})
