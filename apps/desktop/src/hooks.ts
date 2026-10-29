import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BACKUP_SUFFIX } from './statusline'

export const HOOK_MARK = 'hook-bridge'
/** PreCompact → "compacting", PostCompact clears it, PermissionDenied counts auto-mode denials, PermissionRequest logs dialogs (docs §11y). */
export const HOOK_EVENTS = ['PreCompact', 'PostCompact', 'PermissionDenied', 'PermissionRequest'] as const

export type HooksState = 'ours' | 'partial' | 'none' | 'unreadable'

export interface HooksRead {
  state: HooksState
  settings?: Record<string, unknown>
}

type Group = { matcher?: string; hooks?: unknown[] } & Record<string, unknown>
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ours = (h: unknown): boolean => isObj(h) && typeof h.command === 'string' && h.command.includes(HOOK_MARK)

function groupsOf(settings: Record<string, unknown>, event: string): Group[] {
  const hooks = isObj(settings.hooks) ? settings.hooks : {}
  const list = hooks[event]
  return Array.isArray(list) ? list.filter(isObj) : []
}

export function readHooks(file: string): HooksRead {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none', settings: {} } : { state: 'unreadable' }
  }
  let settings: unknown
  try {
    settings = text.trim() ? JSON.parse(text) : {}
  } catch {
    return { state: 'unreadable' }
  }
  if (!isObj(settings)) return { state: 'unreadable' }
  const have = HOOK_EVENTS.filter((e) => groupsOf(settings, e).some((g) => Array.isArray(g.hooks) && g.hooks.some(ours)))
  return { state: have.length === HOOK_EVENTS.length ? 'ours' : have.length ? 'partial' : 'none', settings }
}

/** `hooks` with our async command added to each event (other hooks kept as they are), or removed when `command` is null. */
export function plannedHooks(settings: Record<string, unknown>, command: string | null): Record<string, unknown> {
  const hooks: Record<string, unknown> = isObj(settings.hooks) ? { ...settings.hooks } : {}
  for (const event of HOOK_EVENTS) {
    const kept = groupsOf(settings, event)
      .map((g) => (Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !ours(h)) } : g))
      .filter((g) => !Array.isArray(g.hooks) || g.hooks.length)
    const next = command ? [...kept, { hooks: [{ type: 'command', command, async: true }] }] : kept
    if (next.length) hooks[event] = next
    else delete hooks[event]
  }
  return hooks
}

export type HooksWriteResult = 'ok' | 'unreadable' | 'failed'

export function writeHooks(file: string, read: HooksRead, command: string | null): HooksWriteResult {
  if (read.state === 'unreadable' || !read.settings) return 'unreadable'
  const hooks = plannedHooks(read.settings, command)
  const next: Record<string, unknown> = { ...read.settings, hooks }
  if (!Object.keys(hooks).length) delete next.hooks
  const tmp = `${file}.ccm-tmp`
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    if (existsSync(file)) copyFileSync(file, `${file}${BACKUP_SUFFIX}`)
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(tmp, file)
    return 'ok'
  } catch {
    return 'failed'
  }
}
