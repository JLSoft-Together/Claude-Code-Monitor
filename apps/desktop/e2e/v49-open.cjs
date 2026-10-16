const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const IO = path.join(OUT, 'v49')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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

function request(port, { method = 'POST', pathname = '/mcp', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => { let json; try { json = JSON.parse(text) } catch {} resolve({ status: res.statusCode, json }) })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const call = (port, token, args) =>
  request(port, { headers: { Authorization: `Bearer ${token}` }, body: { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'open_session', arguments: args } } }).then((r) => r.json?.result?.structuredContent)

const fireLink = (link) => {
  const p = spawn(path.join(REPO, 'node_modules/electron/dist/electron.exe'), [`--user-data-dir=${path.join(OUT, 'run', 'ud')}`, path.join(REPO, 'apps/desktop/stage'), link], { stdio: 'ignore' })
  return new Promise((resolve) => { p.on('exit', resolve); setTimeout(() => { try { p.kill() } catch {} resolve() }, 20000) })
}

;(async () => {
  fs.rmSync(IO, { recursive: true, force: true })
  fs.mkdirSync(IO, { recursive: true })
  const app = await launch()
  const { evaluate, waitFor, shot, type, key } = app
  let childSession = null
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    check('preload exposes onPaneOpen', await evaluate(`typeof window.ccmDesktop.onPaneOpen === 'function'`))
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1')`)
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
    const callFile = path.join(IO, 'call.json')
    const line = [
      `@{api=$env:GOLAIM_API; token=$env:GOLAIM_TOKEN; cfg=$env:GOLAIM_MCP_CONFIG; cfgOk=[bool](Test-Path $env:GOLAIM_MCP_CONFIG); ccm=@(Get-ChildItem Env: | Where-Object Name -like 'CCM_*').Count} | ConvertTo-Json | Set-Content -Encoding utf8 ${psq(envFile)}`,
      `$b = @{jsonrpc='2.0';id=1;method='tools/call';params=@{name='open_session';arguments=@{agent='claude';prompt='E2E prefill check';name='E2E Child'}}} | ConvertTo-Json -Depth 6 -Compress`,
      `(Invoke-RestMethod -Method Post -Uri "$env:GOLAIM_API/mcp" -Headers @{Authorization="Bearer $env:GOLAIM_TOKEN"} -ContentType 'application/json' -Body $b) | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 ${psq(callFile)}`,
    ].join('; ')
    await type(line)
    await key('Enter', 'Enter', 13)

    const env = await readJson(envFile)
    const port = Number(/^http:\/\/127\.0\.0\.1:(\d+)$/.exec(env.api ?? '')?.[1])
    check('pane env GOLAIM_API is loopback', port > 0, env.api)
    check('pane env GOLAIM_TOKEN is 64 hex', /^[0-9a-f]{64}$/.test(env.token ?? ''))
    check('pane env GOLAIM_MCP_CONFIG written', env.cfgOk === true, env.cfg)
    check('pane env has no CCM_* vars', env.ccm === 0, String(env.ccm))
    const cfg = JSON.parse(fs.readFileSync(env.cfg, 'utf8'))
    check('mcp config uses env expansion', cfg.mcpServers?.golaim?.url === '${GOLAIM_API}/mcp' && cfg.mcpServers.golaim.headers?.Authorization === 'Bearer ${GOLAIM_TOKEN}')

    const res = await readJson(callFile, 30000)
    const out = res.result?.structuredContent
    check('open_session from a pane succeeds', out?.ok === true, JSON.stringify(out))
    check('returns a claude session id', UUID.test(out?.sessionId ?? ''), out?.sessionId)
    check('defaults cwd to the calling pane', same(out?.cwd, REPO), out?.cwd)
    check('reports the prefilled prompt', out?.prompt === true)
    childSession = out?.sessionId ?? null

    const placed = await evaluate(`(() => {
      const w = ${W}; const child = w.panes.find(p => p.preset === 'claude')
      const tab = w.tabs.find(t => JSON.stringify(t.root).includes(${JSON.stringify(shellKey)}))
      return { child: child?.key, inTab: !!child && !!tab && JSON.stringify(tab.root).includes(child.key), active: w.activeKey, tabs: w.tabs.length }
    })()`)
    check('new pane split next to the caller', placed.inTab, JSON.stringify(placed))
    check('focus stays on the caller', placed.active === shellKey, placed.active)
    const childKey = placed.child
    await waitFor(`${W}.panes.find(p => p.key === ${JSON.stringify(childKey)})?.state === 'running'`, 20000, 'child running')
    check('child pane running', true)
    check('ticket cleared after spawn', !(await evaluate(`${W}.panes.find(p => p.key === ${JSON.stringify(childKey)})?.openTicket`)))
    await shot('v49-01-split')

    const linked = await waitFor(`${W}.panes.find(p => p.key === ${JSON.stringify(childKey)})?.terminalId`, 60000, 'child linked').catch(() => null)
    check('child linked to a monitor session', !!linked, String(linked))
    const agentId = await waitFor(`${W}.panes.find(p => p.key === ${JSON.stringify(childKey)})?.agentSessionId`, 30000, 'agent id').catch(() => null)
    check('monitor session id = --session-id', agentId === childSession, `${agentId} vs ${childSession}`)
    const cleared = await waitFor(`!${W}.panes.find(p => p.key === ${JSON.stringify(childKey)})?.prefill`, 60000, 'prefill pasted').then(() => true, () => false)
    check('prefill pasted', cleared)
    await sleep(2500)
    await shot('v49-02-prefill')
    const status = await evaluate(`(() => { const p = ${W}.panes.find(p => p.key === ${JSON.stringify(childKey)}); return ${S}.get('terminals').byId?.[p?.terminalId]?.status ?? null })()`)
    check('prompt not submitted (agent still idle)', status === 'idle', String(status))

    check('unauthenticated → 401', (await request(port, { body: {} })).status === 401)
    check('unknown token → 401', (await request(port, { headers: { Authorization: `Bearer ${'0'.repeat(64)}` }, body: {} })).status === 401)
    check('browser Origin → 403', (await request(port, { headers: { Authorization: `Bearer ${env.token}`, Origin: 'https://evil.example' }, body: {} })).status === 403)
    check('foreign Host → 403', (await request(port, { headers: { Authorization: `Bearer ${env.token}`, Host: `localhost:${port}` }, body: {} })).status === 403)
    check('GET → 405', (await request(port, { method: 'GET', headers: { Authorization: `Bearer ${env.token}` } })).status === 405)
    check('other path → 404', (await request(port, { pathname: '/v1/open', headers: { Authorization: `Bearer ${env.token}` }, body: {} })).status === 404)
    const list = await request(port, { headers: { Authorization: `Bearer ${env.token}` }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    check('tools/list has open_session', list.json?.result?.tools?.[0]?.name === 'open_session')
    check('bad agent → preset', (await call(port, env.token, { agent: 'bash' }))?.error === 'preset')
    check('missing folder → cwd', (await call(port, env.token, { agent: 'shell', cwd: path.join(os.tmpdir(), 'ccm-missing-folder-v49') }))?.error === 'cwd')
    const panesBefore = await evaluate(`${W}.panes.length`)
    const again = await call(port, env.token, { agent: 'claude', resume: childSession })
    const focused = await evaluate(`${W}.activeKey`)
    check('resume of an open session focuses its pane', again?.ok === true && again?.resumed === true && focused === childKey && (await evaluate(`${W}.panes.length`)) === panesBefore, JSON.stringify(again))
    check('resume rejects a non-uuid', (await call(port, env.token, { agent: 'claude', resume: '--dangerously-skip-permissions' }))?.error === 'resume')
    const a = await call(port, env.token, { agent: 'shell' })
    const b = await call(port, env.token, { agent: 'shell' })
    check('rate limit: 3 per pane per minute', a?.ok === true && b?.error === 'rate', JSON.stringify([a, b]))

    const before = await evaluate(`${W}.panes.length`)
    await evaluate(`${S}.get('ui').setView('monitor')`)
    const docs = path.join(REPO, 'docs')
    const link = (agent) => `agent-monitor://open?agent=${agent}&cwd=${encodeURIComponent(docs)}&prompt=ignored&name=ignored`
    await fireLink(link('shell'))
    const opened = await waitFor(`${W}.panes.length > ${before} && ${S}.get('ui').view === 'workspace'`, 15000, 'deeplink pane').then(() => true, () => false)
    const last = await evaluate(`(() => { const p = ${W}.panes.at(-1); return { preset: p.preset, cwd: p.cwd, prefill: p.prefill ?? null, resume: p.resume ?? null } })()`)
    check('deeplink opens the pane without asking and shows the workspace', opened && last.preset === 'shell' && same(last.cwd, docs) && last.prefill === null && last.resume === null, JSON.stringify(last))
    await fireLink(link('shell'))
    await fireLink(link('shell'))
    await fireLink(link('shell'))
    await sleep(4000)
    const count = await evaluate(`${W}.panes.length`)
    check('deeplink queue opens every link', count === before + 4, `${count - before} opened`)
    await shot('v49-03-deeplink')

    const pids = await evaluate(`${W}.panes.map(p => p.pid).filter(Boolean)`)
    await evaluate(`(() => { const w = ${W}; [...w.panes].forEach(p => w.remove(p.key)) })()`)
    const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
    let alive = pids
    for (let i = 0; i < 40 && alive.length; i++) { await sleep(250); alive = pids.filter(isAlive) }
    check('closing panes kills processes', alive.length === 0, `pids ${pids} alive ${alive}`)
  } catch (e) {
    check('run', false, e.message)
    await shot('v49-99-error').catch(() => {})
  } finally {
    app.stop()
    if (childSession && UUID.test(childSession)) {
      const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', REPO.replace(/[^A-Za-z0-9]/g, '-'))
      fs.rmSync(path.join(dir, `${childSession}.jsonl`), { force: true })
      fs.rmSync(path.join(dir, childSession), { recursive: true, force: true })
    }
    fs.writeFileSync(path.join(OUT, 'v49-results.txt'), results.join('\n'))
    process.exit(0)
  }
})()
