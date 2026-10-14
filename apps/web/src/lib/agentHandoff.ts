export type ConsoleLevel = 'warning' | 'error'

export type HandoffAction = 'screenshot' | 'console' | 'pick'

export interface ConsoleEntry {
  level: ConsoleLevel
  message: string
  source?: string
  line?: number
  at: number
}

export interface ElementPick {
  selector: string
  tag: string
  classes: string[]
  text: string
  outerHTML: string
  url: string
}

export const CONSOLE_KEEP = 50
const MESSAGE_MAX = 300
const TEXT_MAX = 200
const HTML_MAX = 600

const SECRET = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g
const SECRET_PARAM = /([?&](?:token|access_token|id_token|key|api_key|apikey|secret|password|passwd|auth|sig|signature|code)=)[^&#\s"']+/gi
const OPAQUE = /\b[A-Za-z0-9_-]{40,}\b/g

export const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Control chars out, whitespace collapsed, obvious secrets / tokens masked. */
export function sanitize(text: string, max: number): string {
  const clean = String(text)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(SECRET, '[redacted]')
    .replace(SECRET_PARAM, '$1[redacted]')
    .replace(OPAQUE, '[redacted]')
  return truncate(clean, max)
}

/** Electron's `console-message`: numeric level (0 verbose … 3 error) in older builds, a string in newer. */
export function consoleLevel(level: unknown): ConsoleLevel | null {
  if (level === 3 || level === 'error') return 'error'
  if (level === 2 || level === 'warning' || level === 'warn') return 'warning'
  return null
}

/** Appends to a ring of the last `CONSOLE_KEEP`; repeats of the newest entry are folded. */
export function pushConsole(list: ConsoleEntry[], entry: ConsoleEntry): ConsoleEntry[] {
  const message = sanitize(entry.message, MESSAGE_MAX)
  if (!message) return list
  const last = list[list.length - 1]
  if (last && last.message === message && last.level === entry.level && last.source === entry.source && last.line === entry.line) return list
  return [...list, { ...entry, message }].slice(-CONSOLE_KEEP)
}

function shortSource(source: string | undefined, page: string): string {
  if (!source) return ''
  try {
    const u = new URL(source)
    const p = new URL(page)
    return u.origin === p.origin ? u.pathname : `${u.host}${u.pathname}`
  } catch {
    return sanitize(source, 120)
  }
}

const pageLabel = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return sanitize(url, 200)
  }
}

/** Compact block pasted into the agent's input (no trailing newline: nothing gets submitted). */
export function formatConsoleBlock(entries: readonly ConsoleEntry[], pageUrl: string): string {
  const errors = entries.filter((e) => e.level === 'error').length
  const warnings = entries.length - errors
  const counts = [errors && `${errors} error${errors === 1 ? '' : 's'}`, warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`].filter(Boolean).join(', ')
  const lines = entries.map((e) => {
    const src = shortSource(e.source, pageUrl)
    return `- [${e.level}] ${e.message}${src ? ` (${src}${e.line ? `:${e.line}` : ''})` : ''}`
  })
  return [`Browser console on ${pageLabel(pageUrl)} — ${counts}:`, ...lines].join('\n')
}

export function formatElementBlock(pick: ElementPick): string {
  const tag = [pick.tag, ...pick.classes.slice(0, 6)].join('.')
  const out = [`Element on ${pageLabel(pick.url)}:`, `selector: ${sanitize(pick.selector, 300)}`, `tag: ${sanitize(tag, 200)}`]
  const text = sanitize(pick.text, TEXT_MAX)
  if (text) out.push(`text: "${text}"`)
  out.push(`html: ${sanitize(pick.outerHTML, HTML_MAX)}`)
  return out.join('\n')
}

/** Validates what the guest page returned: it is untrusted input. */
export function asElementPick(value: unknown, pageUrl: string): ElementPick | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
  const selector = str(v.selector, 1000)
  const tag = str(v.tag, 64).toLowerCase()
  if (!selector || !/^[a-z][a-z0-9-]*$/.test(tag)) return null
  const classes = Array.isArray(v.classes) ? v.classes.filter((c): c is string => typeof c === 'string').map((c) => c.slice(0, 80)).slice(0, 12) : []
  return { selector, tag, classes, text: str(v.text, 2000), outerHTML: str(v.outerHTML, 4000), url: pageUrl }
}

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,/%]+\))$/i

/**
 * Runs inside the guest page via `executeJavaScript`; resolves with the clicked element's facts or
 * null on Esc / cancel. Overlay lives in the guest only and is removed on exit.
 */
export function pickerScript(color: string): string {
  const c = JSON.stringify(SAFE_COLOR.test(color.trim()) ? color.trim() : 'Highlight')
  return `(() => new Promise((resolve) => {
  if (window.__ccmPickCancel) window.__ccmPickCancel();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid ' + ${c} + ';border-radius:3px;background:transparent;box-shadow:0 0 0 9999px rgba(0,0,0,.08);transition:all 60ms linear;display:none';
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:2px 6px;border-radius:4px;color:white;background:' + ${c} + ';display:none;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
  document.documentElement.append(box, tip);
  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';
  let current = null;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'));
  const part = (el) => {
    if (el.id && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    let s = el.tagName.toLowerCase();
    const cls = [...el.classList].filter((k) => !/^(?:is-|has-|hover|active|focus)/.test(k)).slice(0, 2);
    if (cls.length) s += '.' + cls.map(esc).join('.');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((x) => x.tagName === el.tagName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
    }
    return s;
  };
  const selectorOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      const p = part(n);
      parts.unshift(p);
      if (p.startsWith('#')) break;
      try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch (e) { break; }
    }
    return parts.join(' > ');
  };
  const show = (el) => {
    const r = el.getBoundingClientRect();
    box.style.display = tip.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    tip.textContent = part(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    tip.style.left = Math.max(0, r.left) + 'px';
    tip.style.top = (r.top > 24 ? r.top - 22 : r.bottom + 4) + 'px';
  };
  const move = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== box && el !== tip && el !== current) { current = el; show(el); }
  };
  const block = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const done = (value) => {
    removeEventListener('mousemove', move, true);
    removeEventListener('click', click, true);
    removeEventListener('mousedown', block, true);
    removeEventListener('mouseup', block, true);
    removeEventListener('keydown', key, true);
    box.remove(); tip.remove();
    document.documentElement.style.cursor = prevCursor;
    window.__ccmPickCancel = null;
    resolve(value);
  };
  const click = (e) => {
    block(e);
    const el = current || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return done(null);
    done({
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      classes: [...el.classList].slice(0, 12),
      text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
      outerHTML: el.outerHTML.slice(0, 1200),
    });
  };
  const key = (e) => { if (e.key === 'Escape') { block(e); done(null); } };
  addEventListener('mousemove', move, true);
  addEventListener('click', click, true);
  addEventListener('mousedown', block, true);
  addEventListener('mouseup', block, true);
  addEventListener('keydown', key, true);
  window.__ccmPickCancel = () => done(null);
}))()`
}

export const PICKER_CANCEL_SCRIPT = 'window.__ccmPickCancel && window.__ccmPickCancel()'
