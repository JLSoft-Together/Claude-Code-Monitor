import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { sanitizePhonePatch, type PhoneSetResult, type PhoneState, type PhoneTestResult } from '@ccm/shared'
import type { PhoneNotifier } from './notifier'

const CHANNELS = ['ccm:phone-state', 'ccm:phone-set', 'ccm:phone-test']

export function registerPhoneIpc(ipcMain: IpcMain, isAppFrame: (event: IpcMainInvokeEvent) => boolean, phone: PhoneNotifier): () => void {
  ipcMain.handle('ccm:phone-state', (event): PhoneState | null => (isAppFrame(event) ? phone.state() : null))
  ipcMain.handle('ccm:phone-set', (event, raw: unknown): PhoneSetResult => {
    const patch = isAppFrame(event) ? sanitizePhonePatch(raw) : null
    return patch ? phone.set(patch) : { ok: false, error: 'failed' }
  })
  ipcMain.handle('ccm:phone-test', async (event): Promise<PhoneTestResult> => (isAppFrame(event) ? phone.test() : { ok: false, error: 'config' }))
  return () => {
    for (const c of CHANNELS) ipcMain.removeHandler(c)
  }
}
