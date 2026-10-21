import type { OfficeSnapshot } from '@ccm/habblaud/shared/types'
import { localizeSnapshot, type OfficeColors } from './localize'

const FALLBACK: OfficeColors = { claude: '#c15f3c', codex: '#5e4fc0' }

function cssColors(): OfficeColors {
  try {
    const css = getComputedStyle(document.documentElement)
    return {
      claude: css.getPropertyValue('--ccm-agent-claude').trim() || FALLBACK.claude,
      codex: css.getPropertyValue('--ccm-agent-codex').trim() || FALLBACK.codex,
    }
  } catch {
    return FALLBACK
  }
}

/** Raw snapshots in, localized `snapshot` out; satisfies the `store` shape Habblaud's world reads. */
export class OfficeFeed {
  snapshot: OfficeSnapshot | null = null
  private rawLive: OfficeSnapshot | null = null
  private rawReplay: OfficeSnapshot | null = null
  private live: OfficeSnapshot | null = null
  private listeners = new Set<() => void>()
  private colors: () => OfficeColors

  constructor(opts: { colors?: () => OfficeColors } = {}) {
    this.colors = opts.colors ?? cssColors
  }

  get liveSnapshot(): OfficeSnapshot | null {
    return this.live
  }

  get replaying(): boolean {
    return this.rawReplay !== null
  }

  on(_ev: 'snapshot', cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  ingestLive(s: OfficeSnapshot): void {
    this.rawLive = s
    this.live = localizeSnapshot(s, this.colors())
    if (this.rawReplay) return
    this.snapshot = this.live
    this.emit()
  }

  pushReplay(s: OfficeSnapshot): void {
    this.rawReplay = s
    this.snapshot = localizeSnapshot(s, this.colors())
    this.emit()
  }

  stopReplay(): void {
    if (!this.rawReplay) return
    this.rawReplay = null
    this.snapshot = this.live
    this.emit()
  }

  /** Rebuilds the localized snapshots from the raw ones (locale or theme colours changed). */
  relocalize(): void {
    const colors = this.colors()
    if (this.rawLive) this.live = localizeSnapshot(this.rawLive, colors)
    this.snapshot = this.rawReplay ? localizeSnapshot(this.rawReplay, colors) : this.live
    this.emit()
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb()
  }
}

export const officeFeed = new OfficeFeed()
