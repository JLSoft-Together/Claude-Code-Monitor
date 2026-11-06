import os from 'node:os'
import type { McpPageError, McpPageResult } from '../../../../../packages/shared/src/mcpCall'
import type { McpRunRefusal, McpRunSessionInfo } from '../../../../../packages/shared/src/mcpRun'
import { createLogMasker } from '../../../../../packages/shared/src/secretMask'
import type { PageAsk, ToolHost } from './types'

let masker: ((text: string) => string) | null = null

/** Run output is masked in main already; the host masks again because the text crossed the page. */
export const maskRun = (text: string): string => (masker ??= createLogMasker(os.homedir(), process.platform))(text)

export const PAGE_ERRORS: Record<McpPageError, string> = {
  unavailable: 'The Orrery window is not ready right now.',
  caller: 'This session is not an Orrery workspace pane the window knows.',
  limit: 'Orrery could not do that right now.',
  failed: 'Orrery could not do that.',
  target: 'No such session in this project. Call list_sessions for the current ones.',
  busy: 'That session already has a prompt waiting; try again once the user has sent it.',
}

export async function ask(host: ToolHost, call: PageAsk): Promise<McpPageResult> {
  try {
    return await host.page(call)
  } catch {
    return { ok: false, error: 'failed' }
  }
}

const REFUSALS: Record<string, string> = {
  'no-config': 'This project has no Run configuration. The user can add one in the Run pane.',
  config: 'No Run configuration of this project has that id; call run_status for the list.',
  device: 'That device is not one this configuration can run on right now; call run_status for the connected devices.',
  'device-missing': 'No connected device for this configuration; ask the user to connect or start one.',
  'device-unauthorized': 'The device has not authorised this computer for USB debugging yet.',
  running: 'That configuration is already running on that device. Use action reload (hot reload) or restart.',
  'no-session': 'Nothing of this project is running.',
  'not-running': 'The app is not in the running state yet; wait and check run_status.',
  waiting: 'Orrery is still on it (the user may be asked to trust the configuration, or the old run is stopping); check run_status in a few seconds.',
  'run-pending': 'A start of that configuration is already in progress.',
  'reload-unsupported': 'Hot reload works only for Flutter debug runs.',
  'reload-failed': 'The hot reload failed; see run_log.',
  untrusted: 'The user declined to trust this shared Run configuration.',
  'config-missing': 'That Run configuration no longer exists.',
  'session-missing': 'That run already ended.',
  'cwd-missing': "The configuration's folder does not exist.",
  'cwd-outside': "The configuration's folder is outside the project.",
  'no-device': 'No Android device is connected over adb.',
  several: 'More than one device is connected; pass serial.',
  'not-connected': 'That device is not connected and ready.',
  'adb-missing': 'adb was not found; the Android SDK is not set up.',
  secure: 'The app on screen blocks screenshots (secure window).',
  timeout: 'The device did not answer in time.',
  'capture-failed': 'The device returned no screenshot.',
  'write-failed': 'Orrery could not save the screenshot.',
}

export function refusalText(r: McpRunRefusal): string {
  const base = REFUSALS[r.code] ?? `Orrery refused it (${r.code}).`
  return r.detail ? `${base} (${maskRun(r.detail)})` : base
}

export const maskSession = (s: McpRunSessionInfo | null): McpRunSessionInfo | null =>
  s && { ...s, configName: maskRun(s.configName), lastError: s.lastError && maskRun(s.lastError) }

// Names come from the owner / the device: quoted so they read as data, not instructions.
const q = (v: string): string => JSON.stringify(v)

export function sessionLine(s: McpRunSessionInfo): string {
  const on = s.deviceId ? ` on ${q(s.deviceName ?? s.deviceId)} (${s.deviceId})` : ''
  const at = new Date(s.startedAt).toISOString()
  const err = s.lastError ? `; last error: ${s.lastError}` : ''
  return `${q(s.configName)} [${s.configId}, ${s.type}]${on}: ${s.state}${s.state === s.rawState ? '' : ` (${s.rawState})`}, started ${at}${err}`
}
