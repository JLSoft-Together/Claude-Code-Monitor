<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, CornerDownLeft, ListTodo, LoaderCircle, RefreshCw, Square, SquareCheckBig, SquareDot, X } from 'lucide-vue-next'
import { joinPath } from '../../lib/fileLinks'
import { now, relativeTime } from '../../lib/format'
import { parsePlanItems, pendingItems, planCounts, PLAN_FILE, PLAN_MAX_FILES, sortPlanFiles, toggleItem, type PlanFile, type PlanItem } from '../../lib/planBoard'
import { baseName, fileWrite, listDir, readFile } from '../../lib/preview'
import { useWorkspaceStore, workCwd } from '../../stores/workspace'

const props = defineProps<{ root: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()
const workspace = useWorkspaceStore()

const PENDING_KEY = 'ccm.planBoard.pending'
const readPending = (): boolean => {
  try {
    return localStorage.getItem(PENDING_KEY) === '1'
  } catch {
    return false
  }
}

const files = shallowRef<PlanFile[]>([])
const loading = ref(false)
const loaded = ref(false)
const missing = ref(false)
const onlyPending = ref(readPending())
const folded = ref(new Set<string>())
const busy = ref<string | null>(null)
const notice = ref<string | null>(null)
const card = ref<HTMLElement | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const target = (() => {
  if (!workspace.activeKey) return null
  const r = workspace.resolveAgentPane(workspace.activeKey)
  return 'pane' in r ? r.pane : null
})()
const targetLabel = target ? (target.title ?? workCwd(target) ?? target.preset) : null

async function readPlan(path: string): Promise<PlanFile | null> {
  const view = await readFile(path)
  if (!view || view.kind !== 'text' || view.text === undefined) return null
  return { path, name: baseName(path), mtimeMs: view.mtimeMs, items: parsePlanItems(view.text) }
}

async function load(): Promise<void> {
  if (!props.root) return
  loading.value = true
  const entries = await listDir(props.root, joinPath(props.root, '.planning'))
  missing.value = !entries
  const paths = (entries ?? [])
    .filter((e) => !e.directory && !e.outOfRoot && PLAN_FILE.test(e.name))
    .map((e) => e.path)
    .slice(0, PLAN_MAX_FILES)
  const read = await Promise.all(paths.map(readPlan))
  files.value = sortPlanFiles(read.filter((f): f is PlanFile => !!f && f.items.length > 0))
  loading.value = false
  loaded.value = true
}

onMounted(async () => {
  await load()
  await nextTick()
  card.value?.focus()
})

const shown = computed(() =>
  files.value
    .map((f) => ({ file: f, counts: planCounts(f.items), items: onlyPending.value ? pendingItems(f.items) : f.items }))
    .filter((g) => g.items.length > 0),
)
const totals = computed(() => files.value.reduce((a, f) => ({ done: a.done + planCounts(f.items).done, total: a.total + f.items.length }), { done: 0, total: 0 }))

function setPending(on: boolean): void {
  onlyPending.value = on
  try {
    localStorage.setItem(PENDING_KEY, on ? '1' : '0')
  } catch {
    // storage unavailable
  }
}

function toggleFold(path: string): void {
  const next = new Set(folded.value)
  if (!next.delete(path)) next.add(path)
  folded.value = next
}

function showNotice(text: string): void {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 4000)
}

function replaceFile(path: string, next: PlanFile | null): void {
  files.value = files.value.map((f) => (f.path === path ? (next ?? { ...f, items: [] }) : f)).filter((f) => f.items.length > 0)
}

async function reloadFile(path: string, reason: 'changed' | 'conflict'): Promise<void> {
  replaceFile(path, await readPlan(path))
  showNotice(t(`workspace.plan.${reason}`))
}

// Re-read right before writing: the item may have moved since the board loaded (an agent edits these files).
async function toggle(file: PlanFile, item: PlanItem): Promise<void> {
  if (busy.value) return
  const id = `${file.path}:${item.line}`
  busy.value = id
  try {
    const view = await readFile(file.path)
    if (!view || view.kind !== 'text' || view.text === undefined) return void (await reloadFile(file.path, 'changed'))
    const next = toggleItem(view.text, item)
    if (next === null) return void (await reloadFile(file.path, 'changed'))
    const res = await fileWrite(file.path, next, view.mtimeMs)
    if (res.ok) replaceFile(file.path, { ...file, mtimeMs: res.mtimeMs, items: parsePlanItems(next) })
    else if (res.error === 'conflict') await reloadFile(file.path, 'conflict')
    else showNotice(t(`workspace.plan.error.${res.error}`))
  } finally {
    busy.value = null
  }
}

function openAt(file: PlanFile, item: PlanItem): void {
  emit('close')
  workspace.openFile(file.path, item.line, { cwd: props.root ?? undefined })
}

function fill(item: PlanItem): void {
  if (!target) return
  emit('close')
  workspace.insertInto(target.key, item.text)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

const BOX = { todo: Square, done: SquareCheckBig, partial: SquareDot } as const
const boxClass = (item: PlanItem): string => (item.state === 'done' ? 'text-success' : item.state === 'partial' ? 'text-warning' : 'text-ink-muted')
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-plan-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,720px)] w-[min(94vw,820px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.plan.title')"
        data-plan-board
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <ListTodo :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 truncate text-sm font-semibold text-ink" :title="root ?? undefined">
            {{ root ? t('workspace.plan.titleOf', { name: baseName(root) }) : t('workspace.plan.title') }}
          </h2>
          <span v-if="totals.total" class="tabular shrink-0 text-2xs text-ink-faint">{{ t('workspace.plan.progress', { done: totals.done, total: totals.total }) }}</span>
          <span class="flex-1" />
          <label v-if="root" class="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
            <input type="checkbox" class="accent-(--ccm-accent)" :checked="onlyPending" data-plan-pending @change="setPending(($event.target as HTMLInputElement).checked)" />
            {{ t('workspace.plan.pendingOnly') }}
          </label>
          <button v-if="root" type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.plan.refresh')" :aria-label="t('workspace.plan.refresh')" :disabled="loading" data-plan-refresh @click="load()">
            <RefreshCw :size="14" :class="loading ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.plan.close')" :aria-label="t('workspace.plan.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <p v-if="!root" class="p-4 text-xs text-ink-muted">{{ t('workspace.plan.noProject') }}</p>
        <div v-else-if="!loaded" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('workspace.plan.loading') }}</div>
        <p v-else-if="!shown.length" class="p-4 text-xs text-ink-muted" data-plan-empty>
          {{ missing ? t('workspace.plan.noFolder') : files.length ? t('workspace.plan.allDone') : t('workspace.plan.none') }}
        </p>
        <div v-else class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          <section v-for="g in shown" :key="g.file.path" class="py-0.5" :data-plan-file="g.file.name">
            <button
              type="button"
              class="flex h-8 w-full cursor-pointer items-center gap-1.5 px-3 text-left text-xs hover:bg-fill"
              :aria-expanded="!folded.has(g.file.path)"
              :title="g.file.path"
              @click="toggleFold(g.file.path)"
            >
              <ChevronRight :size="13" class="shrink-0 text-ink-faint transition-transform" :class="folded.has(g.file.path) ? '' : 'rotate-90'" aria-hidden="true" />
              <span class="min-w-0 truncate font-medium text-ink">{{ g.file.name }}</span>
              <span class="tabular shrink-0 text-2xs text-ink-faint">{{ t('workspace.plan.progress', { done: g.counts.done, total: g.counts.total }) }}</span>
              <span class="flex-1" />
              <span class="shrink-0 text-2xs text-ink-faint">{{ relativeTime(g.file.mtimeMs, locale, now) }}</span>
            </button>
            <ul v-if="!folded.has(g.file.path)" class="pb-1">
              <li
                v-for="item in g.items"
                :key="item.line"
                class="group flex min-h-7 items-start gap-1.5 pr-2 hover:bg-fill"
                :style="{ paddingLeft: `${30 + item.depth * 18}px` }"
                :data-plan-item="item.line"
                :data-plan-state="item.state"
              >
                <button
                  type="button"
                  role="checkbox"
                  class="mt-[5px] shrink-0 cursor-pointer rounded-[4px] disabled:cursor-default"
                  :class="boxClass(item)"
                  :aria-checked="item.state === 'done' ? 'true' : item.state === 'partial' ? 'mixed' : 'false'"
                  :aria-label="t(`workspace.plan.state.${item.state}`)"
                  :title="t(item.state === 'done' ? 'workspace.plan.markTodo' : 'workspace.plan.markDone')"
                  :disabled="!!busy"
                  data-plan-toggle
                  @click="toggle(g.file, item)"
                >
                  <LoaderCircle v-if="busy === `${g.file.path}:${item.line}`" :size="15" class="ccm-spin" aria-hidden="true" />
                  <component :is="BOX[item.state]" v-else :size="15" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="min-w-0 flex-1 cursor-pointer py-1 text-left text-xs leading-5"
                  :class="item.state === 'done' ? 'text-ink-faint line-through' : 'text-ink'"
                  :title="t('workspace.plan.openAt', { line: item.line })"
                  data-plan-open
                  @click="openAt(g.file, item)"
                >
                  <span v-if="item.state === 'partial'" class="mr-1.5 rounded-[4px] bg-fill px-1 text-2xs text-warning">{{ t('workspace.plan.state.partial') }}</span>{{ item.text }}
                </button>
                <span class="tabular mt-1 shrink-0 text-2xs text-ink-faint">{{ item.line }}</span>
                <button
                  v-if="target"
                  type="button"
                  class="ccm-btn-plain mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  :title="t('workspace.plan.fillInto', { pane: targetLabel })"
                  :aria-label="t('workspace.plan.fill')"
                  data-plan-fill
                  @click="fill(item)"
                >
                  <CornerDownLeft :size="13" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </section>
        </div>

        <footer v-if="root" class="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs">
          <span v-if="notice" class="min-w-0 flex-1 truncate text-warning" role="status" data-plan-notice>{{ notice }}</span>
          <span v-else class="min-w-0 flex-1 truncate text-ink-faint" :title="targetLabel ?? undefined">{{
            targetLabel ? t('workspace.plan.into', { pane: targetLabel }) : t('workspace.plan.noTarget')
          }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
