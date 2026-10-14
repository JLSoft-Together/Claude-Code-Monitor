<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranch, GitCompare, RotateCw } from 'lucide-vue-next'
import { absoluteIn, dirOfRel, groupChanges, KIND_CLASS, KIND_LETTER } from '../../lib/changesView'
import { baseName, type ChangeEntry, type ChangesStatus } from '../../lib/preview'

const props = defineProps<{ status: ChangesStatus | null; reading: boolean }>()
const emit = defineEmits<{ open: [path: string, keep: boolean]; openDiff: [root: string]; refresh: [] }>()

const { t } = useI18n()
const listEl = ref<HTMLElement | null>(null)
const focused = ref<string | null>(null)

const ok = computed(() => (props.status?.ok ? props.status : null))
const groups = computed(() => (ok.value ? groupChanges(ok.value.entries) : []))
const ordered = computed(() => groups.value.flatMap((g) => g.items))
const focusPath = computed(() => (ordered.value.some((e) => e.path === focused.value) ? focused.value : (ordered.value[0]?.path ?? null)))

function open(e: ChangeEntry, keep = false): void {
  focused.value = e.path
  if (e.kind !== 'deleted' && ok.value) emit('open', absoluteIn(ok.value.root, e.path), keep)
}

async function move(index: number): Promise<void> {
  const e = ordered.value[Math.max(0, Math.min(ordered.value.length - 1, index))]
  if (!e) return
  focused.value = e.path
  await nextTick()
  listEl.value?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
}

function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const at = ordered.value.findIndex((x) => x.path === focusPath.value)
  if (e.key === 'ArrowDown') void move(at + 1)
  else if (e.key === 'ArrowUp') void move(at - 1)
  else if (e.key === 'Home') void move(0)
  else if (e.key === 'End') void move(ordered.value.length - 1)
  else if (e.key === 'Enter' || e.key === ' ') {
    const entry = ordered.value[at]
    if (entry) open(entry)
  } else return
  e.preventDefault()
}

const title = (e: ChangeEntry): string =>
  `${t(`workspace.changes.kind.${e.kind}`)}: ${e.origPath ? `${t('workspace.changes.renamedFrom', { path: e.origPath })} → ` : ''}${e.path}`
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-7 min-w-0 shrink-0 items-center gap-1 px-2 text-xs text-ink-muted">
      <GitBranch :size="12" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate" :title="ok?.root">{{ ok ? (ok.branch ?? t('workspace.explorer.changesView.noBranch')) : '' }}</span>
      <button
        v-if="ok"
        type="button"
        class="inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-ink-faint hover:bg-fill-strong hover:text-ink"
        :title="t('workspace.explorer.changesView.openDiff')"
        :aria-label="t('workspace.explorer.changesView.openDiff')"
        data-explorer-open-diff
        @click="emit('openDiff', ok.root)"
      >
        <GitCompare :size="13" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-ink-faint hover:bg-fill-strong hover:text-ink"
        :title="t('workspace.explorer.refresh')"
        :aria-label="t('workspace.explorer.refresh')"
        @click="emit('refresh')"
      >
        <RotateCw :size="12" :class="reading ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
      </button>
    </div>

    <p v-if="!status" class="px-3 py-2 text-xs text-ink-muted" role="status">{{ t('workspace.changes.loading') }}</p>
    <p v-else-if="!status.ok" class="px-3 py-2 text-xs text-ink-muted">{{ t(`workspace.changes.error.${status.error}`) }}</p>
    <p v-else-if="!status.entries.length" class="px-3 py-2 text-xs text-ink-faint">{{ t('workspace.explorer.changesView.none') }}</p>
    <div v-else ref="listEl" class="ccm-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-1" role="listbox" :aria-label="t('workspace.explorer.changesView.list')" @keydown="onKey">
      <div v-for="g in groups" :key="g.key" role="group" :aria-labelledby="`xchg-${g.key}`">
        <p :id="`xchg-${g.key}`" class="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-2xs font-semibold text-ink-faint">
          {{ t(`workspace.changes.groups.${g.key}`) }}
          <span class="tabular font-normal">{{ g.items.length }}</span>
        </p>
        <div
          v-for="e in g.items"
          :key="e.path"
          role="option"
          :aria-selected="e.path === focusPath"
          :aria-disabled="e.kind === 'deleted' || undefined"
          :tabindex="e.path === focusPath ? 0 : -1"
          class="flex h-[22px] min-w-0 items-center gap-1.5 rounded-inner px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
          :class="e.kind === 'deleted' ? 'cursor-default text-ink-muted' : 'cursor-pointer text-ink hover:bg-fill'"
          :title="title(e)"
          :data-change="e.path"
          @click="open(e)"
          @dblclick="open(e, true)"
        >
          <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="KIND_CLASS[e.kind]" aria-hidden="true">{{ KIND_LETTER[e.kind] }}</span>
          <span class="sr-only">{{ t(`workspace.changes.kind.${e.kind}`) }}:</span>
          <span class="min-w-0 flex-1 truncate">
            <span :class="e.kind === 'deleted' ? 'line-through' : ''">{{ baseName(e.path) }}</span>
            <span v-if="dirOfRel(e.path)" class="ml-1.5 text-ink-faint">{{ dirOfRel(e.path) }}</span>
          </span>
          <span v-if="!e.binary && (e.added || e.removed)" class="shrink-0 text-2xs tabular" :aria-label="t('workspace.changes.counts', { added: e.added ?? 0, removed: e.removed ?? 0 })">
            <span v-if="e.added" class="text-diff-add">+{{ e.added }}</span>
            <span v-if="e.removed" class="ml-1 text-diff-del">−{{ e.removed }}</span>
          </span>
        </div>
      </div>
      <p v-if="status.truncated" class="px-2 py-1.5 text-2xs text-ink-faint">{{ t('workspace.explorer.changesView.truncated', { n: status.entries.length }) }}</p>
    </div>
  </div>
</template>
