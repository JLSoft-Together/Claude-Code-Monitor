import type { PtyEndpoint } from '@ccm/shared'
import type { FileView, PreviewChange, PreviewTarget } from './preview'

/** Chord pressed inside a browser pane's <webview>, forwarded by the main process (fields of KeyboardEventInit). */
export interface ForwardedKey {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

interface DesktopBridge {
  platform: string
  ptyEndpoint: () => Promise<PtyEndpoint | null>
  pickFolder: () => Promise<string | null>
  logs?: (action: 'copy' | 'save', report: string) => Promise<{ ok: boolean; path?: string } | null>
  onFocus?: (handler: (terminalId: string) => boolean) => void
  onSelect?: (handler: (terminalId: string) => void) => void
  previewUrl?: (path: string) => Promise<PreviewTarget | null>
  readFile?: (path: string) => Promise<FileView | null>
  watch?: (root: string) => Promise<boolean>
  unwatch?: (root: string) => Promise<boolean>
  onPreviewChanged?: (handler: (change: PreviewChange) => void) => () => void
  pickFile?: (kind: 'html' | 'any') => Promise<string | null>
  openExternal?: (url: string) => Promise<boolean>
  reveal?: (path: string) => Promise<boolean>
  openPath?: (path: string) => Promise<string>
  /** Native "Allow … to open files in <folder>?"; true when the path is (now) readable. */
  requestAccess?: (path: string) => Promise<boolean>
  onForwardKey?: (handler: (key: ForwardedKey) => void) => () => void
}

/** Set by the Electron preload; absent in a plain browser, where terminals stay unavailable. */
export const desktop: DesktopBridge | undefined = (window as unknown as { ccmDesktop?: DesktopBridge }).ccmDesktop

export const hasTerminals = typeof desktop?.ptyEndpoint === 'function'
