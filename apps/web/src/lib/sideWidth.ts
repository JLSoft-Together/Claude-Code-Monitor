/** Workspace sidebar (Projects | Explorer) width, dragged with `SideResizer`. */
export const SIDE_WIDTH_KEY = 'ccm.workspace.sideWidth'
export const SIDE_MIN = 200
export const SIDE_MAX = 560
export const SIDE_DEFAULT = 240
/** Window width kept for the stage (tab strip + panes, page padding and gap included). */
export const STAGE_MIN = 480

/** `px` clamped to [SIDE_MIN, SIDE_MAX] and to what leaves the stage STAGE_MIN of a `viewport`-wide window. */
export function clampSideWidth(px: number, viewport = Infinity): number {
  if (!Number.isFinite(px)) return SIDE_DEFAULT
  const max = Math.max(SIDE_MIN, Math.min(SIDE_MAX, viewport - STAGE_MIN))
  return Math.round(Math.min(max, Math.max(SIDE_MIN, px)))
}

export function readSideWidth(): number {
  try {
    const raw = Number(localStorage.getItem(SIDE_WIDTH_KEY))
    return raw ? clampSideWidth(raw) : SIDE_DEFAULT
  } catch {
    return SIDE_DEFAULT
  }
}

export function writeSideWidth(px: number): void {
  try {
    localStorage.setItem(SIDE_WIDTH_KEY, String(Math.round(px)))
  } catch {
    // preference only
  }
}

/** Pane split (XML layout / widget preview beside code): stacks below 700 px, side by side again above 760 px. */
export const STACK_BELOW = 700
export const UNSTACK_ABOVE = 760

export function nextStacked(stacked: boolean, width: number): boolean {
  if (width <= 0) return stacked
  return stacked ? width <= UNSTACK_ABOVE : width < STACK_BELOW
}
