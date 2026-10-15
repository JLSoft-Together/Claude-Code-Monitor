import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LayoutDaemon, LayoutError, type DaemonChild } from '../src/layout/daemon'
import { findJdk } from '../src/layout/jdk'

// Real JVM + layoutlib: needs `apps/layout-daemon` built (`gradlew assemble`) and a JDK ≥ 17; skipped otherwise.
const daemonDir = path.resolve(__dirname, '../../layout-daemon/build')
const jar = path.join(daemonDir, 'libs', 'layout-daemon.jar')
const layoutlib = path.join(daemonDir, 'layoutlib-dist')
const built = existsSync(jar) && existsSync(path.join(layoutlib, 'runtime', 'build.prop')) && process.env.CCM_DAEMON_IT !== '0'

const XML = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">
  <TextView android:id="@+id/title" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Hello"/>
  <Button android:layout_width="match_parent" android:layout_height="wrap_content" android:text="OK"/>
</LinearLayout>`

const params = (text = 'Hello') => ({
  layoutPath: path.join(os.tmpdir(), 'res', 'layout', 'it.xml'),
  xmlContent: XML.replace('Hello', text),
  device: { width: 540, height: 960, density: 240 },
  theme: null,
  night: false,
  locale: null,
})

describe.skipIf(!built)('layout daemon (real jar)', () => {
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'ccm-daemon-it-'))
  let daemon: LayoutDaemon
  let jdkOk = false

  beforeAll(async () => {
    const jdk = await findJdk({ setting: null, env: process.env, platform: process.platform })
    jdkOk = jdk.ok && !!jdk.java
    daemon = new LayoutDaemon({
      spawn: (java, args, cwd) => spawn(java, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) as DaemonChild,
      findJava: async () => jdk,
      daemonJar: jar,
      layoutlibDir: () => layoutlib,
      cacheDir,
      platform: process.platform,
      kill: (child) => (child as unknown as { kill: () => void }).kill(),
      initTimeoutMs: 120_000,
      renderTimeoutMs: 60_000,
    })
  })

  afterAll(async () => {
    await daemon?.stop()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('starts, reports the API level and renders a PNG with a view tree', async (ctx) => {
    if (!jdkOk) return ctx.skip()
    await daemon.ensure()
    expect(daemon.state).toBe('ready')
    expect(daemon.apiLevel).toBe(36)
    const res = await daemon.render(params(), 'it:0')
    expect(res.png).toBeTruthy()
    expect(statSync(res.png!).size).toBeGreaterThan(100)
    expect(res.width).toBe(540)
    expect(res.height).toBe(960)
    const tree = res.viewTree as { class: string; children: { xmlId: string | null }[] }
    expect(tree.class).toMatch(/LinearLayout$/)
    expect(tree.children[0]!.xmlId).toBe('@+id/title')
  }, 180_000)

  it('renders a loose drawable and a color state list', async (ctx) => {
    if (!jdkOk) return ctx.skip()
    const shape = '<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#FF0000"/><corners android:radius="8dp"/></shape>'
    const d = await daemon.renderDrawable({ path: path.join(os.tmpdir(), 'bg.xml'), xmlContent: shape, device: { width: 96, height: 96, density: 320 }, night: false, states: [], colorList: false }, 'it:d')
    expect(d.png).toBeTruthy()
    expect(d.width).toBe(96)
    const list = '<selector xmlns:android="http://schemas.android.com/apk/res/android"><item android:state_pressed="true" android:color="#FF000000"/><item android:color="#FFFFFFFF"/></selector>'
    const c = await daemon.renderDrawable({ path: path.join(os.tmpdir(), 'c.xml'), xmlContent: list, device: { width: 96, height: 96, density: 320 }, night: false, states: [], colorList: true }, 'it:d')
    expect(c.png).toBeNull()
    expect(c.swatches).toEqual(expect.arrayContaining([{ state: 'default', color: '#FFFFFFFF' }, { state: 'pressed', color: '#FF000000' }]))
  }, 120_000)

  it('a newer render in the same slot cancels the older one', async (ctx) => {
    if (!jdkOk) return ctx.skip()
    const first = daemon.render(params('One'), 'it:1')
    const second = daemon.render(params('Two'), 'it:1')
    const [a, b] = await Promise.allSettled([first, second])
    expect(a.status).toBe('rejected')
    expect((a as PromiseRejectedResult).reason).toBeInstanceOf(LayoutError)
    expect(((a as PromiseRejectedResult).reason as LayoutError).code).toBe('cancelled')
    expect(b.status).toBe('fulfilled')
  }, 120_000)
})
