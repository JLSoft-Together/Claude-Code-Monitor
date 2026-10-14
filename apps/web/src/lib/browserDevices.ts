export type DeviceId = 'responsive' | 'iphone' | 'ipad' | 'laptop' | 'desktop'

export interface Device {
  id: DeviceId
  width: number
  height: number
}

export const DEVICES: readonly Device[] = [
  { id: 'responsive', width: 0, height: 0 },
  { id: 'iphone', width: 390, height: 844 },
  { id: 'ipad', width: 820, height: 1180 },
  { id: 'laptop', width: 1280, height: 800 },
  { id: 'desktop', width: 1440, height: 900 },
]

export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const
export const ZOOM_MIN = 50
export const ZOOM_MAX = 200

export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom) ?? ZOOM_MAX
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom) ?? ZOOM_MIN
}

/** Device frame size (rotated if asked) and the scale that fits it in the stage, never above 1. */
export function frameFit(device: Device, rotated: boolean, stageW: number, stageH: number, gutter = 24): { width: number; height: number; scale: number } | null {
  if (device.id === 'responsive' || !device.width) return null
  const width = rotated ? device.height : device.width
  const height = rotated ? device.width : device.height
  const scale = Math.min(1, Math.max(0.05, (stageW - gutter * 2) / width), Math.max(0.05, (stageH - gutter * 2) / height))
  return { width, height, scale }
}
