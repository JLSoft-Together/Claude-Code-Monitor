// v24 (2.2.0): sidebar session rows, project layouts (save / open / open on start), scripts menu.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const NAV = `document.querySelector('nav[aria-label=Projects]')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2, SHIFT = 8

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-tier2-')))
const OUTFILE = path.join(DIR, 'hello.out')
const LAYOUTS = path.join(OUT, 'run', 'data', 'layouts.json')
fs.writeFileSync(path.join(DIR, 'package.json'), JSON.stringify({ name: 'tier2-fixture', private: true, scripts: { hello: `node -e "require('fs').writeFileSync('hello.out','ok')"`, dev: 'vite' } }, null, 2))
fs.writeFileSync(path.join(DIR, 'Makefile'), 'build:\n\techo build\n')
const NAME = path.basename(DIR)
const HOME = path.basename(os.homedir())

;(async () => {
  const app = await launch()
  const { evaluate, waitFor, shot, sleep, cmd, type, key } = app
  const chord = async (k, code, vk, mods) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(300)
  }
  const rows = () => evaluate(`[...${NAV}.querySelectorAll('[data-side-row]')].map((r) => ({ key: r.dataset.sidePane, title: r.closest('[data-rail-row]').querySelector('[data-rail-first]').textContent.trim(), second: r.closest('[data-rail-row]').querySelector('[data-rail-second]').textContent.trim(), current: r.getAttribute('aria-current') }))`)
  const groupNames = () => evaluate(`[...${NAV}.querySelectorAll('section h3')].map((h) => h.textContent.trim())`)
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')

    // --- Sidebar rows ---
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)}, undefined, { tab: true })`)
    await evaluate(`${W}.open('shell', undefined, undefined, { tab: true })`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)}, undefined, { tab: true })`)
    await waitFor(`${W}.panes.length === 3 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'three shells')
    await sleep(1200)
    check('sidebar groups by project folder', JSON.stringify(await groupNames()) === JSON.stringify([NAME, HOME]), JSON.stringify(await groupNames()))
    let list = await rows()
    check('one row per pane', list.length === 3, String(list.length))
    check('shell row title = folder name', list[0]?.title === NAME && list[2]?.title === HOME, JSON.stringify(list.map((r) => r.title)))
    check('row second line names the state', list.every((r) => !!r.second), JSON.stringify(list.map((r) => r.second)))
    check('row has an icon + accessible label', await evaluate(`(() => { const r = ${NAV}.querySelector('[data-side-row]'); return !!r.closest('[data-rail-row]').querySelector('svg') && !!r.getAttribute('aria-label') })()`))
    check('row height ≥ 40px (two lines)', await evaluate(`Math.round(${NAV}.querySelector('[data-rail-row]').getBoundingClientRect().height)`) >= 40)
    await evaluate(`${NAV}.querySelectorAll('[data-side-row]')[1].click()`)
    await sleep(300)
    const p2 = await evaluate(`${W}.panes[2].key`)
    check('click row activates its pane', (await evaluate(`${W}.activeKey`)) === p2)
    list = await rows()
    check('active row aria-current', list.find((r) => r.current === 'true')?.key === p2)
    check('active project group outlined', await evaluate(`[...${NAV}.querySelectorAll('section[data-group]')].map((s) => s.className.includes('outline-line-strong'))`).then((a) => a[0] === true && a[1] === false))

    // Keyboard: header ← collapses, → expands, ↓ moves into rows, Enter activates.
    await evaluate(`${NAV}.querySelector('[data-side-head]').focus()`)
    await chord('ArrowLeft', 'ArrowLeft', 37, 0)
    check('← on header collapses the project', await evaluate(`${NAV}.querySelector('[data-side-head]').getAttribute('aria-expanded')`) === 'false')
    await chord('ArrowRight', 'ArrowRight', 39, 0)
    check('→ expands it again', await evaluate(`${NAV}.querySelector('[data-side-head]').getAttribute('aria-expanded')`) === 'true')
    await chord('ArrowDown', 'ArrowDown', 40, 0)
    check('↓ moves to the first row', await evaluate(`document.activeElement?.dataset.sidePane`) === (await evaluate(`${W}.panes[0].key`)))
    await key('Enter', 'Enter', 13)
    await sleep(300)
    check('Enter activates the row', (await evaluate(`${W}.activeKey`)) === (await evaluate(`${W}.panes[0].key`)))
    await evaluate(`${W}.activate('${p2}')`)
    await sleep(400)
    await shot('tier2-01-sidebar-dark')
    await evaluate(`${S}.get('settings').theme = 'light'`)
    await sleep(600)
    await shot('tier2-02-sidebar-light')
    await evaluate(`${S}.get('settings').theme = 'dark'`)
    await sleep(300)

    // --- Scripts menu ---
    const first = await evaluate(`${W}.panes[0].key`)
    await evaluate(`${W}.activate('${first}')`)
    await sleep(300)
    await evaluate(`document.querySelector('[data-pane="${first}"] [data-scripts]').click()`)
    await waitFor(`!!document.querySelector('[data-scripts-dialog] [data-script="hello"]')`, 8000, 'scripts listed')
    const names = await evaluate(`[...document.querySelectorAll('[data-scripts-dialog] [data-script]')].map((o) => o.dataset.script)`)
    check('scripts list package.json + Makefile', ['hello', 'dev', 'build'].every((n) => names.includes(n)), JSON.stringify(names))
    const heads = await evaluate(`document.querySelector('[data-scripts-dialog]').innerText`)
    check('grouped by source with command shown', /package\.json/.test(heads) && /Makefile/.test(heads) && /writeFileSync/.test(heads), heads.split(String.fromCharCode(10))[0])
    await shot('tier2-03-scripts-menu')
    await type('hel')
    await sleep(300)
    check('fuzzy filter keeps hello first', (await evaluate(`document.querySelector('[data-scripts-dialog] [role=option][aria-selected=true]')?.dataset.script`)) === 'hello')
    const panesBefore = await evaluate(`${W}.panes.length`)
    await key('Enter', 'Enter', 13)
    const runKey = await waitFor(`${W}.panes.length === ${panesBefore + 1} && ${W}.panes.at(-1).key`, 5000, 'script tab')
    check('Enter opens a new shell tab running the script', (await evaluate(`${W}.panes.at(-1).command`)) === 'npm run hello' && (await evaluate(`${W}.activeTab.root.pane`)) === runKey)
    await waitFor(`!${W}.panes.at(-1).pendingCommand`, 15000, 'command typed').catch(() => {})
    let ran = false
    for (let i = 0; i < 60 && !ran; i++) { await sleep(500); ran = fs.existsSync(OUTFILE) }
    check('npm run hello actually ran in the project folder', ran)
    check('shell marked as having run a command', await evaluate(`${W}.panes.at(-1).ranCommand === true`))
    list = await rows()
    check('sidebar row titled by the script', list.some((r) => r.key === runKey && r.title === 'npm run hello'), JSON.stringify(list.map((r) => r.title)))
    check('recent script remembered', (await evaluate(`localStorage.getItem('ccm.workspace.recentScripts') ?? ''`)).includes('npm run hello'))

    // Quick open with ">" switches to the scripts menu.
    await evaluate(`document.querySelector('[data-pane="${first}"] .xterm-helper-textarea').focus()`)
    await chord('P', 'KeyP', 80, CTRL | SHIFT)
    await waitFor(`!!document.querySelector('[role=dialog] input[role=combobox]')`, 5000, 'quick open')
    await type('>')
    await waitFor(`!!document.querySelector('[data-scripts-dialog]')`, 5000, 'scripts via >').catch(() => {})
    check('Quick open ">" opens the scripts menu', await evaluate(`!!document.querySelector('[data-scripts-dialog]')`))
    await chord('Escape', 'Escape', 27, 0)
    await sleep(400)

    // --- Layouts ---
    await evaluate(`${W}.activate('${first}')`)
    await sleep(300)
    await evaluate(`${NAV}.querySelector('section[data-group] [data-side-menu]').click()`)
    await waitFor(`!!document.querySelector('[data-project-menu] [data-menu="save"]')`, 5000, 'project menu')
    await evaluate(`document.querySelector('[data-project-menu] [data-menu="save"]').click()`)
    await waitFor(`!!document.querySelector('[data-layouts-dialog] [data-layout-name]')`, 5000, 'layouts dialog')
    await sleep(300)
    await type('E2E layout')
    await evaluate(`document.querySelector('[data-layouts-dialog] [data-layout-save]').click()`)
    await waitFor(`!!document.querySelector('[data-layouts-dialog] [data-layout="E2E layout"]')`, 5000, 'saved row').catch(() => {})
    check('layout saved and listed', await evaluate(`!!document.querySelector('[data-layouts-dialog] [data-layout="E2E layout"]')`), await evaluate(`document.querySelector('[data-layouts-dialog]')?.innerText.slice(0, 300) ?? 'no dialog'`))
    let saved = []
    try { saved = JSON.parse(fs.readFileSync(LAYOUTS, 'utf8')) } catch {}
    const tabsInLayout = saved[0]?.tabs?.length ?? 0
    check('layouts.json keyed by project, 3 tabs, no session ids', saved.length === 1 && saved[0].project.toLowerCase() === DIR.toLowerCase() && tabsInLayout === 3 && !JSON.stringify(saved).includes('sessionId'), JSON.stringify(saved).slice(0, 120))
    await evaluate(`document.querySelector('[data-layouts-dialog] [data-layout-start]').click()`)
    await sleep(500)
    try { saved = JSON.parse(fs.readFileSync(LAYOUTS, 'utf8')) } catch {}
    check('open-on-start flag stored', saved[0]?.openOnStart === true)
    await shot('tier2-04-layouts-dialog')
    await chord('Escape', 'Escape', 27, 0)
    await sleep(400)

    // Drop the project's extra tabs (keep the first shell), then open the layout from the sidebar menu.
    await evaluate(`${W}.panes.filter((p) => p.cwd?.toLowerCase() === ${JSON.stringify(DIR.toLowerCase())} && p.key !== '${first}').forEach((p) => ${W}.remove(p.key))`)
    await sleep(500)
    const tabsBefore = await evaluate(`${W}.tabs.length`)
    await evaluate(`${NAV}.querySelector('section[data-group] [data-side-menu]').click()`)
    await waitFor(`!!document.querySelector('[data-project-menu] [data-menu="layout"]')`, 5000, 'layout in menu')
    await sleep(300)
    await shot('tier2-05-layouts-menu')
    await evaluate(`document.querySelector('[data-project-menu] [data-menu="layout"]').click()`)
    await sleep(800)
    check('opening the layout adds its tabs', (await evaluate(`${W}.tabs.length`)) === tabsBefore + tabsInLayout, `${tabsBefore} → ${await evaluate(`${W}.tabs.length`)}`)
    await waitFor(`${W}.panes.every((p) => p.state === 'running')`, 25000, 'layout shells').catch(() => {})
    check('layout panes are shells (no agent launched)', await evaluate(`${W}.panes.every((p) => p.preset === 'shell')`))

    // Open on start: first terminal of the project in a fresh window session brings the layout along.
    await evaluate(`${W}.panes.filter((p) => p.cwd?.toLowerCase() === ${JSON.stringify(DIR.toLowerCase())}).forEach((p) => ${W}.remove(p.key))`)
    await evaluate(`sessionStorage.removeItem('ccm.workspace.startedProjects')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded (2)')
    await evaluate(`${S}.get('ui').setView('workspace')`)
    await sleep(800)
    const tabsAfterReload = await evaluate(`${W}.tabs.length`)
    // The first terminal joins a tab of the project if one is still open (v48), else takes its own.
    const ownTab = await evaluate(`(() => { const p = ${W}.open('shell', ${JSON.stringify(DIR)}); return ${W}.tabOf(p.key).root.pane === p.key ? 1 : 0 })()`)
    await waitFor(`${W}.tabs.length >= ${tabsAfterReload + ownTab + tabsInLayout}`, 15000, 'start layout').catch(() => {})
    check('open-on-start layout opens with the first terminal of the project', (await evaluate(`${W}.tabs.length`)) === tabsAfterReload + ownTab + tabsInLayout, `${tabsAfterReload} + ${ownTab} → ${await evaluate(`${W}.tabs.length`)}`)
    await sleep(1500)
    await shot('tier2-06-after-start-layout')
  } catch (e) {
    check('run', false, e.message)
    await shot('tier2-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-tier2.txt'), results.join('\n'))
    fs.rmSync(DIR, { recursive: true, force: true })
    process.exit(0)
  }
})()
