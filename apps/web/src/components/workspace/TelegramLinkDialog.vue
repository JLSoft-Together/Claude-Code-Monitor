<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Send, X } from 'lucide-vue-next'
import { parseTopicLink } from '@ccm/shared'
import { projectLabel, topicText } from '../../lib/telegram'
import { useTelegramStore } from '../../stores/telegram'
import { useToastsStore } from '../../stores/toasts'
import { useUiStore } from '../../stores/ui'
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

const sameDir = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
const sessionRoute = computed(() => tg.state?.sessionRoutes.find((r) => r.session === props.session) ?? null)
const projectRoute = computed(() => tg.state?.routes.find((r) => sameDir(r.project, props.cwd)) ?? null)
const scope = ref<'session' | 'project'>(projectRoute.value && !sessionRoute.value ? 'project' : 'session')
const scopes = computed(() => [
  { value: 'session' as const, label: t('telegram.connect.session') },
  { value: 'project' as const, label: t('telegram.connect.project', { name: projectLabel(props.cwd) }) },
])
const current = computed(() => (scope.value === 'session' ? sessionRoute.value : projectRoute.value))
const parsed = computed(() => parseTopicLink(link.value.trim()))
const preview = computed(() => {
  if (!link.value.trim()) return null
  const p = parsed.value
  return p ? { ok: true, text: t('telegram.linkOk', { chat: p.chatId, topic: p.threadId === null ? t('telegram.general') : `#${p.threadId}` }) } : { ok: false, text: t('telegram.linkBad') }
})
const where = (r: { chatId: string; threadId: number | null; where?: string }) => topicText(r, t('telegram.general'))

onMounted(async () => {
  tg.start()
  await nextTick()
  input.value?.focus()
})

async function connect(): Promise<void> {
  if (!parsed.value || busy.value) return
  busy.value = true
  error.value = null
  const res =
    scope.value === 'session'
      ? await tg.sessionRouteSet({ session: props.session, name: props.name, project: props.cwd, link: link.value.trim() })
      : await tg.routeSet({ project: props.cwd, link: link.value.trim(), label: projectLabel(props.cwd) })
  busy.value = false
  if (!res.ok) {
    error.value = t(`telegram.setError.${res.error}`)
    return
  }
  toasts.push({ id: 'tg-connect', kind: 'info', text: t(scope.value === 'session' ? 'telegram.connect.doneSession' : 'telegram.connect.doneProject', { name: scope.value === 'session' ? props.name : projectLabel(props.cwd) }), timeoutMs: 4000 })
  emit('close')
}

async function disconnect(): Promise<void> {
  busy.value = true
  const res = scope.value === 'session' ? await tg.sessionRouteRemove(props.session) : await tg.routeRemove(props.cwd)
  busy.value = false
  if (!res.ok) error.value = t(`telegram.setError.${res.error}`)
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
      <div ref="card" tabindex="-1" class="ccm-sheet flex w-[min(94vw,480px)] flex-col overflow-hidden outline-none" role="dialog" aria-modal="true" :aria-label="t('telegram.connect.title', { name })" data-telegram-connect>
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <Send :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink" :title="name">{{ t('telegram.connect.title', { name }) }}</h2>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('ctxSources.close')" :aria-label="t('ctxSources.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <div v-if="!tg.state?.configured" class="flex flex-col gap-3 p-4 text-xs">
          <p class="text-ink-muted">{{ t('telegram.connect.noBot') }}</p>
          <button type="button" class="ccm-btn ccm-btn-primary self-start" @click="openSettings">{{ t('telegram.connect.openSettings') }}</button>
        </div>

        <form v-else class="flex flex-col gap-3 p-4" autocomplete="off" @submit.prevent="connect">
          <SegmentedControl v-model="scope" :options="scopes" :label="t('telegram.connect.scope')" fill class="w-full" data-telegram-connect-scope />
          <p class="text-2xs leading-relaxed text-ink-muted">{{ t(scope === 'session' ? 'telegram.connect.sessionHint' : 'telegram.connect.projectHint') }}</p>
          <p v-if="current" class="flex flex-wrap items-center gap-2 text-2xs" data-telegram-connect-current>
            <span class="text-success">{{ t('telegram.connect.current', { topic: where(current) }) }}</span>
            <button type="button" class="ccm-btn-plain text-xs text-st-error" :disabled="busy" data-telegram-connect-remove @click="disconnect">{{ t('telegram.connect.remove') }}</button>
          </p>
          <div class="flex flex-col gap-1">
            <label for="tg-connect-link" class="text-xs text-ink-muted">{{ t('telegram.link') }}</label>
            <input
              id="tg-connect-link"
              ref="input"
              v-model="link"
              type="text"
              spellcheck="false"
              maxlength="300"
              :placeholder="t('telegram.linkPlaceholder')"
              :aria-invalid="preview ? !preview.ok : undefined"
              class="ccm-field font-mono text-xs"
              data-telegram-connect-link
            />
            <p v-if="preview" class="truncate text-2xs" :class="preview.ok ? 'text-success' : 'text-st-error'" aria-live="polite">{{ preview.text }}</p>
            <p v-else class="text-2xs text-ink-faint">{{ t('telegram.linkHint') }}</p>
          </div>
          <p v-if="error" class="text-2xs text-st-error" role="alert">{{ error }}</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="ccm-btn" @click="emit('close')">{{ t('telegram.connect.cancel') }}</button>
            <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!parsed || busy" data-telegram-connect-save>{{ t('telegram.connect.save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
