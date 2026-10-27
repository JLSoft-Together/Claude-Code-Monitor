/** v62 auto save modes, as VS Code `files.autoSave`. */
export const AUTO_SAVE_MODES = ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'] as const
export type AutoSaveMode = (typeof AUTO_SAVE_MODES)[number]
export const isAutoSaveMode = (value: unknown): value is AutoSaveMode => (AUTO_SAVE_MODES as readonly unknown[]).includes(value)

export const AUTO_SAVE_DELAYS = [500, 1000, 2000, 5000]
export const AUTO_SAVE_DELAY_DEFAULT = 1000

export type AutoSaveTrigger = 'edit' | 'focusOut' | 'windowBlur'

/** Whether `trigger` saves under `mode`; onFocusChange also fires when the window loses focus (VS Code). */
export function firesOn(mode: AutoSaveMode, trigger: AutoSaveTrigger): boolean {
  if (mode === 'afterDelay') return trigger === 'edit'
  if (mode === 'onFocusChange') return trigger === 'focusOut' || trigger === 'windowBlur'
  if (mode === 'onWindowChange') return trigger === 'windowBlur'
  return false
}
