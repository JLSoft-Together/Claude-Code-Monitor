import { deviceScreenshot } from './deviceScreenshot'
import { freePort } from './freePort'
import { listServers } from './listServers'
import { notifyOwner } from './notifyOwner'
import { openInWorkspace } from './openInWorkspace'
import { openSession } from './openSession'
import { previewLayout } from './previewLayout'
import { runApp } from './runApp'
import { runLog } from './runLog'
import { runStatus } from './runStatus'
import type { McpTool } from './types'
import { whoIsEditing } from './whoIsEditing'

/** Order is the tools/list order; open_session stays first (older clients and the v49 E2E read tools[0]). */
export const MCP_TOOLS: readonly McpTool[] = [openSession, notifyOwner, openInWorkspace, whoIsEditing, previewLayout, listServers, freePort, runApp, runStatus, runLog, deviceScreenshot]
