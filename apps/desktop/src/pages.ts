import type { Look } from './appearance'
import type { Strings } from './strings'

export const RETRY_URL = 'ccm-desktop://retry'
/** Until the wordmark has landed (STYLE `--text` + letters); a faster collector still waits for it. */
export const INTRO_MS = 2300
/** `.out` leave animation before the dashboard replaces the page. */
export const LEAVE_MS = 280
export const LEAVE_SCRIPT = "document.documentElement.classList.add('out')"

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
  ` --on-accent:${onAccent(l.accent)}; --brand:${l.dark ? '#e8915a' : '#b45a26'}; --error:${l.dark ? '#ff453a' : '#d70015'}; color-scheme:${l.dark ? 'dark' : 'light'};`

const tokens = (look: Look | null | undefined): string =>
  look ? `:root { ${vars(look)} }` : `:root { ${vars(LIGHT)} }\n@media (prefers-color-scheme: dark) { :root { ${vars(DARK)} } }`

/*
 * Startup intro, CSS only (this page has no script and no CSP of its own): the golem is built block by block (legs,
 * torso, arms, head), its ember eye lights up, the chest terminal types its prompt, then it settles above the wordmark
 * and blinks while the collector starts. Timings are offsets from page load.
 */
// Reduced motion, and the error page (same mark, no intro): the finished mark, nothing moves.
const still = (scope: string): string => `
  ${scope} :is(.stage, .mark, .ring, .part, .eye, .draw, .cursor, .word span, .bar, .status, .hint, .ver, body) { animation: none; }
  ${scope} .draw { opacity: 1; stroke-dashoffset: 0; }
  ${scope} :is(.part, .eye, .cursor) { opacity: 1; transform: none; }
  ${scope} .caret { animation: none; opacity: 0; }
  ${scope} .bar::after { animation: none; width: 100%; }`

const STYLE = `
* { box-sizing: border-box; }
html, body { margin: 0; overflow-x: hidden; }
html:not(.static) body { overflow: hidden; }
body { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--canvas); color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
main { width: 100%; max-width: 560px; display: grid; gap: 12px; justify-items: center; text-align: center; }
:root { --settle: 1500ms; --text: 1680ms; --after: calc(var(--text) + var(--n) * 32ms); }
.stage { position: relative; width: 72px; height: 72px; animation: settle .6s cubic-bezier(.65,0,.35,1) var(--settle) both; }
.mark { width: 72px; height: 72px; border-radius: 17px; display: block; overflow: hidden;
  box-shadow: 0 1px 2px rgb(0 0 0 / .18), 0 10px 30px rgb(0 0 0 / .16); animation: tile .45s cubic-bezier(.34,1.4,.64,1) both; }
.ring { position: absolute; inset: 0; border-radius: 17px; border: 1.5px solid #E8915A; opacity: 0; pointer-events: none;
  animation: ring .7s cubic-bezier(.2,.8,.2,1) 1400ms forwards; }
.part { transform-box: fill-box; transform-origin: center; opacity: 0; animation: place .42s cubic-bezier(.34,1.45,.64,1) var(--at) forwards; }
.eye { transform-box: fill-box; transform-origin: center; transform: scaleX(0);
  animation: light .26s cubic-bezier(.2,.8,.2,1) 1000ms forwards, wink 3.4s ease-in-out 2600ms infinite; }
.draw { opacity: 0; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw .24s cubic-bezier(.65,0,.35,1) 1160ms forwards; }
.cursor { transform-box: fill-box; transform-origin: 0 50%; transform: scaleX(0);
  animation: grow .14s ease-out 1380ms forwards, blink 1.05s steps(1) 1600ms infinite; }
.word { margin: 8px 0 0; font-size: 30px; line-height: 1.15; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; display: flex; align-items: baseline; }
.word .ai { color: var(--brand); }
.word span { display: inline-block; white-space: pre; animation: rise .42s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--text) + var(--i) * 32ms); }
.caret { width: 2px; height: .9em; margin-left: 3px; align-self: center; border-radius: 1px; background: var(--accent);
  animation: blink 1s steps(1) calc(var(--after) + 200ms) infinite both; }
.bar { position: relative; width: 160px; height: 2px; margin-top: 10px; border-radius: 1px; overflow: hidden; background: var(--accent-soft);
  animation: fade .3s ease-out calc(var(--after) + 300ms) both; }
.bar::after { content: ""; position: absolute; inset: 0; width: 40%; border-radius: 1px; background: var(--accent); animation: slide 1.1s cubic-bezier(.45,0,.55,1) infinite; }
.status { margin: 0; color: var(--muted); font-size: 13px; animation: fade .3s ease-out calc(var(--after) + 300ms) both; }
.hint { margin: -8px 0 0; color: var(--faint); font-size: 12px; animation: fade .3s ease-out calc(var(--after) + 400ms) both; }
.ver { position: fixed; bottom: 16px; left: 0; right: 0; margin: 0; color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; text-align: center;
  animation: fade .4s ease-out calc(var(--after) + 400ms) both; }
.out body { animation: leave .28s cubic-bezier(.4,0,1,1) forwards; }
@keyframes tile { from { opacity: 0; transform: scale(.55); } to { opacity: 1; transform: none; } }
@keyframes settle { from { transform: translateY(64px) scale(1.6); } to { transform: none; } }
@keyframes place { from { opacity: 0; transform: var(--from); } 40% { opacity: 1; } to { opacity: 1; transform: none; } }
@keyframes light { to { transform: none; } }
@keyframes wink { 0%, 90%, 100% { transform: none; } 95% { transform: scaleY(.15); } }
@keyframes draw { from { opacity: 1; } to { opacity: 1; stroke-dashoffset: 0; } }
@keyframes grow { to { transform: none; } }
@keyframes ring { 0% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(1.45); } }
@keyframes rise { from { opacity: 0; transform: translateY(8px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes leave { to { opacity: 0; transform: scale(.97); filter: blur(4px); } }
@keyframes blink { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) {
${still(':root')}
}
${still('.static')}
h1.title { margin: 0; font-size: 18px; font-weight: 600; }
p { margin: 0; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.err { color: var(--error); font-weight: 600; }
a.btn { display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border-radius: 8px; background: var(--accent); color: var(--on-accent);
  font-weight: 600; text-decoration: none; }
a.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
pre { width: 100%; max-height: 260px; overflow: auto; margin: 0; padding: 12px; text-align: left; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--muted); font: 12px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
`

// apps/web/public/favicon.svg, inline (data: pages cannot load app files), split into the parts the intro builds.
const INK = '#E8E6E3'
const BG = '#16181D'
const part = (x: number, y: number, w: number, h: number, rx: number, at: number, from: string): string =>
  `<rect class="part" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${INK}" style="--at:${at}ms; --from:${from}"/>`
const MARK =
  `<div class="stage" aria-hidden="true"><svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none"><rect width="1024" height="1024" fill="${BG}"/>` +
  part(388, 680, 108, 168, 40, 260, 'translateY(90px)') +
  part(528, 680, 108, 168, 40, 330, 'translateY(90px)') +
  part(348, 368, 328, 288, 52, 470, 'translateY(-120px) scaleY(.85)') +
  part(228, 384, 96, 236, 44, 650, 'translateX(-80px) rotate(-14deg)') +
  part(700, 384, 96, 236, 44, 650, 'translateX(80px) rotate(14deg)') +
  part(412, 176, 200, 168, 44, 800, 'translateY(-110px)') +
  `<rect class="eye" x="448" y="240" width="128" height="36" rx="14" fill="#E8915A"/>` +
  `<path class="draw" pathLength="1" d="M430 462 492 512 430 562" stroke="${BG}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<rect class="cursor" x="520" y="540" width="92" height="30" rx="10" fill="${BG}"/>` +
  `</svg><i class="ring"></i></div>`

const page = (title: string, body: string, look?: Look | null, n = 0, intro = true): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html${intro ? '' : ' class="static"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${tokens(look)}\n:root { --n: ${n}; }${STYLE}</style></head><body><main>${body}</main></body></html>`,
  )}`

/** One span per character (code points, so an emoji or accented letter is not split); spaces stay spaces. */
export function wordmark(text: string): string {
  const chars = [...text]
  // "GolAIm": in the system font a capital I reads as l, so the AI pair carries the brand colour.
  const ai = chars.join('').indexOf('AI')
  return chars
    .map((ch, i) => `<span aria-hidden="true"${ai >= 0 && (i === ai || i === ai + 1) ? ' class="ai"' : ''} style="--i:${i}">${ch === ' ' ? ' ' : esc(ch)}</span>`)
    .join('')
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
    0,
    false,
  )
