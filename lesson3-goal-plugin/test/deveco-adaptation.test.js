import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { testInternals } from "../template/.deveco/plugin/devecocode-goal-plugin/goal-plugin.js"

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
