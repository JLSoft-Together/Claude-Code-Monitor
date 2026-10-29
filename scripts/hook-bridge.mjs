#!/usr/bin/env node
// Opt-in Claude Code hook (async: true) for PreCompact / PostCompact / PermissionDenied / PermissionRequest. Installed by the app (Settings).
// Writes <dataDir>/hooks/<session_id>.json and appends permission dialogs to <dataDir>/hooks/permission-asks.jsonl; never prints, always exits 0.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Must match apps/collector/src/datadir.ts (test/datadir.test.ts compares both).
function defaultDataDir(env, platform, home) {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'ccm')
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'ccm')
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'ccm')
}

const DATA_DIR = process.env.CCM_DATA_DIR || defaultDataDir(process.env, process.platform, os.homedir())
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOOL_RE = /^[\w.:-]{1,80}$/
// Rule names / contents and command words kept from a permission dialog: no paths, quotes, `=` or long tokens.
const RULE_NAME_RE = /^[A-Za-z][\w-]{0,79}$/
const RULE_CONTENT_RE = /^[\w .:*@+,~-]{1,120}$/
const WORD_RE = /^(?:\.\/)?[\w.:@+-]{1,30}$/
const SHELLS = new Set(['Bash', 'PowerShell'])
const ASKS_FILE = 'permission-asks.jsonl'
const ASKS_ROTATE = 512 * 1024

const safeContent = (c) => RULE_CONTENT_RE.test(c) && !c.split(/\s+/).some((w) => w.length > 40)

function suggestedRules(input) {
  const out = []
  const list = Array.isArray(input.permission_suggestions) ? input.permission_suggestions : []
  for (const s of list) {
    if (!s || s.type !== 'addRules' || s.behavior !== 'allow' || !Array.isArray(s.rules)) continue
    for (const r of s.rules) {
      const name = r?.toolName
      if (typeof name !== 'string' || !RULE_NAME_RE.test(name)) continue
      const c = r.ruleContent
      if (c === undefined || c === null || c === '') out.push(name)
      else if (typeof c === 'string' && safeContent(c.trim())) out.push(`${name}(${c.trim()})`)
    }
  }
  return [...new Set(out)].slice(0, 3)
}

// At most two leading words of a shell command, stopping at the first word that looks like a path, flag value or secret.
function commandPrefix(command) {
  if (typeof command !== 'string') return undefined
  const words = []
  for (const w of command.trim().split(/\s+/).slice(0, 2)) {
    if (!WORD_RE.test(w) || w.startsWith('-')) break
    words.push(w)
  }
  return words.length ? words.join(' ') : undefined
}

function recordAsk(input) {
  const tool = typeof input.tool_name === 'string' && TOOL_RE.test(input.tool_name) ? input.tool_name : null
  const cwd = typeof input.cwd === 'string' && input.cwd.length <= 1024 ? input.cwd : null
  if (!tool || !cwd) return
  const rec = { at: new Date().toISOString(), cwd, tool, rules: suggestedRules(input) }
  if (SHELLS.has(tool)) {
    const prefix = commandPrefix(input.tool_input?.command)
    if (prefix) rec.prefix = prefix
  }
  const dir = path.join(DATA_DIR, 'hooks')
  const file = path.join(dir, ASKS_FILE)
  mkdirSync(dir, { recursive: true })
  try {
    if (statSync(file).size > ASKS_ROTATE) renameSync(file, path.join(dir, 'permission-asks.1.jsonl'))
  } catch {
    // no file yet
  }
  appendFileSync(file, `${JSON.stringify(rec)}\n`)
}

function readOld(file) {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8'))
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

// Only the event name, trigger and tool name are kept: prompts, tool input, summaries and paths are dropped here.
function save(input) {
  const id = input?.session_id
  if (typeof id !== 'string' || !SESSION_RE.test(id)) return
  const event = input.hook_event_name
  if (event === 'PermissionRequest') return recordAsk(input)
  const dir = path.join(DATA_DIR, 'hooks')
  const file = path.join(dir, `${id}.json`)
  const old = readOld(file)
  const at = new Date().toISOString()
  const rec = {
    v: 1,
    sessionId: id,
    at,
    compactingSince: typeof old.compactingSince === 'string' ? old.compactingSince : undefined,
    compactTrigger: typeof old.compactTrigger === 'string' ? old.compactTrigger : undefined,
    deniedCount: Number.isInteger(old.deniedCount) ? old.deniedCount : 0,
    deniedTools: Array.isArray(old.deniedTools) ? old.deniedTools.filter((t) => typeof t === 'string' && TOOL_RE.test(t)).slice(-5) : [],
  }
  if (event === 'PreCompact') {
    rec.compactingSince = at
    rec.compactTrigger = input.trigger === 'manual' ? 'manual' : 'auto'
  } else if (event === 'PostCompact') {
    rec.compactingSince = undefined
    rec.compactTrigger = undefined
  } else if (event === 'PermissionDenied') {
    rec.deniedCount = Math.min(1_000_000, rec.deniedCount + 1)
    const tool = typeof input.tool_name === 'string' && TOOL_RE.test(input.tool_name) ? input.tool_name : null
    if (tool) rec.deniedTools = [...rec.deniedTools.filter((t) => t !== tool), tool].slice(-5)
  } else return
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(rec))
  renameSync(tmp, file)
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (raw.length < 1_000_000) raw += chunk
})
process.stdin.on('end', () => {
  try {
    save(JSON.parse(raw))
  } catch {
    // never fail the hook
  }
  process.exit(0)
})
