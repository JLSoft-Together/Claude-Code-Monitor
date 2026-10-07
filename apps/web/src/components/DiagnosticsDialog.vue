<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CircleAlert, CircleCheck, CircleMinus, ClipboardCopy, RefreshCw, X } from 'lucide-vue-next'
import { now, relativeTime } from '../lib/format'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

const { t, locale } = useI18n()
const ui = useUiStore()
const extras = useExtrasStore()
const terminals = useTerminalsStore()
const connection = useConnectionStore()

const dialog = ref<HTMLElement | null>(null)
const copied = ref(false)
let restoreFocus: HTMLElement | null = null
let poll: number | undefined

type Level = 'ok' | 'warn' | 'off'
const ICON = { ok: CircleCheck, warn: CircleAlert, off: CircleMinus } as const
const TONE = { ok: 'text-st-done', warn: 'text-st-waiting', off: 'text-ink-faint' } as const

const ago = (iso: string | undefined) => relativeTime(iso, locale.value, now.value) ?? '—'

const rows = computed(() => {
  const d = extras.diagnostics
  if (!d) return []
  const versions = [...new Set(terminals.live.map((x) => x.claudeVersion).filter((v): v is string => !!v))]
  const supported = connection.supportedClaudeVersion
  const mismatch = supported ? versions.filter((v) => v !== supported) : []
  const usage = d.usage
  return [
    { key: 'collector', level: 'ok' as Level, value: t('diag.collectorValue', { ago: ago(d.startedAt), clients: d.clients }), detail: `${d.platform}, Node ${d.node}` },
    {
      key: 'claudeRoot',
      level: (d.claudeRootFound && d.watchers.sessions && d.watchers.projects ? 'ok' : 'warn') as Level,
      value: d.claudeRootFound ? t('diag.watching', { list: [d.watchers.sessions && 'sessions', d.watchers.projects && 'projects'].filter(Boolean).join(', ') || '—' }) : t('diag.notFound'),
      detail: d.claudeRoot,
    },
    {
      key: 'sessions',
      level: 'ok' as Level,
      value: t('diag.sessionsValue', { live: d.sessions.live, ended: d.sessions.ended }),
      detail: d.verifyProcesses ? t('diag.verifyOn') : t('diag.verifyOff'),
    },
    {
      key: 'version',
      level: (mismatch.length ? 'warn' : versions.length ? 'ok' : 'off') as Level,
      value: versions.length ? versions.join(', ') : t('diag.noSession'),
      detail: supported ? t('diag.supported', { v: supported }) : '',
    },
    {
      key: 'statusLine',
      level: (d.statusLine.lastAt ? 'ok' : extras.statusLineCommand ? 'warn' : 'off') as Level,
      value: d.statusLine.lastAt ? t('diag.statusLineValue', { ago: ago(d.statusLine.lastAt), n: d.statusLine.reports }) : t('diag.statusLineNone'),
      detail: d.statusLine.lastAt ? '' : t('diag.statusLineHint'),
    },
    {
      key: 'usage',
      level: (usage?.state === 'ready' ? 'ok' : usage?.state === 'scanning' ? 'warn' : 'off') as Level,
      value: usage ? t(`diag.usage.${usage.state}`, { done: usage.filesDone, total: usage.filesTotal }) : '—',
      detail: '',
    },
    { key: 'dataDir', level: 'ok' as Level, value: d.dataDir, detail: t('diag.dataDirHint') },
  ]
})

function report(): string {
  return rows.value.map((r) => `${t(`diag.row.${r.key}`)}: ${r.value}${r.detail ? ` (${r.detail})` : ''}`).join('\n')
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(report())
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}

function close(): void {
  ui.diagnosticsOpen = false
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => ui.diagnosticsOpen,
  async (open) => {
    window.clearInterval(poll)
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      connection.loadDiagnostics()
      poll = window.setInterval(() => connection.loadDiagnostics(), 5_000)
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('button')?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)
onBeforeUnmount(() => window.clearInterval(poll))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div v-if="ui.diagnosticsOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[6vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diag-title"
          class="ccm-pop w-full max-w-[600px] rounded-xl border border-line bg-surface shadow-lg"
          @keydown="trap"
        >
          <div class="flex items-center gap-2 border-b border-line px-5 py-4">
            <div class="mr-auto min-w-0">
              <h2 id="diag-title" class="text-lg font-semibold">{{ t('diag.title') }}</h2>
              <p class="text-xs text-ink-muted">{{ t('diag.subtitle') }}</p>
            </div>
            <button
              type="button"
              class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              :aria-label="t('diag.refresh')"
              :title="t('diag.refresh')"
              @click="connection.loadDiagnostics()"
            >
              <RefreshCw :size="17" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              :aria-label="t('projects.close')"
              @click="close"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </div>

          <p v-if="connection.state !== 'connected'" class="px-5 py-6 text-sm text-st-error">{{ t('diag.offline') }}</p>
          <p v-else-if="!rows.length" class="px-5 py-6 text-sm text-ink-muted">{{ t('diag.loading') }}</p>
          <ul v-else class="divide-y divide-line px-5">
            <li v-for="r in rows" :key="r.key" class="flex gap-3 py-3">
              <component :is="ICON[r.level]" :size="18" class="mt-0.5 shrink-0" :class="TONE[r.level]" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span class="font-medium text-ink">{{ t(`diag.row.${r.key}`) }}</span>
                  <span class="sr-only">{{ t(`diag.level.${r.level}`) }}</span>
                  <span class="min-w-0 break-all text-ink-muted tabular">{{ r.value }}</span>
                </p>
                <p v-if="r.detail" class="mt-0.5 break-all text-xs text-ink-faint">{{ r.detail }}</p>
              </div>
            </li>
          </ul>

          <div class="flex justify-end border-t border-line px-5 py-3">
            <button
              type="button"
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!rows.length"
              @click="copy"
            >
              <Check v-if="copied" :size="14" class="ccm-pop text-st-done" aria-hidden="true" /><ClipboardCopy v-else :size="14" aria-hidden="true" />
              {{ copied ? t('limits.copied') : t('diag.copy') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
