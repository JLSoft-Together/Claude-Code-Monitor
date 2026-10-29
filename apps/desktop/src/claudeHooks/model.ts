import { createHash } from 'node:crypto'
import { maskLog } from '../log-mask'
import { HOOK_MARK } from '../hooks'

export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export interface FlatHook {
  event: string
  matcher: string | null
  /** The hook entry exactly as in the file (`{ type, command, timeout, … }`). */
  hook: Obj
}

const normMatcher = (m: unknown): string | null => (typeof m === 'string' && m !== '' ? m : null)

/** Every hook entry of a `hooks` object (settings file, plugin hooks.json or plugin.json), in file order. */
export function flattenHooks(hooks: unknown): FlatHook[] {
  if (!isObj(hooks)) return []
  const out: FlatHook[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) continue
      for (const h of g.hooks) if (isObj(h)) out.push({ event, matcher: normMatcher(g.matcher), hook: h })
    }
  }
  return out
}

/** JSON with sorted keys, so the same entry hashes the same however the file orders its fields. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

export function normFile(file: string, platform: NodeJS.Platform = process.platform): string {
  const s = file.replace(/\\/g, '/')
  return platform === 'win32' ? s.toLowerCase() : s
}

export function hookKey(file: string, flat: FlatHook, platform: NodeJS.Platform = process.platform): string {
  const raw = [normFile(file, platform), flat.event, flat.matcher ?? '', canonical(flat.hook)].join('\0')
  return createHash('sha256').update(raw).digest('hex').slice(0, 24)
}

export const isOrreryHook = (hook: Obj): boolean => typeof hook.command === 'string' && hook.command.includes(HOOK_MARK)

const sameEntry = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

/** Settings without that one entry (empty group / event / `hooks` dropped); null when it is not there. Other keys untouched. */
export function removeHookEntry(settings: Obj, flat: FlatHook): Obj | null {
  if (!isObj(settings.hooks)) return null
  const groups = settings.hooks[flat.event]
  if (!Array.isArray(groups)) return null
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    if (!isObj(g) || !Array.isArray(g.hooks) || normMatcher(g.matcher) !== flat.matcher) continue
    const hi = g.hooks.findIndex((h) => sameEntry(h, flat.hook))
    if (hi < 0) continue
    const left = g.hooks.filter((_, i) => i !== hi)
    const nextGroups = left.length ? groups.map((x, i) => (i === gi ? { ...g, hooks: left } : x)) : groups.filter((_, i) => i !== gi)
    const hooks: Obj = { ...settings.hooks }
    if (nextGroups.length) hooks[flat.event] = nextGroups
    else delete hooks[flat.event]
    const next: Obj = { ...settings, hooks }
    if (!Object.keys(hooks).length) delete next.hooks
    return next
  }
  return null
}

export function hasHookEntry(settings: Obj, flat: FlatHook): boolean {
  return flattenHooks(settings.hooks).some((f) => f.event === flat.event && f.matcher === flat.matcher && sameEntry(f.hook, flat.hook))
}

/** Settings with the entry back: appended to the first group with the same matcher, else a new group at the end. */
export function restoreHookEntry(settings: Obj, flat: FlatHook): Obj {
  if (hasHookEntry(settings, flat)) return settings
  const hooks: Obj = isObj(settings.hooks) ? { ...settings.hooks } : {}
  const groups = Array.isArray(hooks[flat.event]) ? (hooks[flat.event] as unknown[]) : []
  const gi = groups.findIndex((g) => isObj(g) && Array.isArray(g.hooks) && normMatcher(g.matcher) === flat.matcher)
  if (gi >= 0) {
    const g = groups[gi] as Obj
    hooks[flat.event] = groups.map((x, i) => (i === gi ? { ...g, hooks: [...(g.hooks as unknown[]), flat.hook] } : x))
  } else {
    hooks[flat.event] = [...groups, flat.matcher === null ? { hooks: [flat.hook] } : { matcher: flat.matcher, hooks: [flat.hook] }]
  }
  return { ...settings, hooks }
}

const SECRET_NAME = '[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH|CREDENTIALS?|COOKIE|SESSION)[A-Za-z0-9_]*'

/** Display text of a command / URL with the home folder and anything credential-like replaced. */
export function maskHookText(text: string, home: string, platform: NodeJS.Platform = process.platform): string {
  let out = text
    .replace(/(:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1••••@')
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ••••')
    .replace(new RegExp(`\\b(${SECRET_NAME})(\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s;&|"']+)`, 'gi'), '$1$2••••')
    .replace(/(--?[A-Za-z0-9-]*(?:token|secret|password|passwd|api-?key|auth|key)[A-Za-z0-9-]*)(=|\s+)("[^"]*"|'[^']*'|[^\s;&|"'-][^\s;&|"']*)/gi, '$1$2••••')
    .replace(/([?&](?:token|key|secret|sig|signature|access_token|api_key|apikey|password)=)[^&\s"']+/gi, '$1••••')
  out = maskLog(out, home, platform)
  return out.replace(/\[masked\]/g, '••••')
}

export function hookText(hook: Obj): string {
  if (typeof hook.command === 'string') return Array.isArray(hook.args) ? [hook.command, ...hook.args.filter((a): a is string => typeof a === 'string')].join(' ') : hook.command
  if (typeof hook.url === 'string') return hook.url
  if (typeof hook.tool === 'string') return hook.tool
  if (typeof hook.prompt === 'string') return hook.prompt
  return ''
}

const SIMPLE_TOOL = /^[A-Za-z][A-Za-z0-9_]*$/

function toolFrom(matcher: string | null): string {
  const first = (matcher ?? '').split('|')[0]?.trim() ?? ''
  return SIMPLE_TOOL.test(first) ? first : 'Bash'
}

function sampleInput(tool: string, cwd: string): Obj {
  const file = `${cwd.replace(/[\\/]+$/, '')}${cwd.includes('\\') ? '\\' : '/'}orrery-hook-test.txt`
  if (tool === 'Bash') return { command: 'echo orrery-hook-test', description: 'Orrery hook test' }
  if (tool === 'Read') return { file_path: file }
  if (tool === 'Write') return { file_path: file, content: 'orrery hook test\n' }
  if (tool === 'Edit' || tool === 'MultiEdit') return { file_path: file, old_string: 'a', new_string: 'b' }
  if (tool === 'Glob' || tool === 'Grep') return { pattern: 'orrery-hook-test' }
  return {}
}

/** Stdin a hook gets for `event` (fields as in the Claude Code 2.1.294 input schemas), filled with harmless sample values. */
export function fakePayload(event: string, matcher: string | null, cwd: string, sessionId: string): Obj {
  const base: Obj = { session_id: sessionId, transcript_path: '', cwd, hook_event_name: event, permission_mode: 'default' }
  const pick = (options: string[], fallback: string): string => options.find((o) => (matcher ?? '').split('|').includes(o)) ?? fallback
  const tool = toolFrom(matcher)
  const toolCall = { tool_name: tool, tool_input: sampleInput(tool, cwd), tool_use_id: 'toolu_orrery_hook_test' }
  switch (event) {
    case 'PreToolUse':
      return { ...base, ...toolCall }
    case 'PostToolUse':
      return { ...base, ...toolCall, tool_response: {} }
    case 'PostToolUseFailure':
      return { ...base, ...toolCall, error: 'Orrery hook test failure' }
    case 'PermissionRequest':
      return { ...base, tool_name: tool, tool_input: toolCall.tool_input, permission_suggestions: [] }
    case 'PermissionDenied':
      return { ...base, ...toolCall, reason: 'Orrery hook test' }
    case 'UserPromptSubmit':
      return { ...base, prompt: 'Orrery hook test (never sent to Claude)' }
    case 'UserPromptExpansion':
      return { ...base, expansion_type: 'slash_command', command_name: 'orrery-hook-test', command_args: '', prompt: 'Orrery hook test' }
    case 'SessionStart':
      return { ...base, source: pick(['startup', 'resume', 'clear', 'compact'], 'startup') }
    case 'SessionEnd':
      return { ...base, reason: 'other' }
    case 'Stop':
      return { ...base, stop_hook_active: false, last_assistant_message: '' }
    case 'StopFailure':
      return { ...base, error: 'Orrery hook test', last_assistant_message: '' }
    case 'SubagentStart':
      return { ...base, agent_id: 'orrery-hook-test', agent_type: 'general-purpose' }
    case 'SubagentStop':
      return { ...base, stop_hook_active: false, agent_id: 'orrery-hook-test', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: '' }
    case 'Notification':
      return { ...base, message: 'Orrery hook test', title: 'Orrery', notification_type: 'idle_prompt' }
    case 'PreCompact':
      return { ...base, trigger: pick(['manual', 'auto'], 'manual'), custom_instructions: null }
    case 'PostCompact':
      return { ...base, trigger: pick(['manual', 'auto'], 'manual'), compact_summary: '' }
    default:
      return base
  }
}

/** Keeps the tail end of the output a person needs (errors come last), cut to `max` characters. */
export function clipOutput(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: `…${text.slice(-max)}`, cut: true } : { text, cut: false }
}
