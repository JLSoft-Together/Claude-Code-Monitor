<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Folder, GitBranch, Search, Star, Tag } from 'lucide-vue-next'
import { refTree, type RefRow, type RefsOk } from '../../../lib/gitRefs'

const props = defineProps<{ refs: RefsOk | null; branch: string | null; favorites: ReadonlySet<string>; view: { group: boolean; tags: boolean } }>()
/** `pick` = click / Enter filters the log; `select` = the focused row, the Branches toolbar's target. */
const emit = defineEmits<{ pick: [ref: string | null]; select: [row: RefRow | null] }>()
const { t } = useI18n()
const filter = ref('')
const collapsed = defineModel<Set<string>>('collapsed', { required: true })
const rows = computed(() => (props.refs ? refTree(props.refs, filter.value, collapsed.value, { favorites: props.favorites, group: props.view.group, tags: props.view.tags }) : []))
const focusId = ref<string | null>(null)
const tabId = computed(() => (rows.value.some((r) => r.id === focusId.value) ? focusId.value : rows.value[0]?.id))
const searchEl = ref<HTMLInputElement | null>(null)

watch([focusId, rows], () => emit('select', rows.value.find((r) => r.id === focusId.value) ?? null))

function toggle(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

function activate(r: RefRow): void {
  if (r.kind === 'ref') emit('pick', props.branch === r.ref ? null : r.ref)
  else if (r.kind === 'section' && r.section === 'head') emit('pick', props.branch === 'HEAD' ? null : 'HEAD')
  else toggle(r.id)
}

function label(r: RefRow): string {
  if (r.kind === 'ref') return r.leaf
  if (r.kind === 'folder') return r.name
  if (r.section === 'head') {
    const h = props.refs?.head
    return h?.branch || !h?.hash ? t('workspace.log.refs.head') : t('workspace.log.refs.detached', { hash: h.hash.slice(0, 8) })
  }
  return t(`workspace.log.refs.${r.section}`)
}

function onKey(e: KeyboardEvent): void {
  const list = rows.value
  const at = list.findIndex((r) => r.id === tabId.value)
  const go = (i: number): void => {
    const r = list[Math.max(0, Math.min(list.length - 1, i))]
    if (!r) return
    focusId.value = r.id
    document.getElementById(`ref-${r.id}`)?.focus()
  }
  const cur = list[at]
  const node = cur && cur.kind !== 'ref' && !(cur.kind === 'section' && cur.section === 'head') ? cur : null
  let parent = at - 1
  while (cur && parent >= 0 && list[parent]!.depth >= cur.depth) parent--
  if (e.key === 'ArrowDown') go(at + 1)
  else if (e.key === 'ArrowUp') go(at - 1)
  else if (e.key === 'Home') go(0)
  else if (e.key === 'End') go(list.length - 1)
  else if (e.key === 'ArrowRight' && node && !node.expanded) toggle(node.id)
  else if (e.key === 'ArrowRight' && node && (list[at + 1]?.depth ?? 0) > node.depth) go(at + 1)
  else if (e.key === 'ArrowLeft' && node && node.expanded) toggle(node.id)
  else if (e.key === 'ArrowLeft' && cur && cur.depth > 0 && parent >= 0) go(parent)
  else if ((e.key === 'Enter' || e.key === ' ') && cur) activate(cur)
  else return
  e.preventDefault()
}

defineExpose({
  focusSearch: (): void => {
    searchEl.value?.focus()
    searchEl.value?.select()
  },
})
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-col">
    <label class="m-1.5 flex h-6 items-center gap-1 rounded-inner bg-fill px-1.5 focus-within:ring-2 focus-within:ring-focus">
      <Search :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
      <input ref="searchEl" v-model="filter" type="search" class="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-faint" :placeholder="t('workspace.log.refs.search')" :aria-label="t('workspace.log.refs.search')" />
    </label>
    <div class="ccm-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-1" role="tree" :aria-label="t('workspace.log.refs.label')" data-log-refs @keydown="onKey">
      <p v-if="filter && rows.length <= 1" class="px-3 py-2 text-xs text-ink-faint">{{ t('workspace.log.refs.none') }}</p>
      <div
        v-for="r in rows"
        :id="`ref-${r.id}`"
        :key="r.id"
        role="treeitem"
        :aria-level="r.depth + 1"
        :aria-expanded="r.kind === 'ref' || (r.kind === 'section' && r.section === 'head') ? undefined : r.expanded"
        :aria-selected="r.kind === 'ref' ? r.ref === branch : r.kind === 'section' && r.section === 'head' && branch === 'HEAD'"
        :tabindex="tabId === r.id ? 0 : -1"
        class="flex h-[22px] min-w-0 cursor-pointer items-center gap-1 rounded-inner pr-2 text-xs outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
        :class="[(r.kind === 'ref' && r.ref === branch) || (r.kind === 'section' && r.section === 'head' && branch === 'HEAD') ? 'bg-selection' : '', r.kind === 'section' ? 'font-semibold text-ink' : 'text-ink']"
        :style="{ paddingLeft: `${6 + r.depth * 14}px` }"
        :title="r.kind === 'ref' ? [r.name, r.tracked ? t('workspace.log.refs.tracked') : ''].filter(Boolean).join(' · ') : undefined"
        :data-ref="r.kind === 'ref' ? r.ref : undefined"
        @focus="focusId = r.id"
        @click="focusId = r.id; activate(r)"
      >
        <ChevronRight v-if="r.kind !== 'ref' && !(r.kind === 'section' && r.section === 'head')" :size="12" class="shrink-0 text-ink-faint transition-transform" :class="r.expanded ? 'rotate-90' : ''" aria-hidden="true" />
        <Folder v-if="r.kind === 'folder'" :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <template v-if="r.kind === 'ref'">
          <Tag v-if="r.refKind === 'tag'" :size="13" class="shrink-0 text-warning" aria-hidden="true" />
          <Tag v-else-if="r.current" :size="13" class="shrink-0 text-accent-ink" :aria-label="t('workspace.log.refs.current')" />
          <Star v-else-if="r.favorite" :size="13" class="shrink-0 fill-current text-favorite" :aria-label="t('workspace.log.branches.favoriteMark')" />
          <GitBranch v-else :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
        </template>
        <span class="min-w-0 flex-1 truncate">{{ label(r) }}</span>
        <Star v-if="r.kind === 'ref' && r.current && r.favorite" :size="11" class="shrink-0 fill-current text-favorite" :aria-label="t('workspace.log.branches.favoriteMark')" data-ref-favorite />
        <span v-if="r.kind === 'ref' && (r.ahead || r.behind)" class="shrink-0 text-2xs text-ink-faint tabular" :title="[r.ahead ? t('workspace.log.refs.ahead', { n: r.ahead }) : '', r.behind ? t('workspace.log.refs.behind', { n: r.behind }) : ''].filter(Boolean).join(', ')">
          {{ r.ahead ? `↑${r.ahead}` : '' }}{{ r.behind ? `↓${r.behind}` : '' }}
        </span>
        <span v-if="r.kind === 'ref' && r.gone" class="shrink-0 text-2xs text-ink-faint">{{ t('workspace.log.refs.gone') }}</span>
      </div>
    </div>
  </div>
</template>
