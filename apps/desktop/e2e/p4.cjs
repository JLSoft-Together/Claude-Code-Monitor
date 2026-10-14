// E2E for workspace P4: live branch label, worktree list/create/remove guards.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const base = path.join(OUT, 'repo-sandbox')
fs.rmSync(base, { recursive: true, force: true })
const repo = path.join(base, 'demo')
fs.mkdirSync(repo, { recursive: true })
const g = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' }).toString()
g('init', '-b', 'main')
g('config', 'user.email', 'e2e@local')
g('config', 'user.name', 'e2e')
fs.writeFileSync(path.join(repo, 'a.txt'), 'hi')
g('add', '.')
g('commit', '-m', 'init')
const wtDir = path.join(base, 'demo-wt', 'feat-e2e')

;(async () => {
  const app = await launch()
  const { evaluate, waitFor, shot, sleep, type, key } = app
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell')`)
    await app.cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(repo)})`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'pane running')
    const b0 = await waitFor(`${W}.panes[0].branch`, 10000, 'branch').catch(() => null)
    check('branch shown for repo pane', b0 === 'main', String(b0))

    g('switch', '-c', 'live-switch')
    const b1 = await waitFor(`${W}.panes[0].branch === 'live-switch' && ${W}.panes[0].branch`, 8000, 'branch change').catch(() => null)
    check('branch label follows checkout', b1 === 'live-switch', String(b1))

    await sleep(500)
    await evaluate(`[...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b => b.title === 'Worktrees').click()`)
    await waitFor(`!!document.querySelector('#wt-branch')`, 10000, 'worktree menu')
    const rows = await evaluate(`[...document.querySelectorAll('[role=dialog] li')].map(l => l.innerText.replace(/\\s+/g,' '))`)
    check('worktree list shows main checkout', rows.length === 1 && /live-switch/.test(rows[0]) && /primary/.test(rows[0]), JSON.stringify(rows))
    await shot('p4-01-menu')

    // Invalid branch → error, nothing created.
    await evaluate(`document.querySelector('#wt-branch').focus()`)
    await type('-bad name')
    await key('Enter', 'Enter', 13)
    await waitFor(`!!document.querySelector('[role=dialog] [role=alert]')`, 10000, 'branch error')
    check('invalid branch rejected', !fs.existsSync(path.join(base, 'demo-wt')), await evaluate(`document.querySelector('[role=dialog] [role=alert]').innerText`))

    await evaluate(`(() => { const i = document.querySelector('#wt-branch'); i.value = ''; i.dispatchEvent(new Event('input')) })()`)
    await type('feat/e2e')
    await key('Enter', 'Enter', 13)
    await waitFor(`${W}.tabs.length === 2 && ${W}.panes[1]?.state === 'running'`, 30000, 'worktree tab')
    check('worktree created and opened in new tab', fs.existsSync(path.join(wtDir, 'a.txt')), await evaluate(`${W}.panes[1].cwd`))
    const b2 = await waitFor(`${W}.panes[1].branch`, 10000, 'wt branch').catch(() => null)
    check('new pane on worktree branch', b2 === 'feat/e2e', String(b2))

    // Remove while a terminal runs inside → refused.
    const removeVia = async (label) => {
      await evaluate(`${W}.activateTab(${W}.tabs[0].key)`)
      await sleep(400)
      await evaluate(`[...document.querySelectorAll('button[aria-haspopup=dialog]')].filter(b => b.title === 'Worktrees' && b.offsetParent)[0].click()`)
      await waitFor(`document.querySelectorAll('[role=dialog] li').length === 2`, 10000, 'menu with 2 rows ' + label)
      await evaluate(`[...document.querySelectorAll('[role=dialog] li')][1].querySelector('button[aria-label^="Remove"]').click()`)
      await sleep(200)
      await evaluate(`document.querySelector('[role=alertdialog] .ccm-btn-danger').click()`)
      await sleep(2500)
      return evaluate(`document.querySelector('[role=dialog] [role=alert]')?.innerText ?? null`)
    }
    const busyMsg = await removeVia('busy')
    check('remove refused while terminal inside', fs.existsSync(wtDir) && /terminal/i.test(busyMsg ?? ''), String(busyMsg))
    await key('Escape', 'Escape', 27)

    // Close that tab, make it dirty → refused; clean → removed.
    await evaluate(`${W}.closeTab(${W}.tabs[1].key)`)
    await sleep(1500)
    fs.writeFileSync(path.join(wtDir, 'dirty.txt'), 'x')
    const dirtyMsg = await removeVia('dirty')
    check('remove refused when dirty', fs.existsSync(wtDir) && /uncommitted/i.test(dirtyMsg ?? ''), String(dirtyMsg))
    await key('Escape', 'Escape', 27)
    fs.rmSync(path.join(wtDir, 'dirty.txt'))
    const okMsg = await removeVia('clean')
    check('clean worktree removed', !fs.existsSync(wtDir) && okMsg === null, String(okMsg))
    const branches = g('branch', '--list')
    check('branch kept after remove', /feat\/e2e/.test(branches))
    await shot('p4-02-after')
    const mainTrash = await evaluate(`[...document.querySelectorAll('[role=dialog] li')][0]?.querySelector('button[aria-label^="Remove"]') ? 'has' : 'none'`)
    check('main checkout has no remove button', mainTrash === 'none')
  } catch (e) {
    check('run', false, e.message)
    await shot('p4-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-p4.txt'), results.join('\n'))
    process.exit(0)
  }
})()
