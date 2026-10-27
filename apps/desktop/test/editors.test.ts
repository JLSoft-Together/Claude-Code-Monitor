import { describe, expect, it } from 'vitest'
import type { IpcMain, IpcMainEvent } from 'electron'
import { createEditorTracker } from '../src/editors'

type Handler = (event: IpcMainEvent, ...args: unknown[]) => void

function setup() {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
    removeListener: (channel: string) => handlers.delete(channel),
  } as unknown as IpcMain
  const tracker = createEditorTracker({ ipcMain, isAppSender: () => true })
  const page = (id: number) => ({ sender: { id, once: () => undefined, on: () => undefined } }) as unknown as IpcMainEvent
  const dirty = (id: number, files: unknown, autoSave?: unknown) => handlers.get('ccm:editor-dirty')!(page(id), files, autoSave)
  return { tracker, dirty }
}

const file = { name: 'a.ts', path: '/repo/a.ts' }

describe('editor tracker: auto save flag (v62)', () => {
  it('is off without unsaved editors', () => {
    expect(setup().tracker.autoSave()).toBe(false)
  })

  it('is on only when every page with unsaved editors has auto save on', () => {
    const { tracker, dirty } = setup()
    dirty(1, [file], true)
    expect(tracker.autoSave()).toBe(true)
    dirty(2, [file], false)
    expect(tracker.autoSave()).toBe(false)
    dirty(2, [])
    expect(tracker.autoSave()).toBe(true)
  })

  it('treats anything but true as off', () => {
    const { tracker, dirty } = setup()
    dirty(1, [file], 'yes')
    expect(tracker.autoSave()).toBe(false)
    dirty(1, [file])
    expect(tracker.autoSave()).toBe(false)
  })
})
