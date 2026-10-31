import type { PhoneError, PhonePatch, PhoneSetResult, PhoneState, PhoneTestResult } from '@ccm/shared'
import { desktop } from './desktop'

export type PhoneEvent = { state: PhoneState } | { failed: PhoneError }

interface PhoneBridge {
  phoneState?: () => Promise<PhoneState | null>
  phoneSet?: (patch: PhonePatch) => Promise<PhoneSetResult>
  phoneTest?: () => Promise<PhoneTestResult>
  onPhone?: (handler: (event: PhoneEvent) => void) => () => void
}
const bridge = desktop as unknown as PhoneBridge | undefined

export const hasPhone = typeof bridge?.phoneState === 'function'

const quiet = <T>(p: Promise<T> | undefined, fallback: T): Promise<T> => (p ? p.catch(() => fallback) : Promise.resolve(fallback))

export const phoneState = (): Promise<PhoneState | null> => quiet(bridge?.phoneState?.(), null)
export const phoneSet = (patch: PhonePatch): Promise<PhoneSetResult> => quiet(bridge?.phoneSet?.(patch), { ok: false, error: 'failed' } as PhoneSetResult)
export const phoneTest = (): Promise<PhoneTestResult> => quiet(bridge?.phoneTest?.(), { ok: false, error: 'network' } as PhoneTestResult)
export const onPhone = (handler: (event: PhoneEvent) => void): (() => void) => bridge?.onPhone?.(handler) ?? (() => undefined)
