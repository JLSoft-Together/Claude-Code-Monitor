import type { Component } from 'vue'

export interface MenuAction {
  id: string
  label: string
  icon?: Component
  /** Display only (the owner binds the key). */
  shortcut?: string
  disabled?: boolean
  /** Second line under the label (why it is disabled, a caveat). */
  hint?: string
  children?: MenuEntry[]
}
export type MenuEntry = MenuAction | { separator: true }

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

const M = 8

export const isSeparator = (e: MenuEntry): e is { separator: true } => 'separator' in e

const clamp = (v: number, max: number): number => Math.max(M, Math.min(v, max))

/**
 * Menu `w`×`h` at `at` (cursor or row rect): right/below, flipped left/up, then clamped `M` px inside the window
 * (a menu taller than the window starts at `M` and scrolls: ContextMenu caps its height).
 */
export function menuPosition(at: Rect, w: number, h: number, vw: number, vh: number): { left: number; top: number; origin: string } {
  const flipX = at.left + w > vw - M
  const flipY = at.bottom + h > vh - M
  return {
    left: clamp(flipX ? at.right - w : at.left, vw - M - w),
    top: clamp(flipY ? at.top - h : at.bottom, vh - M - h),
    origin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`,
  }
}

/** Submenu beside its parent row (right, else left), top aligned with the row (4px for the panel padding), clamped. */
export function submenuPosition(row: Rect, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = row.right + w > vw - M ? Math.max(M, row.left - w) : row.right
  return { left, top: Math.max(M, Math.min(row.top - 4, vh - M - h)) }
}

export function findAction(entries: readonly MenuEntry[], id: string): MenuAction | null {
  for (const e of entries) {
    if (isSeparator(e)) continue
    if (e.id === id) return e
    const hit = e.children ? findAction(e.children, id) : null
    if (hit) return hit
  }
  return null
}
