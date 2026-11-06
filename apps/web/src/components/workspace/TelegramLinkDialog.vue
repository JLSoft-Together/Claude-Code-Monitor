<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, CircleDashed, ExternalLink, FolderPlus, Hash, RefreshCw, Send, TriangleAlert, X } from 'lucide-vue-next'
import { parseTopicLink } from '@ccm/shared'
import { projectLabel, suggestTopic, topicText, topicUrl } from '../../lib/telegram'
import { openExternal } from '../../lib/preview'
import { useSessionLive } from '../../composables/useTelegramLinks'
import { useTelegramStore } from '../../stores/telegram'
import { useToastsStore } from '../../stores/toasts'
import { useUiStore } from '../../stores/ui'
import AppSelect from '../AppSelect.vue'
import StatusIcon from '../StatusIcon.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const props = defineProps<{ cwd: string; session: string; name: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const tg = useTelegramStore()
const ui = useUiStore()
const toasts = useToastsStore()

const card = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const link = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
const scanning = computed(() => tg.scanning)
const list = ref<HTMLElement | null>(null)
const testing = ref(false)
const tested = ref<string | null>(null)

const liveOf = useSessionLive()
const live = computed(() => liveOf(props.session))

const sameDir = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
const sessionRoute = computed(() => tg.state?.sessionRoutes.find((r) => r.session === props.session) ?? null)
const projectRoute = computed(() => tg.state?.routes.find((r) => sameDir(r.project, props.cwd)) ?? null)
// One topic per project is the usual setup, so the project comes first unless this session already has its own topic.
const scope = ref<'session' | 'project'>(sessionRoute.value ? 'session' : 'project')
const scopes = computed(() => [
  { value: 'project' as const, label: t('telegram.connect.project', { name: projectLabel(props.cwd) }) },
  { value: 'session' as const, label: t('telegram.connect.session') },
])
const current = computed(() => (scope.value === 'session' ? sessionRoute.value : projectRoute.value))
const parsed = computed(() => parseTopicLink(link.value.trim()))
const preview = computed(() => {
  if (!link.value.trim()) return null
  const p = parsed.value
  return p ? { ok: true, text: t('telegram.linkOk', { chat: p.chatId, topic: p.threadId === null ? t('telegram.general') : `#${p.threadId}` }) } : { ok: false, text: t('telegram.linkBad') }
})
const where = (r: { chatId: string; threadId: number | null; where?: string }) => topicText(r, t('telegram.general'))

const chatOptions = computed(() => (tg.chats ?? []).map((c) => ({ value: c.chatId, label: c.title })))
const pickChat = (id: string | null): void => {
  tg.chatId = id
  picked.value = undefined
}

interface TopicChoice {
  threadId: number | null
  name: string
  users: string[]
  here: boolean
  suggested: boolean
}
const isHere = (r: { chatId: string; threadId: number | null } | null, chatId: string, threadId: number | null) => !!r && r.chatId === chatId && r.threadId === threadId
const topics = computed((): TopicChoice[] => {
  const c = tg.chat
  if (!c) return []
  const s = tg.state
  const usersOf = (threadId: number | null): string[] => [
    ...(s?.routes ?? []).filter((r) => r.chatId === c.chatId && r.threadId === threadId && !(scope.value === 'project' && sameDir(r.project, props.cwd))).map((r) => r.label || projectLabel(r.project)),
    ...(s?.sessionRoutes ?? []).filter((r) => r.chatId === c.chatId && r.threadId === threadId && !(scope.value === 'session' && r.session === props.session)).map((r) => r.name),
  ]
  const list = [{ threadId: null as number | null, name: t('telegram.general') }, ...c.topics.map((x) => ({ threadId: x.threadId as number | null, name: x.name }))]
  const choices = list.map((x) => ({ ...x, users: usersOf(x.threadId), here: isHere(current.value, c.chatId, x.threadId), suggested: false }))
  const hint = current.value ? null : suggestTopic(c.topics.filter((x) => !usersOf(x.threadId).length), projectLabel(props.cwd))
  const at = hint ? choices.findIndex((x) => x.threadId === hint.threadId) : -1
  if (at > 0) choices.unshift({ ...choices.splice(at, 1)[0]!, suggested: true })
  return choices
})
// undefined = nothing picked; null = General.
const picked = ref<number | null | undefined>(undefined)
const canSave = computed(() => !busy.value && (picked.value !== undefined ? !!tg.chat : !!parsed.value))
const takeover = computed(() => (picked.value === undefined ? [] : (topics.value.find((x) => x.threadId === picked.value)?.users ?? [])))

async function scan(): Promise<void> {
  error.value = null
  const res = await tg.discover()
  if (!res.ok) error.value = t(`telegram.error.${res.error}`)
}

onMounted(async () => {
  tg.start()
  void tg.ensureChats().then(() => {
    const first = topics.value[0]
    if (first?.suggested && picked.value === undefined && !link.value) picked.value = first.threadId
  })
  await nextTick()
  card.value?.focus()
})

function pick(threadId: number | null): void {
  picked.value = picked.value === threadId ? undefined : threadId
  link.value = ''
}

// Radio group keys: arrows move and pick, Enter connects.
function onListKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && picked.value !== undefined) {
    e.preventDefault()
    void connect()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...(list.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!
  next.focus()
  const threadId = next.dataset.thread === 'general' ? null : Number(next.dataset.thread)
  picked.value = threadId
  link.value = ''
}

function done(): void {
  const name = scope.value === 'session' ? props.name : projectLabel(props.cwd)
  toasts.push({ id: 'tg-connect', kind: 'info', text: t(scope.value === 'session' ? 'telegram.connect.doneSession' : 'telegram.connect.doneProject', { name }), timeoutMs: 4000 })
  emit('close')
}

async function connect(): Promise<void> {
  if (!canSave.value) return
  busy.value = true
  error.value = null
  const target = picked.value !== undefined && tg.chat ? { chatId: tg.chat.chatId, threadId: picked.value } : { link: link.value.trim() }
  const res =
    scope.value === 'session'
      ? await tg.sessionRouteSet({ session: props.session, name: props.name, project: props.cwd, ...target })
      : await tg.routeSet({ project: props.cwd, label: projectLabel(props.cwd), ...target })
  busy.value = false
  if (!res.ok) {
    error.value = t(`telegram.setError.${res.error}`)
    return
  }
  done()
}

async function createTopic(): Promise<void> {
  busy.value = true
  error.value = null
  const res = await tg.createTopic(props.cwd, projectLabel(props.cwd))
  busy.value = false
  if (!res.ok) {
    error.value = res.error === 'invalid-project' ? t('telegram.setError.invalid-project') : t(`telegram.error.${res.error}`)
    return
  }
  done()
}

async function disconnect(): Promise<void> {
  busy.value = true
  const res = scope.value === 'session' ? await tg.sessionRouteRemove(props.session) : await tg.routeRemove(props.cwd)
  busy.value = false
  if (!res.ok) error.value = t(`telegram.setError.${res.error}`)
}

async function test(): Promise<void> {
  testing.value = true
  tested.value = null
  const res = await tg.test(props.cwd, scope.value === 'session' ? props.session : undefined)
  testing.value = false
  if (res.ok) tested.value = t('telegram.connect.testOk')
  else error.value = t(`telegram.error.${res.error}`)
}

function openSettings(): void {
  emit('close')
  ui.settingsPage = 'telegram'
  ui.settingsOpen = true
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" @pointerdown.self="emit('close')" @keydown="onKey">
      <div ref="card" tabindex="-1" class="ccm-sheet flex max-h-[min(90vh,640px)] w-[min(94vw,480px)] flex-col overflow-hidden outline-none" role="dialog" aria-modal="true" :aria-label="t('telegram.connect.title', { name })" data-telegram-connect>
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <Send :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink" :title="name">{{ t('telegram.connect.title', { name }) }}</h2>
          <span v-if="live" class="inline-flex max-w-36 shrink-0 items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-ink" :title="live.word" data-telegram-connect-state>
            <StatusIcon :status="live.badge" :size="12" /><span class="truncate">{{ live.word }}</span>
          </span>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('ctxSources.close')" :aria-label="t('ctxSources.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <div v-if="!tg.state?.configured" class="flex flex-col gap-3 p-4 text-xs">
          <p class="text-ink-muted">{{ t('telegram.connect.noBot') }}</p>
          <button type="button" class="ccm-btn ccm-btn-primary self-start" @click="openSettings">{{ t('telegram.connect.openSettings') }}</button>
        </div>

        <form v-else class="flex min-h-0 flex-col gap-3 overflow-y-auto p-4" autocomplete="off" @submit.prevent="connect">
          <SegmentedControl v-model="scope" :options="scopes" :label="t('telegram.connect.scope')" fill class="w-full" data-telegram-connect-scope @update:model-value="picked = undefined" />
          <p class="text-2xs leading-relaxed text-ink-muted">{{ t(scope === 'session' ? 'telegram.connect.sessionHint' : 'telegram.connect.projectHint') }}</p>

          <div class="ccm-group flex flex-wrap items-center gap-2 px-3 py-2" data-telegram-connect-current>
            <template v-if="current">
              <Check :size="14" class="shrink-0 text-success" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-xs text-success" :title="where(current)">{{ t('telegram.connect.current', { topic: where(current) }) }}</span>
              <button type="button" class="ccm-btn-plain text-xs" :disabled="testing || busy" data-telegram-connect-test @click="test">
                <Send :size="12" :class="testing ? 'ccm-pulse' : ''" aria-hidden="true" />{{ t('telegram.connect.test') }}
              </button>
              <button
                v-if="topicUrl(current.chatId, current.threadId)"
                type="button"
                class="ccm-btn-plain px-1.5"
                :aria-label="t('telegram.topicMap.open', { topic: where(current) })"
                :title="t('telegram.topicMap.open', { topic: where(current) })"
                data-telegram-connect-open
                @click="openExternal(topicUrl(current.chatId, current.threadId)!)"
              >
                <ExternalLink :size="12" aria-hidden="true" />
              </button>
              <button type="button" class="ccm-btn-plain text-xs text-st-error" :disabled="busy" data-telegram-connect-remove @click="disconnect">{{ t('telegram.connect.remove') }}</button>
              <p v-if="tested" class="w-full pl-5 text-2xs text-success" aria-live="polite">{{ tested }}</p>
            </template>
            <template v-else>
              <CircleDashed :size="14" class="shrink-0 text-ink-faint" aria-hidden="true" />
              <span class="min-w-0 flex-1 text-xs text-ink-muted">{{ scope === 'session' && projectRoute ? t('telegram.connect.viaProject', { topic: where(projectRoute) }) : t('telegram.connect.none') }}</span>
            </template>
          </div>

          <div class="flex flex-col gap-1.5" data-telegram-connect-topics>
            <div class="flex items-center gap-2">
              <span class="text-xs text-ink-muted">{{ current ? t('telegram.connect.moveTo') : t('telegram.connect.pickTopic') }}</span>
              <AppSelect v-if="chatOptions.length > 1" :model-value="tg.chatId" :options="chatOptions" :label="t('telegram.groups')" size="sm" class="min-w-0" data-telegram-connect-chat @update:model-value="pickChat" />
              <button type="button" class="ccm-btn-plain ml-auto px-1.5" :disabled="scanning" :title="t('telegram.connect.rescan')" :aria-label="t('telegram.connect.rescan')" data-telegram-connect-scan @click="scan">
                <RefreshCw :size="13" :class="scanning ? 'ccm-spin' : ''" aria-hidden="true" />
              </button>
            </div>
            <p v-if="scanning && !tg.chats" class="text-2xs text-ink-faint">{{ t('telegram.connect.loading') }}</p>
            <p v-else-if="tg.chats && !tg.chat" class="text-2xs text-ink-muted">{{ t('telegram.noChats') }}</p>
            <ul v-else-if="topics.length" ref="list" class="ccm-group max-h-56 divide-y divide-line overflow-y-auto" role="radiogroup" :aria-label="t('telegram.connect.pickTopic')" @keydown="onListKey">
              <li v-for="x in topics" :key="String(x.threadId)">
                <button
                  type="button"
                  role="radio"
                  :aria-checked="picked === x.threadId"
                  :data-thread="x.threadId === null ? 'general' : x.threadId"
                  :disabled="x.here"
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-fill disabled:cursor-default disabled:hover:bg-transparent"
                  :class="picked === x.threadId ? 'bg-accent-soft' : ''"
                  data-telegram-connect-topic
                  @click="pick(x.threadId)"
                >
                  <Hash :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm">{{ x.name }}</span>
                    <span v-if="x.users.length" class="block truncate text-2xs text-warning" :title="x.users.join(', ')">{{ t('telegram.connect.usedBy', { name: x.users.join(', ') }) }}</span>
                  </span>
                  <span v-if="x.suggested" class="shrink-0 rounded-full bg-fill px-1.5 py-px text-2xs text-accent-ink">{{ t('telegram.connect.suggested') }}</span>
                  <span v-if="x.here" class="shrink-0 text-2xs text-success">{{ t('telegram.connect.here') }}</span>
                  <Check v-else-if="picked === x.threadId" :size="14" class="shrink-0 text-accent-ink" aria-hidden="true" />
                </button>
              </li>
            </ul>
            <p v-if="tg.chat && tg.chat.isForum" class="text-2xs leading-relaxed text-ink-faint">{{ t('telegram.connect.missingTopic') }}</p>
            <button v-if="scope === 'project' && !current && !topics[0]?.suggested && tg.chat?.canManageTopics" type="button" class="ccm-btn-plain self-start text-xs" :disabled="busy" data-telegram-connect-create @click="createTopic">
              <FolderPlus :size="13" aria-hidden="true" />{{ t('telegram.connect.newTopic', { name: projectLabel(cwd) }) }}
            </button>
          </div>

          <details class="group" :open="(tg.chats !== null && !tg.chat) || undefined" data-telegram-connect-paste>
            <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden">
              <ChevronRight :size="13" class="transition-transform duration-(--ccm-dur-fast) group-open:rotate-90" aria-hidden="true" />{{ t('telegram.connect.pasteLink') }}
            </summary>
            <div class="mt-2 flex flex-col gap-1">
              <input
                id="tg-connect-link"
                ref="input"
                v-model="link"
                type="text"
                spellcheck="false"
                maxlength="300"
                :aria-label="t('telegram.link')"
                :placeholder="t('telegram.linkPlaceholder')"
                :aria-invalid="preview ? !preview.ok : undefined"
                class="ccm-field font-mono text-xs"
                data-telegram-connect-link
                @input="picked = undefined"
              />
              <p v-if="preview" class="truncate text-2xs" :class="preview.ok ? 'text-success' : 'text-st-error'" aria-live="polite">{{ preview.text }}</p>
              <p v-else class="text-2xs text-ink-faint">{{ t('telegram.linkHint') }}</p>
            </div>
          </details>

          <p v-if="takeover.length" class="flex items-start gap-1.5 text-2xs leading-relaxed text-warning" role="status" data-telegram-connect-takeover>
            <TriangleAlert :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />{{ t('telegram.connect.takeover', { name: takeover.join(', ') }) }}
          </p>
          <p v-if="error" class="text-2xs text-st-error" role="alert">{{ error }}</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="ccm-btn" @click="emit('close')">{{ t('telegram.connect.cancel') }}</button>
            <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!canSave" data-telegram-connect-save>{{ takeover.length ? t('telegram.connect.takeoverSave') : current ? t('telegram.connect.move') : t('telegram.connect.save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
