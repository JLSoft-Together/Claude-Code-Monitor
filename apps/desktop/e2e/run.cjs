// Runs every workspace E2E script in turn against the dev build (or the packaged exe given as argv[2]).
// Build first: npm run build -w @ccm/web && npm run build -w @ccm/desktop. Spawns real shells, and p2 and v25 start `claude` in this repo (no prompt is sent; v25 puts an image on the clipboard).
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { OUT } = require('./cdp.cjs')
let failed = 0
for (const name of ['p2', 'p3', 'p4', 'p5', 'p6', 'csp', 'desktop-only', 'split', 'browser', 'tabs-cwd', 'tier2', 'explorer', 'v25', 'minimap', 'v27', 'extensions', 'diff', 'log', 'sidebar', 'rail', 'explorer-menu', 'split-diff', 'flutter-preview', 'run-pane', 'drawable-preview', 'file-editor', 'loose-kit', 'layout-speed', 'agent-map', 'pane-drag', 'project-panes', 'v49-open']) {
  const res = spawnSync(process.execPath, [path.join(__dirname, `${name}.cjs`), ...process.argv.slice(2)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
  process.stdout.write(`\n# ${name}\n${res.stdout}`)
  failed += (res.stdout.match(/^FAIL /gm) ?? []).length
}
console.log(`\n${failed ? failed + ' failed' : 'all passed'} — screenshots in ${OUT}`)
process.exit(failed ? 1 : 0)
