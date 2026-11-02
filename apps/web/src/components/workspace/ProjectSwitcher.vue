<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, Folder, FolderOpen, FolderPlus, GitBranch, Search, Star } from 'lucide-vue-next'
import { useOpenProject } from '../../composables/useOpenProject'
import { useProjectMru } from '../../composables/useProjectMru'
import { useRail } from '../../composables/useRail'
import { highlightRuns } from '../../lib/fuzzy'
import { retireOverlay } from '../../lib/motion'
import { isMac } from '../../lib/platform'
import { filterProjects, landingTab, projectEntries, type ProjectHit } from '../../lib/projectSwitcher'
import { shortAge } from '../../lib/sidebarRows'
import { leaves } from '../../lib/splitLayout'
import RunBadge from './RunBadge.vue'
import { useFavoritesStore } from '../../stores/favorites'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{ open: boolean; step?: { n: number; back: boolean } }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const favorites = useFavoritesStore()
const rail = useRail()
const projectMru = useProjectMru()
const { available: canPick, openProject } = useOpenProject()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const entries = computed(() => projectEntries({ clusters: rail.clusters.value, mru: projectMru.mru.value, favorites: favorites.list }))
const hits = computed<ProjectHit[]>(() => filterProjects(entries.value, query.value))

// A terminal that finishes mounting after the dialog opened grabs focus; keep typing in the search box.
function holdFocus(e: FocusEvent): void {
  if (!(e.target as Element | null)?.closest?.('[data-project-switcher]')) input.value?.focus()
}

watch(
  () => props.open,
  async (open) => {
    if (open) document.addEventListener('focusin', holdFocus)
    else document.removeEventListener('focusin', holdFocus)
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      query.value = ''
      // After the query watcher (clearing a previous search resets to 0). Alt+Tab habit: the current project sits
      // first, so Enter right away goes back to the previous one.
      await nextTick()
      active.value = hits.value[0]?.entry.active && hits.value.length > 1 ? 1 : 0
      input.value?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
  { immediate: true },
)

watch(query, () => (active.value = 0))

// Alt+Tab: P pressed again with Ctrl+Alt still down steps the list; letting go of Ctrl or Alt opens the pick.
// A single press never arms it, so a tap leaves the list open for typing.
let cycling = false
watch(
  () => props.step?.n,
  () => {
    if (!props.open || !props.step) return
    cycling = true
    move(props.step.back ? -1 : 1)
  },
)
function onKeyUp(e: KeyboardEvent): void {
  if (!cycling || (e.key !== 'Control' && e.key !== 'Alt')) return
  cycling = false
  choose(hits.value[active.value], false)
}
watch(
  () => props.open,
  (open) => {
    cycling = false
    if (open) window.addEventListener('keyup', onKeyUp, true)
    else window.removeEventListener('keyup', onKeyUp, true)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  document.removeEventListener('focusin', holdFocus)
  window.removeEventListener('keyup', onKeyUp, true)
})

const tabFocusedAt = (tabKey: string): number => {
  const tab = workspace.tabs.find((x) => x.key === tabKey)
  if (!tab) return 0
  return Math.max(0, ...leaves(tab.root).map((k) => workspace.panes.find((p) => p.key === k)?.focusedAt ?? 0))
}

function choose(hit: ProjectHit | undefined, newTab: boolean): void {
  if (!hit) return
  const { entry } = hit
  const tabKey = newTab ? undefined : landingTab(entry.tabKeys, tabFocusedAt)
  // Refocusing the old pane on close would make its project active again.
  restoreFocus = null
  emit('close')
  if (tabKey) workspace.activateTab(tabKey)
  else workspace.open(workspace.preset, entry.dir, undefined, { tab: newTab })
}

function forget(hit: ProjectHit | undefined): void {
  if (!hit || hit.entry.tabs || hit.entry.favorite) return
  projectMru.drop(hit.entry.dir)
  workspace.forget(hit.entry.dir)
  active.value = Math.min(active.value, Math.max(0, hits.value.length - 1))
}

async function pickFolder(): Promise<void> {
  restoreFocus = null
  emit('close')
  await openProject()
}

function move(delta: number): void {
  const n = hits.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => listEl.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Shift') cycling = false
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault()
    move(e.key === 'PageDown' ? 8 : -8)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(hits.value[active.value], isMac ? e.metaKey : e.ctrlKey)
  } else if (e.key === 'Delete' && e.shiftKey) {
    e.preventDefault()
    forget(hits.value[active.value])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (query.value) query.value = ''
    else emit('close')
  }
}

const now = ref(Date.now())
watch(
  () => props.open,
  (open) => {
    if (open) now.value = Date.now()
  },
)
function usedText(at: number): string {
  if (!at) return ''
  const a = shortAge(at, Math.max(now.value, at))
  return a.unit === 'now' ? t('workspace.projects.age.now') : t(`workspace.projects.age.${a.unit}`, { n: a.n })
}

const rows = computed(() =>
  hits.value.map((hit, index) => ({
    hit,
    index,
    name: highlightRuns(hit.entry.name, hit.name),
    dir: highlightRuns(hit.entry.dir, hit.dir),
    used: usedText(hit.entry.usedAt),
  })),
)

const activeId = computed(() => (hits.value[active.value] ? `ps-opt-${active.value}` : undefined))
const HINTS = computed(() => [
  { key: 'cycle', keys: isMac ? '⌃⌥P' : 'Ctrl+Alt+P' },
  { key: 'open', keys: 'Enter' },
  { key: 'newTab', keys: isMac ? '⌘↩' : 'Ctrl+Enter' },
  { key: 'forget', keys: isMac ? '⇧⌦' : 'Shift+Del' },
])
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="emit('close')">
        <div role="dialog" aria-modal="true" :aria-label="t('projectSwitcher.title')" class="ccm-sheet flex max-h-[min(76vh,620px)] w-full max-w-[640px] flex-col overflow-hidden" data-project-switcher>
          <div class="flex items-center gap-3 border-b border-line px-4">
            <Search :size="17" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              ref="input"
              v-model="query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="ps-list"
              aria-autocomplete="list"
              :aria-activedescendant="activeId"
              :aria-label="t('projectSwitcher.title')"
              :placeholder="t('projectSwitcher.placeholder')"
              class="ccm-bare-input h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKey"
            />
            <span class="shrink-0 text-2xs tabular text-ink-faint">{{ hits.length }}</span>
          </div>

          <div id="ps-list" ref="listEl" role="listbox" :aria-label="t('projectSwitcher.results')" class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            <p v-if="!entries.length" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('projectSwitcher.none') }}</p>
            <p v-else-if="!rows.length" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('projectSwitcher.empty') }}</p>
            <div
              v-for="row in rows"
              v-else
              :id="`ps-opt-${row.index}`"
              :key="row.hit.entry.key"
              role="option"
              :data-index="row.index"
              :data-project-row="row.hit.entry.dir"
              :aria-selected="row.index === active"
              class="flex h-11 cursor-pointer items-center gap-2.5 rounded-inner px-2.5"
              :class="row.index === active ? 'bg-accent text-on-accent' : 'text-ink'"
              @mousemove="active = row.index"
              @click="choose(row.hit, isMac ? $event.metaKey : $event.ctrlKey)"
            >
              <component
                :is="row.hit.entry.tabs ? FolderOpen : Folder"
                :size="16"
                class="shrink-0"
                :class="row.index === active ? 'text-on-accent' : row.hit.entry.tabs ? 'text-accent-ink' : 'text-ink-faint'"
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5 text-sm">
                  <span class="truncate font-medium"
                    ><template v-for="(p, i) in row.name" :key="i"
                      ><mark v-if="p.hit" class="bg-transparent font-semibold" :class="row.index === active ? 'text-on-accent underline' : 'text-accent-ink'">{{ p.text }}</mark
                      ><template v-else>{{ p.text }}</template></template
                    ></span
                  >
                  <Star v-if="row.hit.entry.favorite" :size="11" fill="currentColor" class="shrink-0" :class="row.index === active ? 'text-on-accent' : 'text-favorite'" :aria-label="t('projectSwitcher.favorite')" />
                  <span v-if="row.hit.entry.active" class="shrink-0 rounded-inner px-1 text-2xs" :class="row.index === active ? 'border border-current text-on-accent' : 'border border-transparent bg-fill text-ink-muted'">{{ t('projectSwitcher.current') }}</span>
                  <span v-if="row.hit.entry.branch" class="inline-flex min-w-0 items-center gap-0.5 truncate text-2xs" :class="row.index === active ? 'text-on-accent' : 'text-ink-muted'" data-project-branch>
                    <GitBranch :size="10" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ row.hit.entry.branch }}</span>
                  </span>
                </div>
                <div class="truncate text-left text-xs" :class="row.index === active ? 'text-on-accent' : 'text-ink-faint'" dir="rtl" :title="row.hit.entry.dir">
                  <bdi
                    ><template v-for="(p, i) in row.dir" :key="i"
                      ><mark v-if="p.hit" class="bg-transparent font-semibold" :class="row.index === active ? 'text-on-accent' : 'text-ink-muted'">{{ p.text }}</mark
                      ><template v-else>{{ p.text }}</template></template
                    ></bdi
                  >
                </div>
              </div>
              <RunBadge :dir="row.hit.entry.dir" />
              <span
                v-if="row.hit.entry.needs"
                class="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-2xs font-semibold tabular"
                :class="row.hit.entry.failed ? 'bg-st-error-soft text-st-error' : 'bg-st-waiting-soft text-st-waiting'"
              >
                <BellRing :size="10" aria-hidden="true" />{{
                  row.hit.entry.failed ? t('projectSwitcher.failed', { n: row.hit.entry.failed }, row.hit.entry.failed) : t('projectSwitcher.needs', { n: row.hit.entry.needs }, row.hit.entry.needs)
                }}
              </span>
              <span class="flex w-20 shrink-0 flex-col items-end text-2xs leading-tight tabular" :class="row.index === active ? 'text-on-accent' : 'text-ink-faint'">
                <span>{{ row.hit.entry.tabs ? t('projectSwitcher.tabs', { n: row.hit.entry.tabs }, row.hit.entry.tabs) : t('projectSwitcher.closed') }}</span>
                <span v-if="row.used" data-project-used>{{ row.used }}</span>
              </span>
            </div>
          </div>

          <div class="flex items-center gap-3 border-t border-line px-4 py-2 text-2xs text-ink-faint">
            <div class="hidden min-w-0 flex-1 items-center gap-x-3.5 overflow-hidden sm:flex">
              <span v-for="h in HINTS" :key="h.key" class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <kbd class="rounded-inner bg-fill px-1.5 py-px font-sans text-ink-muted">{{ h.keys }}</kbd>{{ t(`projectSwitcher.hints.${h.key}`) }}
              </span>
            </div>
            <button v-if="canPick" type="button" class="ccm-btn-plain ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs" data-project-pick @click="pickFolder">
              <FolderPlus :size="13" aria-hidden="true" />{{ t('projectSwitcher.openFolder') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
