const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const IO = path.join(OUT, 'v80-mcp')
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const psq = (s) => `'${s.replace(/'/g, "''")}'`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const same = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

async function readJson(file, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch {}
    await sleep(250)
  }
  throw new Error('no file ' + path.basename(file))
}

function request(port, token, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body))
    const headers = { 'Content-Type': 'application/json', 'Content-Length': data.length, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/mcp', headers }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => { let json; try { json = JSON.parse(text) } catch {} resolve({ status: res.statusCode, json }) })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

const tool = async (port, token, name, args) => (await request(port, token, { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } })).json?.result

;(async () => {
  fs.rmSync(IO, { recursive: true, force: true })
  fs.mkdirSync(IO, { recursive: true })
  const app = await launch()
  const { evaluate, waitFor, shot, type, key } = app
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    check('preload exposes onOrrery', await evaluate(`typeof window.ccmDesktop.onOrrery === 'function'`))
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1')`)
    await app.cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui') && !${S}.get('ui').tourOpen`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').setView('workspace')`)
    await sleep(800)

    const shellKey = await evaluate(`${W}.open('shell', ${JSON.stringify(REPO)}).key`)
    await waitFor(`${W}.panes.find(p => p.key === ${JSON.stringify(shellKey)})?.state === 'running'`, 20000, 'shell running')
    await sleep(2500)
    await evaluate(`document.querySelector('[data-pane="${shellKey}"] .xterm-helper-textarea').focus()`)
    const envFile = path.join(IO, 'env.json')
    await type(`@{api=$env:ORRERY_API; token=$env:ORRERY_TOKEN} | ConvertTo-Json | Set-Content -Encoding utf8 ${psq(envFile)}`)
    await key('Enter', 'Enter', 13)
    const env = await readJson(envFile)
    const port = Number(/^http:\/\/127\.0\.0\.1:(\d+)$/.exec(env.api ?? '')?.[1])
    const token = env.token
    check('pane env has api + token', port > 0 && /^[0-9a-f]{64}$/.test(token ?? ''))

    const list = await request(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const names = list.json?.result?.tools?.map((t) => t.name) ?? []
    check('tools/list: open_session first, then the v80 tools', names[0] === 'open_session' && ['notify_owner', 'open_in_workspace', 'who_is_editing', 'preview_layout', 'list_servers', 'free_port', 'run_app', 'run_status', 'run_log', 'device_screenshot'].every((n) => names.includes(n)), names.join(','))
    check('unauthenticated tools/call → 401', (await request(port, '', { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status === 401)
    check('unknown token → 401', (await request(port, '0'.repeat(64), { jsonrpc: '2.0', id: 3, method: 'tools/list' })).status === 401)

    const typedBefore = await evaluate(`document.activeElement?.className ?? ''`)
    const viewBefore = await evaluate(`${S}.get('ui').view`)
    const opened = await tool(port, token, 'open_in_workspace', { path: 'README.md', line: 3 })
    const file = await evaluate(`(() => { const p = ${W}.panes.find(p => p.kind === 'file'); return p ? { key: p.key, path: p.path, line: p.line } : null })()`)
    check('open_in_workspace opens the viewer at the line', opened?.structuredContent?.ok === true && same(file?.path, path.join(REPO, 'README.md')) && file?.line === 3, JSON.stringify(opened?.structuredContent))
    const inTab = await evaluate(`(() => { const w = ${W}; const t = w.tabs.find(t => JSON.stringify(t.root).includes(${JSON.stringify(shellKey)})); return !!t && JSON.stringify(t.root).includes(${JSON.stringify(file?.key ?? '-')}) })()`)
    check('viewer split next to the caller', inTab)
    await sleep(600)
    check('focus stays on the caller pane', (await evaluate(`${W}.activeKey`)) === shellKey && (await evaluate(`document.activeElement?.className ?? ''`)) === typedBefore, typedBefore)
    check('view not switched', (await evaluate(`${S}.get('ui').view`)) === viewBefore)
    const again = await tool(port, token, 'open_in_workspace', { path: path.join(REPO, 'README.md'), line: 9 })
    check('second call reuses the viewer and jumps', again?.structuredContent?.reused === true && (await evaluate(`${W}.panes.filter(p => p.kind === 'file').length`)) === 1 && (await evaluate(`${W}.panes.find(p => p.kind === 'file').line`)) === 9)
    const diff = await tool(port, token, 'open_in_workspace', { path: 'package.json', diff: true })
    check('diff opens Changes for the project', diff?.structuredContent?.ok === true && (await evaluate(`${W}.panes.some(p => p.kind === 'changes')`)), JSON.stringify(diff?.structuredContent))
    await sleep(1500)
    check('Changes did not take focus', (await evaluate(`document.activeElement?.className ?? ''`)) === typedBefore)
    await shot('v80-01-open-in-workspace')
    const outside = await tool(port, token, 'open_in_workspace', { path: '../outside.txt' })
    check('traversal refused', outside?.isError === true && outside?.structuredContent?.error === 'outside', JSON.stringify(outside?.structuredContent))
    const unc = await tool(port, token, 'open_in_workspace', { path: '\\\\127.0.0.1\\c$\\Windows\\win.ini' })
    check('UNC refused', unc?.structuredContent?.error === 'path')
    const abs = await tool(port, token, 'open_in_workspace', { path: 'C:\\Windows\\win.ini' })
    check('absolute path outside refused', abs?.structuredContent?.error === 'outside')

    const who = await tool(port, token, 'who_is_editing', { path: 'README.md' })
    check('who_is_editing answers for a repo file', who?.structuredContent?.ok === true && who?.structuredContent?.repo === true && Array.isArray(who?.structuredContent?.editors), JSON.stringify(who?.structuredContent))
    check('who_is_editing refuses outside', (await tool(port, token, 'who_is_editing', { path: '..\\x.ts' }))?.structuredContent?.error === 'outside')

    const note = await tool(port, token, 'notify_owner', { text: 'E2E note\nsecond line', level: 'attention' })
    check('notify_owner delivered with a name', note?.structuredContent?.ok === true && note?.structuredContent?.sent === true && !!note?.structuredContent?.name, JSON.stringify(note?.structuredContent))
    check('notify_owner refuses 201 chars', (await tool(port, token, 'notify_owner', { text: 'x'.repeat(201) }))?.isError === true)
    check('notify_owner refuses an unknown level', (await tool(port, token, 'notify_owner', { text: 'x', level: 'urgent' }))?.isError === true)
    const burst = []
    for (let i = 0; i < 7; i++) burst.push((await tool(port, token, 'notify_owner', { text: `burst ${i}` }))?.structuredContent)
    const sent = burst.filter((r) => r?.sent === true).length
    check('rate limit: 6 notes a minute, the rest held', sent === 5 && burst.slice(5).every((r) => r?.ok === true && r?.sent === false), JSON.stringify(burst.map((r) => r?.sent)))

    const pids = await evaluate(`${W}.panes.map(p => p.pid).filter(Boolean)`)
    await evaluate(`(() => { const w = ${W}; [...w.panes].forEach(p => w.remove(p.key)) })()`)
    const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
    let alive = pids
    for (let i = 0; i < 40 && alive.length; i++) { await sleep(250); alive = pids.filter(isAlive) }
    check('closing panes kills processes', alive.length === 0)
    check('closed pane token → 401', (await request(port, token, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).status === 401)
  } catch (e) {
    check('run', false, e.message)
    await shot('v80-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'v80-mcp-results.txt'), results.join('\n'))
    process.exit(0)
  }
})()
