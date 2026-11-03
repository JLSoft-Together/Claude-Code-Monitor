import { isMcpRunId } from '../../../../../packages/shared/src/mcpRun'
import { ask, maskRun, PAGE_ERRORS, refusalText } from './runCommon'
import { toolResult, type McpTool, type ToolDef } from './types'

export const SHOT_RATE_MAX = 10
export const SHOT_RATE_MS = 60_000

export const DEVICE_SCREENSHOT_TOOL = {
  name: 'device_screenshot',
  description:
    "Take a screenshot of a connected Android device (adb screencap) and save it as a PNG in the user's Orrery capture folder (or a temp folder when none is set). Returns the file path and size, so you can look at the image. Default device: the one this project's app runs on, else the only connected one. It never installs anything or changes device settings.",
  inputSchema: {
    type: 'object',
    properties: { serial: { type: 'string', maxLength: 128, description: 'adb serial from run_status. Needed when several devices are connected.' } },
    additionalProperties: false,
  },
  annotations: { title: 'Screenshot an Android device', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
} satisfies ToolDef

export const deviceScreenshot: McpTool = {
  def: DEVICE_SCREENSHOT_TOOL,
  async call(args, host) {
    if (!host.take('shot', SHOT_RATE_MAX, SHOT_RATE_MS))
      return toolResult(`At most ${SHOT_RATE_MAX} screenshots a minute per session; wait a little.`, { ok: false, error: 'rate' }, true)
    const serial = args.serial
    if (serial !== undefined && serial !== null && !isMcpRunId(serial)) return toolResult('serial must be an adb serial from run_status.', { ok: false, error: 'serial' }, true)
    const res = await ask(host, { tool: 'device_screenshot', ...(typeof serial === 'string' ? { serial } : {}) })
    if (!res.ok) return toolResult(PAGE_ERRORS[res.error], res, true)
    if (res.tool !== 'device_screenshot') return toolResult(PAGE_ERRORS.failed, { ok: false, error: 'failed' }, true)
    if (res.refused || !res.shot) {
      const refused = res.refused ?? { code: 'capture-failed' }
      const devices = res.devices?.map((d) => ({ serial: d.serial, name: maskRun(d.name) }))
      const list = devices?.length ? `\nConnected: ${devices.map((d) => `${d.serial} (${JSON.stringify(d.name)})`).join(', ')}` : ''
      return toolResult(refusalText(refused) + list, { ok: false, refused: { code: refused.code }, ...(devices ? { devices } : {}) }, true)
    }
    const s = res.shot
    const where = s.saved === 'capture' ? "the user's capture folder" : 'a temp folder (no capture folder is set in Orrery)'
    return toolResult(`Saved a ${s.width}×${s.height} screenshot of ${JSON.stringify(maskRun(s.name))} (${s.serial}) to ${where}: ${s.path}`, { ok: true, ...s, name: maskRun(s.name) })
  },
}
