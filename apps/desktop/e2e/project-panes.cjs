// v48 §6: terminals opened from "+" join their project's tab. 3 panes = left + right stacked, 4 = 2 × 2 grid, every pane usable.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-group-'))
const OTHER = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-other-'))
const norm = (d) => d.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  const { evaluate, waitFor, shot, sleep, cmd } = app

  /** Visible panes in canvas order with their rects. */
  const paneRects = async () =>
    JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-pane]')].map((el) => ({ key: el.dataset.pane, r: el.getBoundingClientRect() })).filter((p) => p.r.width > 0).map((p) => ({ key: p.key, x: Math.round(p.r.left), y: Math.round(p.r.top), w: Math.round(p.r.width), h: Math.round(p.r.height) })))`))
  const overlaps = (list) => list.some((a, i) => list.some((b, j) => i < j && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1))

  /** "+" → picker → the project's folder row, as a user would. */
  async function plusInProject() {
    await evaluate(`[...document.querySelectorAll('button[aria-haspopup=dialog]')].find((b) => /^(New terminal or tab|Terminal hoặc tab mới|New tab|Tab mới)$/.test(b.getAttribute('aria-label') ?? '')).click()`)
    await waitFor(`!!document.querySelector('[role=dialog] [data-launch-row][title]')`, 5000, 'picker rows')
    const clicked = await evaluate(`(() => { const row = [...document.querySelectorAll('[role=dialog] [data-launch-row][title]')].find((b) => b.title.replace(/[\\\\/]+$/, '').replace(/\\//g, '\\\\').toLowerCase() === ${JSON.stringify(norm(DIR))}); row?.click(); return !!row })()`)
    if (!clicked) throw new Error('project row missing in the picker')
  }

  async function grow(n) {
    await plusInProject()
    await waitFor(`${W}.panes.length === ${n} && ${W}.panes.every((p) => p.state === 'running')`, 20000, `${n} shells running`)
    await sleep(700)
  }

  async function usable(n, label) {
    const list = await paneRects()
    const canvas = JSON.parse(await evaluate(`JSON.stringify(document.querySelector('[data-pane]').offsetParent.getBoundingClientRect())`))
    check(`${label}: one tab, ${n} panes on screen`, (await evaluate(`${W}.tabs.length`)) === 1 && list.length === n, `${await evaluate(`${W}.tabs.length`)} tabs, ${list.length} visible`)
    check(`${label}: no pane overlaps another`, !overlaps(list), JSON.stringify(list))
    check(`${label}: every pane ≥ 200 × 120 px`, list.every((p) => p.w >= 200 && p.h >= 120), JSON.stringify(list.map((p) => [p.w, p.h])))
    const covered = list.reduce((s, p) => s + p.w * p.h, 0) / (canvas.width * canvas.height)
    check(`${label}: panes fill the canvas`, covered > 0.95, covered.toFixed(3))
    check(`${label}: newest pane focused`, (await evaluate(`${W}.activeKey`)) === (await evaluate(`${W}.panes.at(-1).key`)))
    return list
  }

  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.workspace.explorerOpen','0'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.tips', JSON.stringify({ off: true, learned: [], shown: {} }))`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'first shell')
    await sleep(600)

    await grow(2)
    const two = await usable(2, '2 terminals')
    check('2 terminals: side by side', two.length === 2 && two[0].y === two[1].y && two[0].x !== two[1].x)

    await grow(3)
    const three = await usable(3, '3 terminals')
    const lefts3 = [...new Set(three.map((p) => p.x))]
    const maxH = Math.max(...three.map((p) => p.h))
    const tall = three.filter((p) => p.h === maxH)
    check('3 terminals: one full-height column + two stacked', lefts3.length === 2 && tall.length === 1 && three.filter((p) => p.x !== tall[0].x).length === 2, JSON.stringify(three))
    await shot('project-panes-3')

    await grow(4)
    const four = await usable(4, '4 terminals')
    const lefts4 = [...new Set(four.map((p) => p.x))]
    const tops4 = [...new Set(four.map((p) => p.y))]
    check('4 terminals: 2 × 2 grid', lefts4.length === 2 && tops4.length === 2, JSON.stringify(four))
    check('4 terminals: equal quarters', Math.max(...four.map((p) => p.w)) - Math.min(...four.map((p) => p.w)) <= 2 && Math.max(...four.map((p) => p.h)) - Math.min(...four.map((p) => p.h)) <= 2, JSON.stringify(four.map((p) => [p.w, p.h])))
    check('4 terminals: all still running, none restarted', await evaluate(`${W}.panes.length === 4 && ${W}.panes.every((p) => p.state === 'running')`))
    await shot('project-panes-4')

    // Another project gets its own tab; "+" back in the first project joins the 4-pane group, not the other tab.
    await evaluate(`${W}.open('shell', ${JSON.stringify(OTHER)})`)
    await waitFor(`${W}.panes.length === 5`, 10000, 'other project shell')
    check('another project opens its own tab', (await evaluate(`${W}.tabs.length`)) === 2)
    const firstTab = await evaluate(`${W}.tabs[0].key`)
    await evaluate(`${W}.activateTab('${firstTab}')`)
    await sleep(500)
    await grow(6)
    check('5th terminal of the project joins its group', await evaluate(`${W}.tabs.length === 2 && ${W}.tabOf(${W}.panes.at(-1).key).key === '${firstTab}'`))
    const five = await paneRects()
    check('5 terminals: no overlap, all usable', five.length === 5 && !overlaps(five) && five.every((p) => p.w >= 200 && p.h >= 120), JSON.stringify(five.map((p) => [p.w, p.h])))
    await shot('project-panes-5')
  } catch (e) {
    check('run', false, e.message)
    await shot('project-panes-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-project-panes.txt'), results.join('\n'))
    for (const d of [DIR, OTHER]) fs.rmSync(d, { recursive: true, force: true })
    process.exit(0)
  }
})()
