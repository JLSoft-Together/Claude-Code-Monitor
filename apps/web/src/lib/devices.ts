import type { AvdList, AvdResult, AvdStartMode, AppDataList, AppDbOpen, AppDbRows, AppPrefs, PrefEdit, DevBatchResult, DevCapture, DevEvent, DevFailure, DevLaunch, DevManifest, DevResult, DevSnapshot, DevUiChange, DevUiDump, DevUiResult } from '@ccm/shared'
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
  devScreencap?: (id: string) => Promise<DevCapture>
  devUiDump?: (id: string) => Promise<DevUiDump>
  devUiRead?: (id: string, pkg: string | null) => Promise<DevUiResult>
  devUiSet?: (id: string, change: DevUiChange, pkg: string | null) => Promise<DevUiResult>
  devUiRestore?: (id: string, pkg: string | null) => Promise<DevUiResult>
  devManifest?: (dir: string) => Promise<DevManifest>
  devLaunch?: (id: string, target: DevLaunch) => Promise<DevResult>
  onDevEvent?: (handler: (e: DevEvent) => void) => () => void
  avdList?: () => Promise<AvdList>
  avdStart?: (name: string, mode: AvdStartMode) => Promise<AvdResult>
  avdStop?: (name: string) => Promise<AvdResult>
  appDataList?: (id: string, pkg: string) => Promise<AppDataList>
  appDataDbOpen?: (id: string, pkg: string, name: string) => Promise<AppDbOpen>
  appDataDbRows?: (handle: string, table: string, page: number) => Promise<AppDbRows>
  appDataDbQuery?: (handle: string, sql: string) => Promise<AppDbRows>
  appDataDbClose?: (handle: string) => Promise<boolean>
  appDataPrefsRead?: (id: string, pkg: string, name: string) => Promise<AppPrefs>
  appDataPrefsWrite?: (id: string, pkg: string, name: string, edit: PrefEdit) => Promise<AppPrefs>
  appDataPrefsRestore?: (id: string, pkg: string, name: string) => Promise<AppPrefs>
}

const bridge = desktop as unknown as DevicesBridge | undefined
const unavailable: DevFailure = { ok: false, error: 'denied' }

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
export const hasEmulators = typeof bridge?.avdList === 'function'
export const avdList = (): Promise<AvdList> => bridge?.avdList?.() ?? Promise.resolve(unavailable)
/** Wipe asks for a native confirm in main first. */
export const avdStart = (name: string, mode: AvdStartMode): Promise<AvdResult> => bridge?.avdStart?.(name, mode) ?? Promise.resolve(unavailable)
export const avdStop = (name: string): Promise<AvdResult> => bridge?.avdStop?.(name) ?? Promise.resolve(unavailable)
export const hasDeviceCapture = typeof bridge?.devScreencap === 'function'
export const devScreencap = (id: string): Promise<DevCapture> => bridge?.devScreencap?.(id) ?? Promise.resolve(unavailable)
export const devUiDump = (id: string): Promise<DevUiDump> => bridge?.devUiDump?.(id) ?? Promise.resolve(unavailable)
export const hasDeviceUiTest = typeof bridge?.devUiRead === 'function'
export const devUiRead = (id: string, pkg: string | null): Promise<DevUiResult> => bridge?.devUiRead?.(id, pkg) ?? Promise.resolve(unavailable)
export const devUiSet = (id: string, change: DevUiChange, pkg: string | null): Promise<DevUiResult> => bridge?.devUiSet?.(id, change, pkg) ?? Promise.resolve(unavailable)
export const devUiRestore = (id: string, pkg: string | null): Promise<DevUiResult> => bridge?.devUiRestore?.(id, pkg) ?? Promise.resolve(unavailable)
export const devManifest = (dir: string): Promise<DevManifest> => bridge?.devManifest?.(dir) ?? Promise.resolve(unavailable)
export const devLaunch = (id: string, target: DevLaunch): Promise<DevResult> => bridge?.devLaunch?.(id, target) ?? Promise.resolve(unavailable)
export const hasAppData = typeof bridge?.appDataList === 'function'
export const appDataList = (id: string, pkg: string): Promise<AppDataList> => bridge?.appDataList?.(id, pkg) ?? Promise.resolve(unavailable)
export const appDataDbOpen = (id: string, pkg: string, name: string): Promise<AppDbOpen> => bridge?.appDataDbOpen?.(id, pkg, name) ?? Promise.resolve(unavailable)
export const appDataDbRows = (handle: string, table: string, page: number): Promise<AppDbRows> => bridge?.appDataDbRows?.(handle, table, page) ?? Promise.resolve(unavailable)
export const appDataDbQuery = (handle: string, sql: string): Promise<AppDbRows> => bridge?.appDataDbQuery?.(handle, sql) ?? Promise.resolve(unavailable)
export const appDataDbClose = (handle: string): Promise<boolean> => bridge?.appDataDbClose?.(handle) ?? Promise.resolve(false)
export const appDataPrefsRead = (id: string, pkg: string, name: string): Promise<AppPrefs> => bridge?.appDataPrefsRead?.(id, pkg, name) ?? Promise.resolve(unavailable)
/** Desktop shows the change in a native confirm, force-stops the app and keeps the first original for restore. */
export const appDataPrefsWrite = (id: string, pkg: string, name: string, edit: PrefEdit): Promise<AppPrefs> =>
  bridge?.appDataPrefsWrite?.(id, pkg, name, { ...edit, before: Array.isArray(edit.before) ? [...edit.before] : edit.before, after: Array.isArray(edit.after) ? [...edit.after] : edit.after }) ?? Promise.resolve(unavailable)
export const appDataPrefsRestore = (id: string, pkg: string, name: string): Promise<AppPrefs> => bridge?.appDataPrefsRestore?.(id, pkg, name) ?? Promise.resolve(unavailable)
