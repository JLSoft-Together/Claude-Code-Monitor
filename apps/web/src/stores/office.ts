import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { createOfficeSound } from '../office/sound'
import type { OfficeSnapshot } from '@ccm/habblaud/shared/types'
// `world/api` only: the world entry calls Habblaud's `tr()` at load time and is imported lazily by OfficeView.
import { DEFAULT_WORLD_OPTIONS, type WorldApi, type WorldOptions } from '@ccm/habblaud/client/src/world/api'

export type OfficeOptionKey = 'showNames' | 'bubbles' | 'liveliness' | 'dayNight' | 'followSelected'
export type OfficeOptions = Pick<WorldOptions, OfficeOptionKey>

export const OFFICE_OPTIONS_KEY = 'ccm.office.options'
export const OFFICE_SOUND_KEY = 'ccm.office.sound'
export const OFFICE_VOLUME_KEY = 'ccm.office.volume'
/** The scheduler squares the slider (perceptual curve) and the board boosts ×6, so 40 % ≈ Habblaud at full volume. */
export const DEFAULT_OFFICE_VOLUME = 0.4

function readSound(): boolean {
  try {
    return localStorage.getItem(OFFICE_SOUND_KEY) === '1'
  } catch {
    return false
  }
}

/** Saved slider position (0–1); missing or corrupted falls back to the default. */
function readVolume(): number {
  try {
    const raw = localStorage.getItem(OFFICE_VOLUME_KEY)
    const v = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_OFFICE_VOLUME
  } catch {
    return DEFAULT_OFFICE_VOLUME
  }
}
export const BUBBLES: readonly WorldOptions['bubbles'][] = ['all', 'important', 'none']
export const LIVELINESS: readonly WorldOptions['liveliness'][] = ['calm', 'normal', 'lively']

const DEFAULTS: OfficeOptions = {
  showNames: DEFAULT_WORLD_OPTIONS.showNames,
  bubbles: DEFAULT_WORLD_OPTIONS.bubbles,
  liveliness: DEFAULT_WORLD_OPTIONS.liveliness,
  dayNight: DEFAULT_WORLD_OPTIONS.dayNight,
  followSelected: DEFAULT_WORLD_OPTIONS.followSelected,
}

/** Saved office options; every unknown or mistyped field falls back to Habblaud's default. */
export function readOfficeOptions(): OfficeOptions {
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OFFICE_OPTIONS_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
  } catch {
    raw = {}
  }
  const bool = (k: 'showNames' | 'dayNight' | 'followSelected'): boolean => (typeof raw[k] === 'boolean' ? (raw[k] as boolean) : DEFAULTS[k])
  return {
    showNames: bool('showNames'),
    bubbles: BUBBLES.find((b) => b === raw.bubbles) ?? DEFAULTS.bubbles,
    liveliness: LIVELINESS.find((l) => l === raw.liveliness) ?? DEFAULTS.liveliness,
    dayNight: bool('dayNight'),
    followSelected: bool('followSelected'),
  }
}

/** Room of the office agent with this id (a terminal's main agent), or null while the snapshot does not know it. */
export function officeRoomOf(snapshot: OfficeSnapshot | null, agentId: string | undefined): string | null {
  if (!snapshot || !agentId) return null
  return snapshot.agents.find((a) => a.id === agentId)?.roomId ?? null
}

/** Office view state shared by `OfficeView` (owns the world) and the Agent Map toolbar (zoom, overview, options, sound, timelapse). */
export const useOfficeStore = defineStore('office', () => {
  const options = ref<OfficeOptions>(readOfficeOptions())
  /** The live world while the Office view is mounted; shallow so the canvas engine never turns reactive. */
  const world = shallowRef<WorldApi | null>(null)

  /** Ambient sound, off until the owner turns it on. */
  const sound = ref(readSound())
  function setSound(on: boolean): void {
    sound.value = on
    try {
      localStorage.setItem(OFFICE_SOUND_KEY, on ? '1' : '0')
    } catch {
      // Storage blocked: the choice still applies for this session.
    }
  }
  /** Toolbar slider; moving it above zero while muted turns the sound on (dragging to zero never turns it off). */
  const volume = ref(readVolume())
  function setVolume(v: number): void {
    if (!Number.isFinite(v)) return
    volume.value = Math.min(1, Math.max(0, v))
    try {
      localStorage.setItem(OFFICE_VOLUME_KEY, String(volume.value))
    } catch {
      // Storage blocked: the level still applies for this session.
    }
    if (volume.value > 0 && !sound.value) setSound(true)
  }
  // One sound controller per world instance (OfficeView recreates the world on a locale switch).
  watch(
    world,
    (w, _old, onCleanup) => {
      if (!w) return
      const s = createOfficeSound(w, { enabled: () => sound.value, volume: () => volume.value })
      onCleanup(() => s.dispose())
    },
    { flush: 'sync' },
  )

  function setOption<K extends OfficeOptionKey>(key: K, value: OfficeOptions[K]): void {
    options.value = { ...options.value, [key]: value }
    try {
      localStorage.setItem(OFFICE_OPTIONS_KEY, JSON.stringify(options.value))
    } catch {
      // Storage blocked: the choice still applies for this session.
    }
    world.value?.setOptions({ [key]: value } as Partial<WorldOptions>)
  }

  function zoomBy(factor: number): void {
    world.value?.zoomBy(factor)
  }

  function overview(): void {
    world.value?.overview()
  }

  /** Timelapse bar open (toolbar button, key L); `OfficeTimelapse` owns the replay while it is mounted. */
  const timelapse = ref(false)
  /** A recorded moment is on screen instead of the live office (REPLAY badge, sepia canvas). */
  const replaying = ref(false)
  function toggleTimelapse(): void {
    timelapse.value = !timelapse.value
  }

  return { options, world, sound, setSound, volume, setVolume, setOption, zoomBy, overview, timelapse, replaying, toggleTimelapse }
})
