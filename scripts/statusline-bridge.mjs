#!/usr/bin/env node
// Opt-in Claude Code status line command. Saves rate limits + session cost for the monitor, then prints a status line.
// settings.json: "statusLine": { "type": "command", "command": "node \"<repo>/scripts/statusline-bridge.mjs\"" }
// Keep an existing status line: append  --chain "<your old command>"  (it receives the same stdin).
import { spawn } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
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

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function window(w) {
  const usedPct = num(w?.used_percentage)
  if (usedPct === undefined) return undefined
  const resets = num(w?.resets_at)
  return { usedPct: Math.max(0, Math.min(100, usedPct)), resetsAt: resets ? new Date(resets * 1000).toISOString() : undefined }
}

// Must match autocompactBufferPct in packages/shared/src/context.ts.
function bufferPct(cw) {
  const acw = Number.parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '0', 10)
  if (!(acw > 0)) return undefined
  const total = num(cw?.total_tokens) || 1_000_000
  return Math.min(100, (acw / total) * 100)
}

function contextPct(cw) {
  const remaining = num(cw?.remaining_percentage)
  const used = remaining !== undefined ? 100 - remaining : num(cw?.used_percentage)
  return used === undefined ? undefined : Math.max(0, Math.min(100, used))
}

// Only numbers leave this script: no paths, names, prompt or transcript data.
function save(input) {
  if (typeof input?.session_id !== 'string' || !SESSION_RE.test(input.session_id)) return
  const record = {
    v: 1,
    sessionId: input.session_id,
    at: new Date().toISOString(),
    costUsd: num(input.cost?.total_cost_usd),
    contextWindow: num(input.context_window?.context_window_size),
    contextPct: contextPct(input.context_window),
    bufferPct: bufferPct(input.context_window),
    fiveHour: window(input.rate_limits?.five_hour),
    sevenDay: window(input.rate_limits?.seven_day),
  }
  const dir = path.join(DATA_DIR, 'statusline')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${input.session_id}.json`)
  writeFileSync(`${file}.tmp`, JSON.stringify(record))
  renameSync(`${file}.tmp`, file)
}

function defaultLine(input) {
  const parts = [input?.model?.display_name || 'Claude']
  const ctx = num(input?.context_window?.used_percentage)
  if (ctx !== undefined) parts.push(`ctx ${Math.round(ctx)}%`)
  const five = num(input?.rate_limits?.five_hour?.used_percentage)
  if (five !== undefined) parts.push(`5h ${Math.round(five)}%`)
  const cost = num(input?.cost?.total_cost_usd)
  if (cost !== undefined) parts.push(`$${cost.toFixed(2)}`)
  return parts.join(' | ')
}

function chain(command, raw) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    child.on('error', () => resolve(false))
    child.on('close', () => resolve(true))
    child.stdin.on('error', () => {})
    child.stdin.end(raw)
  })
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', async () => {
  let input = null
  try {
    input = JSON.parse(raw)
    save(input)
  } catch {
    // A broken bridge must never break the user's status line.
  }
  const i = process.argv.indexOf('--chain')
  const command = i >= 0 ? process.argv.slice(i + 1).join(' ') : ''
  if (command && (await chain(command, raw))) return
  process.stdout.write(defaultLine(input))
})
