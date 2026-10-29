// v58 GitHub accounts: add by token in Settings (bad token refused, token never in the page or plain on disk); the
// Push dialog picks the account per repo; fetch of a private repo works only through the account's token (system
// git config off, so Git Credential Manager cannot help); a repo nobody can reach warns and links to Settings; a
// non-GitHub remote shows no picker and pushes as before; the account survives a restart.
// Needs `gh auth token` (an account with at least one private repo). Only fetches from GitHub, never pushes there.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DATA_FILE = path.join(OUT, 'run', 'data', 'github-accounts.json')
const ENV = { GIT_CONFIG_NOSYSTEM: '1', GCM_INTERACTIVE: 'never' }
const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-gh-')))
const A = path.join(BASE, 'private')
const B = path.join(BASE, 'noaccess')
const C = path.join(BASE, 'local')
const ORIGIN = path.join(BASE, 'origin.git')
const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commitIn = (cwd, msg, file, text) => {
  fs.writeFileSync(path.join(cwd, file), text)
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, 'commit', '-q', '-m', msg)
}

let TOKEN = ''
let LOGIN = ''
let PRIVATE = ''

function fixture() {
  TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
  LOGIN = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim()
  PRIVATE = execFileSync('gh', ['repo', 'list', LOGIN, '--visibility', 'private', '--limit', '50', '--json', 'nameWithOwner,diskUsage', '--jq', 'sort_by(.diskUsage) | .[0].nameWithOwner'], { encoding: 'utf8' }).trim()
  for (const [dir, url] of [[A, `https://github.com/${PRIVATE}.git`], [B, 'https://github.com/Titan-Team-Z/mobile-zt015-pdf.git']]) {
    fs.mkdirSync(dir)
    gitIn(dir, 'init', '-q', '-b', 'main')
    gitIn(dir, 'config', 'core.autocrlf', 'false')
    gitIn(dir, 'remote', 'add', 'origin', url)
    commitIn(dir, 'local work', 'a.txt', 'a\n')
  }
  execFileSync('git', ['init', '-q', '--bare', ORIGIN])
  execFileSync('git', ['--git-dir', ORIGIN, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  execFileSync('git', ['clone', '-q', ORIGIN, C], { stdio: 'ignore' })
  gitIn(C, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  gitIn(C, 'config', 'core.autocrlf', 'false')
  commitIn(C, 'init', 'a.txt', 'one\n')
  gitIn(C, 'push', '-q', '-u', 'origin', 'main')
  commitIn(C, 'feat: two', 'a.txt', 'one\ntwo\n')
}

// First visible match: every opened Log pane keeps its toolbar in the DOM.
const VIS = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((n) => n.offsetParent)`

async function ready(app) {
  const { evaluate, waitFor, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
}

async function openSettings(app) {
  await app.evaluate(`${S}.get('ui').settingsOpen = true`)
  await app.waitFor(`!!document.querySelector('[data-github-accounts]')`, 10000, 'github section')
  await app.evaluate(`document.querySelector('[data-github-accounts]').scrollIntoView({ block: 'start' })`)
  await app.sleep(400)
}

async function typeToken(app, text) {
  await app.evaluate(`(() => { const i = document.querySelector('#set-github-token'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus() })()`)
  await app.type(text)
  await app.evaluate(`document.querySelector('[data-github-add] button[type=submit]').click()`)
}

async function openRepo(app, dir, n) {
  await app.evaluate(`${W}.open('shell', ${JSON.stringify(dir)})`)
  await app.waitFor(`${W}.panes.filter((p) => p.state === 'running').length >= ${n}`, 20000, `shell ${n}`)
  await app.sleep(800)
  await app.evaluate(`${W}.openLog(${JSON.stringify(dir)})`)
  await app.waitFor(`!!${VIS('[data-refs-action=push]:not([disabled])')}`, 15000, 'push button')
}

async function openPush(app) {
  await app.evaluate(`${VIS('[data-refs-action=push]')}.click()`)
  await app.waitFor(`!!document.querySelector('[data-push-dialog] [data-push-submit]') && !document.querySelector('[data-push-dialog] [data-push-count]')?.textContent.includes('…')`, 10000, 'push dialog')
  await app.sleep(1500)
}

const closePush = async (app) => {
  await app.evaluate(`document.querySelector('[data-push-dialog]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await app.waitFor(`!document.querySelector('[data-push-dialog]')`, 5000, 'dialog closed').catch(() => {})
}

const accountText = (app) => app.evaluate(`document.querySelector('[data-push-account] [role=combobox]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)

async function pickAccount(app, label) {
  await app.evaluate(`document.querySelector('[data-push-account] [role=combobox]').click()`)
  await app.waitFor(`[...document.querySelectorAll('[role=option]')].some((o) => o.offsetParent)`, 5000, 'options')
  const picked = await app.evaluate(`(() => { const o = [...document.querySelectorAll('[role=option]')].find((x) => x.offsetParent && x.textContent.trim().startsWith(${JSON.stringify(label)})); o?.click(); return !!o })()`)
  await app.sleep(1500)
  return picked
}

async function fetchNow(app) {
  await app.evaluate(`${VIS('[data-log-branch-notice] button')}?.click()`)
  await app.sleep(200)
  await app.evaluate(`${VIS('[data-refs-action=fetch]')}.click()`)
  await app.waitFor(`!!${VIS('[data-log-branch-notice]')}`, 60000, 'fetch notice')
  return app.evaluate(`(() => { const n = ${VIS('[data-log-branch-notice]')}; return { failed: n.classList.contains('bg-st-error-soft'), text: n.textContent.replace(/\\s+/g, ' ').trim() } })()`)
}

const remoteRefs = (dir) => gitIn(dir, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin').split('\n').filter(Boolean).length

async function run(app) {
  const { evaluate, waitFor, shot, sleep } = app
  await ready(app)

  // 1. Settings: empty, bad token refused, real token added.
  await openSettings(app)
  check('Settings shows the GitHub accounts section, empty', await evaluate(`!!document.querySelector('[data-github-empty]')`))
  await shot('gh-01-settings-empty')
  await typeToken(app, 'ghp_' + 'x'.repeat(36))
  await waitFor(`!!document.querySelector('[data-github-error]')`, 20000, 'bad token error').catch(() => {})
  const bad = await evaluate(`document.querySelector('[data-github-error]')?.textContent.trim() ?? ''`)
  check('a token GitHub refuses shows an error and adds nothing', bad.includes('GitHub refused') && !(await evaluate(`!!document.querySelector('[data-github-account]')`)), bad)
  await shot('gh-02-bad-token')
  await typeToken(app, TOKEN)
  await waitFor(`!!document.querySelector('[data-github-account="${LOGIN}"]')`, 20000, 'account row').catch(() => {})
  const row = await evaluate(`(() => { const r = document.querySelector('[data-github-account="${LOGIN}"]'); return r && { def: !!r.querySelector('[data-github-default]'), text: r.textContent.replace(/\\s+/g, ' ').trim(), input: document.querySelector('#set-github-token').value } })()`)
  check('the real token adds the account as default and clears the field', !!row?.def && row.input === '', JSON.stringify(row))
  check('the token is nowhere in the page', !(await evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(TOKEN)})`)))
  const disk = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : ''
  check('github-accounts.json holds the login but not the plain token', disk.includes(LOGIN) && !disk.includes(TOKEN))
  await shot('gh-03-account-added')
  await evaluate(`${S}.get('ui').settingsOpen = false`)
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]') || ${W}.panes.length > 0`, 15000, 'workspace').catch(() => {})

  // 2. Private repo: GCM (system config off) cannot fetch; the account's token can.
  await openRepo(app, A, 1)
  await openPush(app)
  const auto = await accountText(app)
  check(`private repo: picker shows Automatic (${LOGIN})`, auto === `Automatic (${LOGIN})`, auto)
  check('private repo: no access warning', !(await evaluate(`!!document.querySelector('[data-push-account-note]')`)))
  await shot('gh-04-push-auto')
  check('picking Git Credential Manager works', await pickAccount(app, 'Git Credential Manager'))
  check('the pick is shown', (await accountText(app)) === 'Git Credential Manager', await accountText(app))
  await closePush(app)
  const sys = await fetchNow(app)
  check('fetch with Git Credential Manager (no system helper) fails', sys.failed && remoteRefs(A) === 0, sys.text)
  await shot('gh-05-fetch-system-failed')
  await openPush(app)
  check('the repo remembers Git Credential Manager', (await accountText(app)) === 'Git Credential Manager', await accountText(app))
  await pickAccount(app, 'Automatic')
  await closePush(app)
  const tok = await fetchNow(app)
  check(`fetch with ${LOGIN}'s token succeeds`, !tok.failed && remoteRefs(A) > 0, `${tok.text} | refs=${remoteRefs(A)}`)
  await shot('gh-06-fetch-token-ok')

  // 3. Repo nobody can reach: warning, failed push, link to Settings.
  await openRepo(app, B, 2)
  await openPush(app)
  const note = await evaluate(`document.querySelector('[data-push-account-note]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  check('no-access repo: warns that no account can reach it', note.includes('None of your accounts can reach Titan-Team-Z/mobile-zt015-pdf'), note)
  await shot('gh-07-push-no-access')
  await evaluate(`document.querySelector('[data-push-submit]').click()`)
  await waitFor(`!!document.querySelector('[data-push-failure]')`, 60000, 'push failure').catch(() => {})
  const fail = await evaluate(`document.querySelector('[data-push-failure]')?.textContent.trim() ?? ''`)
  check('push fails with the access message', fail.includes('no access to the repository'), fail)
  check('auth hint offers Manage accounts', await evaluate(`!!document.querySelector('[data-push-auth-hint] button')`))
  await shot('gh-08-push-auth-failed')
  await evaluate(`document.querySelector('[data-push-auth-hint] button').click()`)
  await waitFor(`!document.querySelector('[data-push-dialog]') && !!document.querySelector('[data-github-accounts]')`, 5000, 'settings from hint').catch(() => {})
  await shot('gh-08b-after-manage')
  check(
    'Manage accounts closes the dialog and opens Settings',
    await evaluate(`!document.querySelector('[data-push-dialog]') && !!document.querySelector('[data-github-accounts]')`),
    await evaluate(`JSON.stringify({ dialogs: document.querySelectorAll('[data-push-dialog]').length, settings: ${S}.get('ui').settingsOpen, section: !!document.querySelector('[data-github-accounts]') })`),
  )
  await evaluate(`${S}.get('ui').settingsOpen = false`)
  await sleep(500)

  // 4. Non-GitHub remote: no picker, push as before.
  await openRepo(app, C, 3)
  await openPush(app)
  check('local remote: no account picker', !(await evaluate(`!!document.querySelector('[data-push-account]')`)))
  await evaluate(`document.querySelector('[data-push-submit]').click()`)
  await waitFor(`!document.querySelector('[data-push-dialog]')`, 20000, 'pushed').catch(() => {})
  check('local remote: push updates it', execFileSync('git', ['--git-dir', ORIGIN, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim() === gitIn(C, 'rev-parse', 'main'))

  // 5. Light theme pass on Settings.
  await evaluate(`${S}.get('settings').theme = 'light'`)
  await openSettings(app)
  await shot('gh-09-settings-light')
  check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`))
}

async function restart() {
  const app = await launch({ keep: true, env: ENV })
  try {
    await ready(app)
    await openSettings(app)
    check('after a restart the account is still there and default', await app.evaluate(`!!document.querySelector('[data-github-account="${LOGIN}"] [data-github-default]')`))
    await app.shot('gh-10-after-restart')
  } finally {
    app.stop()
  }
}

;(async () => {
  try {
    fixture()
  } catch (e) {
    check('fixture (needs gh auth token and a private repo)', false, e.message.split('\n')[0])
    fs.writeFileSync(path.join(OUT, 'results-github-accounts.txt'), results.join('\n'))
    process.exit(0)
  }
  const app = await launch({ env: ENV })
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message.replace(TOKEN, '<token>'))
    await app.shot('gh-99-error').catch(() => {})
  } finally {
    app.stop()
  }
  await new Promise((r) => setTimeout(r, 1500))
  try {
    await restart()
  } catch (e) {
    check('restart', false, e.message)
  }
  fs.writeFileSync(path.join(OUT, 'results-github-accounts.txt'), results.join('\n'))
  try { fs.rmSync(BASE, { recursive: true, force: true }) } catch {}
  process.exit(0)
})()
