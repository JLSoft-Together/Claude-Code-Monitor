import { LAYOUT_DEVICES, type AgentLayoutDevice, type McpDeskError, type McpDeskResult } from '../../../../../packages/shared/src/mcpDesk'
import { PATH_MAX, resolveInside, type InsideError } from './paths'
import { toolResult, type McpTool, type ToolDef } from './types'

export const PREVIEW_RATE_MAX = 10
export const PREVIEW_RATE_MS = 60_000

export const PREVIEW_LAYOUT_TOOL = {
  name: 'preview_layout',
  description:
    "Render an Android XML layout of this session's project (res/layout*/…xml) to a PNG with Orrery's layout preview (layoutlib), and get the image path plus render diagnostics. The first call starts the renderer: it then answers that it is starting and how many seconds to wait before calling again.",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', maxLength: PATH_MAX, description: "Layout XML inside this session's project folder: absolute, or relative to the project folder." },
      device: { type: 'string', enum: [...LAYOUT_DEVICES], default: 'phone', description: 'phone (1080×2340, 440 dpi) or tablet (1600×2560, 320 dpi), portrait.' },
      theme: { type: 'string', enum: ['light', 'dark'], default: 'light', description: 'dark renders with night mode on.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: { title: 'Preview an Android layout', readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

type ArgError = InsideError | 'device' | 'theme' | 'xml' | 'rate'

const ERRORS: Partial<Record<ArgError | McpDeskError, string>> = {
  path: 'path must be a file path (no UNC or device paths).',
  outside: "That file is outside this session's project folder; only layouts of the project can be rendered.",
  missing: 'That file does not exist.',
  folder: 'That is a folder; give a layout XML file.',
  device: 'device must be phone or tablet.',
  theme: 'theme must be light or dark.',
  xml: 'Only .xml layout files can be rendered.',
  rate: 'Too many layouts were rendered from this session in the last minute; wait a little.',
  'not-layout': 'That XML is not a layout (res/layout*/ or a view root element).',
  'too-large': 'That layout is larger than 1 MB.',
  'jar-missing': 'The layout renderer is not built into this Orrery copy.',
  'bundle-missing': 'The layout preview kit (layoutlib, about 170 MB) is not downloaded yet; ask the user to open a layout in Orrery once and download it.',
  'jdk-missing': 'No Java 17+ was found for the layout renderer; ask the user to set one in Orrery Run settings.',
  'jdk-old': 'The Java found for the layout renderer is older than 17; ask the user to set a newer one in Orrery Run settings.',
  'crash-loop': 'The layout renderer crashed several times in a row; it is paused for a few minutes.',
  'render-failed': 'layoutlib could not render this layout.',
  timeout: 'The render took too long; try again.',
  starting: 'The layout renderer is starting.',
  unavailable: 'Orrery cannot render layouts right now.',
  failed: 'Orrery could not render the layout.',
  busy: 'Another render is still running for this session; try again.',
}

function resultText(res: Extract<McpDeskResult, { tool: 'preview_layout' }>): string {
  const head = `Rendered ${res.width}×${res.height} PNG: ${res.png} (${res.renderMs} ms${res.frameworkOnly ? ', framework views only: no project model loaded' : ''}).`
  if (!res.diagnostics.length) return head
  return [head, 'Diagnostics:', ...res.diagnostics.map((d) => `- ${d.severity}${d.line ? ` line ${d.line}` : ''}: ${d.message}`)].join('\n')
}

export const previewLayout: McpTool = {
  def: PREVIEW_LAYOUT_TOOL,
  async call(args, host) {
    const fail = (error: ArgError | McpDeskError, extra: { retryInSec?: number; detail?: string } = {}) => {
      const wait = error === 'starting' ? ` Call again in about ${extra.retryInSec ?? 10} seconds.` : ''
      const detail = extra.detail ? ` (${extra.detail})` : ''
      return toolResult(`${ERRORS[error] ?? ERRORS.failed}${wait}${detail}`, { ok: false, error, ...extra }, true)
    }
    if (!host.take('layout', PREVIEW_RATE_MAX, PREVIEW_RATE_MS)) return fail('rate')
    const device = args.device ?? 'phone'
    if (!(LAYOUT_DEVICES as readonly unknown[]).includes(device)) return fail('device')
    const theme = args.theme ?? 'light'
    if (theme !== 'light' && theme !== 'dark') return fail('theme')
    const target = resolveInside(host.root, args.path)
    if (!target.ok) return fail(target.error)
    if (!/\.xml$/i.test(target.path)) return fail('xml')
    if (!host.desk) return fail('unavailable')
    let res: McpDeskResult
    try {
      res = await host.desk({ tool: 'preview_layout', path: target.path, device: device as AgentLayoutDevice, night: theme === 'dark' })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error, { ...(res.retryInSec ? { retryInSec: res.retryInSec } : {}), ...(res.detail ? { detail: res.detail } : {}) })
    if (res.tool !== 'preview_layout') return fail('failed')
    return toolResult(resultText(res), { ...res, path: target.path })
  },
}
