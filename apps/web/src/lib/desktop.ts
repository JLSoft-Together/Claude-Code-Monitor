import type { PtyEndpoint } from '@ccm/shared'

interface DesktopBridge {
  platform: string
  ptyEndpoint: () => Promise<PtyEndpoint | null>
  pickFolder: () => Promise<string | null>
  logs?: (action: 'copy' | 'save', report: string) => Promise<{ ok: boolean; path?: string } | null>
  onFocus?: (handler: (terminalId: string) => boolean) => void
  onSelect?: (handler: (terminalId: string) => void) => void
}

/** Set by the Electron preload; absent in a plain browser, where terminals stay unavailable. */
export const desktop: DesktopBridge | undefined = (window as unknown as { ccmDesktop?: DesktopBridge }).ccmDesktop

export const hasTerminals = typeof desktop?.ptyEndpoint === 'function'
