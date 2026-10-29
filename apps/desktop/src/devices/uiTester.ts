import { promises as fs } from 'node:fs'
import type { DevFailure, DevUiChange, DevUiResult, DevUiState } from '@ccm/shared'
import type { Collected } from '../run/collect'
import {
  ANIMATION_KEYS,
  changeCommands,
  changedKeys,
  isLocaleList,
  isPackage,
  LOCALE_MIN_SDK,
  parseAppLocales,
  parseDensity,
  parseNight,
  parseSdk,
  parseSetting,
  restoreCommands,
  type UiOriginals,
} from './uiToggles'

export const UI_ORIGINALS_FILE = 'adb-ui-originals.json'
const DEVICES_MAX = 100

export type Shell = (id: string, args: string[]) => Promise<Collected | null>

const failed = (r: Collected | null): boolean => !r || !!r.timedOut || r.code !== 0 || /^(Error|Exception|Unknown|Bad|java\.)/m.test(r.out)

function cleanOriginals(v: unknown): UiOriginals | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const out: UiOriginals = {}
  if (o.night === 'yes' || o.night === 'no' || o.night === 'auto' || o.night === 'custom') out.night = o.night
  if (o.fontScale === null || (typeof o.fontScale === 'string' && /^\d+(\.\d+)?$/.test(o.fontScale))) out.fontScale = o.fontScale
  if (o.density === null || (typeof o.density === 'number' && Number.isInteger(o.density))) out.density = o.density
  if (Array.isArray(o.animations) && o.animations.length === ANIMATION_KEYS.length && o.animations.every((a) => a === null || (typeof a === 'string' && /^\d+(\.\d+)?$/.test(a)))) out.animations = o.animations
  if (o.locales && typeof o.locales === 'object') {
    const l = Object.entries(o.locales as Record<string, unknown>).filter((e): e is [string, string] => isPackage(e[0]) && isLocaleList(e[1]))
    if (l.length) out.locales = Object.fromEntries(l)
  }
  return changedKeys(out).length ? out : null
}

/**
 * Display test settings (dark mode, font scale, density, animations, per-app locale). The value seen before the
 * first change is kept per serial on disk, so Restore all still works after the app or the device restarted.
 */
export class DeviceUiTester {
  private originals: Map<string, UiOriginals> | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly deps: { shell: Shell; file: string }) {}

  private async load(): Promise<Map<string, UiOriginals>> {
    if (this.originals) return this.originals
    const map = new Map<string, UiOriginals>()
    try {
      const raw = JSON.parse(await fs.readFile(this.deps.file, 'utf8')) as { devices?: Record<string, unknown> }
      for (const [id, v] of Object.entries(raw.devices ?? {})) {
        const o = cleanOriginals(v)
        if (o && map.size < DEVICES_MAX) map.set(id, o)
      }
    } catch {
      // missing or unreadable: nothing to restore
    }
    return (this.originals ??= map)
  }

  private persist(): Promise<void> {
    const body = JSON.stringify({ version: 1, devices: Object.fromEntries(this.originals ?? []) }, null, 2)
    const tmp = `${this.deps.file}.tmp`
    this.writing = this.writing.then(async () => {
      try {
        await fs.writeFile(tmp, body, 'utf8')
        await fs.rename(tmp, this.deps.file)
      } catch {
        // a failed write only loses the restore memory for this run
      }
    })
    return this.writing
  }

  private async get(id: string, args: string[]): Promise<string | null> {
    const r = await this.deps.shell(id, args)
    return r && !r.timedOut && r.code === 0 ? r.out : null
  }

  private async sdk(id: string): Promise<number | null> {
    return parseSdk((await this.get(id, ['getprop', 'ro.build.version.sdk'])) ?? '')
  }

  private async rawAnimations(id: string): Promise<(string | null)[]> {
    return Promise.all(ANIMATION_KEYS.map(async (k) => parseSetting((await this.get(id, ['settings', 'get', 'global', k])) ?? '')))
  }

  async read(id: string, pkg: string | null): Promise<DevUiResult> {
    const sdk = await this.sdk(id)
    if (sdk === null) return { ok: false, error: 'not-connected' }
    const [night, font, density, anims] = await Promise.all([
      this.get(id, ['cmd', 'uimode', 'night']),
      this.get(id, ['settings', 'get', 'system', 'font_scale']),
      this.get(id, ['wm', 'density']),
      this.rawAnimations(id),
    ])
    const supported = sdk >= LOCALE_MIN_SDK
    const locale = supported && pkg ? parseAppLocales((await this.get(id, ['cmd', 'locale', 'get-app-locales', pkg])) ?? '') : null
    const state: DevUiState = {
      sdk,
      night: parseNight(night ?? ''),
      fontScale: Number(parseSetting(font ?? '') ?? 1),
      density: parseDensity(density ?? ''),
      animationsOff: anims.every((a) => a !== null && Number(a) === 0),
      locale: { supported, pkg, current: locale },
      changed: changedKeys((await this.load()).get(id)),
    }
    return { ok: true, state }
  }

  /** Reads what `change` will overwrite, unless an older original is already kept. */
  private async remember(id: string, change: DevUiChange, o: UiOriginals): Promise<DevFailure | null> {
    if (change.key === 'night' && !o.night) o.night = parseNight((await this.get(id, ['cmd', 'uimode', 'night'])) ?? '') ?? 'auto'
    else if (change.key === 'fontScale' && o.fontScale === undefined) o.fontScale = parseSetting((await this.get(id, ['settings', 'get', 'system', 'font_scale'])) ?? '')
    else if (change.key === 'density' && o.density === undefined) o.density = parseDensity((await this.get(id, ['wm', 'density'])) ?? '').override
    else if (change.key === 'animations' && !o.animations) o.animations = await this.rawAnimations(id)
    else if (change.key === 'locale' && o.locales?.[change.pkg] === undefined) {
      const cur = parseAppLocales((await this.get(id, ['cmd', 'locale', 'get-app-locales', change.pkg])) ?? '')
      if (cur === null || !isLocaleList(cur)) return { ok: false, error: 'unsupported' }
      o.locales = { ...o.locales, [change.pkg]: cur }
    }
    return null
  }

  async apply(id: string, change: DevUiChange, pkg: string | null): Promise<DevUiResult> {
    const sdk = await this.sdk(id)
    if (sdk === null) return { ok: false, error: 'not-connected' }
    if (change.key === 'locale' && sdk < LOCALE_MIN_SDK) return { ok: false, error: 'unsupported' }
    const map = await this.load()
    const o: UiOriginals = { ...map.get(id) }
    const miss = await this.remember(id, change, o)
    if (miss) return miss
    if (!map.has(id) && map.size >= DEVICES_MAX) map.delete(map.keys().next().value!)
    map.set(id, o)
    await this.persist()
    for (const cmd of changeCommands(change, o)) {
      const r = await this.deps.shell(id, cmd)
      if (failed(r)) return { ok: false, error: 'unsupported', ...(r?.out.trim() ? { detail: r.out.trim().slice(0, 300) } : {}) }
    }
    if (change.key === 'animations' && !change.off) {
      delete o.animations
      if (changedKeys(o).length) map.set(id, o)
      else map.delete(id)
      await this.persist()
    }
    return this.read(id, pkg)
  }

  async restore(id: string, pkg: string | null): Promise<DevUiResult> {
    const map = await this.load()
    const o = map.get(id)
    if (o) {
      let bad: Collected | null | undefined
      for (const cmd of restoreCommands(o)) {
        const r = await this.deps.shell(id, cmd)
        if (failed(r)) bad ??= r
      }
      if (bad !== undefined) return { ok: false, error: 'unsupported', ...(bad?.out.trim() ? { detail: bad.out.trim().slice(0, 300) } : {}) }
      map.delete(id)
      await this.persist()
    }
    return this.read(id, pkg)
  }
}
