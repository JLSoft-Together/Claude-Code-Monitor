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

export interface DesktopLook {
  canvas: string
  surface: string
  ink: string
  muted: string
  faint: string
  accent: string
  dark: boolean
}

export type StatusLineState = 'ours' | 'other' | 'none' | 'unreadable'

interface DesktopBridge {
  platform: string
  ptyEndpoint: () => Promise<PtyEndpoint | null>
  /** `near`: the last project; the dialog opens in its parent folder. */
  pickFolder: (near?: string) => Promise<string | null>
  /** Theme canvas colour (#RRGGBB) for the native window background, kept for the next launch. */
  setWindowBackground?: (color: string) => Promise<boolean>
  /** Theme colours (#RRGGBB) for the startup screen and new windows. */
  setAppearance?: (look: DesktopLook) => Promise<boolean>
  /** App zoom (Chromium level, saved by the app); resolves to the new percent. */
  zoomApp?: (action: 'in' | 'out' | 'reset' | 'get') => Promise<number | null>
  /** Claude Code's settings.json statusLine vs the bridge (quick setup). */
  statusLineState?: () => Promise<StatusLineState | null>
  /** Native confirm, then writes the bridge into settings.json. */
  enableStatusLine?: () => Promise<'ok' | 'ours' | 'unreadable' | 'failed' | 'cancelled'>
  /** Native folder picker; the folder becomes readable by browser / file tabs. */
  grantFolder?: () => Promise<string | null>
  logs?: (action: 'copy' | 'save', report: string) => Promise<{ ok: boolean; path?: string } | null>
  onFocus?: (handler: (terminalId: string) => boolean) => void
  onSelect?: (handler: (terminalId: string) => void) => void
  previewUrl?: (path: string) => Promise<PreviewTarget | null>
  readFile?: (path: string) => Promise<FileView | null>
  watch?: (root: string) => Promise<boolean>
  unwatch?: (root: string) => Promise<boolean>
  onPreviewChanged?: (handler: (change: PreviewChange) => void) => () => void
  pickFile?: (kind: 'html' | 'any', near?: string) => Promise<string | null>
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
