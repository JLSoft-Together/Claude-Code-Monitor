import { captureShot, captureStatus, hasCapture } from '../lib/capture'
import { imageData } from '../lib/imageData'
import type { SearchQuery } from '../lib/preview'
import { handoffPaneFor } from '../lib/runUi'
import { useAttachmentsStore } from '../stores/attachments'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'

export type HandoffResult = 'ok' | 'no-agent' | 'failed'

/** Device screenshot / view facts → an agent pane's prompt. Prefill only: the owner presses Enter. */
export function useDeviceHandoff(root: () => string | null) {
  const workspace = useWorkspaceStore()
  const attachments = useAttachmentsStore()
  const ui = useUiStore()

  const target = () => handoffPaneFor(workspace.panes, root())
  const show = (paneKey: string): void => {
    workspace.activate(paneKey)
    if (ui.view !== 'workspace') ui.setView('workspace')
  }

  async function attachImage(png: string, name: string): Promise<HandoffResult> {
    const pane = target()
    if (!pane) return 'no-agent'
    const blob = await fetch(png)
      .then((r) => r.blob())
      .catch(() => null)
    const img = blob ? await imageData(blob) : null
    if (!img) return 'failed'
    attachments.add(pane.key, [{ kind: 'image', name, source: 'paste', ...img }])
    show(pane.key)
    return 'ok'
  }

  /** Capture folder set with "send as file": the PNG goes to `<dir>/shots/` and the agent gets its path; else image bytes. */
  async function attachShot(png: string, device: string, frame?: number): Promise<HandoffResult> {
    const pane = target()
    if (!pane) return 'no-agent'
    const status = hasCapture ? await captureStatus() : null
    if (!status?.active || !status.config.asFile) return attachImage(png, `${device.replace(/[^\w.-]+/g, '-') || 'device'}${frame ? `-frame-${frame}` : ''}.png`)
    const r = await captureShot(png, device, frame)
    if (!r.ok) return 'failed'
    attachments.add(pane.key, [{ kind: 'file', name: r.path.split(/[\\/]/).pop() ?? r.path, source: 'pick', path: r.path }])
    show(pane.key)
    return 'ok'
  }

  function fillText(text: string): HandoffResult {
    const pane = target()
    if (!pane) return 'no-agent'
    workspace.insertInto(pane.key, text)
    if (ui.view !== 'workspace') ui.setView('workspace')
    return 'ok'
  }

  function findInFiles(query: SearchQuery): void {
    workspace.requestSearch(query, root())
    if (ui.view !== 'workspace') ui.setView('workspace')
  }

  return { target, attachImage, attachShot, fillText, findInFiles }
}
