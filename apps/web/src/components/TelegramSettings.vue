<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, ChevronRight, CircleCheck, CircleDashed, Copy, FolderPlus, Link2, Pin, Plus, Radio, RefreshCw, Send, ShieldAlert, ShieldCheck, Terminal, Trash2, TriangleAlert, UserCheck } from 'lucide-vue-next'
import {
  DEFAULT_TELEGRAM_QUIET,
  DEFAULT_TELEGRAM_SUMMARY,
  isHhmm,
  parseTopicLink,
  TELEGRAM_DONE_CHOICES,
  type TelegramChat,
  type TelegramQuiet,
  type TelegramRoute,
  type TelegramSetResult,
  type TelegramSummary,
} from '@ccm/shared'
import { desktop } from '../lib/desktop'
import { pinLeaving } from '../lib/motion'
import { now, relativeTime, startClock } from '../lib/format'
import { countdown, projectChoices, projectLabel, topicText } from '../lib/telegram'
import { useTelegramStore } from '../stores/telegram'
import { useTerminalsStore } from '../stores/terminals'
import { isTerm, useWorkspaceStore, workCwd } from '../stores/workspace'
import AppSelect from './AppSelect.vue'
import SegmentedControl from './ui/SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const props = defineProps<{ open: boolean }>()

const { t, locale } = useI18n()
const tg = useTelegramStore()
const terminals = useTerminalsStore()
const workspace = useWorkspaceStore()

onMounted(() => {
  tg.start()
  startClock()
})
const token = ref('')
const confirmClear = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null
function resetConfirm(): void {
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = null
  confirmClear.value = false
}
watch(
  () => props.open,
  (open) => {
    if (open) void tg.reload()
    else {
      token.value = ''
      resetConfirm()
    }
  },
)

const state = computed(() => tg.state)
const note = ref<{ text: string; error: boolean } | null>(null)
const testing = ref<string | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)

const say = (text: string, error = false): void => {
  note.value = { text, error }
}
const setFail = (res: TelegramSetResult): boolean => {
  if (res.ok) return false
  say(t(`telegram.setError.${res.error}`), true)
  return true
}

const status = computed(() =>
  state.value?.configured ? (state.value.bot ? t('telegram.tokenSaved', { bot: state.value.bot }) : t('telegram.tokenSavedNoName')) : t('telegram.tokenNone'),
)
const lastError = computed(() => (state.value?.lastError ? t(`telegram.error.${state.value.lastError}`) : null))
const doneOptions = computed(() => TELEGRAM_DONE_CHOICES.map((n) => ({ value: n as number, label: n === 0 ? t('telegram.doneAlways') : t('telegram.doneMin', { n }) })))

async function saveToken(): Promise<void> {
  const res = await tg.set({ token: token.value.trim() })
  if (setFail(res)) return
  token.value = ''
  note.value = null
}

function askClear(): void {
  confirmClear.value = true
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = setTimeout(resetConfirm, 6000)
}

async function clearToken(): Promise<void> {
  resetConfirm()
  if (!setFail(await tg.set({ token: '' }))) note.value = null
}

async function patch(p: Parameters<typeof tg.set>[0]): Promise<void> {
  if (!setFail(await tg.set(p))) note.value = null
}

async function test(project?: string): Promise<void> {
  testing.value = project ?? ''
  const res = await tg.test(project)
  testing.value = null
  say(res.ok ? t('telegram.testOk', { bot: res.bot }) : t(`telegram.error.${res.error}`), !res.ok)
}

async function scan(): Promise<void> {
  scanning.value = true
  scanError.value = null
  const res = await tg.discover()
  scanning.value = false
  if (!res.ok) scanError.value = t(`telegram.error.${res.error}`)
}

const chatOptions = computed(() => (tg.chats ?? []).map((c) => ({ value: c.chatId, label: c.title })))
const pickChat = (id: string | null): void => {
  tg.chatId = id
}

const topicName = (r: Pick<TelegramRoute, 'chatId' | 'threadId'>): string => {
  if (r.threadId === null) return t('telegram.general')
  const name = tg.chats?.find((c) => c.chatId === r.chatId)?.topics.find((x) => x.threadId === r.threadId)?.name
  return name ?? t('telegram.topicUnknown', { id: r.threadId })
}
const chatTitle = (id: string): string => tg.chats?.find((c) => c.chatId === id)?.title ?? id
const topicOptions = (c: TelegramChat | null) => (c ? [{ value: null as number | null, label: t('telegram.general') }, ...c.topics.map((x) => ({ value: x.threadId as number | null, label: x.name }))] : [])
const chatTopicOptions = computed(() => topicOptions(tg.chat))

const routes = computed(() => state.value?.routes ?? [])
const routeName = (r: TelegramRoute): string => r.label || projectLabel(r.project)

const PICK = '\u0000pick'
const known = computed(() =>
  projectChoices(
    [...terminals.list.map((x) => x.cwd), ...workspace.panes.map((p) => (isTerm(p) ? workCwd(p) : p.cwd)), ...workspace.recentDirs],
    routes.value.map((r) => r.project),
  ),
)
const picked = ref<string | null>(null)
const canPickFolder = typeof desktop?.pickFolder === 'function'
const projectOptions = computed(() => {
  const list = [...known.value, ...(picked.value && !known.value.includes(picked.value) ? [picked.value] : [])]
  return [...list.map((d) => ({ value: d as string | null, label: projectLabel(d), hint: d })), ...(canPickFolder ? [{ value: PICK as string | null, label: t('telegram.projectFolder') }] : [])]
})
const newProject = ref<string | null>(null)
const newTopic = ref<number | null>(null)

async function chooseProject(v: string | null): Promise<void> {
  if (v !== PICK) return void (newProject.value = v)
  const dir = await desktop?.pickFolder(newProject.value ?? workspace.recentDirs[0])
  if (!dir) return
  picked.value = dir
  newProject.value = dir
}

async function addRoute(): Promise<void> {
  const project = newProject.value
  if (!project || !tg.chat) return
  const res = await tg.routeSet({ project, chatId: tg.chat.chatId, threadId: newTopic.value, label: projectLabel(project) })
  if (setFail(res)) return
  note.value = null
  newProject.value = null
  newTopic.value = null
}

async function moveRoute(r: TelegramRoute, threadId: number | null): Promise<void> {
  if (!tg.chat) return
  setFail(await tg.routeSet({ project: r.project, chatId: tg.chat.chatId, threadId, label: r.label || projectLabel(r.project) }))
}

const creating = ref<string | null>(null)
async function createTopic(project: string): Promise<void> {
  creating.value = project
  const res = await tg.createTopic(project, projectLabel(project))
  creating.value = null
  if (!res.ok) {
    say(res.error === 'invalid-project' ? t('telegram.setError.invalid-project') : t(`telegram.error.${res.error}`), true)
    return
  }
  say(t('telegram.created', { name: res.topic.name }))
  if (newProject.value === project) {
    newProject.value = null
    newTopic.value = null
  }
}

async function removeRoute(project: string): Promise<void> {
  if (!setFail(await tg.routeRemove(project))) note.value = null
}

const link = ref('')
const parsedLink = computed(() => (link.value.trim() ? parseTopicLink(link.value) : null))
const linkView = computed(() => {
  if (!link.value.trim()) return null
  const p = parsedLink.value
  return p ? { ok: true, text: t('telegram.linkOk', { chat: p.chatId, topic: p.threadId === null ? t('telegram.general') : `#${p.threadId}` }) } : { ok: false, text: t('telegram.linkBad') }
})

async function addByLink(): Promise<void> {
  const project = newProject.value
  if (!project || !parsedLink.value) return
  const res = await tg.routeSet({ project, link: link.value.trim(), label: projectLabel(project) })
  if (setFail(res)) return
  note.value = null
  link.value = ''
  newProject.value = null
}

const installing = ref(false)
async function installCommand(): Promise<void> {
  installing.value = true
  const res = await tg.installCommand()
  installing.value = false
  if (res.ok) say(t('telegram.commandOk'))
  else if (res.error === 'failed') say(t('telegram.setError.failed'), true)
}

const quiet = computed(() => state.value?.quiet ?? DEFAULT_TELEGRAM_QUIET)
const summary = computed(() => state.value?.summary ?? DEFAULT_TELEGRAM_SUMMARY)
function setQuiet(p: Partial<TelegramQuiet>): void {
  void patch({ quiet: { ...quiet.value, ...p } })
}
function setSummary(p: Partial<TelegramSummary>): void {
  void patch({ summary: { ...summary.value, ...p } })
}
function onQuietTime(field: 'from' | 'to', e: Event): void {
  const input = e.target as HTMLInputElement
  if (isHhmm(input.value)) setQuiet({ [field]: input.value })
  else input.value = quiet.value[field]
}
function onSummaryTime(e: Event): void {
  const input = e.target as HTMLInputElement
  if (isHhmm(input.value)) setSummary({ at: input.value })
  else input.value = summary.value.at
}
const actions = computed(() => (['permission', 'finished', 'stop', 'screen', 'files', 'new', 'resume', 'run', 'all', 'last', 'buildLog'] as const).map((k) => ({ key: k, text: t(`telegram.receive.actions.${k}`, { bot: botName.value }) })))

const healthNow = ref(Date.now())
let healthTimer: ReturnType<typeof setInterval> | null = null
function syncHealthTimer(): void {
  const run = props.open && document.visibilityState === 'visible'
  if (run && !healthTimer) {
    healthNow.value = Date.now()
    healthTimer = setInterval(() => (healthNow.value = Date.now()), 30_000)
  } else if (!run && healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
}
watch(() => props.open, syncHealthTimer, { immediate: true })
document.addEventListener('visibilitychange', syncHealthTimer)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', syncHealthTimer)
  resetConfirm()
  if (healthTimer) clearInterval(healthTimer)
  healthTimer = null
})
watch(
  () => state.value?.health,
  () => (healthNow.value = Date.now()),
)
const ago = (ms: number | null | undefined): string => (ms ? (relativeTime(Math.min(ms, healthNow.value), locale.value, healthNow.value) ?? t('telegram.health.never')) : t('telegram.health.never'))
const healthRows = computed(() => {
  const h = state.value?.health
  if (!h) return []
  return [
    { key: 'sent', label: t('telegram.health.sent'), value: ago(h.lastSentAt) },
    ...(state.value?.receiving ? [{ key: 'received', label: t('telegram.health.received'), value: ago(h.lastReceivedAt) }] : []),
    { key: 'poll', label: t('telegram.health.poll'), value: ago(h.lastPollAt) },
  ]
})

const botName = computed(() => state.value?.bot ?? t('telegram.receive.botFallback'))
const pairCommand = computed(() => (state.value?.pairCode ? `@${botName.value} pair ${state.value.pairCode}` : ''))
const pairLeft = computed(() => countdown(state.value?.pairUntil ?? null, now.value))
const pairExpired = computed(() => !!state.value?.pairUntil && state.value.pairUntil <= now.value)
const pairing = ref(false)
async function pair(on: boolean): Promise<void> {
  if (on) startClock()
  pairing.value = true
  const res = await tg.pair(on)
  pairing.value = false
  if (!setFail(res)) note.value = null
}
async function unpair(): Promise<void> {
  if (!setFail(await tg.unpair())) note.value = null
}
async function setReceiving(on: boolean): Promise<void> {
  if (!setFail(await tg.setReceiving(on))) note.value = null
}
async function copyPair(): Promise<void> {
  try {
    await navigator.clipboard.writeText(pairCommand.value)
    say(t('telegram.receive.copied'))
  } catch {
    say(t('telegram.receive.copyFailed'), true)
  }
}
const installingReceive = ref(false)
async function installReceive(): Promise<void> {
  installingReceive.value = true
  const res = await tg.installReceive()
  installingReceive.value = false
  if (res.ok) say(t('telegram.commandOk'))
  else if (res.error === 'failed') say(t('telegram.setError.failed'), true)
}

const guide = computed(() => (['bot', 'token', 'group', 'scan', 'route'] as const).map((k) => ({ key: k, text: t(`telegram.guide.${k}`) })))
</script>

<template>
  <section v-if="state" aria-labelledby="set-telegram" class="mt-6" data-telegram-settings>
    <h3 id="set-telegram" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('telegram.section') }}</h3>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <ToggleSwitch
        :model-value="state.enabled"
        :label="t('telegram.enable')"
        :hint="state.configured ? t('telegram.enableHint') : t('telegram.needToken')"
        :disabled="!state.configured"
        class="px-3"
        data-telegram-enable
        @update:model-value="(on: boolean) => patch({ enabled: on })"
      />
      <details class="group px-3 py-2" data-telegram-guide>
        <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden">
          <ChevronRight :size="13" class="transition-transform duration-(--ccm-dur-fast) group-open:rotate-90" aria-hidden="true" />{{ t('telegram.guideTitle') }}
        </summary>
        <ol class="mt-2 flex list-decimal flex-col gap-1 pl-8 text-2xs leading-relaxed text-ink-muted">
          <li v-for="s in guide" :key="s.key">{{ s.text }}</li>
        </ol>
      </details>
      <form class="flex flex-col gap-2 px-3 py-2" autocomplete="off" @submit.prevent="saveToken">
        <div class="flex items-center gap-2 text-xs">
          <span class="text-ink-muted">{{ t('telegram.token') }}</span>
          <Transition name="ccm-swap" mode="out-in">
            <span :key="status" class="inline-flex min-w-0 items-center gap-1 truncate" :class="state.configured ? 'text-success' : 'text-ink-faint'" data-telegram-token-status>
              <CircleCheck v-if="state.configured" :size="13" class="shrink-0" aria-hidden="true" /><CircleDashed v-else :size="13" class="shrink-0" aria-hidden="true" />{{ status }}
            </span>
          </Transition>
        </div>
        <input
          v-model="token"
          type="password"
          spellcheck="false"
          maxlength="200"
          :aria-label="t('telegram.token')"
          :placeholder="t('telegram.tokenPlaceholder')"
          :disabled="!state.keychain"
          class="ccm-field font-mono text-xs"
          data-telegram-token
        />
        <p class="text-2xs text-ink-faint">{{ t('telegram.tokenHint') }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" class="ccm-btn" :disabled="!token.trim() || !state.keychain" data-telegram-save>{{ t('telegram.save') }}</button>
          <Transition name="ccm-swap" mode="out-in">
            <span v-if="state.configured && confirmClear" key="sure" class="inline-flex flex-wrap items-center gap-1" role="group" :aria-label="t('telegram.clearAsk')" data-telegram-clear-confirm>
              <span class="inline-flex items-center gap-1 text-2xs text-st-error"><TriangleAlert :size="12" class="shrink-0" aria-hidden="true" />{{ t('telegram.clearAsk') }}</span>
              <button type="button" class="ccm-btn-plain text-xs text-st-error" data-telegram-clear-yes @click="clearToken">{{ t('telegram.clearYes') }}</button>
              <button type="button" class="ccm-btn-plain text-xs" data-telegram-clear-no @click="resetConfirm">{{ t('telegram.clearNo') }}</button>
            </span>
            <button v-else-if="state.configured" key="ask" type="button" class="ccm-btn-plain text-xs" data-telegram-clear @click="askClear">{{ t('telegram.clear') }}</button>
          </Transition>
          <button type="button" class="ccm-btn ml-auto" :disabled="!state.configured || testing !== null" data-telegram-test @click="test()">
            <Send :size="13" aria-hidden="true" />{{ testing === '' ? t('telegram.testing') : t('telegram.test') }}
          </button>
        </div>
      </form>
      <ToggleSwitch :model-value="state.includeReply" :label="t('telegram.includeReply')" :hint="t('telegram.includeReplyHint')" class="px-3" data-telegram-reply @update:model-value="(on: boolean) => patch({ includeReply: on })" />
      <ToggleSwitch :model-value="state.waiting" :label="t('telegram.waiting')" :hint="t('telegram.waitingHint')" class="px-3" data-telegram-waiting @update:model-value="(on: boolean) => patch({ waiting: on })" />
      <div class="px-3 py-2">
        <p class="text-sm">{{ t('telegram.done') }}</p>
        <p class="mt-0.5 text-2xs text-ink-faint">{{ t('telegram.doneHint') }}</p>
        <SegmentedControl :model-value="state.doneMinutes" :options="doneOptions" :label="t('telegram.done')" fill class="mt-2 w-full" data-telegram-done @update:model-value="(n: number) => patch({ doneMinutes: n })" />
      </div>
      <ToggleSwitch :model-value="state.alerts" :label="t('telegram.alerts')" :hint="t('telegram.alertsHint')" class="px-3" data-telegram-alerts @update:model-value="(on: boolean) => patch({ alerts: on })" />
      <div class="px-3" data-telegram-quiet>
        <ToggleSwitch :model-value="quiet.enabled" :label="t('telegram.quiet')" :hint="t('telegram.quietHint')" @update:model-value="(on: boolean) => setQuiet({ enabled: on })" />
        <div class="flex flex-wrap items-center gap-2 pb-2 text-xs text-ink-muted" :class="quiet.enabled ? '' : 'opacity-50'">
          <template v-for="f in (['from', 'to'] as const)" :key="f">
            <label :for="`tg-quiet-${f}`">{{ f === 'from' ? t('telegram.quietFrom') : t('telegram.quietTo') }}</label>
            <input
              :id="`tg-quiet-${f}`"
              type="time"
              :value="quiet[f]"
              :disabled="!quiet.enabled"
              class="ccm-field tabular-nums disabled:cursor-not-allowed"
              :data-telegram-quiet-time="f"
              @change="onQuietTime(f, $event)"
            />
          </template>
        </div>
      </div>
      <div class="px-3" data-telegram-summary>
        <ToggleSwitch :model-value="summary.enabled" :label="t('telegram.summary')" :hint="t('telegram.summaryHint')" @update:model-value="(on: boolean) => setSummary({ enabled: on })" />
        <div class="flex flex-wrap items-center gap-2 pb-2 text-xs text-ink-muted" :class="summary.enabled ? '' : 'opacity-50'">
          <label for="tg-summary-at">{{ t('telegram.summaryAt') }}</label>
          <input id="tg-summary-at" type="time" :value="summary.at" :disabled="!summary.enabled" class="ccm-field tabular-nums disabled:cursor-not-allowed" data-telegram-summary-time @change="onSummaryTime" />
        </div>
      </div>
      <div class="flex items-start gap-2 px-3" data-telegram-pin>
        <Pin :size="15" class="mt-2.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <ToggleSwitch :model-value="state.pinStatus" :label="t('telegram.pinStatus')" :hint="t('telegram.pinStatusHint')" class="min-w-0 flex-1" @update:model-value="(on: boolean) => patch({ pinStatus: on })" />
      </div>
      <div v-if="state.configured && healthRows.length" class="flex flex-col gap-1 px-3 py-2" role="status" data-telegram-health>
        <p class="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          <Activity :size="13" aria-hidden="true" />{{ t('telegram.health.title') }}
        </p>
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-2xs">
          <template v-for="r in healthRows" :key="r.key">
            <dt class="text-ink-faint">{{ r.label }}</dt>
            <dd class="min-w-0 truncate text-ink tabular-nums" :data-telegram-health-row="r.key">
              <Transition name="ccm-swap" mode="out-in"><span :key="r.value" class="inline-block">{{ r.value }}</span></Transition>
            </dd>
          </template>
        </dl>
        <p class="flex flex-wrap items-center gap-1 text-2xs tabular-nums" data-telegram-health-today>
          <span class="text-ink-muted">{{ t('telegram.health.today', { n: state.health.sentToday }, state.health.sentToday) }}</span>
          <span class="text-ink-faint" aria-hidden="true">·</span>
          <span v-if="state.health.errorsToday > 0" class="inline-flex items-center gap-1 text-warning" data-telegram-health-errors>
            <TriangleAlert :size="12" aria-hidden="true" />{{ t('telegram.health.errors', { n: state.health.errorsToday }, state.health.errorsToday) }}
          </span>
          <span v-else class="inline-flex items-center gap-1 text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('telegram.health.noErrors') }}</span>
        </p>
      </div>
    </div>

    <h4 class="mt-4 mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('telegram.groups') }}</h4>
    <div class="ccm-group divide-y divide-line overflow-hidden" data-telegram-groups>
      <div class="flex flex-col gap-2 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="ccm-btn" :disabled="!state.configured || scanning" data-telegram-scan @click="scan">
            <RefreshCw :size="13" :class="scanning ? 'ccm-spin' : ''" aria-hidden="true" />{{ scanning ? t('telegram.scanning') : t('telegram.scan') }}
          </button>
          <AppSelect v-if="chatOptions.length > 1" :model-value="tg.chatId" :options="chatOptions" :label="t('telegram.groups')" size="sm" class="min-w-0" data-telegram-chat @update:model-value="pickChat" />
        </div>
        <p class="text-2xs leading-relaxed text-ink-faint">{{ t('telegram.scanHint') }}</p>
        <p v-if="scanError" class="text-2xs text-st-error" role="alert">{{ scanError }}</p>
        <p v-else-if="tg.chats && !tg.chats.length" class="text-2xs text-ink-muted" data-telegram-no-chats>{{ t('telegram.noChats') }}</p>
      </div>
      <Transition name="ccm-swap" mode="out-in">
        <div v-if="tg.chat" :key="tg.chat.chatId" class="flex flex-col gap-1.5 px-3 py-2" data-telegram-chat-info>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="min-w-0 truncate text-sm font-medium" :title="tg.chat.title">{{ tg.chat.title }}</span>
            <span class="rounded-full bg-fill px-1.5 py-px text-2xs text-ink-muted">{{ tg.chat.isForum ? t('telegram.forum') : t('telegram.notForum') }}</span>
            <span v-if="tg.chat.botAdmin" class="inline-flex items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-success" data-telegram-admin>
              <ShieldCheck :size="12" aria-hidden="true" />{{ t('telegram.admin') }}
            </span>
            <span v-else class="inline-flex items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-warning" data-telegram-not-admin>
              <ShieldAlert :size="12" aria-hidden="true" />{{ t('telegram.notAdmin') }}
            </span>
            <span class="ml-auto text-2xs text-ink-faint tabular-nums">{{ t('telegram.topicsCount', { n: tg.chat.topics.length }) }}</span>
          </div>
          <p v-if="!tg.chat.botAdmin" class="text-2xs leading-relaxed text-ink-muted">{{ t('telegram.notAdminHint') }}</p>
        </div>
      </Transition>
    </div>

    <h4 class="mt-4 mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('telegram.routes') }}</h4>
    <div class="ccm-group overflow-hidden" data-telegram-routes>
      <p v-if="!routes.length" class="px-3 py-2 text-2xs text-ink-muted" data-telegram-routes-empty>{{ t('telegram.routesEmpty') }}</p>
      <TransitionGroup tag="ul" name="ccm-list" class="relative divide-y divide-line" @before-leave="pinLeaving">
        <li v-for="r in routes" :key="r.project" class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2" data-telegram-route>
          <div class="min-w-0 flex-1 basis-40">
            <p class="truncate text-sm" :title="r.project">{{ routeName(r) }}</p>
            <p class="truncate font-mono text-2xs text-ink-faint" :title="r.project">{{ r.project }}</p>
          </div>
          <AppSelect
            v-if="tg.chat && r.chatId === tg.chat.chatId"
            :model-value="r.threadId"
            :options="chatTopicOptions"
            :label="t('telegram.topic')"
            :display="topicName(r)"
            size="sm"
            data-telegram-route-topic
            @update:model-value="(v: number | null) => moveRoute(r, v)"
          />
          <span v-else class="max-w-48 truncate text-2xs text-ink-muted" :title="topicText(r, t('telegram.general'))">
            {{ tg.chats ? `${chatTitle(r.chatId)} · ${topicName(r)}` : topicText(r, t('telegram.general')) }}
          </span>
          <button
            v-if="tg.chat?.canManageTopics"
            type="button"
            class="ccm-btn-plain px-1.5"
            :disabled="creating !== null"
            :aria-label="t('telegram.createTopicTitle')"
            :title="t('telegram.createTopicTitle')"
            data-telegram-route-create
            @click="createTopic(r.project)"
          >
            <FolderPlus :size="13" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain px-1.5" :disabled="testing !== null" :aria-label="t('telegram.testRow')" :title="t('telegram.testRow')" data-telegram-route-test @click="test(r.project)">
            <Send :size="13" :class="testing === r.project ? 'ccm-pulse' : ''" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="ccm-btn-plain px-1.5 text-st-error"
            :aria-label="t('telegram.removeTitle', { name: routeName(r) })"
            :title="t('telegram.removeTitle', { name: routeName(r) })"
            data-telegram-route-remove
            @click="removeRoute(r.project)"
          >
            <Trash2 :size="13" aria-hidden="true" />
          </button>
        </li>
      </TransitionGroup>
      <div class="flex flex-col gap-2 border-t border-line px-3 py-2" data-telegram-add>
        <div class="flex flex-wrap items-center gap-2">
          <AppSelect
            :model-value="newProject"
            :options="projectOptions"
            :label="t('telegram.project')"
            :display="newProject ? projectLabel(newProject) : t('telegram.projectPick')"
            size="sm"
            class="min-w-0"
            data-telegram-add-project
            @update:model-value="chooseProject"
          />
          <template v-if="tg.chat">
            <AppSelect v-model="newTopic" :options="chatTopicOptions" :label="t('telegram.topic')" size="sm" class="min-w-0" data-telegram-add-topic />
            <button type="button" class="ccm-btn" :disabled="!newProject" data-telegram-add-route @click="addRoute">
              <Plus :size="13" aria-hidden="true" />{{ t('telegram.add') }}
            </button>
            <button
              v-if="tg.chat.canManageTopics"
              type="button"
              class="ccm-btn-plain text-xs"
              :disabled="!newProject || creating !== null"
              :title="t('telegram.createTopicTitle')"
              data-telegram-add-create
              @click="newProject && createTopic(newProject)"
            >
              <FolderPlus :size="13" aria-hidden="true" />{{ t('telegram.createTopic') }}
            </button>
          </template>
        </div>
        <p v-if="newProject" class="truncate font-mono text-2xs text-ink-faint" :title="newProject">{{ newProject }}</p>
        <p v-if="!tg.chat" class="text-2xs text-ink-muted">{{ t('telegram.pickGroupFirst') }}</p>
        <details class="group" :open="!tg.chat || undefined" data-telegram-link>
          <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden">
            <ChevronRight :size="13" class="transition-transform duration-(--ccm-dur-fast) group-open:rotate-90" aria-hidden="true" />{{ t('telegram.linkSection') }}
          </summary>
          <div class="mt-2 flex flex-col gap-1">
            <label for="telegram-link" class="text-xs text-ink-muted">{{ t('telegram.link') }}</label>
            <div class="flex items-center gap-2">
              <input
                id="telegram-link"
                v-model="link"
                type="text"
                spellcheck="false"
                maxlength="300"
                :placeholder="t('telegram.linkPlaceholder')"
                :aria-invalid="linkView ? !linkView.ok : undefined"
                class="ccm-field min-w-0 flex-1 font-mono text-xs"
                data-telegram-link-input
              />
              <button type="button" class="ccm-btn shrink-0" :disabled="!newProject || !parsedLink" data-telegram-add-link @click="addByLink">{{ t('telegram.addLink') }}</button>
            </div>
            <Transition name="ccm-swap" mode="out-in">
              <p v-if="linkView" :key="linkView.text" class="truncate text-2xs" :class="linkView.ok ? 'text-success' : 'text-st-error'" aria-live="polite" data-telegram-link-view>{{ linkView.text }}</p>
              <p v-else class="text-2xs text-ink-faint">{{ t('telegram.linkHint') }}</p>
            </Transition>
          </div>
        </details>
      </div>
    </div>

    <h4 class="mt-4 mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('telegram.receive.title') }}</h4>
    <div class="ccm-group divide-y divide-line overflow-hidden" data-telegram-receive>
      <div class="px-3 py-2">
        <p class="text-2xs leading-relaxed text-ink-muted">{{ t('telegram.receive.intro', { bot: botName }) }}</p>
        <p class="mt-1 text-2xs leading-relaxed text-ink-faint">{{ t('telegram.receive.limits') }}</p>
        <details class="group mt-2" data-telegram-actions>
          <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden">
            <ChevronRight :size="13" class="transition-transform duration-(--ccm-dur-fast) group-open:rotate-90" aria-hidden="true" />{{ t('telegram.receive.actionsTitle') }}
          </summary>
          <ul class="mt-2 flex list-disc flex-col gap-1 pl-8 text-2xs leading-relaxed text-ink-muted">
            <li v-for="a in actions" :key="a.key">{{ a.text }}</li>
          </ul>
          <p class="mt-1.5 flex items-start gap-1.5 text-2xs leading-relaxed text-warning">
            <ShieldAlert :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />{{ t('telegram.receive.actionsNote') }}
          </p>
        </details>
      </div>
      <Transition name="ccm-swap" mode="out-in">
        <div v-if="state.owner" key="owner" class="flex items-center gap-3 px-3 py-2" data-telegram-owner>
          <UserCheck :size="15" class="shrink-0 text-success" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-success" :title="state.owner.name">{{ t('telegram.receive.paired', { name: state.owner.name }) }}</p>
            <p class="mt-0.5 text-2xs text-ink-faint">{{ t('telegram.receive.unpairHint') }}</p>
          </div>
          <button type="button" class="ccm-btn-plain shrink-0 text-xs text-st-error" data-telegram-unpair @click="unpair">{{ t('telegram.receive.unpair') }}</button>
        </div>
        <div v-else-if="state.pairCode" key="code" class="flex flex-col gap-2 px-3 py-2" data-telegram-pairing>
          <p class="text-xs text-ink-muted">{{ t('telegram.receive.pairSay') }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="ccm-pop min-w-0 truncate rounded-inner bg-fill px-2 py-1 font-mono text-lg font-semibold tracking-wide text-ink tabular-nums" :title="pairCommand" data-telegram-pair-code>{{ pairCommand }}</code>
            <button type="button" class="ccm-btn-plain shrink-0 text-xs" data-telegram-pair-copy @click="copyPair">
              <Copy :size="13" aria-hidden="true" />{{ t('telegram.receive.copy') }}
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-2xs tabular-nums" :class="pairExpired ? 'text-st-error' : 'text-ink-faint'" aria-live="off" data-telegram-pair-left>
              {{ pairExpired ? t('telegram.receive.expired') : t('telegram.receive.expires', { time: pairLeft }) }}
            </p>
            <button v-if="pairExpired" type="button" class="ccm-btn ml-auto text-xs" :disabled="pairing" @click="pair(true)">{{ t('telegram.receive.pair') }}</button>
            <button type="button" class="ccm-btn-plain text-xs" :class="pairExpired ? '' : 'ml-auto'" :disabled="pairing" data-telegram-pair-cancel @click="pair(false)">{{ t('telegram.receive.cancel') }}</button>
          </div>
        </div>
        <div v-else key="none" class="flex items-center gap-3 px-3 py-2" data-telegram-unpaired>
          <Link2 :size="15" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <p class="min-w-0 flex-1 text-2xs text-ink-faint">{{ t('telegram.receive.pairHint') }}</p>
          <button type="button" class="ccm-btn shrink-0" :disabled="!state.configured || pairing" data-telegram-pair @click="pair(true)">{{ t('telegram.receive.pair') }}</button>
        </div>
      </Transition>
      <div class="flex items-center gap-3 px-3">
        <ToggleSwitch
          :model-value="state.receiving"
          :label="t('telegram.receive.switch')"
          :hint="state.owner && state.configured ? t('telegram.receive.switchHint') : state.configured ? t('telegram.receive.needOwner') : t('telegram.needToken')"
          :disabled="!state.owner || !state.configured"
          class="min-w-0 flex-1"
          data-telegram-receiving
          @update:model-value="setReceiving"
        />
      </div>
      <Transition name="ccm-swap">
        <p v-if="state.receiving" class="flex items-center gap-2 bg-warning-soft px-3 py-1.5 text-2xs text-ink" role="status" data-telegram-receiving-on>
          <Radio :size="13" class="shrink-0 text-warning" aria-hidden="true" />{{ t('telegram.receive.top') }}
        </p>
      </Transition>
      <div class="flex items-center gap-3 px-3 py-2" data-telegram-receive-command>
        <Terminal :size="15" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-mono text-xs">{{ t('telegram.receive.command') }}</span>
            <Transition name="ccm-swap" mode="out-in">
              <span v-if="state.receiveInstalled" key="on" class="inline-flex items-center gap-1 text-2xs text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('telegram.commandInstalled') }}</span>
              <span v-else key="off" class="inline-flex items-center gap-1 text-2xs text-ink-faint"><CircleDashed :size="12" aria-hidden="true" />{{ t('telegram.commandMissing') }}</span>
            </Transition>
          </p>
          <p class="mt-0.5 truncate text-2xs text-ink-faint" :title="t('telegram.receive.commandHint')">{{ t('telegram.receive.commandHint') }}</p>
        </div>
        <button type="button" class="ccm-btn shrink-0" :disabled="installingReceive" data-telegram-install-receive @click="installReceive">
          {{ state.receiveInstalled ? t('telegram.commandReinstall') : t('telegram.commandInstall') }}
        </button>
      </div>
      <Transition name="ccm-swap">
        <p v-if="state.ignored > 0" :key="state.ignored" class="px-3 py-1.5 text-2xs text-ink-faint tabular-nums" data-telegram-ignored>{{ t('telegram.receive.ignored', { n: state.ignored }, state.ignored) }}</p>
      </Transition>
    </div>

    <div class="ccm-group mt-4 flex items-center gap-3 px-3 py-2" data-telegram-command>
      <Terminal :size="15" class="shrink-0 text-ink-muted" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-center gap-2 text-sm">
          <span class="font-mono text-xs">{{ t('telegram.command') }}</span>
          <Transition name="ccm-swap" mode="out-in">
            <span v-if="state.commandInstalled" key="on" class="inline-flex items-center gap-1 text-2xs text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('telegram.commandInstalled') }}</span>
            <span v-else key="off" class="inline-flex items-center gap-1 text-2xs text-ink-faint"><CircleDashed :size="12" aria-hidden="true" />{{ t('telegram.commandMissing') }}</span>
          </Transition>
        </p>
        <p class="mt-0.5 truncate text-2xs text-ink-faint" :title="t('telegram.commandHint')">{{ t('telegram.commandHint') }}</p>
      </div>
      <button type="button" class="ccm-btn shrink-0" :disabled="installing" data-telegram-install @click="installCommand">
        {{ state.commandInstalled ? t('telegram.commandReinstall') : t('telegram.commandInstall') }}
      </button>
    </div>

    <p v-if="!state.keychain" class="mt-1 px-3 text-2xs text-st-error" role="alert">{{ t('telegram.setError.keychain') }}</p>
    <p v-if="note" class="mt-1 px-3 text-2xs" :class="note.error ? 'text-st-error' : 'text-ink-muted'" aria-live="polite" data-telegram-note>{{ note.text }}</p>
    <p v-else-if="lastError" class="mt-1 px-3 text-2xs text-st-error" role="alert" data-telegram-error>{{ lastError }}</p>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('telegram.privacy') }}</p>
  </section>
</template>
