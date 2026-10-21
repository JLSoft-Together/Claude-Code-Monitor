// Office ambience (keyboard, elevator, wheels): port of Habblaud's `SoundControl`, minus its settings UI.
// The world suggests cues; the scheduler decides. Nothing plays while disabled or hidden; audio unlocks on a gesture.
import { SoundBoard } from '@ccm/habblaud/client/src/audio/board'
import { DEFAULT_SOUND_SETTINGS } from '@ccm/habblaud/client/src/audio/scheduler'
import type { WorldApi } from '@ccm/habblaud/client/src/world/api'

/** Quiet by default: well under Habblaud's 0.6. */
const OFFICE_VOLUME = 0.35

export function createOfficeSound(world: WorldApi, opts: { enabled: () => boolean }): { dispose(): void } {
  const board = new SoundBoard()
  const sync = (): boolean => {
    const on = opts.enabled()
    board.configure(on, { ...DEFAULT_SOUND_SETTINGS, volume: OFFICE_VOLUME })
    return on
  }
  const off = world.onSound?.((cue) => {
    if (!sync() || document.hidden) return
    board.play(cue.kind, cue)
  })
  // Browsers (and Electron) only start audio after a user gesture; the click also covers the toggle itself.
  const unlock = (): void => {
    if (sync()) void board.unlock()
  }
  const events = ['pointerdown', 'keydown', 'click'] as const
  for (const e of events) addEventListener(e, unlock, { passive: true })
  return {
    dispose() {
      off?.()
      for (const e of events) removeEventListener(e, unlock)
    },
  }
}
