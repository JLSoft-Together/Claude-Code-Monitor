import type { Strings } from './strings'

export const RETRY_URL = 'ccm-desktop://retry'

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Same tokens as the launcher setup page so the hand-off to the dashboard does not flash.
const STYLE = `
:root { --canvas:#ececee; --surface:#fff; --line:rgb(0 0 0 / .1); --ink:#1d1d1f; --muted:#5c5c61; --accent:#0071e3; --accent-soft:rgb(0 122 255 / .12); --error:#d70015; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --canvas:#1e1e1e; --surface:#262628; --line:rgb(255 255 255 / .1); --ink:#f5f5f7; --muted:#a1a1a6; --accent:#0a84ff; --accent-soft:rgb(10 132 255 / .22); --error:#ff453a; color-scheme: dark; } }
* { box-sizing: border-box; }
html, body { margin: 0; overflow-x: hidden; }
body { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--canvas); color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
main { width: 100%; max-width: 560px; display: grid; gap: 12px; justify-items: center; text-align: center; }
h1 { margin: 0; font-size: 18px; font-weight: 600; }
p { margin: 0; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.spin { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.err { color: var(--error); font-weight: 600; }
a.btn { display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border-radius: 8px; background: var(--accent); color: #fff;
  font-weight: 600; text-decoration: none; }
a.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
pre { width: 100%; max-height: 260px; overflow: auto; margin: 0; padding: 12px; text-align: left; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--muted); font: 12px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
`

const page = (title: string, body: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`,
  )}`

export const loadingPage = (t: Strings): string =>
  page(t.appName, `<div class="spin" role="status" aria-label="${esc(t.loading)}"></div><h1>${esc(t.loading)}</h1><p>${esc(t.loadingHint)}</p>`)

export const errorPage = (t: Strings, message: string, log: string[]): string =>
  page(
    t.appName,
    `<h1>${esc(t.errorTitle)}</h1><p class="err" role="alert">${esc(message)}</p><a class="btn" href="${RETRY_URL}">${esc(t.retry)}</a>` +
      (log.length ? `<p>${esc(t.logHint)}</p><pre>${esc(log.join('\n'))}</pre>` : ''),
  )
