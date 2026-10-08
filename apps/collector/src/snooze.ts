import { SNOOZE_MAX_MIN, snoozedUntil, type SnoozeEntry, type TerminalSession } from '@ccm/shared'
import { JsonFile } from './json-file'

export class SnoozeStore {
  private entries = new Map<string, SnoozeEntry>()
  private readonly file: JsonFile | null

  constructor(
    file?: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.file = file ? new JsonFile(file, 500) : null
  }

  async load(): Promise<void> {
    const raw = (await this.file?.read()) as Record<string, Partial<SnoozeEntry>> | null
    if (!raw || typeof raw !== 'object') return
    const at = this.now()
    for (const [id, e] of Object.entries(raw)) {
      if (typeof e?.until === 'number' && e.until > at) this.entries.set(id, { until: e.until, since: typeof e.since === 'string' ? e.since : undefined })
    }
  }

  set(terminal: TerminalSession, minutes: number | null): boolean {
    if (minutes === null) return this.clear(terminal.id)
    if (terminal.status !== 'waiting' || !Number.isFinite(minutes) || minutes < 1 || minutes > SNOOZE_MAX_MIN) return false
    this.entries.set(terminal.id, { until: this.now() + Math.round(minutes) * 60_000, since: terminal.statusSince })
    this.save()
    return true
  }

  clear(id: string): boolean {
    if (!this.entries.delete(id)) return false
    this.save()
    return true
  }

  isSnoozed(terminal: TerminalSession, nowMs = this.now()): boolean {
    return snoozedUntil(this.entries.get(terminal.id), terminal, nowMs) !== null
  }

  prune(alive: Iterable<TerminalSession>): boolean {
    const at = this.now()
    const byId = new Map<string, TerminalSession>()
    for (const t of alive) byId.set(t.id, t)
    let changed = false
    for (const [id, e] of this.entries) {
      const t = byId.get(id)
      if (snoozedUntil(e, t, at) !== null) continue
      this.entries.delete(id)
      changed = true
    }
    if (changed) this.save()
    return changed
  }

  all(): Record<string, SnoozeEntry> {
    return Object.fromEntries(this.entries)
  }

  private save(): void {
    this.file?.schedule(() => this.all())
  }
}
