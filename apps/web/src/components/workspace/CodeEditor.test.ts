import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import { EditorView } from '@codemirror/view'
import { i18n } from '../../i18n'
import CodeEditor from './CodeEditor.vue'

interface Api {
  text: () => string
  markSaved: (saved?: string) => void
  setText: (text: string) => void
}

const editorOf = (props: { doc: string; base?: string }) =>
  mount(CodeEditor, { props: { grammar: null, ...props }, global: { plugins: [i18n, createPinia()] }, attachTo: document.body })

describe('CodeEditor', () => {
  it('reports dirty against the disk text, clean again after markSaved and setText', async () => {
    const w = editorOf({ doc: 'hello' })
    const api = w.vm as unknown as Api
    expect(api.text()).toBe('hello')
    const view = EditorView.findFromDOM(w.element.querySelector('.cm-editor') as HTMLElement)!
    view.dispatch({ changes: { from: 5, insert: '!' } })
    await nextTick()
    expect(w.emitted('dirty')?.at(-1)).toEqual([true])
    expect(api.text()).toBe('hello!')
    api.markSaved('hello!')
    expect(w.emitted('dirty')?.at(-1)).toEqual([false])
    view.dispatch({ changes: { from: 0, insert: '>' } })
    expect(w.emitted('dirty')?.at(-1)).toEqual([true])
    api.setText('from disk')
    expect(api.text()).toBe('from disk')
    expect(w.emitted('dirty')?.at(-1)).toEqual([false])
    w.unmount()
  })

  it('starts dirty when re-entered with unsaved text (base = disk text)', () => {
    const w = editorOf({ doc: 'mine', base: 'disk' })
    expect(w.emitted('dirty')?.at(-1)).toEqual([true])
    w.unmount()
  })
})
