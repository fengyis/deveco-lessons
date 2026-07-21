import type { Plugin } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"

type Config = {
  workerAgent: string
  reviewerAgent: string
  maxIterations: number
  // "provider/model"，留空则用 deveco.json 里的项目默认模型。
  // 分开配是为了让 worker 用便宜快的模型干活、reviewer 用更强的模型把关。
  workerModel?: string
  reviewerModel?: string
}

const DEFAULT_CONFIG: Config = {
  workerAgent: "ralph-worker",
  reviewerAgent: "ralph-reviewer",
  maxIterations: 40,
}

export function loadConfig(directory: string): Config {
  const file = path.join(directory, ".ralph", "config.json")
  if (!fs.existsSync(file)) return DEFAULT_CONFIG
  return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, "utf-8")) }
}

/** "deepseek/deepseek-chat" -> { providerID, modelID }。模型名本身可以带斜杠。 */
export function parseModel(spec?: string): { providerID: string; modelID: string } | undefined {
  if (!spec) return undefined
  const i = spec.indexOf("/")
  if (i <= 0 || i === spec.length - 1) return undefined
  return { providerID: spec.slice(0, i), modelID: spec.slice(i + 1) }
}

/**
 * The reviewer is told to end its reply with a single verdict line. Reading the
 * last non-empty line (rather than searching anywhere in the text) keeps the
 * reviewer's own analysis from being mistaken for the verdict.
 */
export function parseVerdict(text: string): { done: boolean; reason: string } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  if (/^DONE\b/i.test(last)) return { done: true, reason: last }
  return { done: false, reason: last }
}

const CONTINUE_PROMPT = `继续推进 .ralph/GOAL.md 里的目标。
读一下 .ralph/PROGRESS.md 看已经做了什么，挑下一个范围最小、可独立验证的子任务去做。
做完后：把这轮做了什么、怎么验证的追加写进 .ralph/PROGRESS.md，跑相关的编译/lint/测试确认通过，然后 git commit。
一次只推进一件事。`

const REVIEW_PROMPT = `你是严格的验收裁判，不是执行者。
读 .ralph/GOAL.md（目标与验收标准）和 .ralph/PROGRESS.md（已完成记录），并用 git log / git diff 核实是否真的做了。
你可以先写分析，但最后必须**单独用一行**给出裁决，且这一行只能是下面两种之一：
  DONE
  CONTINUE: <还差什么，一句话>
只有当验收标准 100% 满足时才写 DONE。`

type Phase = "working" | "reviewing" | "done"

export const RalphLoop: Plugin = async ({ client, directory }) => {
  const cfg = loadConfig(directory)
  const onceMode = fs.existsSync(path.join(directory, ".ralph", "ONCE"))
  const activeWorkerAgent = onceMode ? "ralph-once" : cfg.workerAgent
  const sessions = new Map<string, { phase: Phase; iteration: number }>()
  // Reviewer sessions are transient, but they still need their bash/git calls
  // auto-approved or the loop would block on an unanswerable permission prompt.
  const reviewers = new Set<string>()

  function log(msg: string) {
    try {
      fs.mkdirSync(path.join(directory, ".ralph"), { recursive: true })
      fs.appendFileSync(path.join(directory, ".ralph", "plugin.log"), `${new Date().toISOString()} ${msg}\n`)
    } catch {}
  }

  function sentinel(name: string, reason: string) {
    fs.mkdirSync(path.join(directory, ".ralph"), { recursive: true })
    fs.writeFileSync(path.join(directory, ".ralph", name), `${new Date().toISOString()} ${reason}\n`)
  }

  function textOf(parts: Array<{ type?: string; text?: string }> | undefined) {
    return (parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n")
  }

  /** Runs the reviewer in a throwaway session and returns its verdict. */
  async function review(): Promise<{ done: boolean; reason: string }> {
    const created: any = await client.session.create({
      body: { title: "ralph-reviewer" },
      query: { directory },
    })
    const id: string | undefined = created?.data?.id ?? created?.id
    if (!id) {
      const status = created?.response?.status
      // 401 means the server was started with DEVECO_SERVER_PASSWORD: the plugin's
      // injected client carries no credentials, so it cannot call its own server.
      const hint = status === 401 ? " (启动 deveco serve 时不要设 DEVECO_SERVER_PASSWORD)" : ""
      log(`reviewer session create FAILED: status=${status}${hint}`)
      return { done: false, reason: "reviewer session could not be created" }
    }
    reviewers.add(id)
    try {
      const replied: any = await client.session.prompt({
        path: { id },
        query: { directory },
        body: {
          agent: cfg.reviewerAgent,
          model: parseModel(cfg.reviewerModel),
          parts: [{ type: "text", text: REVIEW_PROMPT }],
        },
      })
      const verdict = parseVerdict(textOf(replied?.data?.parts ?? replied?.parts))
      log(`reviewer verdict: ${verdict.done ? "DONE" : verdict.reason}`)
      return verdict
    } finally {
      reviewers.delete(id)
    }
  }

  async function onWorkerIdle(sessionID: string) {
    const state = sessions.get(sessionID)
    if (!state || state.phase !== "working") return

    if (onceMode) {
      state.phase = "done"
      sentinel("ONCE_DONE", "single worker attempt reached idle")
      log("ONCE_DONE (reviewer and continuation skipped)")
      return
    }

    state.iteration++
    if (state.iteration > cfg.maxIterations) {
      state.phase = "done"
      sentinel("STOPPED", `max iterations (${cfg.maxIterations}) reached without DONE`)
      log(`STOPPED at iteration ${state.iteration}`)
      return
    }

    state.phase = "reviewing"
    const verdict = await review()

    if (verdict.done) {
      state.phase = "done"
      sentinel("DONE", verdict.reason)
      log("DONE")
      return
    }

    state.phase = "working"
    log(`iteration ${state.iteration} -> continue`)
    await client.session.prompt({
      path: { id: sessionID },
      query: { directory },
      body: {
        agent: cfg.workerAgent,
        model: parseModel(cfg.workerModel),
        parts: [{ type: "text", text: CONTINUE_PROMPT }],
      },
    })
  }

  log(
    `loaded (mode=${onceMode ? "once" : "loop"} worker=${activeWorkerAgent}[${cfg.workerModel ?? "项目默认模型"}] ` +
      `reviewer=${cfg.reviewerAgent}[${cfg.reviewerModel ?? "项目默认模型"}] max=${cfg.maxIterations})`,
  )

  return {
    "chat.message": async (input) => {
      if (input.agent !== activeWorkerAgent) return
      if (sessions.has(input.sessionID)) return
      sessions.set(input.sessionID, { phase: "working", iteration: 0 })
      log(`worker session registered: ${input.sessionID}`)
    },

    "permission.ask": async (input, output) => {
      if (sessions.has(input.sessionID) || reviewers.has(input.sessionID)) output.status = "allow"
    },

    event: async ({ event }) => {
      const evt = event as { type: string; properties?: Record<string, unknown> }
      if (evt.type !== "session.idle") return
      const sessionID = evt.properties?.sessionID as string | undefined
      if (!sessionID || !sessions.has(sessionID)) return
      await onWorkerIdle(sessionID)
    },
  }
}

export default { id: "ralph-loop", server: RalphLoop }
