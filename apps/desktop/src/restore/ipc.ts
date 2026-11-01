import { promises as fs } from 'node:fs'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { scrubJson } from '../backup/format'
import { dirsExist, type PreviousRun } from './runState'

export interface RestoreIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  previous: PreviousRun
  saveDialog: (event: IpcMainInvokeEvent) => Promise<string | null>
  openDialog: (event: IpcMainInvokeEvent) => Promise<string | null>
}

export type PromptsExportResult = { ok: true; file: string; count: number } | { ok: false; error: 'denied' | 'invalid' | 'cancelled' | 'write' }
export type PromptsImportResult = { ok: true; data: unknown } | { ok: false; error: 'denied' | 'cancelled' | 'too-large' | 'read' | 'invalid' }

// 200 prompts x 8 KB plus JSON overhead.
export const MAX_PROMPTS_FILE = 2 * 1024 * 1024

const CHANNELS = ['ccm:run-state', 'ccm:dirs-exist', 'ccm:prompts-export', 'ccm:prompts-import']

export function promptsFileText(raw: unknown): { text: string; count: number } | null {
  if (typeof raw !== 'string' || raw.length > MAX_PROMPTS_FILE) return null
  try {
    const data = JSON.parse(raw) as { prompts?: unknown } | null
    if (!data || typeof data !== 'object' || !Array.isArray(data.prompts)) return null
    return { text: JSON.stringify(scrubJson(data), null, 1), count: data.prompts.length }
  } catch {
    return null
  }
}

export function registerRestoreIpc(deps: RestoreIpcDeps): () => void {
  const { ipcMain, isAppFrame } = deps
  // Only the first window to ask after a start gets `first`: a second window must not restore the agents again.
  let asked = false

  ipcMain.handle('ccm:run-state', (event) => {
    if (!isAppFrame(event)) return null
    const first = !asked
    asked = true
    return { first, unclean: first && deps.previous.unclean }
  })

  ipcMain.handle('ccm:dirs-exist', (event, paths: unknown) => (isAppFrame(event) ? dirsExist(paths) : null))

  ipcMain.handle('ccm:prompts-export', async (event, raw: unknown): Promise<PromptsExportResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const out = promptsFileText(raw)
    if (!out) return { ok: false, error: 'invalid' }
    const file = await deps.saveDialog(event)
    if (!file) return { ok: false, error: 'cancelled' }
    try {
      await fs.writeFile(file, out.text)
    } catch {
      return { ok: false, error: 'write' }
    }
    return { ok: true, file, count: out.count }
  })

  ipcMain.handle('ccm:prompts-import', async (event): Promise<PromptsImportResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const file = await deps.openDialog(event)
    if (!file) return { ok: false, error: 'cancelled' }
    let text: string
    try {
      if ((await fs.stat(file)).size > MAX_PROMPTS_FILE) return { ok: false, error: 'too-large' }
      text = await fs.readFile(file, 'utf8')
    } catch {
      return { ok: false, error: 'read' }
    }
    try {
      return { ok: true, data: JSON.parse(text.replace(/^﻿/, '')) as unknown }
    } catch {
      return { ok: false, error: 'invalid' }
    }
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
