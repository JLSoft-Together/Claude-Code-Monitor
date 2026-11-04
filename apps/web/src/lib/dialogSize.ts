export type DialogSize = { w: number; h: number }

export function readDialogSize(key: string): DialogSize | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<DialogSize> | null
    return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? { w: v.w!, h: v.h! } : null
  } catch {
    return null
  }
}

export function saveDialogSize(key: string, size: DialogSize | null): void {
  try {
    if (size) localStorage.setItem(key, JSON.stringify(size))
    else localStorage.removeItem(key)
  } catch {
    return
  }
}

export function clampDialogSize(w: number, h: number, min: DialogSize, view: DialogSize, edge: number): DialogSize {
  const maxW = Math.max(min.w, view.w - 2 * edge)
  const maxH = Math.max(min.h, view.h - 2 * edge)
  return { w: Math.round(Math.min(Math.max(w, min.w), maxW)), h: Math.round(Math.min(Math.max(h, min.h), maxH)) }
}
