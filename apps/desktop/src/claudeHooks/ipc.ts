import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { HooksListResult, HookTestResult, HookToggleResult } from '@ccm/shared'
import { checkDir } from '../extensions/ipc'
import type { HooksManager } from './manager'

export interface HooksIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  manager: HooksManager
}

const CHANNELS = ['ccm:hooks-list', 'ccm:hooks-toggle', 'ccm:hooks-test']

export function registerHooksIpc({ ipcMain, isAppFrame, manager }: HooksIpcDeps): () => void {
  ipcMain.handle('ccm:hooks-list', async (event, rawDir: unknown): Promise<HooksListResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'unavailable' }
    const dir = await checkDir(rawDir)
    if (dir === 'bad') return { ok: false, error: 'invalid' }
    return manager.list(dir)
  })
  ipcMain.handle('ccm:hooks-toggle', async (event, req: unknown): Promise<HookToggleResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'invalid' }
    const r = (req ?? {}) as { id?: unknown; dir?: unknown; on?: unknown }
    const dir = await checkDir(r.dir)
    if (dir === 'bad') return { ok: false, error: 'invalid' }
    return manager.toggle(r.id, dir, r.on)
  })
  ipcMain.handle('ccm:hooks-test', async (event, req: unknown): Promise<HookTestResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'invalid' }
    const r = (req ?? {}) as { id?: unknown; dir?: unknown }
    const dir = await checkDir(r.dir)
    if (dir === 'bad') return { ok: false, error: 'invalid' }
    return manager.test(r.id, dir)
  })
  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
