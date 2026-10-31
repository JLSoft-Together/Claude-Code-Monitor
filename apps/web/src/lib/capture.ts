import type { AwakeMode, AwakeState, CaptureConfig, CaptureShotResult, CaptureStatus } from '@ccm/shared'
import { desktop } from './desktop'

interface CaptureBridge {
  awakeState?: () => Promise<AwakeState | null>
  awakeMode?: (mode: AwakeMode) => Promise<AwakeState | null>
  onAwake?: (handler: (state: AwakeState) => void) => () => void
  captureGet?: () => Promise<CaptureStatus | null>
  capturePick?: () => Promise<CaptureStatus | null>
  captureSet?: (patch: Partial<CaptureConfig>) => Promise<CaptureStatus | null>
  captureShot?: (req: { png: string; device: string; frame?: number }) => Promise<CaptureShotResult>
  captureOpen?: () => Promise<boolean>
}
const bridge = desktop as unknown as CaptureBridge | undefined

export const hasAwake = typeof bridge?.awakeState === 'function'
export const hasCapture = typeof bridge?.captureGet === 'function'

const quiet = <T>(p: Promise<T> | undefined, fallback: T): Promise<T> => (p ? p.catch(() => fallback) : Promise.resolve(fallback))

export const awakeState = (): Promise<AwakeState | null> => quiet(bridge?.awakeState?.(), null)
export const setAwakeMode = (mode: AwakeMode): Promise<AwakeState | null> => quiet(bridge?.awakeMode?.(mode), null)
export const onAwake = (handler: (state: AwakeState) => void): (() => void) => bridge?.onAwake?.(handler) ?? (() => undefined)

export const captureStatus = (): Promise<CaptureStatus | null> => quiet(bridge?.captureGet?.(), null)
export const capturePick = (): Promise<CaptureStatus | null> => quiet(bridge?.capturePick?.(), null)
export const captureSet = (patch: Partial<CaptureConfig>): Promise<CaptureStatus | null> => quiet(bridge?.captureSet?.(patch), null)
export const captureOpen = (): Promise<boolean> => quiet(bridge?.captureOpen?.(), false)
export const captureShot = (png: string, device: string, frame?: number): Promise<CaptureShotResult> =>
  quiet(bridge?.captureShot?.({ png, device, ...(frame ? { frame } : {}) }), { ok: false, error: 'failed' } as CaptureShotResult)
