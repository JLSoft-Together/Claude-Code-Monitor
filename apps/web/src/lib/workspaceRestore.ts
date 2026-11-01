import { ref, watch } from 'vue'
import { desktop } from './desktop'

export const RESTORE_MODES = ['ask', 'auto', 'off'] as const
export type RestoreMode = (typeof RESTORE_MODES)[number]

const MODE_KEY = 'ccm.workspace.restoreMode'
const LOGIN_HINT_KEY = 'ccm.workspace.loginHintOff'

interface RestoreBridge {
  runState?: () => Promise<{ first: boolean; unclean: boolean } | null>
  dirsExist?: (paths: string[]) => Promise<boolean[] | null>
}
const bridge = desktop as unknown as RestoreBridge | undefined

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage blocked: the choice lasts until reload
  }
}

export const isRestoreMode = (v: unknown): v is RestoreMode => typeof v === 'string' && (RESTORE_MODES as readonly string[]).includes(v)

const stored = read(MODE_KEY)
export const restoreMode = ref<RestoreMode>(isRestoreMode(stored) ? stored : 'ask')
watch(restoreMode, (m) => write(MODE_KEY, m))

export const loginHintOff = ref(read(LOGIN_HINT_KEY) === '1')
watch(loginHintOff, (off) => write(LOGIN_HINT_KEY, off ? '1' : '0'))

/** Set once per app start when the previous run was not quit through the app: the picker says so and ticks every project. */
export const uncleanExit = ref(false)

let runInfo: Promise<{ first: boolean; unclean: boolean }> | null = null
export function startupRun(): Promise<{ first: boolean; unclean: boolean }> {
  runInfo ??= (bridge?.runState?.() ?? Promise.resolve(null)).then((r) => r ?? { first: false, unclean: false }).catch(() => ({ first: false, unclean: false }))
  return runInfo
}

/** Folders among `dirs` that no longer exist; unknown (no bridge) means none are reported gone. */
export async function goneDirs(dirs: readonly string[]): Promise<Set<string>> {
  const list = [...new Set(dirs)]
  if (!list.length || !bridge?.dirsExist) return new Set()
  const exists = await bridge.dirsExist(list).catch(() => null)
  return new Set(Array.isArray(exists) ? list.filter((_, i) => exists[i] === false) : [])
}

type Restorer = (run: ReadonlySet<string> | undefined, gone: ReadonlySet<string>) => void
let mounted: Restorer | null = null
/** WorkspaceView registers its restore (it adopts the new panes for "open on start"); before it mounts, the store restores directly. */
export function setRestorer(fn: Restorer | null): void {
  mounted = fn
}

let restoring = false
export async function restoreWith(homes: readonly string[], run: ReadonlySet<string> | undefined, fallback: Restorer): Promise<void> {
  if (restoring) return
  restoring = true
  try {
    const gone = await goneDirs(homes)
    ;(mounted ?? fallback)(run, gone)
  } finally {
    restoring = false
  }
}
