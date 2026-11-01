/** Phone notifications (v76 R6): collector episode → desktop main → ntfy / Discord. Off by default. */
export const PHONE_REASONS = ['waiting', 'question', 'permission', 'done', 'job', 'limit', 'disk'] as const
export type PhoneReason = (typeof PHONE_REASONS)[number]

/** Collector → desktop main over the utilityProcess port; quiet hours and snooze are already applied. */
export interface PhoneEpisodeMessage {
  type: 'phone'
  /** One message per episode at most; reminders repeat the key. */
  episode: string
  reason: PhoneReason
  /** Alias the owner set, else the project folder name: never the auto title (summarised from chat). */
  name: string
  tool?: string
  /** Epoch ms the wait / work started. */
  since?: number
  /** `disk`: free space left on the drive named by `name`. */
  freeBytes?: number
}

export const PHONE_CHANNELS = ['ntfy', 'discord'] as const
export type PhoneChannel = (typeof PHONE_CHANNELS)[number]
export const PHONE_IDLE_CHOICES = [0, 5, 10, 15] as const
export const DEFAULT_PHONE_IDLE_MIN = 5

/** What the page may see: never the URL path, topic or webhook. */
export interface PhoneState {
  enabled: boolean
  channel: PhoneChannel
  idleMinutes: number
  configured: boolean
  /** Host of the configured server, for "Sending to ntfy.sh". */
  host: string | null
  keychain: boolean
  lastError: PhoneError | null
}

export type PhoneError = 'network' | 'status' | 'timeout' | 'rate' | 'keychain' | 'config'

export interface PhonePatch {
  enabled?: boolean
  channel?: PhoneChannel
  idleMinutes?: number
  /** Write-only secrets; empty string clears. */
  ntfyServer?: string
  ntfyTopic?: string
  discordUrl?: string
}

export type PhoneSetResult = { ok: true; state: PhoneState } | { ok: false; error: 'invalid-url' | 'invalid-topic' | 'keychain' | 'failed' }
export type PhoneTestResult = { ok: true } | { ok: false; error: PhoneError }

const SINCE_MAX = 8_640_000_000_000_000
const NAME_MAX = 80

export function parsePhoneEpisode(raw: unknown): PhoneEpisodeMessage | null {
  const r = raw as Partial<PhoneEpisodeMessage> | null
  if (!r || typeof r !== 'object' || r.type !== 'phone') return null
  if (typeof r.episode !== 'string' || !r.episode || r.episode.length > 300) return null
  if (!(PHONE_REASONS as readonly string[]).includes(r.reason as string)) return null
  if (typeof r.name !== 'string' || !r.name) return null
  const tool = typeof r.tool === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(r.tool) ? r.tool : undefined
  const since = typeof r.since === 'number' && Number.isFinite(r.since) && r.since > 0 && r.since < SINCE_MAX ? r.since : undefined
  const free = typeof r.freeBytes === 'number' && Number.isFinite(r.freeBytes) && r.freeBytes >= 0 ? r.freeBytes : undefined
  return {
    type: 'phone',
    episode: r.episode,
    reason: r.reason as PhoneReason,
    name: r.name.slice(0, NAME_MAX),
    ...(tool ? { tool } : {}),
    ...(since ? { since } : {}),
    ...(free !== undefined ? { freeBytes: free } : {}),
  }
}

export function sanitizePhonePatch(raw: unknown): PhonePatch | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: PhonePatch = {}
  if (r.enabled !== undefined) {
    if (typeof r.enabled !== 'boolean') return null
    out.enabled = r.enabled
  }
  if (r.channel !== undefined) {
    if (!(PHONE_CHANNELS as readonly unknown[]).includes(r.channel)) return null
    out.channel = r.channel as PhoneChannel
  }
  if (r.idleMinutes !== undefined) {
    if (!(PHONE_IDLE_CHOICES as readonly unknown[]).includes(r.idleMinutes)) return null
    out.idleMinutes = r.idleMinutes as number
  }
  for (const k of ['ntfyServer', 'ntfyTopic', 'discordUrl'] as const) {
    const v = r[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || v.length > 500) return null
    out[k] = v.trim()
  }
  return out
}
