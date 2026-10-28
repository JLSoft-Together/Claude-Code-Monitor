import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'
import { previewScrollFor } from './markdownSync'

describe('renderMarkdown sourceLines', () => {
  it('tags only top-level blocks with their 1-based source line', () => {
    const html = renderMarkdown('# Title\n\nSome text\nmore\n\n- a\n- b\n\n```\ncode\n```\n> quote', { sourceLines: true })
    expect(html).toContain('<h1 data-src-line="1">')
    expect(html).toContain('<p data-src-line="3">')
    expect(html).toContain('<ul data-src-line="6">')
    expect(html).toContain('<pre data-src-line="9">')
    expect(html).toContain('<blockquote data-src-line="12"><p>')
    expect(html.match(/data-src-line/g)).toHaveLength(5)
  })

  it('leaves the plain render untouched', () => {
    expect(renderMarkdown('# A\n\ntext')).toBe('<h1>A</h1><p>text</p>')
  })
})

describe('previewScrollFor', () => {
  const anchors = [
    { line: 1, top: 0 },
    { line: 11, top: 400 },
    { line: 21, top: 600 },
  ]

  it('interpolates between the blocks around the top line', () => {
    expect(previewScrollFor(anchors, 1, 30, 2000, 500)).toBe(0)
    expect(previewScrollFor(anchors, 6, 30, 2000, 500)).toBe(200)
    expect(previewScrollFor(anchors, 16, 30, 2000, 500)).toBe(500)
  })

  it('runs from the last block to the end of the content', () => {
    expect(previewScrollFor(anchors, 26, 30, 1100, 200)).toBe(850)
  })

  it('falls back to the line ratio and clamps', () => {
    expect(previewScrollFor([], 51, 100, 1100, 100)).toBe(500)
    expect(previewScrollFor([], 500, 100, 1100, 100)).toBe(1000)
    expect(previewScrollFor(anchors, 5, 30, 300, 400)).toBe(0)
  })
})
