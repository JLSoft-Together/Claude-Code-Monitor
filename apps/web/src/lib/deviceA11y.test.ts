import type { DevUiNode } from '@ccm/shared'
import { describe, expect, it } from 'vitest'
import { a11yCheck, a11yCounts, a11yPrompt, contrastRatio, estimateContrast, isBlack, type Pixels } from './deviceA11y'

const node = (over: Partial<DevUiNode>): DevUiNode => ({
  parent: 0,
  depth: 1,
  cls: 'android.widget.TextView',
  resId: '',
  text: '',
  desc: '',
  pkg: 'com.app',
  bounds: [0, 0, 100, 100],
  clickable: false,
  ...over,
})

const root = node({ parent: -1, depth: 0, cls: 'android.widget.FrameLayout', bounds: [0, 0, 400, 800] })

function canvas(width: number, height: number, bg: [number, number, number]): Pixels & { fill: (b: number[], c: [number, number, number]) => void } {
  const data = new Uint8ClampedArray(width * height * 4)
  const fill = (b: number[], c: [number, number, number]): void => {
    for (let y = b[1]!; y < b[3]!; y++)
      for (let x = b[0]!; x < b[2]!; x++) {
        const o = (y * width + x) * 4
        data[o] = c[0]
        data[o + 1] = c[1]
        data[o + 2] = c[2]
        data[o + 3] = 255
      }
  }
  fill([0, 0, width, height], bg)
  return { width, height, data, fill }
}

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2)
  })

  it('estimates text on background from pixels, ignoring anti-aliased edges', () => {
    const px = canvas(100, 40, [255, 255, 255])
    for (let x = 10; x < 90; x += 6) {
      px.fill([x, 10, x + 3, 30], [170, 170, 170])
      px.fill([x + 3, 10, x + 4, 30], [220, 220, 220])
    }
    const est = estimateContrast(px, [0, 0, 100, 40])!
    expect(est.ratio).toBeCloseTo(contrastRatio([170, 170, 170], [255, 255, 255]), 1)
    expect(estimateContrast(canvas(50, 20, [30, 30, 30]), [0, 0, 50, 20])).toBeNull()
  })

  it('detects a black screenshot', () => {
    expect(isBlack(canvas(40, 40, [0, 0, 0]))).toBe(true)
    expect(isBlack(canvas(40, 40, [250, 250, 250]))).toBe(false)
  })
})

describe('a11yCheck', () => {
  const screen = { width: 400, height: 800 }

  it('flags controls without a label unless a child carries one', () => {
    const nodes = [
      root,
      node({ cls: 'android.widget.ImageButton', clickable: true, resId: 'com.app:id/share', bounds: [0, 0, 200, 200] }),
      node({ cls: 'android.widget.LinearLayout', clickable: true, bounds: [0, 200, 400, 400] }),
      node({ parent: 2, depth: 2, text: 'Settings', bounds: [10, 210, 300, 390] }),
      node({ cls: 'android.widget.ImageView', focusable: true, bounds: [0, 400, 200, 600] }),
      node({ cls: 'androidx.recyclerview.widget.RecyclerView', focusable: true, bounds: [0, 600, 400, 800] }),
    ]
    const r = a11yCheck(nodes, { density: null, screen, pixels: null })
    expect(r.findings.map((f) => [f.kind, f.node])).toEqual([
      ['no-label', 1],
      ['no-label', 4],
    ])
    expect(r.contrast).toBe('no-image')
  })

  it('measures touch targets in dp only when the density is known, skips system UI', () => {
    const nodes = [
      root,
      node({ cls: 'android.widget.ImageButton', clickable: true, desc: 'Back', bounds: [0, 0, 84, 84] }),
      node({ cls: 'android.widget.Button', clickable: true, text: 'OK', bounds: [100, 0, 300, 126] }),
      node({ cls: 'android.widget.ImageView', clickable: true, pkg: 'com.android.systemui', bounds: [0, 700, 20, 720] }),
    ]
    const r = a11yCheck(nodes, { density: 420, screen, pixels: null })
    expect(r.findings).toEqual([{ kind: 'small-target', node: 1, wDp: 32, hDp: 32 }])
    expect(a11yCheck(nodes, { density: null, screen, pixels: null }).findings).toEqual([])
  })

  it('reports low contrast text, skips it on black screenshots, flags duplicate descriptions among siblings', () => {
    const px = canvas(200, 400, [255, 255, 255])
    for (let x = 10; x < 90; x += 6) px.fill([x, 10, x + 3, 30], [200, 200, 200])
    for (let x = 10; x < 90; x += 6) px.fill([x, 110, x + 3, 130], [20, 20, 20])
    const nodes = [
      root,
      node({ text: 'Faint', bounds: [0, 0, 200, 80] }),
      node({ text: 'Strong', bounds: [0, 200, 200, 280] }),
      node({ cls: 'android.widget.ImageButton', clickable: true, desc: 'Delete', bounds: [0, 400, 200, 600] }),
      node({ cls: 'android.widget.ImageButton', clickable: true, desc: 'delete', bounds: [200, 400, 400, 600] }),
    ]
    const r = a11yCheck(nodes, { density: null, screen, pixels: px })
    expect(r.findings.map((f) => f.kind)).toEqual(['low-contrast', 'dup-label'])
    expect(r.findings[0]).toMatchObject({ node: 1, fg: '#c8c8c8', bg: '#ffffff' })
    expect(r.findings[0]!.ratio).toBeLessThan(2)
    expect(r.findings[1]).toMatchObject({ node: 4, label: 'delete' })
    const black = a11yCheck(nodes, { density: null, screen, pixels: canvas(200, 400, [0, 0, 0]) })
    expect(black.contrast).toBe('black')
    expect(black.findings.map((f) => f.kind)).toEqual(['dup-label'])
  })

  it('builds a capped prompt with file hits', () => {
    const nodes = [root, node({ cls: 'android.widget.ImageButton', clickable: true, resId: 'com.app:id/share', bounds: [0, 0, 84, 84] })]
    const r = a11yCheck(nodes, { density: 420, screen, pixels: null })
    expect(a11yCounts(r.findings)).toMatchObject({ 'no-label': 1, 'small-target': 1 })
    const text = a11yPrompt(nodes, r.findings, 'Pixel 7', new Map([[1, ['app/src/main/res/layout/main.xml:12']]]))
    expect(text.split('\n')).toEqual([
      'Fix these accessibility problems found on Pixel 7 (Orrery check of the view tree and screenshot):',
      '- @id/share (ImageButton) · no text or contentDescription for screen readers · @app/src/main/res/layout/main.xml:12',
      '- @id/share (ImageButton) · touch target 32×32 dp, needs 48×48 dp · @app/src/main/res/layout/main.xml:12',
    ])
    const many = Array.from({ length: 200 }, () => r.findings[0]!)
    const long = a11yPrompt(nodes, many, 'P', new Map())
    expect(long.length).toBeLessThanOrEqual(6000)
    expect(long).toMatch(/… \d+ more$/)
  })
})
