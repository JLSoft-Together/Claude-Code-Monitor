<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, FolderOpen, GitBranch, LoaderCircle, Play, Search, ShieldCheck, X } from 'lucide-vue-next'
import { highlightSegments, isAgentSessionId, PROMPT_SEARCH_DAYS, type PromptSearchDays, type PromptSearchHit } from '@ccm/shared'
import { hasTerminals } from '../../lib/desktop'
import { relativeTime, shortPath, now } from '../../lib/format'
import { useConnectionStore } from '../../stores/connection'
import { useHistoryStore } from '../../stores/history'
import { usePromptSearchStore } from '../../stores/promptSearch'
import { useTerminalsStore } from '../../stores/terminals'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import AppSelect from '../AppSelect.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { t, locale } = useI18n()
const search = usePromptSearchStore()
const connection = useConnectionStore()
const history = useHistoryStore()
const terminals = useTerminalsStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const input = ref<HTMLInputElement | null>(null)
defineExpose({ focus: () => input.value?.focus() })

const projectOptions = computed(() => [
  { value: null, label: t('promptSearch.allProjects') },
  ...(history.toolStats?.projects ?? []).map((p) => ({ value: p, label: shortPath(p), hint: p })),
])
const dayOptions = computed(() =>
  PROMPT_SEARCH_DAYS.map((n: PromptSearchDays) => ({ value: n, label: n ? t('promptSearch.days', { n }) : t('promptSearch.allTime') })),
)
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }))
const pct = computed(() => (search.filesTotal ? Math.min(1, search.filesDone / search.filesTotal) : 0))

function run(): void {
  if (!search.query.trim()) return
  connection.searchPrompts()
}
// A changed filter re-runs a search that already has results; typing alone waits for Enter.
watch(
  () => [search.days, search.project],
  () => search.searchId && run(),
)
onBeforeUnmount(() => connection.cancelPromptSearch())

const projectName = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
const liveOf = (id: string) => terminals.list.find((tm) => tm.claudeSessionId === id)
const titleOf = (h: PromptSearchHit): string => {
  const tm = liveOf(h.sessionId)
  return tm?.alias || h.title || (tm?.title && tm.title !== tm.id ? tm.title : '') || projectName(h.cwd)
}
const isRunning = (id: string): boolean => {
  const tm = liveOf(id)
  return !!tm && !tm.endedAt && tm.status !== 'stale'
}
const openPane = (id: string) => workspace.panes.find((p) => p.agentSessionId === id && (p.state === 'running' || p.state === 'starting'))
const fmt = (iso?: string): string => (iso && Number.isFinite(Date.parse(iso)) ? dateFormat.value.format(Date.parse(iso)) : '—')

function resumeDisabledReason(h: PromptSearchHit): string | null {
  if (!hasTerminals) return t('promptSearch.noTerminals')
  if (!isAgentSessionId(h.sessionId)) return t('promptSearch.badId')
  if (!h.cwdExists) return t('promptSearch.folderGone')
  if (isRunning(h.sessionId) && !openPane(h.sessionId)) return t('promptSearch.stillRunning')
  return null
}

function resume(h: PromptSearchHit): void {
  if (resumeDisabledReason(h)) return
  workspace.resumeSession('claude', h.cwd, h.sessionId)
  ui.setView('workspace')
}

const copied = ref<string | null>(null)
let copiedTimer: number | undefined
async function copyId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id)
    copied.value = id
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => (copied.value = null), 1800)
  } catch {
    copied.value = null
  }
}

const statusText = computed(() => {
  switch (search.phase) {
    case 'running':
      return search.filesTotal ? t('promptSearch.scanning', { done: search.filesDone, total: search.filesTotal }) : t('promptSearch.listing')
    case 'done':
      return t('promptSearch.found', { n: search.hits.length, files: search.filesTotal }, search.hits.length)
    case 'capped':
      return t('promptSearch.capped', { n: search.hits.length })
    case 'cancelled':
      return t('promptSearch.cancelled')
    case 'failed':
      return t('promptSearch.failed')
    default:
      return ''
  }
})
</script>

<template>
  <div class="flex flex-col gap-3" data-prompt-search>
    <form class="flex flex-wrap items-center gap-2" role="search" @submit.prevent="run">
      <label class="relative flex min-w-0 flex-1 basis-64 items-center">
        <span class="sr-only">{{ t('promptSearch.label') }}</span>
        <Search :size="14" class="pointer-events-none absolute left-2.5 text-ink-faint" aria-hidden="true" />
        <input
          ref="input"
          v-model="search.query"
          type="search"
          maxlength="200"
          :placeholder="t('promptSearch.placeholder')"
          class="ccm-field w-full pl-8!"
          data-prompt-search-input
          @keydown.esc="connection.cancelPromptSearch()"
        />
      </label>
      <AppSelect v-model="search.project" :options="projectOptions" :label="t('promptSearch.project')" size="sm" data-prompt-search-project />
      <SegmentedControl v-model="search.days" :options="dayOptions" :label="t('promptSearch.range')" />
      <button v-if="search.running" type="button" class="ccm-btn h-7 gap-1 text-xs" data-prompt-search-cancel @click="connection.cancelPromptSearch()">
        <X :size="12" aria-hidden="true" />{{ t('promptSearch.cancel') }}
      </button>
      <button v-else type="submit" class="ccm-btn ccm-btn-primary h-7 gap-1 text-xs" :disabled="!search.query.trim()" data-prompt-search-go>
        <Search :size="12" aria-hidden="true" />{{ t('promptSearch.search') }}
      </button>
    </form>
    <p class="flex items-start gap-1.5 text-2xs text-ink-muted">
      <ShieldCheck :size="12" class="mt-px shrink-0" aria-hidden="true" />{{ t('promptSearch.privacy') }}
    </p>

    <div v-if="search.phase !== 'idle'" class="flex flex-col gap-1.5" role="status" aria-live="polite" data-prompt-search-status :data-state="search.phase">
      <p class="flex items-center gap-1.5 text-xs" :class="search.phase === 'failed' ? 'text-warning' : 'text-ink-muted'">
        <LoaderCircle v-if="search.running" :size="12" class="ccm-spin" aria-hidden="true" />
        <span class="tabular">{{ statusText }}</span>
      </p>
      <span v-if="search.running" class="block h-1 rounded-full bg-fill" aria-hidden="true">
        <span class="block h-full origin-left rounded-full bg-accent transition-transform duration-(--ccm-dur-slow) ease-out-quint" :style="{ transform: `scaleX(${pct})` }" />
      </span>
    </div>

    <p v-if="!search.running && search.phase !== 'idle' && !search.hits.length && search.phase !== 'failed'" class="text-xs text-ink-muted" data-prompt-search-empty>
      {{ t('promptSearch.none') }}
    </p>

    <ul v-if="search.hits.length" class="flex flex-col divide-y divide-line rounded-inner border border-line" data-prompt-search-results>
      <li v-for="h in search.hits" :key="h.sessionId" class="flex flex-col gap-1.5 px-3 py-2.5" data-prompt-search-hit :data-session-id="h.sessionId">
        <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium" :title="titleOf(h)">{{ titleOf(h) }}</p>
            <p class="flex min-w-0 flex-wrap items-center gap-x-2 text-2xs text-ink-faint">
              <span class="max-w-full truncate font-mono" :title="h.cwd">{{ shortPath(h.cwd) }}</span>
              <span class="tabular" :title="t('promptSearch.lastActive', { at: fmt(h.lastAt) })">{{ t('promptSearch.started', { at: fmt(h.startedAt) }) }}</span>
              <span v-if="h.gitBranch" class="inline-flex min-w-0 items-center gap-0.5"><GitBranch :size="10" aria-hidden="true" /><span class="truncate" :title="h.gitBranch">{{ h.gitBranch }}</span></span>
              <span class="tabular">{{ t('promptSearch.matches', { n: h.matches }, h.matches) }}</span>
              <span class="tabular">{{ relativeTime(h.lastAt, locale, now) }}</span>
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="ccm-btn h-7 gap-1 text-xs"
              :disabled="!!resumeDisabledReason(h)"
              :title="resumeDisabledReason(h) ?? t('promptSearch.resumeHint')"
              data-prompt-search-resume
              @click="resume(h)"
            >
              <Play :size="12" aria-hidden="true" />{{ openPane(h.sessionId) ? t('promptSearch.show') : t('promptSearch.resume') }}
            </button>
            <button
              type="button"
              class="ccm-btn h-7 gap-1 text-xs"
              :disabled="!h.cwdExists"
              :title="h.cwdExists ? h.cwd : t('promptSearch.folderGone')"
              data-prompt-search-open
              @click="connection.openPromptSearchFolder(h.sessionId)"
            >
              <FolderOpen :size="12" aria-hidden="true" />{{ t('promptSearch.openFolder') }}
            </button>
            <button type="button" class="ccm-btn h-7 gap-1 text-xs" :title="h.sessionId" data-prompt-search-copy @click="copyId(h.sessionId)">
              <Copy :size="12" aria-hidden="true" />{{ copied === h.sessionId ? t('promptSearch.copied') : t('promptSearch.copyId') }}
            </button>
          </div>
        </div>
        <p
          v-if="search.openResults[h.sessionId] && search.openResults[h.sessionId] !== 'ok'"
          class="text-2xs text-warning"
          role="alert"
        >
          {{ t(`promptSearch.openError.${search.openResults[h.sessionId]}`) }}
        </p>
        <ul class="flex flex-col gap-1">
          <li v-for="(s, i) in h.snippets" :key="i" class="rounded-inner bg-fill px-2 py-1 text-xs text-ink-muted [overflow-wrap:anywhere]" data-prompt-search-snippet>
            <template v-for="(seg, j) in highlightSegments(s, search.terms)" :key="j">
              <mark v-if="seg.hit" class="rounded-[2px] bg-accent-soft font-semibold text-accent-ink">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
