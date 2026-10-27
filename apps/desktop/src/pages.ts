import type { Look } from './appearance'
import type { Strings } from './strings'

export const RETRY_URL = 'ccm-desktop://retry'
/** Until the wordmark has landed (STYLE `--text` + letters); a faster collector still waits for it. */
export const INTRO_MS = 2450
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
  ` --on-accent:${onAccent(l.accent)}; --error:${l.dark ? '#ff453a' : '#d70015'}; color-scheme:${l.dark ? 'dark' : 'light'};`

const tokens = (look: Look | null | undefined): string =>
  look ? `:root { ${vars(look)} }` : `:root { ${vars(LIGHT)} }\n@media (prefers-color-scheme: dark) { :root { ${vars(DARK)} } }`

/*
 * Startup intro, CSS only (this page has no script and no CSP of its own): the sun lights up, both orbits draw
 * themselves, the planets land on them, then the orrery settles above the wordmark and the planets keep turning while
 * the collector starts. Timings are offsets from page load.
 */
// Reduced motion, and the error page (same mark, no intro): the finished mark, nothing moves.
const still = (scope: string): string => `
  ${scope} :is(.stage, .float, .mark, .ring, .part, .sun, .orbit, .spin, .word span, .bar, .status, .hint, .ver, body) { animation: none; }
  ${scope} .orbit { opacity: 1; stroke-dashoffset: 0; }
  ${scope} :is(.part, .sun) { opacity: 1; transform: none; }
  ${scope} .caret { animation: none; opacity: 0; }
  ${scope} .bar::after { animation: none; width: 100%; }`

const STYLE = `
* { box-sizing: border-box; }
html, body { margin: 0; overflow-x: hidden; }
html:not(.static) body { overflow: hidden; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: 40px; -webkit-app-region: drag; app-region: drag; }
body { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--canvas); color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
main { width: 100%; max-width: 760px; display: grid; gap: 16px; justify-items: center; text-align: center; }
:root { --settle: 1500ms; --text: 1680ms; --step: 40ms; --after: calc(var(--text) + var(--n) * var(--step));
  --mark: clamp(96px, 17vmin, 148px); --radius: calc(var(--mark) * .236); --word: clamp(34px, 6.4vmin, 56px); }
.stage { position: relative; width: var(--mark); height: var(--mark); animation: settle .7s cubic-bezier(.65,0,.35,1) var(--settle) both; }
.float { position: absolute; inset: 0; animation: float 4.6s ease-in-out calc(var(--settle) + 700ms) infinite; }
.mark { width: var(--mark); height: var(--mark); border-radius: var(--radius); display: block; overflow: hidden;
  box-shadow: 0 2px 4px rgb(0 0 0 / .18), 0 18px 48px rgb(0 0 0 / .18); animation: tile .5s cubic-bezier(.34,1.4,.64,1) both; }
.ring { position: absolute; inset: 0; border-radius: var(--radius); border: 2px solid #E8915A; opacity: 0; pointer-events: none;
  animation: ring .8s cubic-bezier(.2,.8,.2,1) 1400ms forwards; }
.sun { transform-box: fill-box; transform-origin: center; transform: scale(0);
  animation: light .5s cubic-bezier(.34,1.45,.64,1) 250ms forwards, glow 3.6s ease-in-out 2600ms infinite; }
.orbit { opacity: 0; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw .55s cubic-bezier(.65,0,.35,1) var(--at) forwards; }
.part { transform-box: fill-box; transform-origin: center; opacity: 0; animation: place .42s cubic-bezier(.34,1.45,.64,1) var(--at) forwards; }
.spin { transform-box: view-box; transform-origin: 512px 512px; animation: spin var(--turn) linear 1600ms infinite; }
.word { margin: 14px 0 0; font-size: var(--word); line-height: 1.15; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; display: flex; align-items: baseline; }
.word span { display: inline-block; white-space: pre; animation: rise .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--text) + var(--i) * var(--step)); }
.caret { width: 3px; height: .9em; margin-left: 4px; align-self: center; border-radius: 1.5px; background: var(--accent);
  animation: blink 1s steps(1) calc(var(--after) + 200ms) infinite both; }
.bar { position: relative; width: clamp(200px, 30vmin, 280px); height: 3px; margin-top: 18px; border-radius: 2px; overflow: hidden; background: var(--accent-soft);
  animation: fade .35s ease-out calc(var(--after) + 300ms) both; }
.bar::after { content: ""; position: absolute; inset: 0; width: 40%; border-radius: 2px; background: var(--accent); animation: slide 1.2s cubic-bezier(.45,0,.55,1) infinite; }
.status { margin: 0; color: var(--muted); font-size: 15px; animation: fade .35s ease-out calc(var(--after) + 300ms) both; }
.hint { margin: -10px 0 0; color: var(--faint); font-size: 13px; animation: fade .35s ease-out calc(var(--after) + 400ms) both; }
.ver { position: fixed; bottom: 18px; left: 0; right: 0; margin: 0; color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; text-align: center;
  animation: fade .4s ease-out calc(var(--after) + 400ms) both; }
.out body { animation: leave .28s cubic-bezier(.4,0,1,1) forwards; }
@keyframes tile { from { opacity: 0; transform: scale(.55); } to { opacity: 1; transform: none; } }
@keyframes settle { from { transform: translateY(calc(var(--mark) * .8)) scale(1.55); } to { transform: none; } }
@keyframes float { 0%, 100% { transform: none; } 50% { transform: translateY(calc(var(--mark) * -.045)); } }
@keyframes place { from { opacity: 0; transform: var(--from); } 40% { opacity: 1; } to { opacity: 1; transform: none; } }
@keyframes light { to { transform: none; } }
@keyframes glow { 0%, 100% { transform: none; } 50% { transform: scale(1.08); } }
@keyframes draw { from { opacity: 1; } to { opacity: 1; stroke-dashoffset: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes ring { 0% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(1.6); } }
@keyframes rise { from { opacity: 0; transform: translateY(.3em); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
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
const orbit = (r: number, at: number): string =>
  `<circle class="orbit" pathLength="1" cx="512" cy="512" r="${r}" stroke="${INK}" stroke-width="36" transform="rotate(-90 512 512)" style="--at:${at}ms"/>`
// A planet sits in a gap of background cut into its orbit; both turn together.
const planet = (x: number, y: number, r: number, gap: number, at: number, turn: number): string =>
  `<g class="spin" style="--turn:${turn}s"><g class="part" style="--at:${at}ms; --from:scale(0)">` +
  `<circle cx="${x}" cy="${y}" r="${gap}" fill="${BG}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/></g></g>`
const MARK =
  `<div class="stage" aria-hidden="true"><div class="float"><svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none"><rect width="1024" height="1024" fill="${BG}"/>` +
  orbit(220, 450) +
  orbit(360, 620) +
  planet(681, 371, 50, 82, 950, 18) +
  planet(174, 635, 62, 96, 1060, 34) +
  planet(635, 850, 40, 70, 1160, 34) +
  `<circle class="sun" cx="512" cy="512" r="96" fill="#E8915A"/>` +
  `</svg><i class="ring"></i></div></div>`

const page = (title: string, body: string, look?: Look | null, n = 0, intro = true): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html${intro ? '' : ' class="static"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${tokens(look)}\n:root { --n: ${n}; }${STYLE}</style></head><body><main>${body}</main></body></html>`,
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
    0,
    false,
  )
