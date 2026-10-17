import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { isLayoutRootName, isLooseLayoutXml } from '@ccm/shared'
import { useWorkspaceStore } from '../stores/workspace'
import { diskChangeAction, editBlock, editorKeepsKey, inEditor, isEditKey, isSaveKey, isSelectAllKey, MAX_EDIT_BYTES, MAX_EDIT_LINES } from './fileEditor'
import { isLayoutXml } from './layoutPreview'
import type { FileView } from './preview'
import { workspaceAction } from './workspaceKeys'

const key = (code: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}, key = ''): KeyboardEvent =>
  new KeyboardEvent('keydown', { code, key, ...mods })

const text = (over: Partial<FileView> = {}): FileView => ({ kind: 'text', path: '/p/a.ts', size: 10, mtimeMs: 1, text: 'x', ...over })

describe('editBlock', () => {
  it('lets small UTF-8 text files be edited', () => {
    expect(editBlock(text(), 10, true)).toBeNull()
  })
  it('keeps big, long, non UTF-8 and non-text files view only', () => {
    expect(editBlock(text({ size: MAX_EDIT_BYTES + 1 }), 10, true)).toBe('large')
    expect(editBlock(text(), MAX_EDIT_LINES + 1, true)).toBe('lines')
    expect(editBlock(text({ invalidUtf8: true }), 10, true)).toBe('encoding')
    expect(editBlock(text({ kind: 'binary' }), 0, true)).toBe('kind')
    expect(editBlock(null, 0, true)).toBe('kind')
    expect(editBlock(text(), 10, false)).toBe('unavailable')
  })
})

describe('diskChangeAction', () => {
  it('ignores the echo of our own save', () => {
    expect(diskChangeAction({ kind: 'text', mtimeMs: 100 }, 100, true)).toBe('ignore')
    expect(diskChangeAction({ kind: 'text', mtimeMs: 100.2 }, 100, false)).toBe('ignore')
    expect(diskChangeAction(null, 100, true)).toBe('ignore')
  })
  it('reloads a clean buffer and never overwrites unsaved edits', () => {
    expect(diskChangeAction({ kind: 'text', mtimeMs: 200 }, 100, false)).toBe('reload')
    expect(diskChangeAction({ kind: 'text', mtimeMs: 200 }, 100, true)).toBe('conflict')
    expect(diskChangeAction({ kind: 'missing', mtimeMs: 0 }, 100, true)).toBe('conflict')
  })
})

describe('editor keys vs workspace chords', () => {
  it('E edits, Ctrl/⌘+S saves', () => {
    expect(isEditKey(key('KeyE', {}, 'e'))).toBe(true)
    expect(isEditKey(key('KeyE', { ctrlKey: true }, 'e'))).toBe(false)
    expect(isSaveKey(key('KeyS', { ctrlKey: true }), false)).toBe(true)
    expect(isSaveKey(key('KeyS', { metaKey: true }), true)).toBe(true)
    expect(isSaveKey(key('KeyS', { ctrlKey: true }), true)).toBe(false)
    expect(isSaveKey(key('KeyS', { ctrlKey: true, shiftKey: true }), false)).toBe(false)
  })

  it('Ctrl/⌘+A selects all', () => {
    expect(isSelectAllKey(key('KeyA', { ctrlKey: true }), false)).toBe(true)
    expect(isSelectAllKey(key('KeyA', { metaKey: true }), true)).toBe(true)
    expect(isSelectAllKey(key('KeyA', { ctrlKey: true }), true)).toBe(false)
    expect(isSelectAllKey(key('KeyA', { ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(isSelectAllKey(key('KeyA', {}), false)).toBe(false)
  })

  it('editor save / find / replace keys are not workspace chords', () => {
    for (const mac of [false, true]) {
      const mod = mac ? { metaKey: true } : { ctrlKey: true }
      expect(workspaceAction(key('KeyS', mod), mac, true)).toBeNull()
      expect(workspaceAction(key('KeyF', mod), mac, true)).toBeNull()
      expect(workspaceAction(key('KeyZ', mod), mac, true)).toBeNull()
    }
    expect(workspaceAction(key('KeyH', { ctrlKey: true }), false, true)).toBeNull()
    expect(workspaceAction(key('KeyF', { metaKey: true, altKey: true }), true, true)).toBeNull()
  })

  it('Alt+↑/↓ stay with the editor (move line); Alt+←/→ and the other chords still reach the workspace', () => {
    expect(editorKeepsKey(key('ArrowUp', { altKey: true }), false)).toBe(true)
    expect(editorKeepsKey(key('ArrowDown', { altKey: true }), false)).toBe(true)
    expect(editorKeepsKey(key('ArrowLeft', { altKey: true }), false)).toBe(false)
    expect(editorKeepsKey(key('KeyW', { ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(editorKeepsKey(key('ArrowUp', { metaKey: true, altKey: true }), true)).toBe(false)
    expect(workspaceAction(key('ArrowLeft', { altKey: true }), false, true)).toEqual({ t: 'focus', dir: 'left' })
  })

  it('knows when the target is inside a CodeMirror editor', () => {
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const content = document.createElement('div')
    editor.append(content)
    expect(inEditor(content)).toBe(true)
    expect(inEditor(document.body)).toBe(false)
    expect(inEditor(null)).toBe(false)
  })
})

describe('loose layout XML (v42 extra)', () => {
  const head = (root: string, ns = ' xmlns:android="http://schemas.android.com/apk/res/android"'): string => `<?xml version="1.0" encoding="utf-8"?>\n<!-- c -->\n<${root}${ns} android:layout_width="match_parent">`

  it('accepts view roots anywhere', () => {
    expect(isLayoutXml('F:\\repo\\bg_native_ad_cta.xml', head('androidx.constraintlayout.widget.ConstraintLayout'))).toBe(true)
    expect(isLayoutXml('/tmp/a.xml', head('LinearLayout'))).toBe(true)
    expect(isLayoutXml('/tmp/a.xml', head('merge'))).toBe(true)
    expect(isLayoutXml('/tmp/a.xml', head('com.example.ui.CardView'))).toBe(true)
  })

  it('refuses drawables, resources and generic XML', () => {
    for (const root of ['shape', 'vector', 'selector', 'manifest', 'resources', 'menu', 'navigation', 'PreferenceScreen', 'androidx.preference.PreferenceScreen', 'MotionScene'])
      expect(isLayoutXml('/tmp/a.xml', head(root))).toBe(false)
    expect(isLayoutXml('/tmp/log4j2.xml', '<Configuration status="warn">')).toBe(false)
    expect(isLayoutXml('/tmp/a.xml', head('LinearLayout', ''))).toBe(false)
    expect(isLayoutXml('/p/res/drawable/a.xml', head('LinearLayout'))).toBe(false)
    expect(isLayoutXml('/p/res/values/a.xml', head('LinearLayout'))).toBe(false)
    expect(isLayoutXml('/tmp/a.txt', head('LinearLayout'))).toBe(false)
    expect(isLayoutXml('/tmp/a.xml')).toBe(false)
  })

  it('keeps res/layout by path alone', () => {
    expect(isLayoutXml('/p/res/layout-land/a.xml')).toBe(true)
  })

  it('names view roots', () => {
    expect(isLayoutRootName('FrameLayout')).toBe(true)
    expect(isLayoutRootName('view')).toBe(true)
    expect(isLayoutRootName('layer-list')).toBe(false)
    expect(isLayoutRootName('android:foo')).toBe(false)
    expect(isLooseLayoutXml('/a.xml', null)).toBe(false)
  })
})

describe('workspace store: dirty file panes', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('a dirty pane is never replaced by opening another file', () => {
    const ws = useWorkspaceStore()
    const a = ws.openFile('/repo/a.ts', undefined, { cwd: '/repo' })
    ws.setDirty(a.key, true)
    const b = ws.openFile('/repo/b.ts', undefined, { cwd: '/repo' })
    expect(b.key).not.toBe(a.key)
    expect(ws.panes.find((p) => p.key === a.key)?.path).toBe('/repo/a.ts')
    expect(ws.dirtyPanes.map((p) => p.key)).toEqual([a.key])
  })

  it('dirty state is never persisted', async () => {
    const ws = useWorkspaceStore()
    const a = ws.openFile('/repo/a.ts')
    ws.setDirty(a.key, true)
    await nextTick()
    const stored = sessionStorage.getItem('ccm.workspace.panes') ?? ''
    expect(stored).toContain('a.ts')
    expect(stored).not.toContain('dirty')
  })

  it('saveFiles calls the registered savers and reports failures', async () => {
    const ws = useWorkspaceStore()
    const a = ws.openFile('/repo/a.ts')
    const b = ws.openFile('/repo/b.ts')
    const c = ws.openFile('/repo/c.ts')
    ws.setDirty(a.key, true)
    ws.setDirty(b.key, true)
    ws.setDirty(c.key, true)
    const saved: string[] = []
    ws.registerSaver(a.key, async () => {
      saved.push('a')
      ws.setDirty(a.key, false)
      return { ok: true }
    })
    ws.registerSaver(b.key, async () => ({ ok: false, error: 'conflict' }))
    const failed = await ws.saveFiles([a.key, b.key, c.key])
    expect(saved).toEqual(['a'])
    expect(failed).toEqual([
      { key: b.key, error: 'conflict' },
      { key: c.key, error: 'unavailable' },
    ])
    expect(ws.dirtyPanes.map((p) => p.key)).toEqual([b.key, c.key])
  })

  it('closing asks when a pane is dirty', () => {
    const ws = useWorkspaceStore()
    const a = ws.openFile('/repo/a.ts')
    ws.setDirty(a.key, true)
    ws.requestClose([a.key], (p) => !!p.dirty)
    expect(ws.pendingClose).toEqual([a.key])
    ws.cancelClose()
    expect(ws.panes).toHaveLength(1)
  })
})
