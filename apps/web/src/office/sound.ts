// Office ambience (keyboard, elevator, wheels): port of Habblaud's `SoundControl`; its settings UI is the toolbar volume slider.
// The world suggests cues; the scheduler decides. Nothing plays while disabled or hidden; audio unlocks on a gesture.
import { SoundBoard } from '@ccm/habblaud/client/src/audio/board'
import { DEFAULT_SOUND_SETTINGS } from '@ccm/habblaud/client/src/audio/scheduler'
import type { WorldApi } from '@ccm/habblaud/client/src/world/api'

/** Gain before the board's peak limiter (local patch C): the synth voices peak at 0.03–0.11, so volume 1 alone stays faint. */
export const OFFICE_BOOST = 6

// One board per app: it owns the AudioContext, which upstream never closes, and the world is rebuilt on every mount.
let shared: SoundBoard | null = null
function soundBoard(): SoundBoard {
  return (shared ??= new SoundBoard({ boost: OFFICE_BOOST }))
}

export function createOfficeSound(world: WorldApi, opts: { enabled: () => boolean; volume?: () => number }): { dispose(): void } {
  const board = soundBoard()
  const sync = (): boolean => {
    const on = opts.enabled()
    board.configure(on, { ...DEFAULT_SOUND_SETTINGS, volume: opts.volume?.() ?? DEFAULT_SOUND_SETTINGS.volume })
    return on
  }
  const off = world.onSound?.((cue) => {
    if (!sync() || document.hidden) return
    board.play(cue.kind, cue)
  })
  // Browsers (and Electron) only start audio after a user gesture; the click also covers the toggle itself,
  // `change` the volume slider moved by keyboard (its keydown runs before the slider turns the sound on).
  const unlock = (): void => {
    if (sync()) void board.unlock()
  }
  const events = ['pointerdown', 'keydown', 'click', 'change'] as const
  for (const e of events) addEventListener(e, unlock, { passive: true })
  return {
    dispose() {
      off?.()
      for (const e of events) removeEventListener(e, unlock)
    },
  }
}
