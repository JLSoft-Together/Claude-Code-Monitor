export const PRELOAD_IDLE_TIMEOUT_MS = 4000
export const PRELOAD_LOW_BATTERY = 0.2

type IdleFn = (cb: () => void, timeout: number) => void

export interface PreloadEnv {
  doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null
  idle?: IdleFn
  lowPower?: () => Promise<boolean>
  load?: () => Promise<unknown>
}

interface NavLike {
  connection?: { saveData?: boolean }
  getBattery?: () => Promise<{ charging: boolean; level: number }>
}

export type PreloadState = 'idle' | 'waiting' | 'loading' | 'done' | 'skipped'

let state: PreloadState = 'idle'
let running: Promise<void> | null = null

export function preloadState(): PreloadState {
  return state
}

export function preloadDone(): Promise<void> | null {
  return running
}

export function defaultIdle(cb: () => void, timeout: number): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number }).requestIdleCallback
  if (typeof ric === 'function') ric(cb, { timeout })
  else setTimeout(cb, Math.min(timeout, 1500))
}

export async function lowPowerNow(nav: NavLike | undefined = typeof navigator === 'undefined' ? undefined : (navigator as unknown as NavLike)): Promise<boolean> {
  if (!nav) return false
  if (nav.connection?.saveData === true) return true
  if (typeof nav.getBattery !== 'function') return false
  try {
    const b = await nav.getBattery()
    return !b.charging && b.level <= PRELOAD_LOW_BATTERY
  } catch {
    return false
  }
}

async function defaultLoad(): Promise<void> {
  const { loadIsoModules, readIsoUsed } = await import('./index')
  const [, , , { isoArt, prefetchIsoManifests }, { loadIsoFonts }] = await loadIsoModules()
  void loadIsoFonts()
  await prefetchIsoManifests()
  if (readIsoUsed()) await isoArt()
}

export async function warmIsoArt(): Promise<void> {
  const { isoArt } = await import('./isoArt')
  await isoArt()
}

export function scheduleIsoPreload(env: PreloadEnv = {}): boolean {
  if (state !== 'idle') return false
  state = 'waiting'
  const doc = env.doc === undefined ? (typeof document === 'undefined' ? null : document) : env.doc
  const idle = env.idle ?? defaultIdle
  const lowPower = env.lowPower ?? (() => lowPowerNow())
  const load = env.load ?? defaultLoad
  const go = (): void => {
    if (state !== 'waiting') return
    if (doc?.hidden) {
      whenVisible()
      return
    }
    state = 'loading'
    running = lowPower()
      .catch(() => false)
      .then((low) => {
        if (low) {
          state = 'skipped'
          return
        }
        return load().then(
          () => {
            state = 'done'
          },
          () => {
            state = 'done'
          },
        )
      })
  }
  const whenVisible = (): void => {
    if (!doc) {
      go()
      return
    }
    const on = () => {
      if (doc.hidden) return
      doc.removeEventListener('visibilitychange', on)
      idle(go, PRELOAD_IDLE_TIMEOUT_MS)
    }
    doc.addEventListener('visibilitychange', on)
  }
  if (doc?.hidden) whenVisible()
  else idle(go, PRELOAD_IDLE_TIMEOUT_MS)
  return true
}

export function resetIsoPreload(): void {
  state = 'idle'
  running = null
}
