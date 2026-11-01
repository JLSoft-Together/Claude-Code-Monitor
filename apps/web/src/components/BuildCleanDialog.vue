<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, Hammer, PackageOpen, Trash2, X } from 'lucide-vue-next'
import type { BuildBusy, BuildCleanResult, BuildDaemon, BuildDir, BuildProgress, BuildProject } from '@ccm/shared'
import { buildCancel, buildClean, buildScan, knownProjects, loadTrash, onBuild, saveTrash, uniqueDirs } from '../lib/buildClean'
import { now, relativeTime } from '../lib/format'
import { baseName } from '../lib/preview'
import { formatBytes, hasResKill, resKill } from '../lib/resources'
import { displayTitle } from '../lib/title'
import { useRail } from '../composables/useRail'
import { useProjectRoots } from '../composables/useProjectRoots'
import { useTerminalsStore } from '../stores/terminals'
import { isTerm, useWorkspaceStore, workCwd } from '../stores/workspace'

/** v77 R8: build folders of known projects, measured on demand; deletes go through a native confirm in desktop main. */
const props = defineProps<{ dir: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()
const terminals = useTerminalsStore()
const workspace = useWorkspaceStore()
const { clusters } = useRail()
const { rootOf } = useProjectRoots()

const card = ref<HTMLElement | null>(null)
const projects = shallowRef<BuildProject[] | null>(null)
const running = ref<'scan' | 'clean' | null>(null)
const progress = ref<BuildProgress | null>(null)
const picked = ref(new Set<string>())
const trash = ref(loadTrash())
const note = ref<{ ok: boolean; text: string } | null>(null)
const daemons = ref<BuildDaemon[] | null>(null)

const roots = computed(() => {
  if (props.dir) return [props.dir]
  const sessionRoots = terminals.list.filter((x) => x.cwd).map((x) => rootOf(x.cwd!) ?? x.cwd!)
  return knownProjects(clusters.value, sessionRoots)
})

const bytes = (n: number): string => (n < 1024 * 1024 ? `${n ? Math.max(1, Math.round(n / 1024)) : 0} KB` : formatBytes(n, locale.value))
const keyOf = (p: BuildProject, d: BuildDir): string => `${p.root}\u0000${d.rel}`

const all = computed(() => (projects.value ?? []).flatMap((p) => p.dirs.map((d) => ({ p, d, key: keyOf(p, d) }))))
const chosen = computed(() => all.value.filter((x) => picked.value.has(x.key)))
const chosenBytes = computed(() => chosen.value.reduce((n, x) => n + x.d.bytes, 0))
const totalBytes = computed(() => (projects.value ?? []).reduce((n, p) => n + p.bytes, 0))

const progressText = computed(() => {
  const p = progress.value
  if (running.value === 'clean') return t('buildClean.cleaning', { done: bytes(p?.bytes ?? 0), total: bytes(p?.totalBytes ?? chosenBytes.value) })
  return t('buildClean.measuring', { size: bytes(p?.bytes ?? 0) })
})
const pct = computed(() => (running.value === 'clean' && progress.value?.totalBytes ? Math.min(100, Math.round((progress.value.bytes / progress.value.totalBytes) * 100)) : null))

let off: (() => void) | null = null
onMounted(async () => {
  off = onBuild((p) => {
    if (running.value) progress.value = p
  })
  await nextTick()
  card.value?.focus()
})
onBeforeUnmount(() => off?.())

function toggle(key: string): void {
  const next = new Set(picked.value)
  if (!next.delete(key)) next.add(key)
  picked.value = next
}

function toggleProject(p: BuildProject): void {
  const keys = p.dirs.map((d) => keyOf(p, d))
  const allOn = keys.every((k) => picked.value.has(k))
  const next = new Set(picked.value)
  for (const k of keys) allOn ? next.delete(k) : next.add(k)
  picked.value = next
}

async function measure(): Promise<void> {
  if (running.value || !roots.value.length) return
  running.value = 'scan'
  progress.value = null
  note.value = null
  daemons.value = null
  try {
    const r = await buildScan(roots.value)
    if (r) {
      projects.value = r
      const keep = new Set(r.flatMap((p) => p.dirs.map((d) => keyOf(p, d))))
      picked.value = new Set([...picked.value].filter((k) => keep.has(k)))
    }
  } finally {
    running.value = null
    progress.value = null
  }
}

/** Shells and agents the page knows run inside a project: the desktop side adds servers, daemons and Run sessions. */
function busyList(): BuildBusy[] {
  const out: BuildBusy[] = []
  for (const s of terminals.list) if (s.cwd && s.status !== 'stale' && !s.endedAt) out.push({ name: displayTitle(s), cwd: s.cwd })
  for (const p of workspace.panes) {
    const cwd = isTerm(p) ? workCwd(p) : undefined
    if (cwd && isTerm(p) && p.state === 'running') out.push({ name: `${t(`workspace.preset.${p.agent ?? p.preset}`)} · ${baseName(cwd)}`, cwd })
  }
  return out.slice(0, 200)
}

function explain(r: BuildCleanResult): void {
  if (r.ok) {
    const locked = r.failed ? ` ${t('buildClean.lockedFiles', { n: r.failed }, r.failed)}` : ''
    note.value = { ok: true, text: t('buildClean.done', { n: r.dirs ?? 0, size: bytes(r.bytes ?? 0) }, r.dirs ?? 0) + locked }
    return
  }
  if (r.error === 'daemons') {
    daemons.value = r.daemons ?? []
    note.value = { ok: false, text: t('buildClean.error.daemons', { list: daemons.value.map((d) => `${d.name} (${d.pid})`).join(', ') }) }
    return
  }
  note.value = { ok: false, text: t(`buildClean.error.${r.error ?? 'failed'}`, { list: (r.holders ?? []).join(', ') }) }
}

async function clean(ignoreDaemons = false): Promise<void> {
  if (running.value || !chosen.value.length) return
  running.value = 'clean'
  progress.value = null
  note.value = null
  daemons.value = null
  saveTrash(trash.value)
  try {
    const items = chosen.value.map((x) => ({ root: x.p.root, rel: x.d.rel }))
    const r = await buildClean({ items, trash: trash.value, busy: busyList(), ...(ignoreDaemons ? { ignoreDaemons: true } : {}) })
    explain(r)
    if (r.removed?.length) {
      // Same rows the desktop dropped from its scan: no second measure of the remaining folders.
      const gone = new Set(r.removed.map((i) => `${i.root}\u0000${i.rel}`))
      projects.value = (projects.value ?? []).map((p) => {
        const dirs = p.dirs.filter((d) => !gone.has(keyOf(p, d)))
        return { ...p, dirs, bytes: dirs.reduce((n, d) => n + d.bytes, 0) }
      })
      picked.value = new Set([...picked.value].filter((k) => !gone.has(k)))
    }
  } finally {
    running.value = null
    progress.value = null
  }
}

async function stopDaemons(): Promise<void> {
  const list = daemons.value ?? []
  if (!list.length) return
  const r = await resKill(list.map((d) => ({ pid: d.pid, start: d.start, label: d.name })))
  if (r.ok) {
    daemons.value = null
    await clean()
  } else note.value = { ok: false, text: t(`buildClean.error.failed`) }
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || running.value) return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
}

const changed = (ms: number | null): string => (ms ? t('buildClean.changed', { time: relativeTime(ms, locale.value, now.value) ?? '' }) : '')
const projectIds = computed(() => uniqueDirs(roots.value))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-build-layer @pointerdown.self="!running && emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,720px)] w-[min(94vw,760px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('buildClean.title')"
        data-build-clean
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <Hammer :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {{ props.dir ? `${t('buildClean.title')} · ${baseName(props.dir)}` : t('buildClean.title') }}
          </h2>
          <button type="button" class="ccm-btn shrink-0" :disabled="!!running || !projectIds.length" data-build-measure @click="measure">
            {{ projects ? t('buildClean.measureAgain') : t('buildClean.measure') }}
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('buildClean.close')" :aria-label="t('buildClean.close')" :disabled="!!running" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <p class="shrink-0 border-b border-line px-3 py-2 text-2xs leading-relaxed text-ink-faint">{{ t('buildClean.hint') }}</p>

        <div v-if="running" class="shrink-0 border-b border-line px-3 py-2" role="status" aria-live="polite" data-build-progress>
          <div class="flex items-center gap-2">
            <p class="min-w-0 flex-1 truncate text-2xs text-ink-muted tabular-nums">{{ progressText }}</p>
            <button type="button" class="ccm-btn-plain shrink-0 text-xs" data-build-cancel @click="buildCancel()">{{ t('buildClean.cancel') }}</button>
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded-full bg-fill" role="progressbar" :aria-label="progressText" :aria-valuenow="pct ?? undefined" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full rounded-full bg-accent transition-[width] duration-200" :class="pct === null ? 'w-1/3 animate-pulse' : ''" :style="pct === null ? undefined : { width: `${pct}%` }" />
          </div>
        </div>

        <div
          v-if="note"
          class="flex shrink-0 flex-wrap items-start gap-x-2 gap-y-1.5 border-b border-line px-3 py-2 text-2xs leading-relaxed"
          :class="note.ok ? 'text-success' : 'text-warning'"
          :role="note.ok ? 'status' : 'alert'"
          :data-build-note="note.ok ? 'ok' : 'error'"
        >
          <component :is="note.ok ? CircleCheck : CircleAlert" :size="13" class="mt-px shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 break-words">{{ note.text }}</span>
          <template v-if="daemons?.length">
            <button v-if="hasResKill" type="button" class="ccm-btn" data-build-stop-daemons @click="stopDaemons">{{ t('buildClean.stopDaemons') }}</button>
            <button type="button" class="ccm-btn" data-build-anyway @click="clean(true)">{{ t('buildClean.cleanAnyway') }}</button>
          </template>
        </div>

        <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs">
          <p v-if="!projectIds.length" class="py-6 text-center text-ink-muted" data-build-empty>{{ t('buildClean.noProjects') }}</p>
          <template v-else-if="!projects">
            <p class="pb-2 text-ink-muted">{{ t('buildClean.notMeasured') }}</p>
            <ul class="divide-y divide-line rounded-inner border border-line">
              <li v-for="r in projectIds" :key="r" class="flex min-w-0 items-baseline gap-2 px-2 py-1.5" data-build-known>
                <span class="shrink-0 font-medium text-ink">{{ baseName(r) }}</span>
                <span class="min-w-0 flex-1 truncate font-mono text-2xs text-ink-faint" :title="r">{{ r }}</span>
              </li>
            </ul>
          </template>
          <section v-for="p in projects ?? []" v-else :key="p.root" class="mb-3" :data-build-project="baseName(p.root)">
            <div class="flex min-w-0 items-center gap-2 py-1">
              <input
                v-if="p.dirs.length"
                type="checkbox"
                class="size-4 shrink-0 cursor-pointer accent-accent"
                :checked="p.dirs.every((d) => picked.has(keyOf(p, d)))"
                :disabled="!!running"
                :aria-label="`${t('buildClean.project')} ${baseName(p.root)}`"
                @change="toggleProject(p)"
              />
              <span v-else class="size-4 shrink-0" aria-hidden="true" />
              <h3 class="shrink-0 text-sm font-medium text-ink">{{ baseName(p.root) }}</h3>
              <span class="min-w-0 flex-1 truncate font-mono text-2xs text-ink-faint" :title="p.root">{{ p.root }}</span>
              <span class="shrink-0 text-2xs text-ink-muted tabular-nums" data-build-project-total>
                <template v-if="p.error">{{ t(`buildClean.${p.error}`) }}</template>
                <template v-else-if="!p.dirs.length">{{ t('buildClean.nothing') }}</template>
                <template v-else>{{ bytes(p.bytes) }}</template>
              </span>
            </div>
            <ul v-if="p.dirs.length" class="divide-y divide-line rounded-inner border border-line">
              <li v-for="d in p.dirs" :key="d.rel" class="flex min-h-8 min-w-0 items-center gap-2 px-2 py-1" :data-build-dir="d.rel" :data-kind="d.kind">
                <input
                  type="checkbox"
                  class="size-4 shrink-0 cursor-pointer accent-accent"
                  :checked="picked.has(keyOf(p, d))"
                  :disabled="!!running"
                  :aria-label="d.rel"
                  data-build-pick
                  @change="toggle(keyOf(p, d))"
                />
                <span class="min-w-0 flex-1 truncate font-mono text-ink" :title="d.rel">{{ d.rel }}</span>
                <span v-if="d.reinstall" class="inline-flex shrink-0 items-center gap-1 text-2xs text-warning" :title="t('buildClean.reinstall')">
                  <PackageOpen :size="12" aria-hidden="true" /><span class="hidden sm:inline">{{ t('buildClean.reinstall') }}</span>
                </span>
                <span class="shrink-0 rounded-full bg-fill px-1.5 text-2xs text-ink-muted">{{ t(`buildClean.kind.${d.kind}`) }}</span>
                <span class="hidden w-28 shrink-0 truncate text-right text-2xs text-ink-faint md:inline">{{ changed(d.newestMs) }}</span>
                <span class="w-16 shrink-0 text-right text-2xs text-ink-muted tabular-nums">{{ bytes(d.bytes) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <footer class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3 py-2">
          <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-2xs text-ink-muted" :title="t('buildClean.trashHint')">
            <input v-model="trash" type="checkbox" class="mt-px size-4 shrink-0 cursor-pointer accent-accent" :disabled="!!running" data-build-trash />
            <span class="min-w-0">{{ t('buildClean.trash') }}</span>
          </label>
          <span v-if="projects" class="shrink-0 text-2xs text-ink-muted tabular-nums" data-build-selected>
            {{ chosen.length ? t('buildClean.selected', { n: chosen.length, size: bytes(chosenBytes) }, chosen.length) : t('buildClean.total', { size: bytes(totalBytes) }) }}
          </span>
          <button type="button" class="ccm-btn ccm-btn-danger shrink-0" :disabled="!!running || !chosen.length" data-build-clean-run @click="clean()">
            <Trash2 :size="13" aria-hidden="true" />{{ t('buildClean.clean') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
