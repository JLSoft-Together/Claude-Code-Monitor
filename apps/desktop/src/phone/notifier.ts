import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_PHONE_IDLE_MIN,
  PHONE_CHANNELS,
  PHONE_IDLE_CHOICES,
  type PhoneChannel,
  type PhoneEpisodeMessage,
  type PhoneError,
  type PhonePatch,
  type PhoneSetResult,
  type PhoneState,
  type PhoneTestResult,
} from '@ccm/shared'
import type { TokenCrypt } from '../github/accounts'
import { buildRequest, cleanDiscordUrl, cleanNtfyServer, cleanTopic, hostOf, phoneText, RateLimiter, testText, type PhoneDestination, type PhoneLocale, type PhoneText } from './send'

export const PHONE_FILE = 'phone.json'
export const PHONE_MAX_PER_HOUR = 20
const TIMEOUT_MS = 10_000
const MAX_EPISODES = 500

interface FileShape {
  enabled: boolean
  channel: PhoneChannel
  idleMinutes: number
  /** Sealed with the OS keychain (base64), like GitHub tokens. */
  ntfyServer?: string
  ntfyTopic?: string
  discordUrl?: string
}

export type PhoneFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean }>

export interface PhoneDeps {
  file?: string
  crypt: TokenCrypt
  fetch: PhoneFetch
  /** Seconds since the last keyboard / mouse input on the machine. */
  idleSeconds: () => number
  locale: () => PhoneLocale
  home: string
  platform: string
  now?: () => number
  override?: string | null
  onState?: (state: PhoneState) => void
  /** Called once per run of failures (reset by a success): the in-app notice. */
  onFailure?: (error: PhoneError) => void
}

const DEFAULTS: FileShape = { enabled: false, channel: 'ntfy', idleMinutes: DEFAULT_PHONE_IDLE_MIN }

function readShape(file: string | undefined): FileShape {
  if (!file) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileShape>
    const str = (v: unknown) => (typeof v === 'string' && v.length < 4096 ? v : undefined)
    return {
      enabled: raw.enabled === true,
      channel: (PHONE_CHANNELS as readonly unknown[]).includes(raw.channel) ? (raw.channel as PhoneChannel) : 'ntfy',
      idleMinutes: (PHONE_IDLE_CHOICES as readonly unknown[]).includes(raw.idleMinutes) ? (raw.idleMinutes as number) : DEFAULT_PHONE_IDLE_MIN,
      ntfyServer: str(raw.ntfyServer),
      ntfyTopic: str(raw.ntfyTopic),
      discordUrl: str(raw.discordUrl),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Phone notifications (v76 R6): URLs and topics never go back to the page and are never logged. */
export class PhoneNotifier {
  private data: FileShape
  private readonly limiter: RateLimiter
  private readonly sent = new Set<string>()
  private lastError: PhoneError | null = null

  constructor(private readonly deps: PhoneDeps) {
    this.data = readShape(deps.file)
    this.limiter = new RateLimiter(PHONE_MAX_PER_HOUR, 60 * 60_000, deps.now ?? Date.now)
  }

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private open(sealed: string | undefined): string | null {
    if (!sealed) return null
    try {
      return this.deps.crypt.decrypt(Buffer.from(sealed, 'base64'))
    } catch {
      return null
    }
  }

  private seal(plain: string): string {
    return this.deps.crypt.encrypt(plain).toString('base64')
  }

  destination(): PhoneDestination | null {
    if (this.data.channel === 'discord') {
      const url = this.open(this.data.discordUrl)
      return url ? { channel: 'discord', url } : null
    }
    const url = this.open(this.data.ntfyServer)
    const topic = this.open(this.data.ntfyTopic)
    return url && topic ? { channel: 'ntfy', url, topic } : null
  }

  state(): PhoneState {
    const dest = this.destination()
    return {
      enabled: this.data.enabled,
      channel: this.data.channel,
      idleMinutes: this.data.idleMinutes,
      configured: dest !== null,
      host: dest ? hostOf(dest.url) : null,
      keychain: this.deps.crypt.available(),
      lastError: this.lastError,
    }
  }

  set(patch: PhonePatch): PhoneSetResult {
    const next: FileShape = { ...this.data }
    const secrets = patch.ntfyServer !== undefined || patch.ntfyTopic !== undefined || patch.discordUrl !== undefined
    if (secrets && !this.deps.crypt.available()) return { ok: false, error: 'keychain' }
    if (patch.ntfyServer !== undefined) {
      const v = patch.ntfyServer ? cleanNtfyServer(patch.ntfyServer) : ''
      if (v === null) return { ok: false, error: 'invalid-url' }
      next.ntfyServer = v ? this.seal(v) : undefined
    }
    if (patch.ntfyTopic !== undefined) {
      const v = patch.ntfyTopic ? cleanTopic(patch.ntfyTopic) : ''
      if (v === null) return { ok: false, error: 'invalid-topic' }
      next.ntfyTopic = v ? this.seal(v) : undefined
    }
    if (patch.discordUrl !== undefined) {
      const v = patch.discordUrl ? cleanDiscordUrl(patch.discordUrl) : ''
      if (v === null) return { ok: false, error: 'invalid-url' }
      next.discordUrl = v ? this.seal(v) : undefined
    }
    if (patch.channel) next.channel = patch.channel
    if (patch.idleMinutes !== undefined) next.idleMinutes = patch.idleMinutes
    if (patch.enabled !== undefined) next.enabled = patch.enabled
    this.data = next
    if (secrets || patch.channel) this.lastError = null
    if (!this.save()) return { ok: false, error: 'failed' }
    const state = this.state()
    this.deps.onState?.(state)
    return { ok: true, state }
  }

  /** An episode from the collector: sent at most once, only when enabled and the machine has been idle long enough. */
  async handle(m: PhoneEpisodeMessage): Promise<boolean> {
    if (!this.data.enabled || this.sent.has(m.episode)) return false
    if (this.deps.idleSeconds() < this.data.idleMinutes * 60) return false
    const dest = this.destination()
    if (!dest) return false
    this.sent.add(m.episode)
    if (this.sent.size > MAX_EPISODES) this.sent.delete(this.sent.values().next().value as string)
    return (await this.send(dest, phoneText(m, this.deps.locale(), this.now, this.deps.home, this.deps.platform))) === null
  }

  async test(): Promise<PhoneTestResult> {
    const dest = this.destination()
    if (!dest) return { ok: false, error: 'config' }
    const error = await this.send(dest, testText(this.deps.locale()))
    return error ? { ok: false, error } : { ok: true }
  }

  private async send(dest: PhoneDestination, text: PhoneText): Promise<PhoneError | null> {
    if (!this.limiter.take()) return this.fail('rate')
    const req = buildRequest(dest, text, this.deps.override)
    try {
      const res = await this.deps.fetch(req.url, { ...req.init, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return this.fail('status')
    } catch (err) {
      return this.fail((err as Error)?.name === 'TimeoutError' ? 'timeout' : 'network')
    }
    if (this.lastError) {
      this.lastError = null
      this.deps.onState?.(this.state())
    }
    return null
  }

  private fail(error: PhoneError): PhoneError {
    const first = this.lastError === null
    this.lastError = error
    if (first) {
      this.deps.onFailure?.(error)
      this.deps.onState?.(this.state())
    }
    return error
  }

  private save(): boolean {
    const file = this.deps.file
    if (!file) return true
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
      renameSync(tmp, file)
      return true
    } catch {
      return false
    }
  }
}
