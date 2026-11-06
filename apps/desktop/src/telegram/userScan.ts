import type { TelegramClient } from 'telegram'
import type { TelegramUserError } from '@ccm/shared'

export interface UserScanKeys {
  apiId: number
  apiHash: string
}

export interface ScannedChat {
  chatId: string
  title: string
  topics: { threadId: number; name: string }[]
}

export type UserLoginResult = { ok: true; session: string; name: string } | { ok: true; next: 'code' | 'password' } | { ok: false; error: TelegramUserError }
export type UserTopicsResult = { ok: true; chats: ScannedChat[] } | { ok: false; error: TelegramUserError }

/** The owner's own Telegram account, used only to read the topic list of forum groups (bots may not call getForumTopics). */
export interface UserScanner {
  sendCode: (keys: UserScanKeys, phone: string) => Promise<UserLoginResult>
  signIn: (code: string) => Promise<UserLoginResult>
  password: (password: string) => Promise<UserLoginResult>
  topics: (keys: UserScanKeys, session: string) => Promise<UserTopicsResult>
  logout: (keys: UserScanKeys, session: string) => Promise<void>
  close: () => Promise<void>
}

const MAX_CHATS = 50
const MAX_TOPICS = 300
const PAGE = 100
const GENERAL_TOPIC = 1

const errorCode = (err: unknown): string => String((err as { errorMessage?: unknown })?.errorMessage ?? (err as Error)?.message ?? '').slice(0, 200)

export function classifyUserError(err: unknown): TelegramUserError {
  const msg = errorCode(err)
  if (/FLOOD|SLOWMODE/.test(msg)) return 'flood'
  if (/PHONE_NUMBER|PHONE_PASSWORD_FLOOD/.test(msg)) return 'phone'
  if (/PHONE_CODE/.test(msg)) return 'code'
  if (/PASSWORD_HASH|SRP_/.test(msg)) return 'password'
  if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|API_ID/.test(msg)) return 'auth'
  if (/timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket|network|disconnect/i.test(msg)) return 'network'
  return 'failed'
}

const displayName = (u: unknown): string => {
  const o = (u ?? {}) as { firstName?: unknown; lastName?: unknown; username?: unknown }
  const name = [o.firstName, o.lastName].filter((x): x is string => typeof x === 'string' && !!x).join(' ')
  return (name || (typeof o.username === 'string' ? `@${o.username}` : 'Telegram')).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, 64)
}

export function createUserScanner(): UserScanner {
  let login: { client: TelegramClient; phone: string; hash: string } | null = null

  async function client(keys: UserScanKeys, session: string): Promise<TelegramClient> {
    const { TelegramClient: Client, sessions, Logger, LogLevel } = await import('./gramjs')
    const c = new Client(new sessions.StringSession(session), keys.apiId, keys.apiHash, { connectionRetries: 2, baseLogger: new Logger(LogLevel.NONE) })
    await c.connect()
    return c
  }

  async function dropLogin(): Promise<void> {
    const c = login?.client
    login = null
    await c?.destroy().catch(() => undefined)
  }

  async function finish(user: unknown): Promise<UserLoginResult> {
    const c = login!.client
    const session = String(c.session.save())
    await dropLogin()
    return { ok: true, session, name: displayName(user) }
  }

  async function passwordStep(password: string): Promise<UserLoginResult> {
    if (!login) return { ok: false, error: 'expired' }
    const { Api, computeCheck } = await import('./gramjs')
    try {
      const srp = await login.client.invoke(new Api.account.GetPassword())
      const res = await login.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(srp, password) }))
      return await finish((res as { user?: unknown }).user)
    } catch (err) {
      return { ok: false, error: classifyUserError(err) }
    }
  }

  return {
    async sendCode(keys, phone) {
      await dropLogin()
      try {
        const { Api } = await import('./gramjs')
        const c = await client(keys, '')
        login = { client: c, phone, hash: '' }
        const sent = await c.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId: keys.apiId, apiHash: keys.apiHash, settings: new Api.CodeSettings({}) }))
        const hash = (sent as { phoneCodeHash?: unknown }).phoneCodeHash
        if (typeof hash !== 'string') return await finish((sent as { authorization?: { user?: unknown } }).authorization?.user)
        login.hash = hash
        return { ok: true, next: 'code' }
      } catch (err) {
        await dropLogin()
        return { ok: false, error: classifyUserError(err) }
      }
    },

    async signIn(code) {
      if (!login) return { ok: false, error: 'expired' }
      const { Api } = await import('./gramjs')
      try {
        const res = await login.client.invoke(new Api.auth.SignIn({ phoneNumber: login.phone, phoneCodeHash: login.hash, phoneCode: code }))
        if (res instanceof Api.auth.AuthorizationSignUpRequired) {
          await dropLogin()
          return { ok: false, error: 'phone' }
        }
        return await finish((res as { user?: unknown }).user)
      } catch (err) {
        if (errorCode(err).includes('SESSION_PASSWORD_NEEDED')) return { ok: true, next: 'password' }
        return { ok: false, error: classifyUserError(err) }
      }
    },

    password: passwordStep,

    async topics(keys, session) {
      let c: TelegramClient | null = null
      try {
        const { Api } = await import('./gramjs')
        c = await client(keys, session)
        const chats: ScannedChat[] = []
        for (const d of await c.getDialogs({ limit: 200 })) {
          const entity = d.entity
          if (!(entity instanceof Api.Channel) || !entity.forum || !entity.megagroup) continue
          const topics: ScannedChat['topics'] = []
          let offsetDate = 0
          let offsetId = 0
          let offsetTopic = 0
          while (topics.length < MAX_TOPICS) {
            const page = await c.invoke(new Api.channels.GetForumTopics({ channel: d.inputEntity, offsetDate, offsetId, offsetTopic, limit: PAGE }))
            const got = page.topics.filter((x): x is InstanceType<typeof Api.ForumTopic> => x instanceof Api.ForumTopic)
            for (const x of got) if (x.id !== GENERAL_TOPIC) topics.push({ threadId: x.id, name: x.title.slice(0, 128) })
            const last = got[got.length - 1]
            if (!last || page.topics.length < PAGE) break
            offsetTopic = last.id
            offsetId = last.topMessage
            offsetDate = (page.messages.find((m) => 'id' in m && m.id === last.topMessage) as { date?: number } | undefined)?.date ?? 0
          }
          chats.push({ chatId: `-100${entity.id.toString()}`, title: (entity.title ?? '').slice(0, 120), topics })
          if (chats.length >= MAX_CHATS) break
        }
        return { ok: true, chats }
      } catch (err) {
        console.warn('[telegram] account topic scan failed:', errorCode(err))
        return { ok: false, error: classifyUserError(err) }
      } finally {
        await c?.destroy().catch(() => undefined)
      }
    },

    async logout(keys, session) {
      let c: TelegramClient | null = null
      try {
        const { Api } = await import('./gramjs')
        c = await client(keys, session)
        await c.invoke(new Api.auth.LogOut())
      } catch {
        // The session is dropped locally either way; the owner can still end it in Telegram › Devices.
      } finally {
        await c?.destroy().catch(() => undefined)
      }
    },

    close: dropLogin,
  }
}
