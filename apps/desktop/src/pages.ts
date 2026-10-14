import type { Look } from './appearance'
import type { Strings } from './strings'

export const RETRY_URL = 'ccm-desktop://retry'

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// OS-default tokens; a theme picked in the app (appearance.json) replaces them so the hand-off does not flash.
const LIGHT: Look = { canvas: '#ececee', surface: '#ffffff', ink: '#1d1d1f', muted: '#5c5c61', faint: '#86868b', accent: '#0071e3', dark: false }
const DARK: Look = { canvas: '#1e1e1e', surface: '#262628', ink: '#f5f5f7', muted: '#a1a1a6', faint: '#7c7c80', accent: '#0a84ff', dark: true }

/** Text on an accent fill: white unless the accent is light (Dracula purple, Monokai yellow…), WCAG relative luminance. */
export function onAccent(hex: string): string {
  const lin = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5)
  // Contrast with white vs with near-black; pick the larger.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.06 ? '#ffffff' : '#1d1d1f'
}

const vars = (l: Look): string =>
  `--canvas:${l.canvas}; --surface:${l.surface}; --ink:${l.ink}; --muted:${l.muted}; --faint:${l.faint}; --accent:${l.accent};` +
  ` --line:color-mix(in srgb, var(--ink) 12%, transparent); --accent-soft:color-mix(in srgb, var(--accent) 22%, transparent);` +
  ` --on-accent:${onAccent(l.accent)}; --error:${l.dark ? '#ff453a' : '#d70015'}; color-scheme:${l.dark ? 'dark' : 'light'};`

const tokens = (look: Look | null | undefined): string =>
  look ? `:root { ${vars(look)} }` : `:root { ${vars(LIGHT)} }\n@media (prefers-color-scheme: dark) { :root { ${vars(DARK)} } }`

/*
 * Startup wordmark: each character rises out of a blur, 32 ms apart (CSS only: this page has no script and no CSP of
 * its own). A caret blinks after the last letter while the collector starts, then the progress bar takes over.
 */
const STYLE = `
* { box-sizing: border-box; }
html, body { margin: 0; overflow-x: hidden; }
body { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--canvas); color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
main { width: 100%; max-width: 560px; display: grid; gap: 12px; justify-items: center; text-align: center; }
.mark { width: 56px; height: 56px; border-radius: 14px; display: block; box-shadow: 0 1px 2px rgb(0 0 0 / .18), 0 8px 24px rgb(0 0 0 / .12);
  animation: mark .5s cubic-bezier(.2,.8,.2,1) both; }
.word { margin: 6px 0 0; font-size: 30px; line-height: 1.15; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; display: flex; align-items: baseline; }
.word span { display: inline-block; white-space: pre; animation: rise .42s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(120ms + var(--i) * 32ms); }
.caret { width: 2px; height: .9em; margin-left: 3px; align-self: center; border-radius: 1px; background: var(--accent);
  animation: blink 1s steps(1) calc(120ms + var(--n) * 32ms + 200ms) infinite both; }
.bar { position: relative; width: 160px; height: 2px; margin-top: 10px; border-radius: 1px; overflow: hidden; background: var(--accent-soft);
  animation: fade .3s ease-out calc(120ms + var(--n) * 32ms + 300ms) both; }
.bar::after { content: ""; position: absolute; inset: 0; width: 40%; border-radius: 1px; background: var(--accent); animation: slide 1.1s cubic-bezier(.45,0,.55,1) infinite; }
.status { margin: 0; color: var(--muted); font-size: 13px; animation: fade .3s ease-out calc(120ms + var(--n) * 32ms + 300ms) both; }
.hint { margin: -8px 0 0; color: var(--faint); font-size: 12px; animation: fade .3s ease-out calc(120ms + var(--n) * 32ms + 400ms) both; }
.ver { position: fixed; bottom: 16px; left: 0; right: 0; margin: 0; color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; text-align: center; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes mark { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes blink { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) {
  .mark, .word span, .bar, .status, .hint { animation: none; }
  .caret { animation: none; opacity: 0; }
  .bar::after { animation: none; width: 100%; }
}
h1.title { margin: 0; font-size: 18px; font-weight: 600; }
p { margin: 0; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.err { color: var(--error); font-weight: 600; }
a.btn { display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border-radius: 8px; background: var(--accent); color: var(--on-accent);
  font-weight: 600; text-decoration: none; }
a.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
pre { width: 100%; max-height: 260px; overflow: auto; margin: 0; padding: 12px; text-align: left; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--muted); font: 12px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
`

// apps/web/public/favicon.svg, inline (data: pages cannot load app files).
const MARK = `<svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none" aria-hidden="true"><rect width="1024" height="1024" fill="#16181D"/><rect x="218" y="218" width="588" height="588" rx="72" stroke="#E8E6E3" stroke-width="34"/><path d="M294 427 375 508 294 589" stroke="#E8E6E3" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><rect x="423" y="437" width="50" height="138" rx="10" fill="#E8915A"/><path d="M487 506H590" stroke="#E8E6E3" stroke-width="24"/><path d="M590 506V376Q590 364 602 364H670M590 506H670M590 506V636Q590 648 602 648H670" stroke="#E8E6E3" stroke-width="24" stroke-linecap="square" stroke-linejoin="round"/><rect x="670" y="326" width="78" height="78" rx="16" fill="#E8915A"/><rect x="670" y="467" width="78" height="78" rx="16" fill="#E8E6E3"/><rect x="670" y="609" width="78" height="78" rx="16" fill="#E8E6E3"/></svg>`

const page = (title: string, body: string, look?: Look | null, n = 0): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${tokens(look)}\n:root { --n: ${n}; }${STYLE}</style></head><body><main>${body}</main></body></html>`,
  )}`

/** One span per character (code points, so an emoji or accented letter is not split); spaces stay spaces. */
export function wordmark(text: string): string {
  return [...text].map((ch, i) => `<span aria-hidden="true" style="--i:${i}">${ch === ' ' ? ' ' : esc(ch)}</span>`).join('')
}

export const loadingPage = (t: Strings, look?: Look | null, version?: string): string => {
  const n = [...t.appName].length
  return page(
    t.appName,
    `${MARK}<h1 class="word" aria-label="${esc(t.appName)}">${wordmark(t.appName)}<i class="caret" aria-hidden="true"></i></h1>` +
      `<div class="bar" role="progressbar" aria-label="${esc(t.loading)}"></div><p class="status" role="status">${esc(t.loading)}</p><p class="hint">${esc(t.loadingHint)}</p>` +
      (version ? `<p class="ver">v${esc(version)}</p>` : ''),
    look,
    n,
  )
}

export const errorPage = (t: Strings, message: string, log: string[], look?: Look | null): string =>
  page(
    t.appName,
    `${MARK}<h1 class="title">${esc(t.errorTitle)}</h1><p class="err" role="alert">${esc(message)}</p><a class="btn" href="${RETRY_URL}">${esc(t.retry)}</a>` +
      (log.length ? `<p>${esc(t.logHint)}</p><pre>${esc(log.join('\n'))}</pre>` : ''),
    look,
  )
