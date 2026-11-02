// README screenshots (docs/screenshots/*.png): monitor, workspace, changes, run-pane, whats-new. Not part of run.cjs.
// Everything lives under DEMO (default F:\orrery-demo) so no user name shows; fixture sessions + git demo repos + run-fakes, vi / dark / 1440x900.
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const DEMO = process.env.CCM_DEMO_DIR || 'F:\\orrery-demo'
process.env.CCM_E2E_OUT = path.join(DEMO, '.e2e')
process.env.CCM_E2E_DBG ??= '9444'
process.env.CCM_E2E_PORT ??= '4399'
const { launch, REPO } = require('./cdp.cjs')

const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const W = `${S}.get('workspace')`
const R = `${S}.get('run')`
const TM = `${S}.get('terminals')`
const RAW = process.env.CCM_SHOTS_DIR || path.join(REPO, 'docs', 'screenshots')
const WIN = process.platform === 'win32'
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const write = (file, text, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  if (mode) fs.chmodSync(file, mode)
}
const gitIn = (dir) => (...a) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-C', dir, ...a], { stdio: 'ignore' })

const ROOT = path.join(DEMO, 'claude-root')
const ACME = path.join(DEMO, 'acme-shop')
const QUEST = path.join(DEMO, 'pixel-quest')
const LEDGER = path.join(DEMO, 'ledger-api')
const DOCS = path.join(DEMO, 'orrery-docs')
const FLUTTER_DIR = path.join(DEMO, 'flutter_demo')
const FAKE = path.join(DEMO, '.fake')
const TOOLS = path.join(FAKE, 'tools')
const STATE = path.join(FAKE, 'state')
const SDK = { flutterSdk: path.join(FAKE, 'flutter'), androidSdk: path.join(FAKE, 'android-sdk'), jdk: path.join(FAKE, 'jdk') }

const CART_V1 = `import type { Product } from './types'

export interface CartLine {
  product: Product
  quantity: number
}

export class Cart {
  private lines = new Map<string, CartLine>()

  add(product: Product, quantity = 1): void {
    const line = this.lines.get(product.id)
    if (line) line.quantity += quantity
    else this.lines.set(product.id, { product, quantity })
  }

  remove(id: string): void {
    this.lines.delete(id)
  }

  get items(): CartLine[] {
    return [...this.lines.values()]
  }

  get total(): number {
    return this.items.reduce((sum, l) => sum + l.product.price * l.quantity, 0)
  }
}
`
const CART_V2 = CART_V1.replace('  private lines = new Map<string, CartLine>()\n', '  private lines = new Map<string, CartLine>()\n  private discount = 0\n').replace(
  /  get total\(\): number \{[\s\S]*?\n  \}\n/,
  `  applyDiscount(percent: number): void {
    this.discount = Math.min(Math.max(percent, 0), 50)
  }

  get subtotal(): number {
    return this.items.reduce((sum, l) => sum + l.product.price * l.quantity, 0)
  }

  get total(): number {
    return this.subtotal * (1 - this.discount / 100)
  }
`,
)
const TYPES = `export interface Product {
  id: string
  name: string
  price: number
}
`
const CHECKOUT = `import { Cart } from './cart'

export function checkout(cart: Cart): { ok: boolean; total: number } {
  const total = Math.round(cart.total * 100) / 100
  return { ok: total > 0, total }
}
`
const TEST_V1 = `import { describe, expect, it } from 'vitest'
import { Cart } from '../src/cart'

describe('Cart', () => {
  it('adds lines', () => {
    const cart = new Cart()
    cart.add({ id: 'a', name: 'Socks', price: 5 }, 2)
    expect(cart.total).toBe(10)
  })
})
`
const TEST_V2 = TEST_V1.replace(
  '  })\n})\n',
  `  })

  it('applies a capped discount', () => {
    const cart = new Cart()
    cart.add({ id: 'a', name: 'Socks', price: 10 })
    cart.applyDiscount(80)
    expect(cart.total).toBe(5)
  })
})
`,
)
const DISCOUNTS = `export const CODES: Record<string, number> = {
  SPRING: 10,
  VIP: 25,
}

export function percentFor(code: string): number {
  return CODES[code.toUpperCase()] ?? 0
}
`

function buildRepos() {
  for (const d of [ACME, QUEST, LEDGER, DOCS, FLUTTER_DIR, FAKE]) fs.rmSync(d, { recursive: true, force: true })
  fs.mkdirSync(DEMO, { recursive: true })

  const g = gitIn(ACME)
  write(path.join(ACME, 'package.json'), '{\n  "name": "acme-shop",\n  "version": "0.4.0",\n  "scripts": { "test": "vitest run" }\n}\n')
  write(path.join(ACME, 'README.md'), '# acme-shop\n\nTiny storefront used by the Orrery README screenshots.\n')
  write(path.join(ACME, 'src', 'types.ts'), TYPES)
  write(path.join(ACME, 'src', 'cart.ts'), CART_V1)
  write(path.join(ACME, 'test', 'cart.test.ts'), TEST_V1)
  g('init', '-q', '-b', 'main')
  g('add', '.')
  g('commit', '-q', '-m', 'Initial storefront')
  write(path.join(ACME, 'src', 'checkout.ts'), CHECKOUT)
  g('add', '.')
  g('commit', '-q', '-m', 'Add checkout')
  g('checkout', '-q', '-b', 'feature/discounts')
  write(path.join(ACME, 'src', 'cart.ts'), CART_V2)
  write(path.join(ACME, 'test', 'cart.test.ts'), TEST_V2)
  write(path.join(ACME, 'src', 'discounts.ts'), DISCOUNTS)

  const q = gitIn(QUEST)
  write(path.join(QUEST, 'settings.gradle.kts'), 'rootProject.name = "pixel-quest"\n')
  write(path.join(QUEST, 'app', 'src', 'main', 'kotlin', 'Hero.kt'), 'data class Hero(val name: String, var hp: Int = 100) {\n    fun hit(damage: Int) {\n        hp = (hp - damage).coerceAtLeast(0)\n    }\n}\n')
  q('init', '-q', '-b', 'main')
  q('add', '.')
  q('commit', '-q', '-m', 'Hero model')
  write(path.join(QUEST, 'app', 'src', 'main', 'kotlin', 'Hero.kt'), 'data class Hero(val name: String, var hp: Int = 100, var mana: Int = 30) {\n    fun hit(damage: Int) {\n        hp = (hp - damage).coerceAtLeast(0)\n    }\n}\n')

  const l = gitIn(LEDGER)
  write(path.join(LEDGER, 'package.json'), '{ "name": "ledger-api", "version": "1.2.0" }\n')
  write(path.join(LEDGER, 'src', 'server.ts'), "import { createServer } from 'node:http'\n\ncreateServer((_req, res) => res.end('ok')).listen(8080)\n")
  l('init', '-q', '-b', 'main')
  l('add', '.')
  l('commit', '-q', '-m', 'Hello server')

  const d = gitIn(DOCS)
  write(path.join(DOCS, 'index.md'), '# Orrery docs\n\nGetting started, shortcuts and FAQ.\n')
  d('init', '-q', '-b', 'main')
  d('add', '.')
  d('commit', '-q', '-m', 'Docs skeleton')

  write(path.join(FLUTTER_DIR, 'pubspec.yaml'), 'name: flutter_demo\nenvironment:\n  sdk: ^3.9.0\ndependencies:\n  flutter:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n')
  write(path.join(FLUTTER_DIR, 'lib', 'main.dart'), "import 'package:flutter/material.dart';\n\nvoid main() {\n  // entry\n  runApp(const DemoApp())\n}\n")
  fs.mkdirSync(path.join(FLUTTER_DIR, 'android'), { recursive: true })
  write(path.join(FLUTTER_DIR, '.dart_tool', 'package_config.json'), '{"configVersion":2,"packages":[]}\n')
  write(path.join(FLUTTER_DIR, 'pubspec.lock'), 'packages: {}\n')
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(path.join(FLUTTER_DIR, 'pubspec.lock'), later, later)
}

function wrapper(file, name, kind) {
  const script = path.join(TOOLS, `${name}.js`)
  if (!WIN) return write(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, 0o755)
  if (kind === 'bat') return write(file, `@echo off\r\n"${process.execPath}" "${script}" %*\r\nexit /b %errorlevel%\r\n`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(path.join(FAKE, 'launcher.exe'), file)
}

function fakes() {
  const src = path.join(__dirname, 'fixtures', 'run-fakes')
  fs.mkdirSync(TOOLS, { recursive: true })
  fs.mkdirSync(STATE, { recursive: true })
  for (const f of ['flutter.js', 'adb.js', 'java.js', 'gradle.js']) fs.copyFileSync(path.join(src, f), path.join(TOOLS, f))
  if (WIN) {
    const cs = path.join(FAKE, 'launcher.cs')
    fs.writeFileSync(cs, fs.readFileSync(path.join(src, 'launcher.cs'), 'utf8').replace('__NODE__', process.execPath).replace('__TOOLS__', TOOLS))
    const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${path.join(FAKE, 'launcher.exe')}`, cs], { stdio: 'pipe' })
  }
  wrapper(path.join(SDK.flutterSdk, 'bin', WIN ? 'flutter.bat' : 'flutter'), 'flutter', 'bat')
  wrapper(path.join(SDK.androidSdk, 'platform-tools', WIN ? 'adb.exe' : 'adb'), 'adb', 'exe')
  wrapper(path.join(SDK.jdk, 'bin', WIN ? 'java.exe' : 'java'), 'java', 'exe')
}

function startFixture() {
  const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'demo-fixture.mjs'), `--root=${ROOT}`, '--sessions=6', '--subagents=3', '--tick=600000'], { stdio: ['ignore', 'pipe', 'inherit'] })
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('fixture root')) resolve(child) })
    child.on('exit', (code) => reject(new Error('fixture exited ' + code)))
  })
}

async function main() {
  buildRepos()
  fakes()
  fs.mkdirSync(RAW, { recursive: true })
  const fixture = await startFixture()
  const regs = fs.readdirSync(path.join(ROOT, 'sessions')).filter((f) => f.endsWith('.json')).sort()
  for (const [i, status] of [[0, 'waiting'], [2, 'idle'], [3, 'waiting']]) {
    const file = path.join(ROOT, 'sessions', regs[i])
    const reg = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...reg, status, waitingFor: status === 'waiting' ? 'permission prompt' : undefined }))
  }
  const env = { CLAUDE_CONFIG_DIR: ROOT, CCM_VERIFY_PROCESSES: '0', CCM_CODEX: '0', FLUTTER_ROOT: SDK.flutterSdk, ANDROID_HOME: SDK.androidSdk, ANDROID_SDK_ROOT: SDK.androidSdk, JAVA_HOME: SDK.jdk }
  const app = await launch({ env })
  const { evaluate, waitFor, sleep, cmd, key } = app
  const version = require('../package.json').version
  const shoot = async (name, wait = 600) => {
    await sleep(wait)
    const r = await cmd('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(RAW, name + '.png'), Buffer.from(r.result.data, 'base64'))
    check(`shot ${name}`, true)
  }
  const typeInShell = async (text) => {
    await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus()`)
    await cmd('Input.insertText', { text })
    await key('Enter', 'Enter', 13)
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.locale','vi'); localStorage.setItem('ccm.theme','dark'); localStorage.setItem('ccm.mapView','map'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.workspace.sidebar','1')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${UI}`, 30000, 'reloaded')
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await evaluate(`${S}.get('settings').hideFinished = false`)

    // Monitor
    await evaluate(`${UI}.setView('monitor'); ${UI}.openSessionTab(null); ${UI}.panels.sessions.open = true`)
    await waitFor(`${TM}.list.length >= 5`, 30000, 'fixture sessions').catch(() => {})
    await sleep(2000)
    await shoot('monitor')

    // What's new (3.0.0 is the current release)
    await evaluate(`${UI}.whatsNewOpen = true`)
    await waitFor(`!!document.querySelector('[data-whats-new]')`, 8000, 'whats new')
    await shoot('whats-new', 800)
    await key('Escape', 'Escape', 27)
    await waitFor(`!document.querySelector('[data-whats-new]')`, 5000, 'closed').catch(() => {})

    // Workspace: 4 projects, acme-shop with shell + file split
    await evaluate(`${UI}.setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]') || ${W}.panes.length`, 15000, 'workspace').catch(() => {})
    for (const d of [QUEST, LEDGER, DOCS]) {
      await evaluate(`${W}.open('shell', ${JSON.stringify(d)})`)
      await sleep(300)
    }
    await evaluate(`${W}.open('shell', ${JSON.stringify(ACME)})`)
    await waitFor(`${W}.panes.length >= 4 && ${W}.panes.every((p) => p.state === 'running')`, 30000, 'shells running')
    await sleep(1500)
    await typeInShell('git log --oneline --graph --all; git status -s')
    await evaluate(`${W}.openFile(${JSON.stringify(path.join(ACME, 'src', 'cart.ts'))}, undefined, { cwd: ${JSON.stringify(ACME)}, split: { key: ${W}.activeKey, dir: 'row' } })`)
    await waitFor(`!!document.querySelector('.monaco-editor, .cm-editor')`, 15000, 'editor').catch(() => {})
    await key('E', 'KeyE', 69, 2 | 8)
    await waitFor(`!!document.querySelector('[data-explorer-tree]')`, 10000, 'explorer').catch(() => {})
    await shoot('workspace', 2500)

    // Changes with diff
    const ch = await evaluate(`(() => { const p = ${W}.openChanges(${JSON.stringify(ACME)}); ${W}.toggleZoom(p.key); return p.key })()`)
    check('changes pane opened', !!ch)
    await waitFor(`!!document.querySelector('[data-kind=changes]')`, 10000, 'changes').catch(() => {})
    await sleep(2500)
    await shoot('changes', 1500)
    await evaluate(`${W}.clearZoom?.()`)

    // Run pane: Flutter build that fails
    await evaluate(`${R}.updateSettings(${JSON.stringify(SDK)})`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(FLUTTER_DIR)})`)
    await waitFor(`${W}.panes.some((p) => p.cwd === ${JSON.stringify(FLUTTER_DIR)} && p.state === 'running')`, 20000, 'flutter shell')
    await evaluate(`${W}.openRun(${JSON.stringify(FLUTTER_DIR)})`)
    await waitFor(`!!document.querySelector('[data-run-pane] [data-run-start]')`, 15000, 'run pane')
    await waitFor(`${R}.configsFor(${JSON.stringify(FLUTTER_DIR)}).length >= 1`, 15000, 'configs').catch(() => {})
    await waitFor(`${R}.devicesFor(${R}.selectedConfig(${JSON.stringify(FLUTTER_DIR)})).some((d) => d.id === 'emulator-5554')`, 30000, 'device').catch(() => {})
    await evaluate(`document.querySelector('[data-run-menu-button=device]')?.click()`)
    await waitFor(`!!document.querySelector('[data-run-menu] [role=menuitemradio]')`, 8000, 'device menu').catch(() => {})
    await evaluate(`[...document.querySelectorAll('[data-run-menu] [role=menuitemradio]')].find((b) => b.title === 'emulator-5554')?.click()`)
    await sleep(400)
    const focused = `${R}.focusedSession(${JSON.stringify(FLUTTER_DIR)})`
    await waitFor(`!document.querySelector('[data-run-start]').disabled`, 10000, 'run enabled').catch(() => {})
    await evaluate(`document.querySelector('[data-run-start]').click()`)
    await waitFor(`${focused}?.state === 'running'`, 25000, 'running')
    await waitFor(`document.querySelector('[data-run-pane] [role=log]')?.textContent.includes('reloaded') || document.querySelector('[data-run-pane] [role=log]')?.textContent.includes('Hello from the fake app')`, 8000, 'log').catch(() => {})
    await evaluate(`document.querySelector('[data-run-reload]')?.click()`)
    await sleep(1500)
    await evaluate(`document.querySelector('[data-run-stop]')?.click()`)
    await waitFor(`${focused}?.state === 'stopped'`, 15000, 'stopped').catch(() => {})
    fs.writeFileSync(path.join(STATE, 'flutter-mode'), 'fail')
    await waitFor(`!document.querySelector('[data-run-start]').disabled`, 10000, 'run enabled again').catch(() => {})
    await evaluate(`document.querySelector('[data-run-start]').click()`)
    await waitFor(`${focused}?.state === 'failed'`, 25000, 'failed')
    await sleep(800)
    await evaluate(`document.querySelector('[data-run-tab=build]')?.click()`)
    await shoot('run-pane', 1200)
  } catch (e) {
    check('script error', false, String(e.message ?? e))
    try { await shoot('99-error') } catch {}
  } finally {
    fs.writeFileSync(path.join(DEMO, '.e2e', 'readme-shots-results.txt'), results.join('\n'))
    app.stop()
    fixture.kill()
  }
}
main().then(() => process.exit(0))
