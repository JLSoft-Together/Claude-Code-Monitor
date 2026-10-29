import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ReleaseApp, ReleaseCheckResult, ReleaseVerifyResult } from '@ccm/shared'
import { isWithin, realOrNull, rootKey } from '../preview/paths'
import { certFinding } from './rules'
import { newestArtifact, scanRelease } from './scan'
import { readSigner, type SignTools } from './sign'
import { ReleaseStore } from './store'

export interface ReleaseIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  /** Explorer gate: real path of an allowed project folder, else null. */
  resolveDir: (dir: unknown) => Promise<string | null>
  dataDir: string
  /** Native APK / AAB picker; null when cancelled. */
  pickArtifact: (event: IpcMainInvokeEvent, near: string) => Promise<string | null>
  findTools: () => Promise<SignTools>
  readSigner?: typeof readSigner
}

const CHANNELS = ['ccm:release-check', 'ccm:release-mark', 'ccm:release-verify', 'ccm:release-remember']

export function registerReleaseIpc(deps: ReleaseIpcDeps): () => void {
  const { ipcMain, isAppFrame } = deps
  const store = new ReleaseStore(deps.dataDir)
  const signer = deps.readSigner ?? readSigner
  // Remember takes the certificate main itself read this run, never a hash sent by the page.
  const verified = new Map<string, { sha256: string; debugKey: boolean; file: string }>()

  const withVerified = (app: ReleaseApp): ReleaseApp => {
    const v = verified.get(rootKey(app.dir))
    if (!v) return app
    return { ...app, findings: app.findings.map((f) => (f.rule === 'cert' ? certFinding(v.sha256, app.cert?.sha256 ?? null, v.debugKey, v.file) : f)) }
  }

  async function check(root: unknown): Promise<ReleaseCheckResult> {
    if (typeof root !== 'string' || root.length > 4096 || !path.isAbsolute(root)) return { ok: false, error: 'invalid' }
    const dir = await deps.resolveDir(root)
    if (!dir) return { ok: false, error: 'denied' }
    try {
      const apps = await scanRelease(dir, store)
      return apps.length ? { ok: true, root: dir, apps: apps.map(withVerified), checkedAt: Date.now() } : { ok: false, error: 'no-app' }
    } catch {
      return { ok: false, error: 'read-failed' }
    }
  }

  /** The app of a fresh scan of `root` whose dir is `app`. */
  async function appOf(req: unknown): Promise<{ root: string; app: ReleaseApp } | ReleaseCheckResult> {
    const { root, app } = (req ?? {}) as { root?: unknown; app?: unknown }
    if (typeof app !== 'string' || !path.isAbsolute(app)) return { ok: false, error: 'invalid' }
    const res = await check(root)
    if (!res.ok) return res
    const hit = res.apps.find((a) => rootKey(a.dir) === rootKey(app))
    return hit ? { root: res.root, app: hit } : { ok: false, error: 'invalid' }
  }

  ipcMain.handle('ccm:release-check', async (event, root: unknown): Promise<ReleaseCheckResult> => (isAppFrame(event) ? check(root) : { ok: false, error: 'denied' }))

  ipcMain.handle('ccm:release-mark', async (event, req: unknown): Promise<ReleaseCheckResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const found = await appOf(req)
    if ('ok' in found) return found
    if (!(await store.markReleased(found.app.dir, found.app.version))) return { ok: false, error: 'read-failed' }
    return check(found.root)
  })

  ipcMain.handle('ccm:release-verify', async (event, req: unknown): Promise<ReleaseVerifyResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const found = await appOf(req)
    if ('ok' in found) return { ok: false, error: !found.ok && found.error === 'denied' ? 'denied' : 'invalid' }
    const pick = (req as { pick?: unknown }).pick === true
    let file = pick ? await deps.pickArtifact(event, found.app.dir) : await newestArtifact(found.app)
    if (!file) return { ok: false, error: pick ? 'cancelled' : 'no-artifact' }
    file = await realOrNull(file)
    if (!file || !/\.(apk|aab)$/i.test(file)) return { ok: false, error: 'invalid' }
    const tools = await deps.findTools()
    // A JDK / build-tools inside the checkout would run repo-controlled code.
    for (const t of [tools.java, tools.keytool, tools.apksignerJar]) if (t && isWithin(found.root, t)) return { ok: false, error: 'no-jdk' }
    const res = await signer(file, tools)
    if (!res.ok) return res
    const key = rootKey(found.app.dir)
    if (verified.size >= 50 && !verified.has(key)) verified.delete(verified.keys().next().value!)
    verified.set(key, { sha256: res.sha256, debugKey: res.debugKey, file })
    return {
      ok: true,
      file,
      artifact: /\.aab$/i.test(file) ? 'aab' : 'apk',
      sha256: res.sha256,
      subject: res.subject,
      debugKey: res.debugKey,
      finding: certFinding(res.sha256, found.app.cert?.sha256 ?? null, res.debugKey, file),
    }
  })

  ipcMain.handle('ccm:release-remember', async (event, req: unknown): Promise<ReleaseCheckResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const found = await appOf(req)
    if ('ok' in found) return found
    const v = verified.get(rootKey(found.app.dir))
    if (!v || v.debugKey) return { ok: false, error: 'invalid' }
    if (!(await store.rememberCert(found.app.dir, v.sha256))) return { ok: false, error: 'read-failed' }
    return check(found.root)
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
