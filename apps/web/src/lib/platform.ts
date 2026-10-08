import type { OpenApp } from '@ccm/shared'

// The dashboard only runs on the collector's machine, so the browser platform is the collector's platform.
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)

export const openAppKey = (app: OpenApp): string => (app === 'explorer' && isMac ? 'finder' : app)
