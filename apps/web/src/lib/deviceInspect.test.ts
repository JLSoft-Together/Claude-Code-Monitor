import { describe, expect, it } from 'vitest'
import type { DevUiNode } from '@ccm/shared'
import type { Pane } from '../stores/workspace'
import { boundsText, idName, nodeAt, nodePrompt, nodeSearch, pathTo, shortClass } from './deviceInspect'
import { handoffPaneFor } from './runUi'

const n = (over: Partial<DevUiNode>): DevUiNode => ({ parent: -1, depth: 0, cls: 'android.view.View', resId: '', text: '', desc: '', pkg: 'com.app', bounds: [0, 0, 0, 0], clickable: false, ...over })

const TREE: DevUiNode[] = [
  n({ cls: 'android.widget.FrameLayout', bounds: [0, 0, 1080, 2400] }),
  n({ parent: 0, depth: 1, cls: 'android.widget.LinearLayout', bounds: [0, 1500, 1080, 2000] }),
  n({ parent: 1, depth: 2, cls: 'android.widget.Button', resId: 'com.app:id/login_button', text: 'Sign in', bounds: [40, 1800, 1040, 1950], clickable: true }),
  n({ parent: 1, depth: 2, cls: 'android.view.View', bounds: [100, 1600, 100, 1700] }),
]

describe('device inspector', () => {
  it('picks the smallest box under the point', () => {
    expect(nodeAt(TREE, 500, 1850)).toBe(2)
    expect(nodeAt(TREE, 500, 1600)).toBe(1)
    expect(nodeAt(TREE, 500, 100)).toBe(0)
    expect(nodeAt(TREE, 2000, 100)).toBe(-1)
    expect(nodeAt(TREE, 100, 1650)).toBe(1)
  })

  it('names ids, classes and bounds', () => {
    expect(idName('com.app:id/login_button')).toBe('login_button')
    expect(idName('android:id/title')).toBe('android:id/title')
    expect(idName('weird')).toBe('weird')
    expect(shortClass('android.widget.Button')).toBe('Button')
    expect(boundsText([1, 2, 3, 4])).toBe('[1,2][3,4]')
    expect(pathTo(TREE, 2)).toEqual([0, 1, 2])
  })

  it('searches by id, then text, then description', () => {
    expect(nodeSearch(TREE[2]!)).toEqual({ q: 'login_button', regex: false, caseSensitive: true, word: true })
    expect(nodeSearch(n({ text: 'Sign in' }))).toEqual({ q: 'Sign in', regex: false, caseSensitive: true, word: false })
    expect(nodeSearch(n({ resId: 'android:id/title' }))!.q).toBe('title')
    expect(nodeSearch(n({ desc: 'Back' }))!.q).toBe('Back')
    expect(nodeSearch(n({}))).toBeNull()
    expect(nodeSearch(n({ text: 'a\nb' }))).toBeNull()
  })

  it('formats a prompt block with secrets masked', () => {
    const text = nodePrompt(n({ cls: 'android.widget.TextView', resId: 'com.app:id/token', text: 'sk-abcdefghijklmnop', desc: 'Token', bounds: [0, 0, 10, 10] }), 'Pixel 8')
    expect(text).toBe(['View on Pixel 8: android.widget.TextView', 'id: @id/token (com.app:id/token)', 'text: "[redacted]"', 'content-desc: "Token"', 'bounds: [0,0][10,10]'].join('\n'))
    expect(text.endsWith('\n')).toBe(false)
  })

  it('hands off to the project agent, else the latest agent anywhere', () => {
    const pane = (key: string, cwd: string, focusedAt: number, preset = 'claude'): Pane => ({ key, kind: 'term', preset, state: 'running', cwd, focusedAt }) as unknown as Pane
    const panes = [pane('a', '/w/app', 1), pane('b', '/w/other', 5), pane('s', '/w/app', 9, 'shell')]
    expect(handoffPaneFor(panes, '/w/app')?.key).toBe('a')
    expect(handoffPaneFor(panes, '/w/none')?.key).toBe('b')
    expect(handoffPaneFor(panes, null)?.key).toBe('b')
    expect(handoffPaneFor([], null)).toBeNull()
  })
})
