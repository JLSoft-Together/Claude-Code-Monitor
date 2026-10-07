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
  Languages,
  ListFilter,
  Moon,
  Search,
  Trash2,
  Volume2,
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

interface Item {
  id: string
  group: 'sessions' | 'favorites' | 'commands'
  label: string
  sub?: string
  hay: string
  icon?: Component
  status?: string
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
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const STATUS_RANK: Record<string, number> = { waiting: 0, working: 1, error: 2, idle: 3, unknown: 4, stale: 5 }

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
  const commands: Item[] = [
    { id: 'c:monitor', label: t('palette.goMonitor'), icon: Activity, run: () => ui.setView('monitor') },
    { id: 'c:usage', label: t('palette.goUsage'), icon: ChartColumnBig, run: () => ui.setView('usage') },
    { id: 'c:recap', label: t('palette.recap'), icon: FileDown, run: () => ui.openRecap() },
    { id: 'c:theme', label: settings.theme === 'dark' ? t('settings.toLight') : t('settings.toDark'), icon: Moon, run: () => settings.toggleTheme() },
    { id: 'c:lang', label: `${t('settings.language')}: ${t('settings.switchLanguage')}`, icon: Languages, run: () => settings.toggleLocale() },
    { id: 'c:notify', label: settings.notifyEnabled ? t('settings.notifyOff') : t('settings.notifyOn'), icon: Bell, run: () => void settings.toggleNotifications() },
    { id: 'c:sound', label: t(settings.sound ? 'palette.soundOff' : 'palette.soundOn'), icon: Volume2, run: () => (settings.sound = !settings.sound) },
    { id: 'c:tools', label: t(settings.hideTools ? 'palette.showTools' : 'palette.hideTools'), icon: ListFilter, run: () => (settings.hideTools = !settings.hideTools) },
    ...(ended ? [{ id: 'c:clear', label: t('sessions.clearEnded', { n: ended }), icon: Trash2, run: () => void connection.dismissEnded() }] : []),
  ].map((c) => ({ ...c, group: 'commands' as const, hay: fold(c.label) }))
  return [...sessions, ...favs, ...commands]
})

const filtered = computed(() => {
  const tokens = fold(query.value).split(/\s+/).filter(Boolean)
  if (!tokens.length) return items.value
  return items.value.filter((x) => tokens.every((tk) => x.hay.includes(tk)))
})

const groups = computed(() => {
  const order = ['sessions', 'favorites', 'commands'] as const
  let index = 0
  return order
    .map((g) => ({ key: g, label: t(`palette.group.${g}`), items: filtered.value.filter((x) => x.group === g).map((x) => ({ ...x, index: index++ })) }))
    .filter((g) => g.items.length)
})

watch(query, () => (active.value = 0))
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
  if (alt && item.alt) item.alt()
  else item.run()
}

function move(delta: number): void {
  const n = filtered.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => list.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
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
    close()
  } else if (e.key === 'Tab') {
    e.preventDefault()
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
      active.value = 0
      await nextTick()
      input.value?.focus()
    } else {
      restoreFocus?.focus?.()
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
  { key: 'alt', keys: 'Shift Enter' },
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
      <div v-if="ui.paletteOpen" class="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[12vh]" @mousedown.self="close">
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="t('palette.title')"
          class="ccm-pop flex max-h-[min(70vh,560px)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lg"
        >
          <div class="flex items-center gap-3 border-b border-line px-4">
            <Search :size="18" class="shrink-0 text-ink-muted" aria-hidden="true" />
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
              class="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKey"
            />
            <kbd class="hidden shrink-0 rounded-md border border-line bg-raised px-1.5 py-0.5 text-2xs text-ink-muted sm:inline">Esc</kbd>
          </div>
          <div id="palette-list" ref="list" role="listbox" :aria-label="t('palette.title')" class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
            <p v-if="!filtered.length" class="px-4 py-6 text-center text-sm text-ink-muted">{{ t('palette.empty') }}</p>
            <div v-for="(g, gi) in groups" :key="g.key" role="group" :aria-label="g.label" :class="gi > 0 ? 'mt-1 border-t border-line pt-1' : ''">
              <p class="px-4 pt-2 pb-1.5 text-2xs font-medium text-ink-faint">{{ g.label }}</p>
              <div
                v-for="item in g.items"
                :id="`palette-opt-${item.index}`"
                :key="item.id"
                role="option"
                :data-index="item.index"
                :aria-selected="item.index === active"
                class="relative mx-2 flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-100"
                :class="item.index === active ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:text-ink'"
                @mousemove="active = item.index"
                @click="choose(item, $event.shiftKey)"
              >
                <StatusIcon v-if="item.status" :status="item.status" :size="15" :animate="false" class="shrink-0" />
                <component :is="item.icon" v-else-if="item.icon" :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate" :class="item.sub ? 'font-medium text-ink' : ''">{{ item.label }}</span>
                  <span v-if="item.sub" class="block truncate text-2xs text-ink-faint">{{ item.sub }}</span>
                </span>
                <span v-if="item.index === active" class="hidden shrink-0 items-center gap-2 text-2xs text-ink-faint sm:inline-flex">
                  <span v-if="item.alt" class="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5"><AppWindow v-if="item.group === 'sessions'" :size="12" aria-hidden="true" />Shift ↵ {{ item.altHint }}</span>
                  <span class="inline-flex items-center rounded-md border border-line px-1.5 py-0.5"><CornerDownLeft :size="12" aria-hidden="true" /></span>
                </span>
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-raised/40 px-4 py-2.5 text-2xs text-ink-faint">
            <span v-for="h in HINTS" :key="h.key" class="inline-flex items-center gap-1.5">
              <kbd class="rounded border border-line bg-surface px-1.5 py-px text-ink-muted">{{ h.keys }}</kbd>{{ t(`palette.hints.${h.key}`) }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
