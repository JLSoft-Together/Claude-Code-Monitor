import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { TelegramUserInput, TelegramUserResult, TelegramChat, TelegramCommandResult, TelegramCreateTopicResult, TelegramDiscoverResult, TelegramPatch, TelegramRouteInput, TelegramSessionRouteInput, TelegramSetResult, TelegramState, TelegramTestResult } from '@ccm/shared'
import {
  hasTelegram,
  onTelegram,
  telegramCreateTopic,
  telegramDiscover,
  telegramInstallCommand,
  telegramInstallReceive,
  telegramPair,
  telegramRouteRemove,
  telegramRouteSet,
  telegramSessionRouteRemove,
  telegramSessionRouteSet,
  telegramSet,
  telegramState,
  telegramTest,
  telegramUnpair,
  telegramUser,
} from '../lib/telegram'

export const useTelegramStore = defineStore('telegram', () => {
  const state = shallowRef<TelegramState | null>(null)
  const chats = shallowRef<TelegramChat[] | null>(null)
  const chatId = ref<string | null>(null)
  const busy = ref(false)
  const scanning = ref(false)
  /** A live scan ran this app run; until then `chats` may be the remembered list. */
  const fresh = ref(false)
  let started = false

  const ready = computed(() => hasTelegram && !!state.value?.configured)
  const enabled = computed(() => !!state.value?.enabled)
  const chat = computed(() => chats.value?.find((c) => c.chatId === chatId.value) ?? null)

  function start(): void {
    if (started || !hasTelegram) return
    started = true
    onTelegram((e) => {
      if ('state' in e) state.value = e.state
    })
    void reload()
  }

  async function reload(): Promise<void> {
    const s = await telegramState()
    if (s) state.value = s
  }

  const keep = <R extends TelegramSetResult | TelegramCommandResult | TelegramCreateTopicResult>(res: R): R => {
    if (res.ok) state.value = res.state
    return res
  }

  const set = async (patch: TelegramPatch): Promise<TelegramSetResult> => keep(await telegramSet(patch))
  const routeSet = async (input: TelegramRouteInput): Promise<TelegramSetResult> => keep(await telegramRouteSet(input))
  const routeRemove = async (project: string): Promise<TelegramSetResult> => keep(await telegramRouteRemove(project))
  const sessionRouteSet = async (input: TelegramSessionRouteInput): Promise<TelegramSetResult> => keep(await telegramSessionRouteSet(input))
  const sessionRouteRemove = async (session: string): Promise<TelegramSetResult> => keep(await telegramSessionRouteRemove(session))
  const installCommand = async (): Promise<TelegramCommandResult> => keep(await telegramInstallCommand())
  const createTopic = async (project: string, name: string): Promise<TelegramCreateTopicResult> => {
    if (!chatId.value) return { ok: false, error: 'chat' }
    const res = keep(await telegramCreateTopic({ chatId: chatId.value, project, name }))
    if (res.ok && chats.value) {
      const id = chatId.value
      chats.value = chats.value.map((c) => (c.chatId === id && !c.topics.some((t) => t.threadId === res.topic.threadId) ? { ...c, topics: [...c.topics, res.topic] } : c))
    }
    return res
  }
  const user = async (input: TelegramUserInput): Promise<TelegramUserResult> => {
    const res = await telegramUser(input)
    if (res.ok) state.value = res.state
    return res
  }
  const pair = async (on: boolean): Promise<TelegramSetResult> => keep(await telegramPair(on))
  const unpair = async (): Promise<TelegramSetResult> => keep(await telegramUnpair())
  const installReceive = async (): Promise<TelegramCommandResult> => keep(await telegramInstallReceive())
  const setReceiving = (on: boolean): Promise<TelegramSetResult> => set({ receiving: on })
  const receiving = computed(() => !!state.value?.receiving)
  const test = (project?: string, session?: string): Promise<TelegramTestResult> => telegramTest(project, session)

  const pickChat = (list: TelegramChat[]): void => {
    if (list.some((c) => c.chatId === chatId.value)) return
    const routed = state.value?.routes.find((r) => list.some((c) => c.chatId === r.chatId))?.chatId
    chatId.value = routed ?? list.find((c) => c.isForum)?.chatId ?? list[0]?.chatId ?? null
  }

  async function discover(): Promise<TelegramDiscoverResult> {
    scanning.value = true
    const res = await telegramDiscover().finally(() => (scanning.value = false))
    if (res.ok) {
      fresh.value = true
      chats.value = res.chats
      pickChat(res.chats)
    }
    return res
  }

  /** Shows the remembered groups at once, then refreshes them with one live scan per app run. */
  async function ensureChats(): Promise<void> {
    if (!state.value?.configured) return
    if (chats.value === null) {
      const res = await telegramDiscover(true)
      if (res.ok && res.chats.length && chats.value === null) {
        chats.value = res.chats
        pickChat(res.chats)
      }
    }
    if (!fresh.value && !scanning.value) await discover()
  }

  async function toggle(on = !enabled.value): Promise<TelegramSetResult> {
    busy.value = true
    try {
      return await set({ enabled: on })
    } finally {
      busy.value = false
    }
  }

  return { state, user, chats, chatId, chat, busy, scanning, fresh, ready, ensureChats, enabled, start, reload, set, routeSet, routeRemove, sessionRouteSet, sessionRouteRemove, installCommand, createTopic, test, discover, toggle, pair, unpair, installReceive, setReceiving, receiving }
})
