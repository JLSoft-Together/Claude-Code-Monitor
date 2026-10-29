// v54 Push: ↑N in Explorer → Changes and Push… on the Log Branches toolbar open the Push dialog (outgoing commits,
// target, exact command); pushing to a local bare remote updates it; a diverged remote is reported in the dialog.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-push-')))
const ORIGIN = path.join(BASE, 'origin.git')
const DIR = path.join(BASE, 'repo')
const OTHER = path.join(BASE, 'other')
const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const git = (...args) => gitIn(DIR, ...args)
const commitIn = (cwd, msg, file, text) => {
  fs.writeFileSync(path.join(cwd, file), text)
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, 'commit', '-q', '-m', msg)
}
const remoteHash = (ref) => execFileSync('git', ['--git-dir', ORIGIN, 'rev-parse', ref], { encoding: 'utf8' }).trim()

function fixture() {
  execFileSync('git', ['init', '-q', '--bare', ORIGIN])
  execFileSync('git', ['--git-dir', ORIGIN, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  execFileSync('git', ['clone', '-q', ORIGIN, DIR], { stdio: 'ignore' })
  git('symbolic-ref', 'HEAD', 'refs/heads/main')
  git('config', 'core.autocrlf', 'false')
  commitIn(DIR, 'init', 'a.txt', 'one\n')
  git('push', '-q', '-u', 'origin', 'main')
  commitIn(DIR, 'feat: two', 'a.txt', 'one\ntwo\n')
  commitIn(DIR, 'feat: three', 'b.txt', 'b\n')
  execFileSync('git', ['clone', '-q', ORIGIN, OTHER], { stdio: 'ignore' })
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.workspace.explorerOpen','1'); localStorage.removeItem('ccm.workspace.logCols')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)

  // Explorer → Changes: ↑2 next to the branch.
  await waitFor(`!!document.querySelector('[data-explorer] [data-view=changes]:not([disabled])')`, 10000, 'changes tab').catch(() => {})
  await evaluate(`document.querySelector('[data-explorer] [data-view=changes]').click()`)
  await waitFor(`document.querySelector('[data-explorer-push]')?.textContent.trim() === '2'`, 10000, 'push chip').catch(() => {})
  check('Changes header shows ↑2 for two unpushed commits', (await evaluate(`document.querySelector('[data-explorer-push]')?.textContent.trim()`)) === '2', await evaluate(`document.querySelector('[data-explorer-push]')?.getAttribute('title')`))
  await shot('push-01-explorer-chip')

  await evaluate(`document.querySelector('[data-explorer-push]').click()`)
  await waitFor(`document.querySelectorAll('[data-push-commits] li').length === 2`, 10000, 'outgoing list').catch(() => {})
  const dlg = await evaluate(`(() => { const d = document.querySelector('[data-push-dialog]'); return d && { route: d.querySelector('[data-push-route]')?.textContent.trim(), rows: [...d.querySelectorAll('[data-push-commits] li')].map((l) => l.textContent.replace(/\\s+/g, ' ').trim()), command: d.querySelector('[data-push-command]')?.textContent.trim(), upstream: d.querySelector('[data-push-upstream]')?.checked, submit: d.querySelector('[data-push-submit]')?.textContent.trim(), focus: document.activeElement?.hasAttribute('data-push-submit') } })()`)
  check('dialog lists both outgoing commits, newest first', dlg?.rows.length === 2 && dlg.rows[0].includes('feat: three') && dlg.rows[1].includes('feat: two'), JSON.stringify(dlg?.rows))
  check('dialog shows route and exact command', dlg?.route === 'main → origin/main' && dlg?.command === 'git push --porcelain origin refs/heads/main:refs/heads/main', `${dlg?.route} | ${dlg?.command}`)
  check('upstream already set: -u off; Push button counts and has focus', dlg?.upstream === false && dlg?.submit === 'Push 2 commits' && dlg?.focus, JSON.stringify(dlg))
  await shot('push-02-dialog')
  await evaluate(`document.querySelector('[data-push-upstream]').click()`)
  check('ticking upstream adds --set-upstream to the command', (await evaluate(`document.querySelector('[data-push-command]').textContent`)).includes('--set-upstream'))
  await evaluate(`document.querySelector('[data-push-upstream]').click()`)

  await evaluate(`document.querySelector('[data-push-submit]').click()`)
  await waitFor(`!document.querySelector('[data-push-dialog]')`, 20000, 'dialog closed').catch(() => {})
  check('push updates the remote', remoteHash('refs/heads/main') === git('rev-parse', 'main'))
  await waitFor(`!document.querySelector('[data-explorer-push]')?.textContent.trim()`, 10000, 'chip cleared').catch(() => {})
  check('↑ count clears after the push', !(await evaluate(`document.querySelector('[data-explorer-push]')?.textContent.trim()`)))
  check('Explorer reports the push', (await evaluate(`document.querySelector('[data-explorer] [role=status]')?.textContent ?? ''`)).includes('Pushed main → origin/main'))
  await shot('push-03-pushed')

  // Log toolbar: new branch → new remote branch with -u on; then a diverged main → non-ff kept in the dialog.
  git('checkout', '-q', '-b', 'feature/new')
  commitIn(DIR, 'feat: new branch', 'c.txt', 'c\n')
  await evaluate(`${W}.openLog(${JSON.stringify(DIR)})`)
  await waitFor(`!!document.querySelector('[data-refs-action=push]:not([disabled])')`, 10000, 'push button').catch(() => {})
  check('Branches toolbar has an enabled Push… button', await evaluate(`!!document.querySelector('[data-refs-action=push]:not([disabled])')`))
  await evaluate(`document.querySelector('[data-refs-action=push]').click()`)
  await waitFor(`!!document.querySelector('[data-push-new]')`, 10000, 'new branch badge').catch(() => {})
  const nb = await evaluate(`(() => { const d = document.querySelector('[data-push-dialog]'); return d && { badge: d.querySelector('[data-push-new]')?.textContent.trim(), rows: d.querySelectorAll('[data-push-commits] li').length, upstream: d.querySelector('[data-push-upstream]')?.checked, command: d.querySelector('[data-push-command]')?.textContent.trim() } })()`)
  check('new branch: badge, one commit, -u on by default', nb?.badge === 'New branch on origin' && nb.rows === 1 && nb.upstream === true && nb.command === 'git push --porcelain --set-upstream origin refs/heads/feature/new:refs/heads/feature/new', JSON.stringify(nb))
  await shot('push-04-new-branch')
  await evaluate(`document.querySelector('[data-push-submit]').click()`)
  await waitFor(`!document.querySelector('[data-push-dialog]')`, 20000, 'closed').catch(() => {})
  check('new branch exists on the remote and tracks it', remoteHash('refs/heads/feature/new') === git('rev-parse', 'HEAD') && git('rev-parse', '--abbrev-ref', '@{upstream}') === 'origin/feature/new')

  git('checkout', '-q', 'main')
  gitIn(OTHER, 'pull', '-q', '--ff-only')
  commitIn(OTHER, 'remote only', 'r.txt', 'r\n')
  gitIn(OTHER, 'push', '-q', 'origin', 'main')
  commitIn(DIR, 'local only', 'l.txt', 'l\n')
  await sleep(800)
  await evaluate(`document.querySelector('[data-refs-action=push]').click()`)
  await waitFor(`document.querySelectorAll('[data-push-commits] li').length === 1`, 10000, 'diverged list').catch(() => {})
  await evaluate(`document.querySelector('[data-push-submit]').click()`)
  await waitFor(`!!document.querySelector('[data-push-failure]')`, 20000, 'failure').catch(() => {})
  check('rejected push stays in the dialog with a non-ff hint', (await evaluate(`document.querySelector('[data-push-failure]')?.textContent ?? ''`)).includes('Update or fetch'), await evaluate(`document.querySelector('[data-push-failure]')?.textContent`))
  await shot('push-05-rejected')
  await evaluate(`document.querySelector('[data-push-dialog]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitFor(`!document.querySelector('[data-push-dialog]')`, 5000, 'esc').catch(() => {})
  check('Esc closes the dialog', !(await evaluate(`!!document.querySelector('[data-push-dialog]')`)))

  // Light theme pass for the dialog.
  await evaluate(`${S}.get('settings').theme = 'light'`)
  await evaluate(`document.querySelector('[data-refs-action=push]').click()`)
  await waitFor(`!!document.querySelector('[data-push-commits]')`, 10000, 'light dialog').catch(() => {})
  await sleep(300)
  await shot('push-06-light')
  check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`))
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('push-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-push.txt'), results.join('\n'))
    try { fs.rmSync(BASE, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
