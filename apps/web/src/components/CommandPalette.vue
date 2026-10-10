<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Activity,
  AppWindow,
  Bell,
  ChartColumnBig,
  CornerDownLeft,
  FileDown,
  FolderOpen,
  GraduationCap,
  History,
  Keyboard,
  Languages,
  ListFilter,
  Minimize2,
  Moon,
  Search,
  SearchX,
  Settings2,
  Stethoscope,
  Trash2,
  Volume2,
  X,
} from 'lucide-vue-next'
import { shortPath } from '../lib/format'
import { statusMeta } from '../lib/status'
import { displayTitle } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useFavoritesStore } from '../stores/favorites'
import { useSettingsStore } from '../stores/settings'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import StatusIcon from './StatusIcon.vue'

type Group = 'sessions' | 'favorites' | 'nav' | 'actions' | 'prefs' | 'help'
type Scope = 'all' | 'sessions' | 'favorites' | 'commands'

interface Item {
  id: string
  group: Group
  label: string
  sub?: string
  hay: string
  icon?: Component
  status?: string
  /** Current state of a preference, shown as an On / Off tag. */
  on?: boolean
  run: () => void
  /** Shift+Enter. */
  alt?: () => void
  altHint?: string
}

const { t } = useI18n()
const ui = useUiStore()
const terminals = useTerminalsStore()
const favorites = useFavoritesStore()
const settings = useSettingsStore()
const connection = useConnectionStore()

const query = ref('')
const scope = ref<Scope>('all')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const STATUS_RANK: Record<string, number> = { waiting: 0, working: 1, error: 2, idle: 3, unknown: 4, stale: 5 }
const GROUP_ORDER: Group[] = ['sessions', 'favorites', 'nav', 'actions', 'prefs', 'help']
const SCOPES: Scope[] = ['all', 'sessions', 'favorites', 'commands']
const inScope = (g: Group, s: Scope) => s === 'all' || s === g || (s === 'commands' && g !== 'sessions' && g !== 'favorites')

const items = computed<Item[]>(() => {
  const sessions: Item[] = [...terminals.list]
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
    .map((x) => {
      const title = displayTitle(x)
      const live = x.status !== 'stale'
      return {
        id: `s:${x.id}`,
        group: 'sessions' as const,
        label: title,
        sub: [t(statusMeta(x.status).labelKey), x.gitBranch, shortPath(x.cwd)].filter(Boolean).join(' · '),
        hay: fold(`${title} ${x.title} ${x.cwd ?? ''} ${x.gitBranch ?? ''} ${x.status}`),
        status: x.status,
        run: () => {
          ui.setView('monitor')
          ui.focusTerminal(x.id)
        },
        alt: live && x.processId ? () => connection.focusWindow(x.id) : undefined,
        altHint: t('palette.jump'),
      }
    })
  const favs: Item[] = favorites.list.map((f) => ({
    id: `f:${f.dir}`,
    group: 'favorites' as const,
    label: f.label,
    sub: shortPath(f.dir),
    hay: fold(`${f.label} ${f.dir}`),
    icon: FolderOpen,
    run: () => connection.openFavorite(f.dir, 'new'),
    alt: () => connection.openFavorite(f.dir, 'continue'),
    altHint: t('palette.continue'),
  }))
  const ended = terminals.list.filter((x) => x.status === 'stale').length
  const commands: Omit<Item, 'hay'>[] = [
    { id: 'c:monitor', group: 'nav', label: t('palette.goMonitor'), icon: Activity, run: () => ui.setView('monitor') },
    { id: 'c:usage', group: 'nav', label: t('palette.goUsage'), icon: ChartColumnBig, run: () => ui.setView('usage') },
    { id: 'c:history', group: 'nav', label: t('palette.goHistory'), icon: History, run: () => ui.setView('history') },
    { id: 'c:compact', group: 'nav', label: ui.compact ? t('compact.exit') : t('compact.enter'), icon: Minimize2, run: () => ui.toggleCompact() },
    { id: 'c:recap', group: 'actions', label: t('palette.recap'), icon: FileDown, run: () => ui.openRecap() },
    ...(ended ? [{ id: 'c:clear', group: 'actions' as const, label: t('sessions.clearEnded', { n: ended }), icon: Trash2, run: () => void connection.dismissEnded() }] : []),
    { id: 'c:notify', group: 'prefs', label: t('settings.notifyEnable'), icon: Bell, on: settings.notifyEnabled, run: () => void settings.toggleNotifications() },
    { id: 'c:sound', group: 'prefs', label: t('settings.sound'), icon: Volume2, on: settings.sound, run: () => (settings.sound = !settings.sound) },
    { id: 'c:theme', group: 'prefs', label: t('palette.darkTheme'), icon: Moon, on: settings.theme === 'dark', run: () => settings.toggleTheme() },
    { id: 'c:keyHints', group: 'prefs', label: t('keys.hints'), icon: Keyboard, on: settings.keyHints, run: () => (settings.keyHints = !settings.keyHints) },
    { id: 'c:tools', group: 'prefs', label: t('palette.toolsPref'), icon: ListFilter, on: !settings.hideTools, run: () => (settings.hideTools = !settings.hideTools) },
    { id: 'c:lang', group: 'prefs', label: t('palette.language'), sub: settings.locale === 'vi' ? 'Tiếng Việt → English' : 'English → Tiếng Việt', icon: Languages, run: () => settings.toggleLocale() },
    { id: 'c:settings', group: 'help', label: t('palette.openSettings'), icon: Settings2, run: () => (ui.settingsOpen = true) },
    { id: 'c:keys', group: 'help', label: t('keys.title'), sub: '?', icon: Keyboard, run: () => (ui.shortcutsOpen = true) },
    { id: 'c:tour', group: 'help', label: t('tour.open'), icon: GraduationCap, run: () => (ui.tourOpen = true) },
    { id: 'c:diag', group: 'help', label: t('diag.title'), icon: Stethoscope, run: () => (ui.diagnosticsOpen = true) },
  ]
  return [...sessions, ...favs, ...commands.map((c) => ({ ...c, hay: fold(`${c.label} ${c.sub ?? ''}`) }))]
})

const tokens = computed(() => fold(query.value).split(/\s+/).filter(Boolean))
const matched = computed(() => items.value.filter((x) => tokens.value.every((tk) => x.hay.includes(tk))))
const filtered = computed(() => matched.value.filter((x) => inScope(x.group, scope.value)))
const scopeCounts = computed(() => Object.fromEntries(SCOPES.map((s) => [s, matched.value.filter((x) => inScope(x.group, s)).length])) as Record<Scope, number>)

const groups = computed(() => {
  let index = 0
  return GROUP_ORDER.map((g) => ({ key: g, label: t(`palette.group.${g}`), items: filtered.value.filter((x) => x.group === g).map((x) => ({ ...x, index: index++ })) })).filter(
    (g) => g.items.length,
  )
})

/** Splits a label into matched / unmatched runs; folding keeps precomposed text the same length. */
function parts(label: string): { text: string; hit: boolean }[] {
  const folded = fold(label)
  if (!tokens.value.length || folded.length !== label.length) return [{ text: label, hit: false }]
  const mark = new Array<boolean>(label.length).fill(false)
  for (const tk of tokens.value) {
    let from = folded.indexOf(tk)
    while (from >= 0) {
      for (let i = from; i < from + tk.length; i++) mark[i] = true
      from = folded.indexOf(tk, from + tk.length)
    }
  }
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < label.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === mark[i]) last.text += label[i]
    else out.push({ text: label[i]!, hit: mark[i]! })
  }
  return out
}

watch([query, scope], () => (active.value = 0))
watch(
  () => filtered.value.length,
  (n) => {
    if (active.value > n - 1) active.value = Math.max(0, n - 1)
  },
)

function close(): void {
  ui.paletteOpen = false
}

function choose(item: Item | undefined, alt: boolean): void {
  if (!item) return
  close()
  // After the close watcher has put focus back, so a navigating action keeps the focus it sets.
  void nextTick(() => (alt && item.alt ? item.alt() : item.run()))
}

function move(delta: number): void {
  const n = filtered.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => list.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function cycleScope(delta: number): void {
  scope.value = SCOPES[(SCOPES.indexOf(scope.value) + delta + SCOPES.length) % SCOPES.length]!
}

function clearQuery(): void {
  query.value = ''
  input.value?.focus()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(filtered.value[active.value], e.shiftKey)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    if (query.value) query.value = ''
    else close()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    cycleScope(e.shiftKey ? -1 : 1)
  }
}

function onGlobalKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    ui.paletteOpen = !ui.paletteOpen
  }
}

watch(
  () => ui.paletteOpen,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      query.value = ''
      scope.value = 'all'
      active.value = 0
      await nextTick()
      input.value?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)

onMounted(() => document.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKey))

const activeId = computed(() => (filtered.value[active.value] ? `palette-opt-${active.value}` : undefined))
const HINTS = [
  { key: 'move', keys: '↑ ↓' },
  { key: 'open', keys: 'Enter' },
  { key: 'scope', keys: 'Tab' },
  { key: 'close', keys: 'Esc' },
] as const
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div v-if="ui.paletteOpen" class="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="close">
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="t('palette.title')"
          class="ccm-pop flex max-h-[min(78vh,620px)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lg"
        >
          <div class="flex items-center gap-3 px-5 pt-2">
            <Search :size="19" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              ref="input"
              v-model="query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-autocomplete="list"
              :aria-activedescendant="activeId"
              :aria-label="t('palette.title')"
              :placeholder="t('palette.placeholder')"
              class="ccm-bare-input h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKey"
            />
            <button
              v-if="query"
              type="button"
              class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
              :aria-label="t('palette.clear')"
              :title="t('palette.clear')"
              @mousedown.prevent
              @click="clearQuery"
            >
              <X :size="16" aria-hidden="true" />
            </button>
            <kbd v-else class="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-sans text-2xs text-ink-faint sm:inline">Esc</kbd>
          </div>

          <div class="flex gap-5 border-b border-line px-5" role="radiogroup" :aria-label="t('palette.scopeLabel')">
            <button
              v-for="s in SCOPES"
              :key="s"
              type="button"
              role="radio"
              :aria-checked="scope === s"
              tabindex="-1"
              class="-mb-px inline-flex h-10 cursor-pointer items-center gap-1.5 border-b-2 text-[13px] font-medium transition-colors"
              :class="scope === s ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink-muted'"
              @mousedown.prevent
              @click="scope = s"
            >
              {{ t(`palette.scope.${s}`) }}
              <span class="tabular text-2xs" :class="scope === s ? 'text-accent' : 'text-ink-faint'">{{ scopeCounts[s] }}</span>
            </button>
          </div>

          <div id="palette-list" ref="list" role="listbox" :aria-label="t('palette.title')" class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-3">
            <div v-if="!filtered.length" class="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <SearchX :size="28" class="text-ink-faint" aria-hidden="true" />
              <p class="text-sm font-medium">{{ query ? t('palette.emptyFor', { q: query }) : t('palette.empty') }}</p>
              <p class="max-w-[36ch] text-xs text-ink-faint">{{ t('palette.emptyHint') }}</p>
              <button
                v-if="scope !== 'all' && scopeCounts.all"
                type="button"
                class="mt-2 inline-flex h-8 cursor-pointer items-center rounded-lg border border-line px-3 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-ink"
                @mousedown.prevent
                @click="scope = 'all'"
              >
                {{ t('palette.showAll', { n: scopeCounts.all }) }}
              </button>
            </div>
            <div v-for="g in groups" :key="g.key" role="group" :aria-label="g.label" class="pt-3">
              <p class="px-3 pb-1.5 text-2xs font-medium text-ink-faint">{{ g.label }}</p>
              <div class="flex flex-col gap-0.5">
                <div
                  v-for="item in g.items"
                  :id="`palette-opt-${item.index}`"
                  :key="item.id"
                  role="option"
                  :data-index="item.index"
                  :aria-selected="item.index === active"
                  class="relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-100"
                  :class="item.index === active ? 'bg-raised' : ''"
                  @mousemove="active = item.index"
                  @click="choose(item, $event.shiftKey)"
                >
                  <span v-if="item.index === active" class="absolute inset-y-3 left-0 w-0.5 rounded-full bg-accent" aria-hidden="true" />
                  <span class="inline-flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
                    <StatusIcon v-if="item.status" :status="item.status" :size="16" :animate="false" />
                    <component :is="item.icon" v-else-if="item.icon" :size="17" :class="item.index === active ? 'text-accent' : 'text-ink-faint'" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-ink"
                      ><template v-for="(p, pi) in parts(item.label)" :key="pi"
                        ><mark v-if="p.hit" class="bg-transparent font-semibold text-accent">{{ p.text }}</mark
                        ><template v-else>{{ p.text }}</template></template
                      ></span
                    >
                    <span v-if="item.sub" class="mt-0.5 block truncate text-xs text-ink-faint">{{ item.sub }}</span>
                  </span>
                  <span v-if="item.on !== undefined" class="inline-flex shrink-0 items-center gap-1.5 text-xs" :class="item.on ? 'text-st-done' : 'text-ink-faint'">
                    <span class="size-1.5 rounded-full" :class="item.on ? 'bg-st-done' : 'border border-current'" aria-hidden="true" />
                    {{ item.on ? t('palette.on') : t('palette.off') }}
                  </span>
                  <span v-if="item.index === active" class="hidden shrink-0 items-center gap-2 text-2xs text-ink-faint sm:inline-flex">
                    <span v-if="item.alt" class="inline-flex items-center gap-1"
                      ><AppWindow v-if="item.group === 'sessions'" :size="12" aria-hidden="true" />{{ item.altHint }}
                      <kbd class="rounded border border-line bg-surface px-1 font-sans">⇧↵</kbd></span
                    >
                    <kbd class="inline-flex items-center rounded border border-line bg-surface px-1 py-px"><CornerDownLeft :size="12" aria-hidden="true" /></kbd>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="hidden items-center gap-x-5 border-t border-line px-5 py-3 text-2xs text-ink-faint sm:flex">
            <span v-for="h in HINTS" :key="h.key" class="inline-flex items-center gap-1.5">
              <kbd class="rounded border border-line px-1.5 py-px font-sans text-ink-muted">{{ h.keys }}</kbd>{{ t(`palette.hints.${h.key}`) }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
