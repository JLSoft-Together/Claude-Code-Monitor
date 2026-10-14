<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, GitBranch, Plus } from 'lucide-vue-next'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { leaves } from '../../lib/splitLayout'
import { dirKey } from '../../stores/favorites'
import { useWorkspaceStore, type Pane } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'
import PresetIcon from './PresetIcon.vue'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const { sessionOf, labelOf } = usePaneInfo()

interface Group {
  key: string
  root: string | null
  name: string
  waiting: number
  panes: Pane[]
}

// Worktrees live in `<repo>-wt/<branch>`, so they fold back under the repo they came from.
const WT = /^(.*[\\/])([^\\/]+)-wt[\\/][^\\/]+(?:[\\/].*)?$/
function projectOf(cwd: string | undefined): { root: string | null; name: string } {
  if (!cwd) return { root: null, name: t('workspace.side.home') }
  const m = WT.exec(cwd)
  const root = m ? `${m[1]}${m[2]}` : cwd
  return { root, name: root.split(/[\\/]+/).filter(Boolean).pop() ?? root }
}

const groups = computed<Group[]>(() => {
  const order = workspace.tabs.flatMap((tab) => leaves(tab.root))
  const map = new Map<string, Group>()
  for (const key of order) {
    const pane = workspace.panes.find((p) => p.key === key)
    if (!pane) continue
    const { root, name } = projectOf(pane.cwd)
    const id = root ? dirKey(root) : '~'
    const group = map.get(id) ?? { key: id, root, name, waiting: 0, panes: [] }
    group.panes.push(pane)
    if (pane.attention === 'waiting' || sessionOf(pane)?.status === 'waiting') group.waiting++
    map.set(id, group)
  }
  return [...map.values()]
})

function paneBranch(pane: Pane): string | undefined {
  return sessionOf(pane)?.gitBranch || pane.branch
}

function statusText(pane: Pane): string {
  const session = sessionOf(pane)
  if (pane.attention === 'waiting') return t('workspace.attention.waiting')
  if (pane.attention === 'done') return t('workspace.attention.done')
  if (session) return t(`status.${session.status}`)
  return t(`workspace.state.${pane.state === 'gone' ? 'gone' : pane.state}`, { code: pane.exitCode ?? 0 })
}

function onKey(e: KeyboardEvent): void {
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  const rows = [...((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-side-row]') ?? [])]
  const at = rows.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  rows[(at + step + rows.length) % rows.length]?.focus()
}
</script>

<template>
  <nav class="ccm-material ccm-scroll flex h-full w-full flex-col gap-3 overflow-y-auto rounded-card p-2" :aria-label="t('workspace.side.title')" @keydown="onKey">
    <section v-for="g in groups" :key="g.key" class="flex flex-col" :aria-labelledby="`side-${g.key}`">
      <div class="group flex h-7 items-center gap-1.5 px-2">
        <Folder :size="13" class="shrink-0 text-ink-faint" aria-hidden="true" />
        <h3 :id="`side-${g.key}`" class="min-w-0 flex-1 truncate text-xs font-semibold text-ink-muted" :title="g.root ?? undefined">{{ g.name }}</h3>
        <span
          v-if="g.waiting"
          class="shrink-0 rounded-full bg-st-waiting-soft px-1.5 text-2xs font-semibold text-st-waiting tabular"
          :title="t('workspace.side.waiting', { n: g.waiting }, g.waiting)"
        >
          {{ g.waiting }}<span class="sr-only"> {{ t('workspace.side.waiting', { n: g.waiting }, g.waiting) }}</span>
        </span>
        <button
          v-if="g.root"
          type="button"
          class="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-fill-strong hover:text-ink focus-visible:opacity-100"
          :title="t('workspace.side.newIn', { name: g.name, preset: t(`workspace.preset.${workspace.preset}`) })"
          :aria-label="t('workspace.side.newIn', { name: g.name, preset: t(`workspace.preset.${workspace.preset}`) })"
          @click="workspace.open(workspace.preset, g.root)"
        >
          <Plus :size="12" aria-hidden="true" />
        </button>
      </div>
      <ul class="flex flex-col">
        <li v-for="pane in g.panes" :key="pane.key">
          <button
            type="button"
            data-side-row
            class="flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-inner pr-2 pl-5 text-left text-xs"
            :class="pane.key === workspace.activeKey ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-fill'"
            :aria-current="pane.key === workspace.activeKey ? 'true' : undefined"
            :title="pane.cwd"
            @click="workspace.activate(pane.key)"
          >
            <StatusIcon v-if="sessionOf(pane)" :status="sessionOf(pane)!.status" :size="13" />
            <PresetIcon v-else :preset="pane.preset" :size="13" class="shrink-0 opacity-80" />
            <span class="min-w-0 flex-1 truncate">{{ labelOf(pane) }}</span>
            <span v-if="paneBranch(pane)" class="inline-flex max-w-[45%] min-w-0 shrink items-center gap-0.5 opacity-60">
              <GitBranch :size="11" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ paneBranch(pane) }}</span>
            </span>
            <span
              v-if="pane.attention"
              class="size-2 shrink-0 rounded-full"
              :class="pane.attention === 'waiting' ? 'bg-st-waiting' : 'bg-st-done'"
              aria-hidden="true"
            />
            <span class="sr-only">{{ statusText(pane) }}</span>
          </button>
        </li>
      </ul>
    </section>
  </nav>
</template>
