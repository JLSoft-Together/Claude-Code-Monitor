import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isRiskyPermRule, parsePermRule, PERM_ASK_DAYS, PERM_RULES_MAX, type PermAsk, type PermFileState, type PermRead, type PermRuleSet, type PermWrite } from '@ccm/shared'
import { BACKUP_SUFFIX } from '../statusline'
import { isWithin, realOrNull } from './paths'

/** Written by `scripts/hook-bridge.mjs` under `<dataDir>/hooks/` (rotated to the `.1` file past 512 KB). */
export const PERM_ASK_FILES = ['permission-asks.1.jsonl', 'permission-asks.jsonl'] as const
const ASK_FILE_MAX = 1024 * 1024
const SETTINGS_MAX = 512 * 1024
const RULES_SHOWN = 200
const TOOL_RE = /^[\w.:-]{1,80}$/
const RULE_CONTENT_RE = /^[\w .:*@+,~-]{1,120}$/
const PREFIX_RE = /^(?:\.\/)?[\w.:@+-]{1,30}(?: (?:\.\/)?[\w.:@+-]{1,30})?$/

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A rule read back from the bridge log: same limits the bridge applies, the file is still untrusted. */
export function safeAskRule(rule: unknown): string | null {
  const r = parsePermRule(rule)
  if (!r) return null
  if (r.content === undefined) return r.tool
  return RULE_CONTENT_RE.test(r.content) ? `${r.tool}(${r.content})` : null
}

/** Asks of the last `PERM_ASK_DAYS` days whose session folder is `root` or inside it, oldest first. */
export function parseAsks(text: string, root: string, now: number, platform: NodeJS.Platform = process.platform): PermAsk[] {
  const since = now - PERM_ASK_DAYS * 86_400_000
  const out: PermAsk[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(o) || typeof o.at !== 'string' || typeof o.cwd !== 'string' || typeof o.tool !== 'string' || !TOOL_RE.test(o.tool)) continue
    const at = Date.parse(o.at)
    if (!Number.isFinite(at) || at < since || at > now + 60_000) continue
    if (!path.isAbsolute(o.cwd) || !isWithin(root, o.cwd, platform)) continue
    const rules = Array.isArray(o.rules) ? o.rules.map(safeAskRule).filter((r): r is string => !!r).slice(0, 3) : []
    const ask: PermAsk = { at: new Date(at).toISOString(), tool: o.tool, rules }
    if (typeof o.prefix === 'string' && PREFIX_RE.test(o.prefix)) ask.prefix = o.prefix
    out.push(ask)
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

export async function readAsks(dataDir: string, root: string, now = Date.now()): Promise<PermAsk[]> {
  const out: PermAsk[] = []
  for (const name of PERM_ASK_FILES) {
    const file = path.join(dataDir, 'hooks', name)
    const st = await fs.stat(file).catch(() => null)
    if (!st?.isFile() || st.size > ASK_FILE_MAX) continue
    out.push(...parseAsks(await fs.readFile(file, 'utf8').catch(() => ''), root, now))
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

interface SettingsRead {
  state: PermFileState
  text: string
  settings: Record<string, unknown> | null
}

async function readSettings(file: string): Promise<SettingsRead> {
  let text: string
  try {
    const st = await fs.stat(file)
    if (!st.isFile() || st.size > SETTINGS_MAX) return { state: 'unreadable', text: '', settings: null }
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none', text: '', settings: {} } : { state: 'unreadable', text: '', settings: null }
  }
  try {
    const v: unknown = text.trim() ? JSON.parse(text.replace(/^﻿/, '')) : {}
    if (!isObj(v)) return { state: 'unreadable', text, settings: null }
    if (v.permissions !== undefined && !isObj(v.permissions)) return { state: 'unreadable', text, settings: null }
    const allow = isObj(v.permissions) ? v.permissions.allow : undefined
    if (allow !== undefined && !Array.isArray(allow)) return { state: 'unreadable', text, settings: null }
    return { state: 'ok', text, settings: v }
  } catch {
    return { state: 'unreadable', text, settings: null }
  }
}

function ruleSet(r: SettingsRead): PermRuleSet & { state: PermFileState } {
  const p = isObj(r.settings?.permissions) ? r.settings.permissions : {}
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 300).slice(0, RULES_SHOWN) : [])
  return { state: r.state, allow: list(p.allow), deny: list(p.deny) }
}

const settingsFiles = (root: string) => ({ shared: path.join(root, '.claude', 'settings.json'), local: path.join(root, '.claude', 'settings.local.json') })

/** Recorded asks + the allow / deny rules of both project settings files. Only rule strings leave this module. */
export async function readPermissions(root: string, dataDir: string | null, now = Date.now()): Promise<PermRead> {
  const files = settingsFiles(root)
  const [asks, shared, local] = await Promise.all([dataDir ? readAsks(dataDir, root, now) : Promise.resolve([]), readSettings(files.shared), readSettings(files.local)])
  return { ok: true, root, asks, shared: ruleSet(shared), local: ruleSet(local) }
}

/** Ticked rules, trimmed and de-duplicated; null when any is malformed, `risky` when one is a rule Orrery never writes. */
export function cleanRules(rules: unknown): string[] | 'risky' | null {
  if (!Array.isArray(rules) || !rules.length || rules.length > PERM_RULES_MAX) return null
  const out: string[] = []
  for (const r of rules) {
    const p = parsePermRule(r)
    if (!p) return null
    const text = p.content === undefined ? p.tool : `${p.tool}(${p.content})`
    if (isRiskyPermRule(text)) return 'risky'
    if (!out.includes(text)) out.push(text)
  }
  return out
}

/** Settings with `rules` appended to `permissions.allow` (existing ones skipped); every other key and its order kept. */
export function planAllow(settings: Record<string, unknown>, rules: readonly string[]): { next: Record<string, unknown>; added: string[] } {
  const perms = isObj(settings.permissions) ? settings.permissions : {}
  const allow = Array.isArray(perms.allow) ? perms.allow : []
  const added = rules.filter((r) => !allow.includes(r))
  const next = { ...settings, permissions: { ...perms, allow: [...allow, ...added] } }
  return { next, added }
}

/** Indent of the first indented line (tabs or spaces), 2 spaces for a new or one-line file. */
export function indentOf(text: string): string | number {
  const m = /\n([ \t]+)\S/.exec(text)
  return m ? m[1]! : 2
}

export function formatSettings(next: Record<string, unknown>, before: string): string {
  const eol = before.includes('\r\n') ? '\r\n' : '\n'
  return `${JSON.stringify(next, null, indentOf(before)).replace(/\n/g, eol)}${eol}`
}

const DIFF_MAX_LINES = 1500

/** Line diff (`  ` kept, `- ` removed, `+ ` added) of the whole file, unchanged runs longer than 6 lines folded. */
export function jsonDiff(before: string, after: string): string {
  const a = before ? before.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : []
  const b = after.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) return b.map((l) => `+ ${l}`).join('\n')
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const rows: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push(`  ${a[i]}`)
      i++
      j++
    } else if (i < a.length && (j >= b.length || dp[i + 1]![j]! >= dp[i]![j + 1]!)) rows.push(`- ${a[i++]}`)
    else rows.push(`+ ${b[j++]}`)
  }
  const out: string[] = []
  for (let k = 0; k < rows.length; ) {
    let end = k
    while (end < rows.length && rows[end]!.startsWith('  ')) end++
    if (end - k > 6) {
      out.push(...rows.slice(k, k + 2), '  …', ...rows.slice(end - 2, end))
      k = end
    } else if (end > k) {
      out.push(...rows.slice(k, end))
      k = end
    } else out.push(rows[k++]!)
  }
  return out.join('\n')
}

export type ConfirmAllow = (req: { file: string; added: string[]; diff: string }) => Promise<boolean>

/**
 * Adds ticked allow rules to `<root>/.claude/settings.local.json` after `confirm` saw the exact diff. Never touches the
 * shared settings.json; refuses when the file changed while the dialog was open.
 */
export async function writeAllow(root: string, rules: unknown, confirm: ConfirmAllow): Promise<PermWrite> {
  const clean = cleanRules(rules)
  if (clean === null) return { ok: false, error: 'invalid' }
  if (clean === 'risky') return { ok: false, error: 'risky' }
  const dir = path.join(root, '.claude')
  const realDir = await realOrNull(dir)
  if (realDir && !isWithin(root, realDir)) return { ok: false, error: 'denied' }
  const file = path.join(dir, 'settings.local.json')
  const realFile = await realOrNull(file)
  if (realFile && !isWithin(root, realFile)) return { ok: false, error: 'denied' }
  const read = await readSettings(file)
  if (read.state === 'unreadable' || !read.settings) return { ok: false, error: 'unreadable' }
  const { next, added } = planAllow(read.settings, clean)
  if (!added.length) return { ok: true, added: [] }
  const text = formatSettings(next, read.text)
  if (!(await confirm({ file, added, diff: jsonDiff(read.text, text) }))) return { ok: false, error: 'cancelled' }
  const again = await readSettings(file)
  if (again.text !== read.text || again.state !== read.state) return { ok: false, error: 'changed' }
  const tmp = `${file}.ccm-tmp`
  try {
    await fs.mkdir(dir, { recursive: true })
    if (read.state === 'ok') await fs.copyFile(file, `${file}${BACKUP_SUFFIX}`)
    await fs.writeFile(tmp, text)
    await fs.rename(tmp, file)
    return { ok: true, added }
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    return { ok: false, error: 'failed' }
  }
}
