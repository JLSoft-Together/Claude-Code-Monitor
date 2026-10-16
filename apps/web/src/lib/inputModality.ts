export type InputModality = 'pointer' | 'key'

let last: InputModality = 'pointer'
let installed: EventTarget | null = null

const onPointer = (): void => {
  last = 'pointer'
}

const onKey = (): void => {
  last = 'key'
}

export function watchInputModality(target: EventTarget = window): void {
  if (installed === target) return
  installed?.removeEventListener('pointerdown', onPointer, true)
  installed?.removeEventListener('mousedown', onPointer, true)
  installed?.removeEventListener('keydown', onKey, true)
  installed = target
  target.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
  target.addEventListener('mousedown', onPointer, { capture: true, passive: true })
  target.addEventListener('keydown', onKey, { capture: true, passive: true })
}

export function lastInput(): InputModality {
  return last
}

export const openedByKey = (): boolean => last === 'key'

if (typeof window !== 'undefined') watchInputModality(window)
