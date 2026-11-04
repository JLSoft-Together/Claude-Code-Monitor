import { deviceScreenshot } from './deviceScreenshot'
import { freePort } from './freePort'
import { handBack } from './handBack'
import { listServers } from './listServers'
import { notifyOwner } from './notifyOwner'
import { openInWorkspace } from './openInWorkspace'
import { openSession, openSessionDef } from './openSession'
import { previewLayout } from './previewLayout'
import { runApp } from './runApp'
import { runLog } from './runLog'
import { runStatus } from './runStatus'
import { telegramNotify } from './telegramNotify'
import { telegramReceive } from './telegramReceive'
import { telegramSend } from './telegramSend'
import type { McpTool } from './types'
import { whoIsEditing } from './whoIsEditing'

/** Order is the tools/list order; open_session stays first (older clients and the v49 E2E read tools[0]). */
export const MCP_TOOLS: readonly McpTool[] = [openSession, notifyOwner, openInWorkspace, whoIsEditing, previewLayout, listServers, freePort, runApp, runStatus, runLog, deviceScreenshot, telegramNotify, telegramSend, telegramReceive, handBack]

/** Owner paused agent ↔ DeepSeek over MCP (2026-11-03): no deepseek in open_session, no hand_back. */
export const mcpToolsFor = (deepseek: boolean): readonly McpTool[] =>
  deepseek ? MCP_TOOLS : MCP_TOOLS.filter((t) => t !== handBack).map((t) => (t === openSession ? { ...t, def: openSessionDef(false) } : t))
