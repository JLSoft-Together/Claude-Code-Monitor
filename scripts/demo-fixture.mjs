import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)

const ROOT = args.root ?? path.join(os.tmpdir(), 'ccm-demo-root')
const SESSIONS = Number(args.sessions ?? 4)
const SUBAGENTS = Number(args.subagents ?? 3)
const TICK_MS = Number(args.tick ?? 1200)
const DURATION_S = Number(args.duration ?? 0)

const TOOLS = ['Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write', 'PowerShell']
const AGENT_TYPES = ['Explore', 'general-purpose', 'Plan', 'code-reviewer']
const TASKS = ['Find ad loading code', 'Review collector diff', 'Map session registry', 'Check i18n keys', 'Trace WebSocket reconnect', 'Audit status mapping']
const NAMES = ['android-ads', 'ios-launcher', 'claude-code-monitor', 'poker-trainer', 'memory-garden', 'data-transfer']
const STATUSES = ['busy', 'busy', 'busy', 'idle', 'waiting', 'shell']

rmSync(ROOT, { recursive: true, force: true })
mkdirSync(path.join(ROOT, 'sessions'), { recursive: true })

const pick = (list) => list[Math.floor(Math.random() * list.length)]
const iso = () => new Date().toISOString()
const line = (o) => `${JSON.stringify(o)}\n`
let counter = 0
const nextId = (p) => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}`

const children = []
const sessions = []

function writeRegistry(s) {
  writeFileSync(
    path.join(ROOT, 'sessions', `${s.pid}.json`),
    JSON.stringify({
      pid: s.pid,
      sessionId: s.sessionId,
      cwd: s.cwd,
      startedAt: s.startedAt,
      version: '2.1.289',
      kind: s.kind,
      entrypoint: 'cli',
      name: s.name,
      nameSource: s.nameSource,
      status: s.status,
      waitingFor: s.status === 'waiting' ? 'permission prompt' : undefined,
      updatedAt: Date.now(),
      statusUpdatedAt: Date.now(),
    }),
  )
}

function transcript(s) {
  return path.join(ROOT, 'projects', s.slug, `${s.sessionId}.jsonl`)
}

function toolUse(file, tool, sidechain = false) {
  const id = nextId('toolu')
  appendFileSync(
    file,
    line({
      type: 'assistant',
      isSidechain: sidechain,
      timestamp: iso(),
      message: {
        id: nextId('msg'),
        model: 'claude-opus-5-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 200 + Math.floor(Math.random() * 3000), output_tokens: 20 + Math.floor(Math.random() * 400), cache_read_input_tokens: 5000 },
        content: [{ type: 'tool_use', id, name: tool, input: {} }],
      },
    }),
  )
  return id
}

function toolResult(file, id, isError = false, extra = {}) {
  appendFileSync(file, line({ type: 'user', timestamp: iso(), ...extra, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } }))
}

function spawnSubagent(s, parent) {
  const host = parent ? parent.file : transcript(s)
  const toolUseId = toolUse(host, 'Agent', Boolean(parent))
  toolResult(host, toolUseId, false, { toolUseResult: { status: 'async_launched' } })
  const agentId = `a${Math.random().toString(16).slice(2, 15)}`
  const dir = path.join(ROOT, 'projects', s.slug, s.sessionId, 'subagents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, `agent-${agentId}.meta.json`),
    JSON.stringify({ agentType: pick(AGENT_TYPES), description: pick(TASKS), toolUseId, parentAgentId: parent?.agentId, spawnDepth: parent ? parent.depth + 1 : 1, requestShape: 'background', requestNonInteractive: true }),
  )
  const file = path.join(dir, `agent-${agentId}.jsonl`)
  writeFileSync(file, '')
  s.subs.push({ agentId, toolUseId, file, open: null, done: false, depth: parent ? parent.depth + 1 : 1 })
}

function finishSubagent(s, sub) {
  const status = Math.random() < 0.8 ? 'completed' : Math.random() < 0.5 ? 'failed' : 'stopped'
  appendFileSync(
    sub.file,
    line({ type: 'assistant', isSidechain: true, timestamp: iso(), message: { id: nextId('msg'), stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 300 }, content: [{ type: 'text', text: 'done' }] } }),
  )
  appendFileSync(
    transcript(s),
    line({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(), content: `<task-notification><task-id>${sub.agentId}</task-id><tool-use-id>${sub.toolUseId}</tool-use-id><status>${status}</status><summary>demo</summary></task-notification>` }),
  )
  sub.done = true
}

for (let i = 0; i < SESSIONS; i++) {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], { stdio: 'ignore' })
  children.push(child)
  const name = NAMES[i % NAMES.length]
  const cwd = `D:\\work\\demo\\${name}`
  const s = {
    pid: child.pid,
    sessionId: randomUUID(),
    cwd,
    slug: cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    startedAt: Date.now() - Math.floor(Math.random() * 3_600_000),
    kind: i === SESSIONS - 1 && SESSIONS > 2 ? 'bg' : 'interactive',
    name: `${name}-${(i + 10).toString(16)}`,
    nameSource: 'derived',
    status: 'busy',
    open: null,
    subs: [],
  }
  mkdirSync(path.join(ROOT, 'projects', s.slug), { recursive: true })
  writeFileSync(transcript(s), '')
  writeRegistry(s)
  for (let k = 0; k < SUBAGENTS; k++) spawnSubagent(s)
  sessions.push(s)
}

console.log(`[demo] fixture root ${ROOT}`)
console.log(`[demo] ${SESSIONS} sessions, ${SUBAGENTS} subagents each, tick ${TICK_MS}ms`)
console.log(`[demo] run collector: CLAUDE_CONFIG_DIR=${ROOT} CCM_VERIFY_PROCESSES=0 npm run dev -w @ccm/collector`)

let ticks = 0
const timer = setInterval(() => {
  ticks++
  for (const s of sessions) {
    const r = Math.random()
    if (s.open) {
      toolResult(transcript(s), s.open, Math.random() < 0.05)
      s.open = null
    } else if (s.status === 'busy') {
      s.open = toolUse(transcript(s), pick(TOOLS))
    }
    for (const sub of [...s.subs]) {
      if (sub.done) continue
      if (sub.open) {
        toolResult(sub.file, sub.open)
        sub.open = null
      } else if (sub.depth < 3 && Math.random() < 0.05) {
        spawnSubagent(s, sub)
      } else if (Math.random() < 0.15) {
        finishSubagent(s, sub)
      } else {
        sub.open = toolUse(sub.file, pick(TOOLS), true)
      }
    }
    if (r < 0.08) spawnSubagent(s)
    if (r > 0.9) {
      s.status = pick(STATUSES)
      writeRegistry(s)
    }
    if (r > 0.985) {
      s.name = `${pick(NAMES)}-renamed`
      s.nameSource = 'user'
      writeRegistry(s)
    }
  }
  if (DURATION_S > 0 && ticks * TICK_MS >= DURATION_S * 1000) shutdown()
}, TICK_MS)

function shutdown() {
  clearInterval(timer)
  for (const c of children) c.kill()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
