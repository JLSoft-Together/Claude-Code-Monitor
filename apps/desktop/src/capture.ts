export const DUST_MAX_PIXELS = 160_000

export function dustSize(width: number, height: number, device: { width: number; height: number }): { width: number; height: number } {
  const w = Math.max(1, Math.min(device.width, Math.round(width)))
  const h = Math.max(1, Math.min(device.height, Math.round(height)))
  const k = Math.min(1, Math.sqrt(DUST_MAX_PIXELS / (w * h)))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}
