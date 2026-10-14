<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CaseSensitive, Regex, RotateCw, Search, X } from 'lucide-vue-next'
import type { RefsOk } from '../../../lib/gitRefs'
import { DATE_PRESETS, hasFilters, type LogFilters } from '../../../lib/logQuery'
import { desktop } from '../../../lib/desktop'
import { pickFile } from '../../../lib/preview'
import LogFilterMenu from './LogFilterMenu.vue'

const props = defineProps<{ filters: LogFilters; refs: RefsOk | null; authors: string[]; root: string; flat: boolean }>()
const emit = defineEmits<{ change: [patch: Partial<LogFilters>]; refresh: [] }>()
const { t } = useI18n()
const note = ref(false)
let noteTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(noteTimer))

function change(patch: Partial<LogFilters>): void {
  note.value = false
  emit('change', patch)
}

const branchOptions = computed(() => {
  const r = props.refs
  const all = [{ id: '', label: t('workspace.log.filter.allBranches'), checked: !props.filters.branch }]
  if (!r) return all
  const refsList = [...r.local, ...r.remotes.flatMap((g) => g.refs), ...r.tags]
  return [...all, ...refsList.map((x) => ({ id: x.ref, label: x.name, checked: props.filters.branch === x.ref }))]
})
const branchValue = computed(() => branchOptions.value.find((o) => o.checked)?.label ?? '')

const userOptions = computed(() => {
  const me = props.refs?.me
  const names = props.authors.filter((a) => a !== me)
  return [
    { id: '', label: t('workspace.log.filter.anyUser'), checked: !props.filters.author },
    ...(me ? [{ id: me, label: t('workspace.log.filter.me', { name: me }), checked: props.filters.author === me }] : []),
    ...names.map((n) => ({ id: n, label: n, checked: props.filters.author === n })),
  ]
})

const dateOptions = computed(() => DATE_PRESETS.map((d) => ({ id: d, label: t(`workspace.log.filter.dates.${d}`), checked: props.filters.date === d })))

const pathOptions = computed(() => [
  { id: '', label: t('workspace.log.filter.anyPath'), checked: !props.filters.paths.length },
  ...props.filters.paths.map((p) => ({ id: `-${p}`, label: t('workspace.log.filter.removePath', { path: p }), checked: true })),
  { id: '+file', label: t('workspace.log.filter.addFile'), checked: false },
  ...(desktop ? [{ id: '+folder', label: t('workspace.log.filter.addFolder'), checked: false }] : []),
])

function toRel(abs: string | null): string | null {
  if (!abs) return null
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/$/, '')
  const root = norm(props.root)
  const a = norm(abs)
  const same = /^[A-Za-z]:/.test(a) ? a.toLowerCase().startsWith(`${root.toLowerCase()}/`) : a.startsWith(`${root}/`)
  return same ? a.slice(root.length + 1) : null
}

async function onPath(id: string): Promise<void> {
  if (id === '') return change({ paths: [] })
  if (id.startsWith('-')) return change({ paths: props.filters.paths.filter((p) => p !== id.slice(1)) })
  const abs = id === '+file' ? await pickFile('any', props.root) : await desktop?.pickFolder(props.root)
  if (!abs) return
  const rel = toRel(abs)
  if (!rel) {
    note.value = true
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => (note.value = false), 4000)
    return
  }
  if (!props.filters.paths.includes(rel)) change({ paths: [...props.filters.paths, rel] })
}
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1" role="toolbar" :aria-label="t('workspace.log.table.label')">
    <label class="flex h-6 min-w-36 flex-1 basis-48 items-center gap-1 rounded-inner bg-fill px-1.5 focus-within:ring-2 focus-within:ring-focus">
      <Search :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
      <input
        :value="filters.text"
        type="search"
        class="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-faint"
        :placeholder="t('workspace.log.filter.text')"
        :aria-label="t('workspace.log.filter.text')"
        data-log-text
        @input="change({ text: ($event.target as HTMLInputElement).value })"
      />
      <button type="button" class="ccm-btn-plain size-5 p-0" :class="filters.regex ? 'bg-accent-soft text-accent-ink' : 'text-ink-faint'" :aria-pressed="filters.regex" :title="t('workspace.log.filter.regex')" :aria-label="t('workspace.log.filter.regex')" @click="change({ regex: !filters.regex })">
        <Regex :size="13" aria-hidden="true" />
      </button>
      <button type="button" class="ccm-btn-plain size-5 p-0" :class="filters.matchCase ? 'bg-accent-soft text-accent-ink' : 'text-ink-faint'" :aria-pressed="filters.matchCase" :title="t('workspace.log.filter.matchCase')" :aria-label="t('workspace.log.filter.matchCase')" @click="change({ matchCase: !filters.matchCase })">
        <CaseSensitive :size="13" aria-hidden="true" />
      </button>
    </label>
    <LogFilterMenu :label="t('workspace.log.filter.branch')" :value="branchValue" :active="!!filters.branch" :options="branchOptions" data-log-filter="branch" @pick="(id) => change({ branch: id || null })" />
    <LogFilterMenu :label="t('workspace.log.filter.user')" :value="filters.author ?? ''" :active="!!filters.author" :options="userOptions" data-log-filter="user" @pick="(id) => change({ author: id || null })" />
    <LogFilterMenu :label="t('workspace.log.filter.date')" :value="t(`workspace.log.filter.dates.${filters.date}`)" :active="filters.date !== 'any'" :options="dateOptions" data-log-filter="date" @pick="(id) => change({ date: id as LogFilters['date'] })">
      <template #extra>
        <div v-if="filters.date === 'custom'" class="flex flex-col gap-1 border-t border-line px-2 pt-1.5 pb-1">
          <label class="flex items-center justify-between gap-2 text-2xs text-ink-muted">
            {{ t('workspace.log.filter.from') }}
            <input type="date" class="rounded-inner bg-fill px-1 text-xs text-ink" :value="filters.from" @change="change({ from: ($event.target as HTMLInputElement).value })" />
          </label>
          <label class="flex items-center justify-between gap-2 text-2xs text-ink-muted">
            {{ t('workspace.log.filter.to') }}
            <input type="date" class="rounded-inner bg-fill px-1 text-xs text-ink" :value="filters.to" @change="change({ to: ($event.target as HTMLInputElement).value })" />
          </label>
        </div>
      </template>
    </LogFilterMenu>
    <LogFilterMenu
      :label="t('workspace.log.filter.paths')"
      :value="filters.paths.length === 1 ? filters.paths[0]! : t('workspace.log.filter.pathsN', { n: filters.paths.length }, filters.paths.length)"
      :active="filters.paths.length > 0"
      :options="pathOptions"
      data-log-filter="paths"
      @pick="onPath"
    />
    <span class="flex-1" />
    <span v-if="note" class="truncate text-2xs text-warning" role="status" :title="t('workspace.log.filter.outside')">{{ t('workspace.log.filter.outside') }}</span>
    <span v-if="flat" class="truncate text-2xs text-ink-faint" :title="t('workspace.log.filter.flatNote')">{{ t('workspace.log.filter.flatNote') }}</span>
    <button v-if="hasFilters(filters)" type="button" class="ccm-btn-plain h-6 shrink-0 gap-1 px-1.5 text-xs" data-log-clear @click="change({ text: '', branch: null, author: null, date: 'any', from: '', to: '', paths: [] })">
      <X :size="12" aria-hidden="true" />{{ t('workspace.log.filter.clear') }}
    </button>
    <button type="button" class="ccm-btn-plain size-6 shrink-0 p-0" :title="t('workspace.log.filter.refresh')" :aria-label="t('workspace.log.filter.refresh')" @click="emit('refresh')">
      <RotateCw :size="13" aria-hidden="true" />
    </button>
  </div>
</template>
