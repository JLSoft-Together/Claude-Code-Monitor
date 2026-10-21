import type { DevBatchResult, DevEvent, DevResult, DevSnapshot } from '@ccm/shared'
import { desktop } from './desktop'

/** v61 ADB devices bridge (main owns adb; the page only sends ids and validated inputs). */
interface DevicesBridge {
  devSnapshot?: () => Promise<DevSnapshot | null>
  devHold?: (on: boolean) => Promise<boolean>
  devConnect?: (address: string) => Promise<DevResult>
  devPair?: (address: string, code: string) => Promise<DevResult>
  devDisconnect?: (ids: string[]) => Promise<DevBatchResult[]>
  devConnectMany?: (ids: string[]) => Promise<DevBatchResult[]>
  devToWifi?: (id: string) => Promise<DevResult>
  devRemove?: (ids: string[]) => Promise<DevResult>
  devAlias?: (id: string, alias: string | null) => Promise<DevResult>
  devAutoConnect?: (on: boolean) => Promise<DevResult>
  devDiscover?: () => Promise<DevBatchResult[] | DevResult>
  devQrStart?: () => Promise<{ id: string; payload: string } | DevResult>
  devQrCancel?: (id: string) => Promise<DevResult>
  onDevEvent?: (handler: (e: DevEvent) => void) => () => void
}

const bridge = desktop as unknown as DevicesBridge | undefined
const unavailable: DevResult = { ok: false, error: 'denied' }

export const hasDevices = typeof bridge?.devSnapshot === 'function'
export const devSnapshot = (): Promise<DevSnapshot | null> => bridge?.devSnapshot?.() ?? Promise.resolve(null)
export const devHold = (on: boolean): Promise<boolean> => bridge?.devHold?.(on) ?? Promise.resolve(false)
export const devConnect = (address: string): Promise<DevResult> => bridge?.devConnect?.(address) ?? Promise.resolve(unavailable)
export const devPair = (address: string, code: string): Promise<DevResult> => bridge?.devPair?.(address, code) ?? Promise.resolve(unavailable)
export const devDisconnect = (ids: string[]): Promise<DevBatchResult[]> => bridge?.devDisconnect?.(ids) ?? Promise.resolve([])
export const devConnectMany = (ids: string[]): Promise<DevBatchResult[]> => bridge?.devConnectMany?.(ids) ?? Promise.resolve([])
export const devToWifi = (id: string): Promise<DevResult> => bridge?.devToWifi?.(id) ?? Promise.resolve(unavailable)
export const devRemove = (ids: string[]): Promise<DevResult> => bridge?.devRemove?.(ids) ?? Promise.resolve(unavailable)
export const devAlias = (id: string, alias: string | null): Promise<DevResult> => bridge?.devAlias?.(id, alias) ?? Promise.resolve(unavailable)
export const devAutoConnect = (on: boolean): Promise<DevResult> => bridge?.devAutoConnect?.(on) ?? Promise.resolve(unavailable)
export const devDiscover = (): Promise<DevBatchResult[] | DevResult> => bridge?.devDiscover?.() ?? Promise.resolve(unavailable)
export const devQrStart = (): Promise<{ id: string; payload: string } | DevResult> => bridge?.devQrStart?.() ?? Promise.resolve(unavailable)
export const devQrCancel = (id: string): Promise<DevResult> => bridge?.devQrCancel?.(id) ?? Promise.resolve(unavailable)
export const onDevEvent = (handler: (e: DevEvent) => void): (() => void) => bridge?.onDevEvent?.(handler) ?? (() => {})
