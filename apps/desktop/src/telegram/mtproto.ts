import type { TelegramClient } from 'telegram'

export interface BigUploadCreds {
  apiId: number
  apiHash: string
  token: string
  session: string | null
  onSession: (session: string | null) => void
}

export interface BigUploadRequest {
  chatId: string
  threadId: number | null
  file: string
  name: string
  size: number
  caption: string
  /** Fraction 0–1 as GramJS reports it while the parts go up. */
  onProgress?: (fraction: number) => void
}

export type BigUploadError = 'auth' | 'chat' | 'network' | 'failed'
export type BigUploadResult = { ok: true } | { ok: false; error: BigUploadError }

export interface BigUploader {
  upload: (req: BigUploadRequest, creds: BigUploadCreds) => Promise<BigUploadResult>
  close: () => Promise<void>
}

const IDLE_MS = 120_000
const WORKERS = 4
const AUTH_ERRORS = /AUTH_KEY|ACCESS_TOKEN|API_ID|BOT_|SESSION_REVOKED|USER_DEACTIVATED/
const CHAT_ERRORS = /CHANNEL_|CHAT_|PEER_ID|TOPIC_|MESSAGE_THREAD|USER_BANNED|RIGHT_FORBIDDEN|SEND_/

const errorCode = (err: unknown): string => String((err as { errorMessage?: unknown })?.errorMessage ?? (err as Error)?.message ?? '').slice(0, 200)

export function classifyMtprotoError(err: unknown): BigUploadError {
  const msg = errorCode(err)
  if (AUTH_ERRORS.test(msg)) return 'auth'
  if (CHAT_ERRORS.test(msg)) return 'chat'
  if (/timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket|network|disconnect/i.test(msg)) return 'network'
  return 'failed'
}

export function createBigUploader(): BigUploader {
  let client: TelegramClient | null = null
  let key = ''
  let idle: NodeJS.Timeout | null = null
  let queue: Promise<unknown> = Promise.resolve()

  async function close(): Promise<void> {
    if (idle) clearTimeout(idle)
    idle = null
    const c = client
    client = null
    key = ''
    await c?.destroy().catch(() => undefined)
  }

  async function connect(creds: BigUploadCreds): Promise<TelegramClient> {
    const k = `${creds.apiId}:${creds.apiHash}:${creds.token}`
    if (client && key === k) return client
    await close()
    const { TelegramClient: Client, sessions, Logger, LogLevel } = await import('./gramjs')
    const c = new Client(new sessions.StringSession(creds.session ?? ''), creds.apiId, creds.apiHash, { connectionRetries: 3, baseLogger: new Logger(LogLevel.NONE) })
    await c.start({ botAuthToken: creds.token })
    creds.onSession(String(c.session.save()))
    client = c
    key = k
    return c
  }

  async function send(req: BigUploadRequest, creds: BigUploadCreds): Promise<void> {
    const c = await connect(creds)
    const { helpers, CustomFile } = await import('./gramjs')
    // Resolves the group with channels.getChannels (bots may ask with access hash 0) to get the real hash sendMedia needs.
    const peer = await c.getInputEntity(helpers.returnBigInt(req.chatId))
    await c.sendFile(peer, {
      file: new CustomFile(req.name, req.size, req.file),
      caption: req.caption,
      parseMode: 'html',
      forceDocument: true,
      workers: WORKERS,
      ...(req.onProgress ? { progressCallback: req.onProgress } : {}),
      ...(req.threadId ? { replyTo: req.threadId, topMsgId: req.threadId } : {}),
    })
  }

  async function run(req: BigUploadRequest, creds: BigUploadCreds): Promise<BigUploadResult> {
    if (idle) clearTimeout(idle)
    try {
      await send(req, creds)
      return { ok: true }
    } catch (err) {
      const error = classifyMtprotoError(err)
      console.warn('[telegram] mtproto upload failed:', errorCode(err))
      if (error !== 'auth' || !creds.session) return { ok: false, error }
      // A stored session the server no longer knows: log the bot in again once.
      await close()
      creds.onSession(null)
      try {
        await send(req, { ...creds, session: null })
        return { ok: true }
      } catch (retry) {
        return { ok: false, error: classifyMtprotoError(retry) }
      }
    } finally {
      idle = setTimeout(() => void close(), IDLE_MS)
      idle.unref?.()
    }
  }

  return {
    upload(req, creds) {
      const next = queue.then(() => run(req, creds))
      queue = next.catch(() => undefined)
      return next
    },
    close,
  }
}
