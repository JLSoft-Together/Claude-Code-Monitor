import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { drawableFolderKind, drawableKind, DRAWABLE_SNIFF_BYTES, isLooseLayoutXml } from '@ccm/shared'
import { isWithin } from '../preview/paths'
import type { PreviewServer } from '../preview/server'
import { LayoutDaemon, LayoutError, type DaemonDeps, type RenderParams } from './daemon'
import { LayoutlibBundle } from './download'
import { findJdk } from './jdk'
import { LayoutModelService, type ModelServiceDeps } from './model'
import { LAYOUTLIB_API_LEVEL } from './types'
import type { DaemonRenderResult, DrawableRenderResult, DrawableSwatch, JdkStatus, LayoutDevice, LayoutDiagnostic, LayoutEvent, LayoutModelInfo, LayoutRenderResult, LayoutStatus, LayoutViewNode } from './types'

export interface LayoutIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  /** Explorer gate (`PreviewIpc.resolveDir`): real path of an allowed file, else null. */
  resolveDir: (p: unknown) => Promise<string | null>
  dataDir: string
  /** Run settings JDK folder (null = auto). */
  getJdk: () => string | null
  /** Native consent before the ~170 MB download; false = cancelled. */
  confirm: (event: IpcMainInvokeEvent, info: { bytes: number; host: string }) => Promise<boolean>
  server: Pick<PreviewServer, 'urlFor'>
  daemonJar: string
  spawn: DaemonDeps['spawn']
  kill: DaemonDeps['kill']
  broadcast?: (event: LayoutEvent) => void
  log?: (level: string, message: string) => void
  platform?: NodeJS.Platform
  arch?: string
  env?: NodeJS.ProcessEnv
  /** Dev: staged bundle (apps/layout-daemon/build/layoutlib-dist) instead of the download. */
  layoutlibOverride?: string | null
  findJava?: DaemonDeps['findJava']
  bundle?: LayoutlibBundle
  daemon?: LayoutDaemon
  /** Project model (Phase 3); absent = framework views only. */
  model?: Omit<ModelServiceDeps, 'modelsDir' | 'daemon' | 'broadcast' | 'log' | 'canRun'>
  renderCacheSize?: number
}

export interface LayoutIpc {
  dispose: () => void
  stop: () => Promise<void>
  killNow: () => void
  model: LayoutModelService | null
}

const CHANNELS = ['ccm:layout-status', 'ccm:layout-download', 'ccm:layout-render', 'ccm:layout-model-status', 'ccm:layout-model-refresh', 'ccm:layout-model-pick', 'ccm:layout-warmup', 'ccm:drawable-render']
const RENDER_CACHE = 32
const MAX_SLOT = 3

interface CachedRender {
  result: Omit<Extract<LayoutRenderResult, { ok: true }>, 'pngUrl' | 'cached'>
  png: string | null
}

/** Insertion-ordered LRU; `onEvict` deletes the snapshot PNG. */
export class RenderCache<T> {
  private readonly map = new Map<string, T>()
  constructor(
    private readonly max: number,
    private readonly onEvict: (value: T) => void = () => undefined,
  ) {}
  get(key: string): T | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }
  set(key: string, value: T): void {
    const old = this.map.get(key)
    this.map.delete(key)
    if (old !== undefined && old !== value) this.onEvict(old)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const [k, v] = this.map.entries().next().value as [string, T]
      this.map.delete(k)
      this.onEvict(v)
    }
  }
  delete(key: string): void {
    const v = this.map.get(key)
    if (v === undefined) return
    this.map.delete(key)
    this.onEvict(v)
  }
  get size(): number {
    return this.map.size
  }
}

export function renderKey(params: RenderParams, modelKey: string): string {
  return createHash('sha1')
    .update(JSON.stringify([params.layoutPath, params.xmlContent, params.device, params.theme, params.night, params.locale, modelKey]))
    .digest('hex')
}
const MAX_XML = 1024 * 1024
const JDK_TTL_MS = 30_000
const MAX_NODES = 5000
const MAX_DEPTH = 64

/** `…/res/layout[-qualifiers]/<name>.xml`; the only files the daemon is ever handed. */
export function isLayoutFile(file: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix
  const insensitive = platform === 'darwin' || platform === 'win32'
  const fold = (s: string): string => (insensitive ? s.toLowerCase() : s)
  if (fold(p.extname(file)) !== '.xml') return false
  const dir = fold(p.basename(p.dirname(file)))
  const res = fold(p.basename(p.dirname(p.dirname(file))))
  return res === 'res' && /^layout(-[a-z0-9_+-]+)?$/i.test(dir) && dir.startsWith('layout')
}

async function readHead(file: string): Promise<string | null> {
  const handle = await fs.open(file, 'r').catch(() => null)
  if (!handle) return null
  try {
    const buf = Buffer.alloc(DRAWABLE_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** `res/layout*` by path, else a loose `.xml` (not in another `res/` folder) whose root element is a view. */
export async function isLayoutTarget(file: string, text: string | null, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (isLayoutFile(file, platform)) return true
  if (path.extname(file).toLowerCase() !== '.xml' || drawableFolderKind(file)) return false
  if (path.basename(path.dirname(path.dirname(file))).toLowerCase() === 'res') return false
  return isLooseLayoutXml(file, text ?? (await readHead(file)))
}

/** Unsaved editor text (v42 live preview); undefined = read the file, null = unusable. */
export function cleanText(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return undefined
  return typeof v === 'string' && Buffer.byteLength(v, 'utf8') <= MAX_XML ? v : null
}

export function cleanDevice(v: unknown): LayoutDevice | null {
  const d = (v ?? {}) as Record<string, unknown>
  const int = (x: unknown, lo: number, hi: number): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : null)
  const width = int(d.width, 64, 8192)
  const height = int(d.height, 64, 8192)
  const density = int(d.density, 72, 960)
  return width && height && density ? { width, height, density } : null
}

const cleanTheme = (v: unknown): string | null => (typeof v === 'string' && /^[@A-Za-z0-9_.:/]{1,128}$/.test(v) ? v : null)
const cleanLocale = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9+_-]{1,35}$/.test(v) ? v : null)

export function cleanTree(raw: unknown): LayoutViewNode | null {
  let count = 0
  const walk = (n: unknown, depth: number): LayoutViewNode | null => {
    if (!n || typeof n !== 'object' || depth > MAX_DEPTH || ++count > MAX_NODES) return null
    const o = n as Record<string, unknown>
    const b = Array.isArray(o.bounds) && o.bounds.length === 4 && o.bounds.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (o.bounds as [number, number, number, number]) : null
    if (!b) return null
    const kids = Array.isArray(o.children) ? o.children.map((c) => walk(c, depth + 1)).filter((c): c is LayoutViewNode => !!c) : []
    return {
      class: typeof o.class === 'string' ? o.class.slice(0, 200) : '?',
      xmlId: typeof o.xmlId === 'string' ? o.xmlId.slice(0, 200) : null,
      line: typeof o.line === 'number' && o.line > 0 ? Math.floor(o.line) : 0,
      column: typeof o.column === 'number' && o.column > 0 ? Math.floor(o.column) : 0,
      bounds: b,
      children: kids,
    }
  }
  return walk(raw, 0)
}

export function cleanDiagnostics(raw: unknown): LayoutDiagnostic[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 200).flatMap((d): LayoutDiagnostic[] => {
    if (!d || typeof d !== 'object') return []
    const o = d as Record<string, unknown>
    const severity = o.severity === 'error' || o.severity === 'warning' ? o.severity : 'info'
    const out: LayoutDiagnostic = { severity, message: String(o.message ?? '').slice(0, 1000) }
    if (typeof o.line === 'number' && o.line > 0) out.line = Math.floor(o.line)
    if (typeof o.column === 'number' && o.column > 0) out.column = Math.floor(o.column)
    return [out]
  })
}

const DRAWABLE_STATES = new Set(['pressed', 'focused', 'selected', 'checked', 'activated', 'disabled'])

/** Size in dp (1–1024 each way) at `dpi` → device pixels for the daemon. */
export function drawableDevice(v: unknown): LayoutDevice | null {
  const r = (v ?? {}) as Record<string, unknown>
  const int = (x: unknown, lo: number, hi: number): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : null)
  const w = int(r.width, 1, 1024)
  const h = int(r.height, 1, 1024)
  const dpi = int(r.density, 72, 960)
  if (!w || !h || !dpi) return null
  const px = (dp: number): number => Math.min(4096, Math.max(16, Math.round((dp * dpi) / 160)))
  return { width: px(w), height: px(h), density: dpi }
}

export function cleanSwatches(raw: unknown): DrawableSwatch[] | null {
  if (!Array.isArray(raw)) return null
  return raw.slice(0, 20).flatMap((s): DrawableSwatch[] => {
    const o = (s ?? {}) as Record<string, unknown>
    return typeof o.state === 'string' && typeof o.color === 'string' && /^#[0-9A-F]{8}$/i.test(o.color) ? [{ state: o.state.slice(0, 40), color: o.color.toUpperCase() }] : []
  })
}

export function registerLayoutIpc(deps: LayoutIpcDeps): LayoutIpc {
  const { ipcMain, isAppFrame, resolveDir } = deps
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const base = path.join(deps.dataDir, 'layoutlib')
  const cacheDir = path.join(base, 'cache')
  const renderDir = path.join(cacheDir, 'render')
  const snapDir = path.join(cacheDir, 'snap')
  const broadcast = deps.broadcast ?? (() => undefined)
  let model: LayoutModelService | null = null
  let jdkCache: { key: string | null; at: number; value: JdkStatus & { java?: string } } | null = null

  const findJava = deps.findJava ?? (async () => {
    const key = deps.getJdk()
    if (jdkCache && jdkCache.key === key && Date.now() - jdkCache.at < JDK_TTL_MS) return jdkCache.value
    const value = await findJdk({ setting: key, env, platform })
    jdkCache = { key, at: Date.now(), value }
    return value
  })

  const bundle =
    deps.bundle ??
    new LayoutlibBundle({ base, platform, arch: deps.arch ?? process.arch, overrideDir: deps.layoutlibOverride, onStatus: (status) => broadcast({ type: 'bundle', status }) })
  const daemon =
    deps.daemon ??
    new LayoutDaemon({
      spawn: deps.spawn,
      kill: deps.kill,
      findJava,
      daemonJar: deps.daemonJar,
      layoutlibDir: () => bundle.dir,
      cacheDir,
      platform,
      log: deps.log,
      onState: (state, detail) => {
        model?.onDaemonState(state)
        broadcast({ type: 'daemon', state, detail })
      },
    })
  const jarExists = (): boolean => existsSync(deps.daemonJar)
  let realRender: string | null = null
  let realSnap: string | null = null
  if (deps.model) {
    model = new LayoutModelService({
      ...deps.model,
      modelsDir: path.join(base, 'models'),
      daemon,
      broadcast,
      log: deps.log ?? (() => undefined),
      canRun: () => jarExists() && bundle.isReady(),
    })
  }
  const cache = new RenderCache<CachedRender>(deps.renderCacheSize ?? RENDER_CACHE, (v) => {
    if (v.png) void fs.rm(v.png, { force: true }).catch(() => undefined)
  })
  // Snapshots of a previous session are unreachable (the cache is in memory).
  const snapReady = fs.rm(snapDir, { recursive: true, force: true }).then(
    () => fs.mkdir(snapDir, { recursive: true }),
    () => fs.mkdir(snapDir, { recursive: true }),
  )
  snapReady.catch(() => undefined)

  const snapUrl = async (png: string, tag: string): Promise<string | null> => {
    realSnap ??= await fs.realpath(snapDir).catch(() => null)
    if (!realSnap) return null
    const target = await deps.server.urlFor(png, [realSnap])
    return target ? `${target.url}?r=${encodeURIComponent(tag)}` : null
  }

  const gateFile = async (event: IpcMainInvokeEvent, req: unknown): Promise<string | null> => {
    if (!isAppFrame(event)) return null
    const file = await resolveDir(((req ?? {}) as Record<string, unknown>).file)
    return file && (await isLayoutTarget(file, null, platform)) ? file : null
  }

  const noModel: LayoutModelInfo = { target: null, state: { state: 'none' }, hasModel: false, themes: [] }

  ipcMain.handle('ccm:layout-model-status', async (event, req: unknown): Promise<LayoutModelInfo | null> => {
    const file = await gateFile(event, req)
    if (!file) return null
    return model ? model.info(file).catch(() => noModel) : noModel
  })

  // Button: runs the read-only Gradle task now (explicit user action, same trust as Run).
  ipcMain.handle('ccm:layout-model-refresh', async (event, req: unknown): Promise<LayoutModelInfo | null> => {
    const file = await gateFile(event, req)
    if (!file) return null
    return model ? model.refreshFile(file).catch(() => noModel) : noModel
  })

  // Library layout: which dependent app's model to borrow (validated against the candidates in the service).
  ipcMain.handle('ccm:layout-model-pick', async (event, req: unknown): Promise<LayoutModelInfo | null> => {
    const file = await gateFile(event, req)
    const module = ((req ?? {}) as Record<string, unknown>).module
    if (!file || typeof module !== 'string' || module.length > 300) return null
    return model ? model.pickApp(file, module).catch(() => noModel) : noModel
  })

  ipcMain.handle('ccm:layout-status', async (event): Promise<LayoutStatus | null> => {
    if (!isAppFrame(event)) return null
    const jdk = await findJava()
    const { java: _java, ...pub } = jdk
    return { bundle: bundle.status(), jdk: pub as JdkStatus, daemon: daemon.state, jar: jarExists(), apiLevel: daemon.apiLevel ?? LAYOUTLIB_API_LEVEL }
  })

  // A layout was opened: start the JVM (initialize renders a framework-only warm-up layout) and load the cached
  // project model, so the first real render skips the cold start. Never Gradle; the daemon's idle timer still applies.
  ipcMain.handle('ccm:layout-warmup', async (event, req: unknown): Promise<{ ok: boolean; code?: string }> => {
    // Any explorer-allowed .xml (layouts and drawables); nothing is read here.
    const file = isAppFrame(event) ? await resolveDir(((req ?? {}) as Record<string, unknown>).file) : null
    if (!file || path.extname(file).toLowerCase() !== '.xml') return { ok: false, code: 'denied' }
    if (!jarExists()) return { ok: false, code: 'jar-missing' }
    if (!bundle.isReady()) return { ok: false, code: 'bundle-missing' }
    try {
      await daemon.ensure()
      if (model) await model.prepare(file)
      return { ok: true }
    } catch (err) {
      return { ok: false, code: err instanceof LayoutError ? err.code : 'failed' }
    }
  })

  ipcMain.handle('ccm:layout-download', async (event) => {
    if (!isAppFrame(event)) return null
    const now = bundle.status()
    if (now.state === 'ready' || now.state === 'downloading') return now
    if (!(await deps.confirm(event, { bytes: bundle.downloadBytes, host: 'dl.google.com' }))) return { state: 'cancelled' }
    // Progress goes out as ccm:layout-event; the invoke resolves when the bundle is ready or failed.
    return bundle.download()
  })

  ipcMain.handle('ccm:layout-render', async (event, req: unknown): Promise<LayoutRenderResult> => {
    if (!isAppFrame(event)) return { ok: false, code: 'denied' }
    const r = (req ?? {}) as Record<string, unknown>
    const file = await resolveDir(r.file)
    const text = cleanText(r.text)
    if (text === null) return { ok: false, code: 'too-large' }
    if (!file || !(await isLayoutTarget(file, text ?? null, platform))) return { ok: false, code: 'denied' }
    const device = cleanDevice(r.device)
    if (!device) return { ok: false, code: 'bad-params' }
    if (!jarExists()) return { ok: false, code: 'jar-missing' }
    if (!bundle.isReady()) return { ok: false, code: 'bundle-missing' }
    const stat = await fs.stat(file).catch(() => null)
    if (!stat?.isFile()) return { ok: false, code: 'missing' }
    if (text === undefined && stat.size > MAX_XML) return { ok: false, code: 'too-large' }
    const xmlContent = text ?? (await fs.readFile(file, 'utf8').catch(() => null))
    if (xmlContent === null) return { ok: false, code: 'missing' }
    const slot = typeof r.slot === 'number' && Number.isInteger(r.slot) && r.slot >= 0 && r.slot <= MAX_SLOT ? r.slot : 0
    const params: RenderParams = { layoutPath: file, xmlContent, device, theme: cleanTheme(r.theme), night: r.night === true, locale: cleanLocale(r.locale) }
    const prepared = model ? await model.prepare(file) : { key: 'framework', frameworkOnly: true }
    const key = renderKey(params, prepared.key)
    const hit = cache.get(key)
    if (hit) {
      const pngUrl = hit.png ? await snapUrl(hit.png, key) : null
      if (!hit.png || pngUrl) return { ...hit.result, pngUrl, cached: true }
      cache.delete(key)
    }
    let res: DaemonRenderResult
    try {
      await fs.mkdir(renderDir, { recursive: true })
      res = await daemon.render(params, `${event.sender.id}:${file}:${slot}`)
    } catch (err) {
      if (err instanceof LayoutError) return { ok: false, code: err.code, ...(err.detail ? { detail: err.detail.slice(-600) } : {}) }
      return { ok: false, code: 'render-failed' }
    }
    let pngUrl: string | null = null
    let snap: string | null = null
    if (typeof res.png === 'string' && path.isAbsolute(res.png)) {
      realRender ??= await fs.realpath(renderDir).catch(() => null)
      const png = await fs.realpath(res.png).catch(() => null)
      if (realRender && png && isWithin(realRender, png, platform) && path.extname(png).toLowerCase() === '.png') {
        // The daemon keeps only its last 8 PNGs; the cache needs its own copy to stay valid.
        await snapReady.catch(() => undefined)
        const copy = path.join(snapDir, `${key}.png`)
        if (await fs.copyFile(png, copy).then(() => true, () => false)) {
          snap = copy
          pngUrl = await snapUrl(copy, key)
        }
        if (!pngUrl) {
          const target = await deps.server.urlFor(png, [realRender])
          if (target) pngUrl = `${target.url}?r=${encodeURIComponent(res.requestId)}`
        }
      }
    }
    const result: CachedRender['result'] = {
      ok: true,
      width: Number(res.width) || device.width,
      height: Number(res.height) || device.height,
      viewTree: cleanTree(res.viewTree),
      diagnostics: cleanDiagnostics(res.diagnostics),
      renderMs: Number(res.renderMs) || 0,
      frameworkOnly: prepared.frameworkOnly,
    }
    if (snap || res.png === null) cache.set(key, { result, png: snap })
    return { ...result, pngUrl, cached: false }
  })

  // Drawable / color state list (v41): any file the explorer may open, judged by folder or root element (≤ 1 MB).
  ipcMain.handle('ccm:drawable-render', async (event, req: unknown): Promise<DrawableRenderResult> => {
    if (!isAppFrame(event)) return { ok: false, code: 'denied' }
    const r = (req ?? {}) as Record<string, unknown>
    const file = await resolveDir(r.file)
    if (!file || path.extname(file).toLowerCase() !== '.xml') return { ok: false, code: 'denied' }
    const device = drawableDevice({ width: r.width, height: r.height, density: r.density })
    if (!device) return { ok: false, code: 'bad-params' }
    const text = cleanText(r.text)
    if (text === null) return { ok: false, code: 'too-large' }
    if (!jarExists()) return { ok: false, code: 'jar-missing' }
    if (!bundle.isReady()) return { ok: false, code: 'bundle-missing' }
    const stat = await fs.stat(file).catch(() => null)
    if (!stat?.isFile()) return { ok: false, code: 'missing' }
    if (text === undefined && stat.size > MAX_XML) return { ok: false, code: 'too-large' }
    const xmlContent = text ?? (await fs.readFile(file, 'utf8').catch(() => null))
    if (xmlContent === null) return { ok: false, code: 'missing' }
    const kind = drawableKind(file, xmlContent)
    if (!kind) return { ok: false, code: 'not-drawable' }
    const states = Array.isArray(r.states) ? [...new Set(r.states.filter((s): s is string => typeof s === 'string' && DRAWABLE_STATES.has(s)))] : []
    const prepared = model ? await model.prepare(file) : { key: 'framework', frameworkOnly: true }
    let res
    try {
      await fs.mkdir(renderDir, { recursive: true })
      res = await daemon.renderDrawable({ path: file, xmlContent, device, night: r.night === true, states, colorList: kind === 'color' }, `${event.sender.id}:${file}:drawable`)
    } catch (err) {
      if (err instanceof LayoutError) return { ok: false, code: err.code, ...(err.detail ? { detail: err.detail.slice(-600) } : {}) }
      return { ok: false, code: 'render-failed' }
    }
    let pngUrl: string | null = null
    if (typeof res.png === 'string' && path.isAbsolute(res.png)) {
      realRender ??= await fs.realpath(renderDir).catch(() => null)
      const png = await fs.realpath(res.png).catch(() => null)
      if (realRender && png && isWithin(realRender, png, platform) && path.extname(png).toLowerCase() === '.png') {
        const target = await deps.server.urlFor(png, [realRender])
        if (target) pngUrl = `${target.url}?r=${encodeURIComponent(res.requestId)}`
      }
    }
    return {
      ok: true,
      kind,
      pngUrl,
      width: Number(res.width) || device.width,
      height: Number(res.height) || device.height,
      swatches: cleanSwatches(res.swatches),
      diagnostics: cleanDiagnostics(res.diagnostics),
      renderMs: Number(res.renderMs) || 0,
      frameworkOnly: prepared.frameworkOnly,
    }
  })

  return {
    dispose: () => {
      for (const ch of CHANNELS) ipcMain.removeHandler(ch)
    },
    stop: () => {
      model?.killNow()
      return daemon.stop()
    },
    killNow: () => {
      model?.killNow()
      daemon.killNow()
    },
    model,
  }
}
