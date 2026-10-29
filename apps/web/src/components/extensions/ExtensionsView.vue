<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CircleAlert, Copy, Folder, FolderOpen, Globe, LoaderCircle, LogIn, Plus, Puzzle, RefreshCw, Server, Sparkles, Trash2, Webhook } from 'lucide-vue-next'
import { CATALOG, type CatalogEntry, type ExtScope, type McpServerRow } from '@ccm/shared'
import { desktop } from '../../lib/desktop'
import { entryState, others, removeScope } from '../../lib/extensions'
import { now, relativeTime, shortPath } from '../../lib/format'
import { openExternal } from '../../lib/preview'
import { hasHooks } from '../../lib/claudeHooks'
import { useExtensionsStore, type ExtMode } from '../../stores/extensions'
import { dirKey, useFavoritesStore } from '../../stores/favorites'
import { useTerminalsStore } from '../../stores/terminals'
import { useWorkspaceStore } from '../../stores/workspace'
import AppSelect from '../AppSelect.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import AddSourceSheet from './AddSourceSheet.vue'
import ExtensionCard from './ExtensionCard.vue'
import HooksPanel from './HooksPanel.vue'
import InstallSheet from './InstallSheet.vue'
import { brandIcon, STATE_META } from './meta'

const { t, locale } = useI18n()
const ext = useExtensionsStore()
const workspace = useWorkspaceStore()
const favorites = useFavoritesStore()
const terminals = useTerminalsStore()

const sheet = ref<CatalogEntry | null>(null)
const sourceOpen = ref(false)
const browsing = ref(false)

type Section = 'catalog' | 'hooks'
const section = ref<Section>('catalog')
const sections = computed(() => [
  { value: 'catalog' as Section, label: t('hooksMgr.tab.catalog'), icon: Puzzle },
  { value: 'hooks' as Section, label: t('hooksMgr.tab.hooks'), icon: Webhook },
])

const modes = computed(() => [
  { value: 'global' as ExtMode, label: t('ext.scope.global'), icon: Globe },
  { value: 'project' as ExtMode, label: t('ext.scope.project'), icon: Folder },
])

const baseName = (dir: string): string => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir

/** Picked project first, then recent / favorite / live session folders (deduped like the launch picker). */
const projectOptions = computed(() => {
  const seen = new Set<string>()
  const dirs = [ext.project, ...workspace.recentDirs, ...favorites.list.map((f) => f.dir), ...terminals.live.map((s) => s.cwd)]
  const out: { value: string; label: string; hint: string }[] = []
  for (const dir of dirs) {
    if (!dir || seen.has(dirKey(dir))) continue
    seen.add(dirKey(dir))
    out.push({ value: dir, label: baseName(dir), hint: shortPath(dir) })
    if (out.length >= 24) break
  }
  return out
})
const projectModel = computed({
  get: () => ext.project,
  set: (v: string | null) => (ext.project = v),
})

async function browse(): Promise<void> {
  if (browsing.value || !desktop) return
  browsing.value = true
  try {
    const dir = await desktop.pickFolder(ext.project ?? workspace.recentDirs[0])
    if (dir) ext.project = dir
  } finally {
    browsing.value = false
  }
}

const noProject = computed(() => ext.mode === 'project' && !ext.project)
const states = computed(() => new Map(CATALOG.map((e) => [e.id, entryState(e, ext.status, ext.mcp)])))
const mcpEntries = CATALOG.filter((e) => e.kind === 'mcp')
const pluginEntries = CATALOG.filter((e) => e.kind === 'plugin')
const missing = (e: CatalogEntry) => e.prereqs.filter((p) => ext.status && !ext.status.prereqs[p])
const other = computed(() => others(ext.status, ext.mcp))
const projectView = computed(() => ext.mode === 'project')
const disabled = computed(() => !!ext.busy || !ext.status?.cli)
const checked = computed(() => (ext.mcpAt ? relativeTime(ext.mcpAt, locale.value, now.value) : null))

function removeEntry(e: CatalogEntry, scope: ExtScope): void {
  const s = states.value.get(e.id)
  if (e.kind === 'plugin') void ext.remove(e.id, { kind: 'plugin', name: s?.installed ?? [], scope })
  else if (s?.server) void ext.remove(e.id, { kind: 'mcp', name: s.server, scope })
}

const serverScope = (row: McpServerRow): ExtScope | null => (row.plugin || row.connector ? null : removeScope(row.scopes, projectView.value))
const serverMeta = (row: McpServerRow) => STATE_META[row.state]

const skillGroups = computed(() => {
  const s = ext.status
  if (!s) return []
  const groups = [{ key: 'user', title: t('ext.sections.skillsUser'), dir: s.skillDirs.user, names: s.skills.user }]
  if (ext.mode === 'project' && s.skillDirs.project) groups.push({ key: 'project', title: t('ext.sections.skillsProject'), dir: s.skillDirs.project, names: s.skills.project })
  return groups
})
const skillPath = (dir: string, name: string): string => `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`

const copiedPath = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
  } catch {
    return
  }
  copiedPath.value = path
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copiedPath.value = null), 1500)
}
onBeforeUnmount(() => clearTimeout(copiedTimer))

onMounted(() => void ext.refresh())
watch(() => ext.dir, () => void ext.refresh())
watch(() => ext.mode, () => void ext.refresh())
</script>

<template>
  <main class="mx-auto w-full max-w-[1560px] flex-1 px-4 py-5 sm:px-6 sm:py-6" data-extensions>
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="min-w-0">
        <h2 class="text-2xl font-semibold tracking-tight">{{ t('ext.title') }}</h2>
        <p class="mt-1 max-w-[80ch] text-sm text-ink-muted">{{ t('ext.subtitle') }}</p>
      </div>
      <SegmentedControl v-if="hasHooks" v-model="section" :options="sections" :label="t('hooksMgr.tab.label')" data-ext-section />
      <button v-if="section === 'catalog'" type="button" class="ccm-btn" :disabled="!ext.status?.cli" data-ext-add-source @click="sourceOpen = true">
        <Plus :size="14" aria-hidden="true" />{{ t('ext.addSource') }}
      </button>
    </div>

    <!-- Toolbar: where to install + status refresh -->
    <div class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <SegmentedControl v-model="ext.mode" :options="modes" :label="t('ext.scope.label')" />
      <template v-if="ext.mode === 'project'">
        <AppSelect
          v-if="projectOptions.length"
          v-model="projectModel"
          :options="projectOptions"
          :label="t('ext.project.label')"
          :icon="Folder"
          :display="ext.project ? baseName(ext.project) : t('ext.project.none')"
        />
        <button type="button" class="ccm-btn" :disabled="browsing" @click="browse">
          <FolderOpen :size="14" aria-hidden="true" />{{ t('ext.project.choose') }}
        </button>
        <span v-if="ext.project" class="hidden min-w-0 truncate font-mono text-2xs text-ink-faint md:inline" :title="ext.project">{{ shortPath(ext.project) }}</span>
      </template>
      <div v-if="section === 'catalog'" class="ml-auto flex items-center gap-2">
        <span class="text-2xs text-ink-faint" role="status">
          <template v-if="ext.mcpLoading">{{ t('ext.refreshing') }}</template>
          <template v-else-if="checked">{{ t('ext.checked', { ago: checked }) }}</template>
        </span>
        <button type="button" class="ccm-btn" :disabled="ext.loading || ext.mcpLoading || noProject" data-ext-refresh @click="ext.refresh(true)">
          <LoaderCircle v-if="ext.loading || ext.mcpLoading" :size="14" class="animate-spin" aria-hidden="true" />
          <RefreshCw v-else :size="14" aria-hidden="true" />{{ t('ext.refresh') }}
        </button>
      </div>
    </div>

    <p v-if="noProject" class="mt-6 rounded-card bg-surface px-4 py-6 text-center text-sm text-ink-muted shadow-card">{{ t('ext.project.hint') }}</p>

    <HooksPanel v-else-if="section === 'hooks'" :dir="ext.dir" />

    <template v-else>
      <div v-if="ext.status && !ext.status.cli" class="mt-5 flex items-start gap-2 rounded-card bg-warning-soft px-4 py-3" role="alert">
        <CircleAlert :size="16" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ t('ext.noCli.title') }}</p>
          <p class="mt-0.5 text-xs text-ink-muted">{{ t('ext.noCli.body') }}</p>
        </div>
      </div>
      <p v-else-if="ext.failed" class="mt-5 flex items-center gap-1.5 text-sm text-warning" role="alert">
        <CircleAlert :size="14" aria-hidden="true" />{{ t('ext.loadFailed') }}
      </p>

      <section class="mt-6" aria-labelledby="ext-mcp">
        <h3 id="ext-mcp" class="text-base font-semibold">{{ t('ext.sections.mcp') }}</h3>
        <p class="mt-0.5 text-xs text-ink-muted">{{ t('ext.sections.mcpHint') }}</p>
        <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
          <ExtensionCard
            v-for="e in mcpEntries"
            :key="e.id"
            :entry="e"
            :state="states.get(e.id)!"
            :checking="ext.mcpLoading"
            :missing="missing(e)"
            :busy="ext.busy === e.id"
            :disabled="disabled"
            :project="projectView"
            :result="ext.results[e.id]"
            @open="sheet = e"
            @remove="(s) => removeEntry(e, s)"
            @sign-in="(name) => ext.login(e.id, name)"
            @docs="openExternal(e.docs)"
          />
        </div>
      </section>

      <section class="mt-8" aria-labelledby="ext-plugins">
        <h3 id="ext-plugins" class="text-base font-semibold">{{ t('ext.sections.plugins') }}</h3>
        <p class="mt-0.5 text-xs text-ink-muted">{{ t('ext.sections.pluginsHint') }}</p>
        <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
          <ExtensionCard
            v-for="e in pluginEntries"
            :key="e.id"
            :entry="e"
            :state="states.get(e.id)!"
            :checking="false"
            :missing="missing(e)"
            :busy="ext.busy === e.id"
            :disabled="disabled"
            :project="projectView"
            :result="ext.results[e.id]"
            @open="sheet = e"
            @remove="(s) => removeEntry(e, s)"
            @docs="openExternal(e.docs)"
          />
        </div>
      </section>

      <section class="mt-8" aria-labelledby="ext-other">
        <h3 id="ext-other" class="text-base font-semibold">{{ t('ext.sections.other') }}</h3>
        <p class="mt-0.5 text-xs text-ink-muted">{{ t('ext.sections.otherHint') }}</p>
        <div class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div class="ccm-group" data-ext-other>
            <p v-if="!other.servers.length && !other.plugins.length" class="px-3 py-3 text-xs text-ink-faint">{{ t('ext.sections.noOther') }}</p>
            <div v-for="row in other.servers" :key="`s:${row.name}`" class="flex min-h-10 min-w-0 items-center gap-2 px-3 py-1.5">
              <component :is="brandIcon(row.name) ?? Server" :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
              <span class="min-w-0 truncate font-mono text-xs" :title="row.name">{{ row.name }}</span>
              <span class="inline-flex shrink-0 items-center gap-1 text-2xs" :class="serverMeta(row).cls">
                <component :is="serverMeta(row).icon" :size="12" aria-hidden="true" />{{ ext.mcpLoading && row.state === 'unknown' ? t('ext.state.checking') : t(`ext.state.${row.state}`) }}
              </span>
              <span class="ml-auto hidden shrink-0 truncate text-2xs text-ink-faint sm:inline">
                {{ row.connector ? t('ext.other.connector') : row.plugin ? t('ext.other.plugin', { name: row.plugin }) : row.scopes.map((s) => t(`ext.scopeChip.${s}`)).join(' · ') }}
              </span>
              <button
                v-if="row.state === 'needsAuth' && !row.connector"
                type="button"
                class="ccm-btn-plain shrink-0"
                :disabled="disabled"
                :aria-label="`${t('ext.actions.signIn')}: ${row.name}`"
                :title="t('ext.actions.signIn')"
                @click="ext.login(`mcp:${row.name}`, row.name)"
              >
                <LoaderCircle v-if="ext.busy === `mcp:${row.name}`" :size="13" class="animate-spin" aria-hidden="true" />
                <LogIn v-else :size="13" aria-hidden="true" />
              </button>
              <button
                v-if="serverScope(row)"
                type="button"
                class="ccm-btn-plain shrink-0"
                :disabled="disabled"
                :aria-label="`${t('ext.actions.remove')}: ${row.name}`"
                :title="t('ext.actions.remove')"
                @click="ext.remove(`mcp:${row.name}`, { kind: 'mcp', name: row.name, scope: serverScope(row)! })"
              >
                <Trash2 :size="13" aria-hidden="true" />
              </button>
            </div>
            <div v-for="p in other.plugins" :key="`p:${p.id}:${p.scope}`" class="flex min-h-10 min-w-0 items-center gap-2 px-3 py-1.5">
              <component :is="brandIcon(p.id) ?? Puzzle" :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
              <span class="min-w-0 truncate font-mono text-xs" :title="p.id">{{ p.id }}</span>
              <span v-if="!p.enabled" class="shrink-0 text-2xs text-ink-faint">{{ t('ext.other.disabled') }}</span>
              <span class="ml-auto shrink-0 text-2xs text-ink-faint">{{ t(`ext.scopeChip.${p.scope}`) }}</span>
              <button
                v-if="removeScope([p.scope], projectView)"
                type="button"
                class="ccm-btn-plain shrink-0"
                :disabled="disabled"
                :aria-label="`${t('ext.actions.remove')}: ${p.id}`"
                :title="t('ext.actions.remove')"
                @click="ext.remove(`plugin:${p.id}`, { kind: 'plugin', name: p.id, scope: p.scope })"
              >
                <LoaderCircle v-if="ext.busy === `plugin:${p.id}`" :size="13" class="animate-spin" aria-hidden="true" />
                <Trash2 v-else :size="13" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div class="flex min-w-0 flex-col gap-3">
            <div v-for="g in skillGroups" :key="g.key" :data-ext-skills="g.key">
              <h4 class="truncate text-xs font-medium text-ink-muted" :title="g.dir">{{ g.title }}</h4>
              <div v-if="g.names.length" class="ccm-group mt-1 max-h-80 overflow-y-auto">
                <div v-for="s in g.names" :key="s" class="flex min-h-8 min-w-0 items-center gap-2 px-3 py-1">
                  <Sparkles :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate font-mono text-xs" :title="skillPath(g.dir, s)">{{ s }}</span>
                  <button
                    type="button"
                    class="ccm-btn-plain shrink-0"
                    :aria-label="`${t('ext.other.copyPath')}: ${s}`"
                    :title="copiedPath === skillPath(g.dir, s) ? t('ext.other.copied') : t('ext.other.copyPath')"
                    data-ext-copy-skill
                    @click="copyPath(skillPath(g.dir, s))"
                  >
                    <Check v-if="copiedPath === skillPath(g.dir, s)" :size="13" class="text-success" aria-hidden="true" />
                    <Copy v-else :size="13" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p v-else class="mt-1 text-2xs text-ink-faint">{{ t('ext.other.none') }}</p>
            </div>
            <p class="sr-only" role="status">{{ copiedPath ? t('ext.other.copied') : '' }}</p>
          </div>
        </div>
      </section>
    </template>

    <InstallSheet :entry="sheet" @close="sheet = null" />
    <AddSourceSheet :open="sourceOpen" @close="sourceOpen = false" />
  </main>
</template>
