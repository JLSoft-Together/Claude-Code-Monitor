import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { STRIP_AGE_DAYS, isDataAgent, parseCleanRequest, type AgentDataResult, type AgentDataSize, type AgentDataState } from '@ccm/shared'
import type { AgentDataService } from './service'

export interface AgentDataIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  service: AgentDataService
}

const CHANNELS = [
  'ccm:agentdata-state',
  'ccm:agentdata-scan',
  'ccm:agentdata-cancel',
  'ccm:agentdata-clean',
  'ccm:agentdata-strip',
  'ccm:agentdata-move',
  'ccm:agentdata-undo',
  'ccm:agentdata-delete-original',
  'ccm:agentdata-discard',
]

const invalid: AgentDataResult = { ok: false, error: 'invalid' }

export function registerAgentDataIpc({ ipcMain, isAppFrame, service }: AgentDataIpcDeps): () => void {
  const agentOf = (raw: unknown) => (raw && typeof raw === 'object' && isDataAgent((raw as { agent?: unknown }).agent) ? (raw as { agent: 'claude' | 'codex' }).agent : null)
  ipcMain.handle('ccm:agentdata-state', (event): Promise<AgentDataState> | null => (isAppFrame(event) ? service.state() : null))
  ipcMain.handle('ccm:agentdata-scan', (event): Promise<AgentDataSize[] | null> | null => (isAppFrame(event) ? service.scan() : null))
  ipcMain.handle('ccm:agentdata-cancel', (event): boolean => (isAppFrame(event) ? service.cancel() : false))
  ipcMain.handle('ccm:agentdata-clean', (event, raw: unknown) => {
    const req = isAppFrame(event) ? parseCleanRequest(raw) : null
    return req ? service.clean(req) : invalid
  })
  ipcMain.handle('ccm:agentdata-strip', (event, raw: unknown) => {
    const days = raw && typeof raw === 'object' ? (raw as { minDays?: unknown }).minDays : null
    if (!isAppFrame(event) || !STRIP_AGE_DAYS.includes(days as (typeof STRIP_AGE_DAYS)[number])) return invalid
    return service.strip(days as number)
  })
  const byAgent = (channel: string, fn: (agent: 'claude' | 'codex') => Promise<AgentDataResult>): void => {
    ipcMain.handle(channel, (event, raw: unknown) => {
      const agent = isAppFrame(event) ? agentOf(raw) : null
      return agent ? fn(agent) : invalid
    })
  }
  byAgent('ccm:agentdata-move', (a) => service.move(a))
  byAgent('ccm:agentdata-undo', (a) => service.undo(a))
  byAgent('ccm:agentdata-delete-original', (a) => service.deleteOriginal(a))
  byAgent('ccm:agentdata-discard', (a) => service.discard(a))
  return () => {
    for (const c of CHANNELS) ipcMain.removeHandler(c)
  }
}
