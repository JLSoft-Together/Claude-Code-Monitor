#!/usr/bin/env node
// Opt-in Claude Code hook (async: true) for PreCompact / PostCompact / PermissionDenied. Installed by the app (Settings).
// Writes <dataDir>/hooks/<session_id>.json for the monitor; never prints, always exits 0.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
