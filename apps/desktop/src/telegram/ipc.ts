import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  sanitizeCreateTopic,
  sanitizeRouteInput,
  sanitizeTelegramPatch,
  type TelegramCommandResult,
  type TelegramCreateTopicResult,
  type TelegramDiscoverResult,
  type TelegramSetResult,
  type TelegramState,
  type TelegramTestResult,
} from '@ccm/shared'
import type { TelegramNotifier } from './notifier'

const CHANNELS = [
  'ccm:telegram-state',
  'ccm:telegram-set',
  'ccm:telegram-route-set',
  'ccm:telegram-route-remove',
  'ccm:telegram-test',
  'ccm:telegram-command',
  'ccm:telegram-discover',
  'ccm:telegram-create-topic',
  'ccm:telegram-pair',
  'ccm:telegram-unpair',
  'ccm:telegram-receive-command',
]

export function registerTelegramIpc(
  ipcMain: IpcMain,
  isAppFrame: (event: IpcMainInvokeEvent) => boolean,
  tg: TelegramNotifier,
  install: () => Promise<boolean | null>,
  installReceive: () => Promise<boolean | null>,
): () => void {
  ipcMain.handle('ccm:telegram-pair', (event, raw: unknown): TelegramSetResult => (isAppFrame(event) ? tg.pair(raw !== false) : { ok: false, error: 'failed' }))
  ipcMain.handle('ccm:telegram-unpair', (event): TelegramSetResult => (isAppFrame(event) ? tg.unpair() : { ok: false, error: 'failed' }))
  ipcMain.handle('ccm:telegram-receive-command', async (event): Promise<TelegramCommandResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'failed' }
    const done = await installReceive()
    if (done === null) return { ok: false, error: 'cancelled' }
    return done ? { ok: true, state: tg.state() } : { ok: false, error: 'failed' }
  })
  const failed: TelegramSetResult = { ok: false, error: 'failed' }
  ipcMain.handle('ccm:telegram-state', (event): TelegramState | null => (isAppFrame(event) ? tg.state() : null))
  ipcMain.handle('ccm:telegram-set', (event, raw: unknown): TelegramSetResult => {
    const patch = isAppFrame(event) ? sanitizeTelegramPatch(raw) : null
    return patch ? tg.set(patch) : failed
  })
  ipcMain.handle('ccm:telegram-route-set', (event, raw: unknown): TelegramSetResult => {
    const input = isAppFrame(event) ? sanitizeRouteInput(raw) : null
    return input ? tg.setRoute(input) : failed
  })
  ipcMain.handle('ccm:telegram-route-remove', (event, raw: unknown): TelegramSetResult =>
    isAppFrame(event) && typeof raw === 'string' && raw.length < 4096 ? tg.removeRoute(raw) : failed,
  )
  ipcMain.handle('ccm:telegram-test', async (event, raw: unknown): Promise<TelegramTestResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'config' }
    return tg.test(typeof raw === 'string' && raw.length < 4096 ? raw : undefined)
  })
  ipcMain.handle('ccm:telegram-discover', async (event): Promise<TelegramDiscoverResult> => (isAppFrame(event) ? tg.discover() : { ok: false, error: 'config' }))
  ipcMain.handle('ccm:telegram-create-topic', async (event, raw: unknown): Promise<TelegramCreateTopicResult> => {
    const input = isAppFrame(event) ? sanitizeCreateTopic(raw) : null
    return input ? tg.createTopic(input) : { ok: false, error: 'invalid-project' }
  })
  ipcMain.handle('ccm:telegram-command', async (event): Promise<TelegramCommandResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'failed' }
    const done = await install()
    if (done === null) return { ok: false, error: 'cancelled' }
    return done ? { ok: true, state: tg.state() } : { ok: false, error: 'failed' }
  })
  return () => {
    for (const c of CHANNELS) ipcMain.removeHandler(c)
  }
}
