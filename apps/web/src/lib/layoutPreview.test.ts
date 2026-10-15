import { describe, expect, it } from 'vitest'
import en from '../i18n/en'
import vi from '../i18n/vi'
import { BLUEPRINT_MAX, borrowedModel, COMPARE_CAPTION_MIN, DEVICE_PRESETS, boxRect, compareCell, compareCellAt, compareConfigs, deviceFor, dpSize, fitScale, flattenTree, hitTest, isLayoutXml, modelChip, needsModelNotice, nodeForLine, shortClass, stepView, type LayoutModelInfo, type LayoutViewNode } from './layoutPreview'

const node = (cls: string, line: number, bounds: [number, number, number, number], children: LayoutViewNode[] = [], xmlId: string | null = null): LayoutViewNode => ({ class: cls, xmlId, line, column: 1, bounds, children })

// LinearLayout (lines 2-12) > [TextView line 7, FrameLayout line 9 > Button line 10]; a later sibling overlaps the TextView.
const button = node('android.widget.Button', 10, [20, 220, 200, 300])
const frame = node('android.widget.FrameLayout', 9, [0, 200, 1080, 400], [button])
const text = node('android.widget.TextView', 7, [20, 20, 400, 120], [], '@+id/title')
const overlay = node('android.view.View', 11, [300, 100, 500, 150])
const root = node('android.widget.LinearLayout', 2, [0, 0, 1080, 2340], [text, frame, overlay])

describe('layout preview helpers', () => {
  it('hit-tests the deepest, topmost view under a point', () => {
    expect(hitTest(root, 50, 50)).toBe(text)
    expect(hitTest(root, 100, 250)).toBe(button)
    expect(hitTest(root, 900, 250)).toBe(frame)
    expect(hitTest(root, 350, 110)).toBe(overlay)
    expect(hitTest(root, 900, 2000)).toBe(root)
    expect(hitTest(root, 2000, 10)).toBeNull()
    expect(hitTest(null, 0, 0)).toBeNull()
  })

  it('maps an XML line to its view, else the nearest start tag above', () => {
    expect(nodeForLine(root, 10)).toBe(button)
    expect(nodeForLine(root, 7)).toBe(text)
    expect(nodeForLine(root, 8)).toBe(text)
    expect(nodeForLine(root, 3)).toBe(root)
    expect(nodeForLine(root, 1)).toBeNull()
    const sameLine = node('Merge', 4, [0, 0, 10, 10], [node('Inner', 4, [0, 0, 5, 5])])
    expect(nodeForLine(sameLine, 4)?.class).toBe('Inner')
  })

  it('scales device presets and fits them in a box', () => {
    expect(deviceFor('pixel5', false)).toEqual({ width: 1080, height: 2340, density: 440 })
    expect(deviceFor('pixel5', true)).toEqual({ width: 2340, height: 1080, density: 440 })
    expect(deviceFor('nope', false)).toEqual(deviceFor('pixel5', false))
    expect(dpSize(deviceFor('pixel5', false))).toEqual({ width: 393, height: 851 })
    expect(dpSize(deviceFor('tablet', false))).toEqual({ width: 800, height: 1280 })
    expect(fitScale(1080, 2340, 540, 2000)).toBeCloseTo(0.5)
    expect(fitScale(1080, 2340, 2000, 1170)).toBeCloseTo(0.5)
    expect(fitScale(100, 100, 2000, 2000)).toBe(1)
    expect(fitScale(0, 100, 10, 10)).toBe(1)
    for (const d of DEVICE_PRESETS) expect(d.height).toBeGreaterThan(d.width)
  })

  it('recognises res/layout*/ xml files only', () => {
    expect(isLayoutXml('C:\\p\\app\\src\\main\\res\\layout\\activity_main.xml')).toBe(true)
    expect(isLayoutXml('/p/res/layout-land/a.xml')).toBe(true)
    expect(isLayoutXml('/p/res/values/strings.xml')).toBe(false)
    expect(isLayoutXml('/p/layout/a.xml')).toBe(false)
    expect(isLayoutXml('/p/res/layout/a.kt')).toBe(false)
  })

  it('flattens in document order and shortens class names', () => {
    expect(flattenTree(root).map((n) => n.line)).toEqual([2, 7, 9, 10, 11])
    expect(shortClass('android.widget.TextView')).toBe('TextView')
    expect(shortClass('MyView')).toBe('MyView')
  })

  it('has every device label in en and vi', () => {
    for (const d of DEVICE_PRESETS) {
      expect(en.layout.device[d.id as keyof typeof en.layout.device]).toBeTruthy()
      expect(vi.layout.device[d.id as keyof typeof vi.layout.device]).toBeTruthy()
    }
  })
})

describe('project model + compare helpers', () => {
  const target = { root: '/p', module: ':app', name: 'Demo' }
  const info = (state: LayoutModelInfo['state']): LayoutModelInfo => ({ target, state, hasModel: false, themes: [] })

  it('maps the model state to a status chip', () => {
    expect(modelChip(null)).toEqual({ kind: 'framework' })
    expect(modelChip({ target: null, reason: 'no-app', state: { state: 'none' }, hasModel: false, themes: [] })).toEqual({ kind: 'framework' })
    expect(modelChip(info({ state: 'none' }))).toEqual({ kind: 'framework' })
    expect(modelChip(info({ state: 'running', since: 1 }))).toEqual({ kind: 'running' })
    expect(modelChip(info({ state: 'ready', at: 5, resCount: 3, classpathCount: 9, warnings: 0 }))).toEqual({ kind: 'ready', at: 5 })
    expect(modelChip(info({ state: 'error', code: 'timeout', at: 2 }))).toEqual({ kind: 'error', code: 'timeout' })
  })

  it('describes a borrowed app model and offers a picker only for several dependent apps', () => {
    const none = info({ state: 'none' })
    expect(borrowedModel(none)).toBeNull()
    expect(borrowedModel({ ...none, library: { module: ':ui', candidates: [':app'], linked: true } })).toEqual({ library: ':ui', app: ':app', linked: true, choices: [] })
    expect(borrowedModel({ ...none, library: { module: ':ui', candidates: [':app', ':demo'], linked: true } })?.choices).toEqual([':app', ':demo'])
    expect(borrowedModel({ ...none, library: { module: ':ui', candidates: [], linked: false } })).toMatchObject({ linked: false, choices: [] })
  })

  it('suggests the project model only for framework-only renders with missing classes', () => {
    const missing = [{ severity: 'error' as const, message: 'Class not found: com.google.android.material.button.MaterialButton — build the project' }]
    expect(needsModelNotice(true, missing)).toBe(true)
    expect(needsModelNotice(false, missing)).toBe(false)
    expect(needsModelNotice(true, [{ severity: 'warning', message: 'other' }])).toBe(false)
  })

  it('compares light, dark and the other form factor', () => {
    expect(compareConfigs('pixel5', false).map((c) => [c.id, c.deviceId, c.night])).toEqual([
      ['light', 'pixel5', false],
      ['dark', 'pixel5', true],
      ['other', 'tablet', false],
    ])
    expect(compareConfigs('tablet', true)[2]).toMatchObject({ deviceId: 'pixel5', device: { width: 2340, height: 1080 } })
  })

  it('keeps compare cells inside the box (wrap, no sideways scroll)', () => {
    for (const boxW of [240, 600, 1400]) {
      const { cellWidth, scale } = compareCell(1080, 2340, boxW, 800, 3)
      expect(cellWidth).toBeLessThanOrEqual(boxW - 32)
      expect(1080 * scale).toBeLessThanOrEqual(cellWidth + 0.5)
    }
    expect(compareCell(1080, 2340, 1400, 800, 3).cellWidth).toBe(Math.floor((1400 - 32 - 32) / 3))
  })

  it('scales compare cells by zoom: fit wraps, a fixed % is the same for every cell', () => {
    expect(compareCellAt(1080, 2340, 1400, 800, 3, 'fit')).toEqual(compareCell(1080, 2340, 1400, 800, 3))
    const phone = compareCellAt(1080, 2340, 600, 800, 3, 50)
    const tablet = compareCellAt(1600, 2560, 600, 800, 3, 50)
    expect(phone).toEqual({ cellWidth: 540, scale: 0.5 })
    expect(tablet.scale).toBe(phone.scale)
    expect(tablet.cellWidth).toBe(800)
  })

  it('keeps a fixed-zoom compare cell wide enough for its caption', () => {
    expect(compareCellAt(400, 800, 600, 800, 3, 25)).toEqual({ cellWidth: COMPARE_CAPTION_MIN, scale: 0.25 })
    expect(compareCellAt(1080, 2340, 600, 800, 3, 25).cellWidth).toBe(270)
  })

  it('walks the view tree with arrow keys', () => {
    expect(stepView(root, null, 'ArrowDown')).toBe(text)
    expect(stepView(root, text, 'ArrowRight')).toBe(frame)
    expect(stepView(root, frame, 'ArrowLeft')).toBe(text)
    expect(stepView(root, text, 'ArrowLeft')).toBeNull()
    expect(stepView(root, overlay, 'ArrowRight')).toBeNull()
    expect(stepView(root, frame, 'ArrowDown')).toBe(button)
    expect(stepView(root, button, 'ArrowUp')).toBe(frame)
    expect(stepView(root, root, 'ArrowUp')).toBeNull()
    expect(stepView(root, root, 'ArrowRight')).toBeNull()
    expect(stepView(root, text, 'Enter')).toBeNull()
    expect(stepView(null, null, 'ArrowDown')).toBeNull()
  })

  it('does not walk from a view of another tree', () => {
    const other = node('android.widget.Button', 10, [0, 0, 1, 1])
    expect(stepView(root, other, 'ArrowUp')).toBeNull()
  })

  it('has the keys hint in en and vi', () => {
    expect(vi.layout.keys).toBeTruthy()
    expect(vi.layout.keysCompare).toBeTruthy()
    expect(en.layout.keysCompare).toBeTruthy()
  })

  it('maps view bounds to a box at scale, never thinner than 1 px', () => {
    expect(boxRect([20, 220, 200, 300], 0.5)).toEqual({ left: 10, top: 110, width: 90, height: 40 })
    expect(boxRect([5, 5, 5, 6], 0.25)).toEqual({ left: 1.25, top: 1.25, width: 1, height: 1 })
    expect(BLUEPRINT_MAX).toBe(800)
  })

  it('has the model strings in en and vi', () => {
    for (const code of Object.keys(en.layout.model.errors)) expect(vi.layout.model.errors[code as keyof typeof vi.layout.model.errors]).toBeTruthy()
    expect(vi.layout.themePick.auto).toBeTruthy()
  })
})
