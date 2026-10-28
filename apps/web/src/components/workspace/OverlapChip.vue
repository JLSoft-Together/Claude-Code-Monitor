<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitMerge, LoaderCircle, MessageSquareShare, TriangleAlert } from 'lucide-vue-next'
import { shortPath } from '../../lib/format'
import { rootKey, type OverlapHit } from '../../lib/overlap'
import { overlapDryRun, type DryMerge } from '../../lib/preview'
import { useOverlapStore } from '../../stores/overlap'
import { isTerm, presetOf, useWorkspaceStore, workCwd, type Pane } from '../../stores/workspace'

const props = defineProps<{ cwd: string; branch?: string | null; compact?: boolean }>()
const { t } = useI18n()
const overlap = useOverlapStore()
const workspace = useWorkspaceStore()

const MAX_LISTED = 20
const button = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const anchor = ref<DOMRect | null>(null)
const dry = ref<Record<string, DryMerge | 'running'>>({})
const sent = ref<string | null>(null)

const hits = computed(() => overlap.hitsFor(props.cwd))
const total = computed(() => new Set(hits.value.flatMap((h) => h.files)).size)
const label = computed(() => {
  const first = hits.value[0]
  if (!first) return ''
  const name = first.branch ?? shortPath(first.root)
  return hits.value.length > 1 ? t('workspace.overlap.chipMany', { n: total.value, name, more: hits.value.length - 1 }, total.value) : t('workspace.overlap.chip', { n: total.value, name }, total.value)
})

const style = computed(() => {
  const r = anchor.value
  if (!r) return {}
  const w = Math.min(380, window.innerWidth - 24)
  return { left: `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`, top: `${r.bottom + 6}px`, width: `${w}px` }
})

function agentIn(root: string): Pane | null {
  const k = rootKey(root)
  const inRoot = (p: Pane) => {
    const d = workCwd(p)
    return !!d && (rootKey(d) === k || rootKey(d).startsWith(`${k}\\`))
  }
  return workspace.panes.filter((p) => isTerm(p) && presetOf(p) !== 'shell' && p.state === 'running' && inRoot(p)).sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0))[0] ?? null
}

function toggle(): void {
  if (anchor.value) return close()
  anchor.value = button.value?.getBoundingClientRect() ?? null
  document.addEventListener('pointerdown', onOutside, true)
  void nextTick(() => pop.value?.focus())
}
function close(): void {
  anchor.value = null
  document.removeEventListener('pointerdown', onOutside, true)
}
function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!pop.value?.contains(target) && !button.value?.contains(target)) close()
}
onBeforeUnmount(close)

async function tryMerge(h: OverlapHit): Promise<void> {
  if (!props.branch || !h.branch) return
  dry.value = { ...dry.value, [h.root]: 'running' }
  const res = await overlapDryRun(props.cwd, props.branch, h.branch)
  dry.value = { ...dry.value, [h.root]: res }
}

function dryText(h: OverlapHit): string {
  const r = dry.value[h.root]
  if (!r || r === 'running') return ''
  if (!r.ok) return t(`workspace.overlap.dry.${r.error}`)
  return r.clean ? t('workspace.overlap.dry.clean') : t('workspace.overlap.dry.conflicts', { n: r.conflicts.length, files: r.conflicts.slice(0, 5).join(', ') }, r.conflicts.length)
}

function tell(h: OverlapHit): void {
  const pane = agentIn(h.root)
  if (!pane) return
  workspace.insertInto(pane.key, t('workspace.overlap.tellText', { files: h.files.slice(0, MAX_LISTED).join(', '), branch: props.branch ?? shortPath(props.cwd) }))
  sent.value = h.root
}
</script>

<template>
  <span v-if="hits.length" class="contents">
    <button
      ref="button"
      type="button"
      class="inline-flex h-5 max-w-full min-w-6 shrink cursor-pointer items-center gap-1 rounded-inner bg-warning-soft px-1.5 text-2xs font-medium whitespace-nowrap text-warning hover:text-ink"
      :title="label"
      :aria-label="label"
      aria-haspopup="dialog"
      :aria-expanded="!!anchor"
      data-overlap-chip
      @click.stop="toggle()"
    >
      <TriangleAlert :size="12" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 truncate" :class="compact ? 'sr-only' : '@max-[520px]:sr-only'">{{ label }}</span>
    </button>
    <Teleport to="body">
      <div
        v-if="anchor"
        ref="pop"
        class="ccm-menu fixed z-50 flex max-h-[min(60vh,480px)] flex-col gap-2 overflow-y-auto p-3 text-xs text-ink outline-none"
        :style="style"
        role="dialog"
        tabindex="-1"
        :aria-label="t('workspace.overlap.title')"
        data-overlap-pop
        @keydown.esc.stop="close()"
      >
        <p class="font-semibold">{{ t('workspace.overlap.title') }}</p>
        <p class="text-2xs text-ink-faint">{{ t('workspace.overlap.hint') }}</p>
        <section v-for="h in hits" :key="h.root" class="flex flex-col gap-1.5 rounded-inner bg-fill p-2">
          <p class="flex min-w-0 items-center gap-1.5">
            <span class="shrink-0 font-medium">{{ h.branch ?? t('workspace.overlap.detached') }}</span>
            <span class="min-w-0 truncate text-ink-faint" :title="h.root">{{ shortPath(h.root) }}</span>
          </p>
          <ul class="flex flex-col font-mono text-2xs text-ink-muted">
            <li v-for="f in h.files.slice(0, MAX_LISTED)" :key="f" class="truncate" :title="f">{{ f }}</li>
            <li v-if="h.files.length > MAX_LISTED" class="text-ink-faint">{{ t('workspace.overlap.more', { n: h.files.length - MAX_LISTED }) }}</li>
          </ul>
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="ccm-btn h-7 gap-1 text-2xs"
              :disabled="!branch || !h.branch || dry[h.root] === 'running'"
              :title="!branch || !h.branch ? t('workspace.overlap.needBranch') : t('workspace.overlap.tryHint')"
              data-overlap-try
              @click="tryMerge(h)"
            >
              <LoaderCircle v-if="dry[h.root] === 'running'" :size="12" class="ccm-spin" aria-hidden="true" />
              <GitMerge v-else :size="12" aria-hidden="true" />{{ t('workspace.overlap.try') }}
            </button>
            <button
              type="button"
              class="ccm-btn h-7 gap-1 text-2xs"
              :disabled="!agentIn(h.root)"
              :title="agentIn(h.root) ? t('workspace.overlap.tellHint') : t('workspace.overlap.noAgent')"
              data-overlap-tell
              @click="tell(h)"
            >
              <MessageSquareShare :size="12" aria-hidden="true" />{{ t('workspace.overlap.tell') }}
            </button>
          </div>
          <p v-if="dryText(h)" class="text-2xs" :class="(dry[h.root] as DryMerge).ok && (dry[h.root] as { clean?: boolean }).clean ? 'text-success' : 'text-warning'" role="status" data-overlap-dry>
            {{ dryText(h) }}
          </p>
          <p v-if="sent === h.root" class="text-2xs text-ink-muted" role="status">{{ t('workspace.overlap.told') }}</p>
        </section>
      </div>
    </Teleport>
  </span>
</template>
