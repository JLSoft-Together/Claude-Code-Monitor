<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, CircleAlert, CircleCheck, CircleDashed, CirclePlus, Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw, X } from 'lucide-vue-next'
import { joinPath } from '../../lib/fileLinks'
import { baseName, envCheck, envReveal, type EnvCheck, type EnvFileReport, type EnvRow, type EnvStatus } from '../../lib/preview'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{ root: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()

const report = shallowRef<EnvCheck | null>(null)
const loading = ref(false)
const onlyIssues = ref(false)
const folded = ref(new Set<string>())
// Revealed values stay in this component only and go with it on close.
const revealed = ref(new Map<string, string>())
const revealing = ref<string | null>(null)
const notice = ref<string | null>(null)
const card = ref<HTMLElement | null>(null)

const STATUS: Record<EnvStatus, { icon: typeof CircleCheck; cls: string }> = {
  ok: { icon: CircleCheck, cls: 'text-success' },
  empty: { icon: CircleDashed, cls: 'text-warning' },
  missing: { icon: CircleAlert, cls: 'text-warning' },
  extra: { icon: CirclePlus, cls: 'text-ink-muted' },
}
const ISSUES: EnvStatus[] = ['missing', 'empty', 'extra']

async function load(): Promise<void> {
  if (!props.root) return
  loading.value = true
  revealed.value = new Map()
  notice.value = null
  report.value = await envCheck(props.root)
  loading.value = false
}

onMounted(async () => {
  await load()
  await nextTick()
  card.value?.focus()
})
onBeforeUnmount(() => revealed.value.clear())

const ok = computed(() => (report.value?.ok ? report.value : null))
const shown = computed(() =>
  (ok.value?.files ?? []).map((f) => ({ file: f, rows: onlyIssues.value ? f.rows.filter((r) => r.status !== 'ok') : f.rows })),
)

const idOf = (file: EnvFileReport, row: EnvRow): string => `${file.name}\n${row.key}`

async function toggleReveal(file: EnvFileReport, row: EnvRow): Promise<void> {
  const id = idOf(file, row)
  if (revealed.value.has(id)) {
    const next = new Map(revealed.value)
    next.delete(id)
    revealed.value = next
    return
  }
  if (!props.root || revealing.value) return
  revealing.value = id
  try {
    const res = await envReveal(props.root, file.name, row.key)
    if (res.ok) revealed.value = new Map(revealed.value).set(id, res.value)
    else notice.value = t(`workspace.envCheck.revealError.${res.error}`)
  } finally {
    revealing.value = null
  }
}

function toggleFold(name: string): void {
  const next = new Set(folded.value)
  if (!next.delete(name)) next.add(name)
  folded.value = next
}

function openAt(file: EnvFileReport, row: EnvRow): void {
  if (!props.root || row.line === null) return
  emit('close')
  workspace.openFile(joinPath(props.root, file.name), row.line, { cwd: props.root })
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-env-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,720px)] w-[min(94vw,820px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.envCheck.title')"
        data-env-check
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <KeyRound :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 truncate text-sm font-semibold text-ink" :title="root ?? undefined">
            {{ root ? t('workspace.envCheck.titleOf', { name: baseName(root) }) : t('workspace.envCheck.title') }}
          </h2>
          <span v-if="ok" class="min-w-0 truncate text-2xs text-ink-faint" data-env-template>
            {{ ok.template ? t('workspace.envCheck.against', { name: ok.template.name }) : t('workspace.envCheck.noTemplate') }}
          </span>
          <span class="flex-1" />
          <label v-if="ok?.files.length" class="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
            <input v-model="onlyIssues" type="checkbox" class="accent-(--ccm-accent)" data-env-issues />
            {{ t('workspace.envCheck.issuesOnly') }}
          </label>
          <button v-if="root" type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.envCheck.refresh')" :aria-label="t('workspace.envCheck.refresh')" :disabled="loading" @click="load()">
            <RefreshCw :size="14" :class="loading ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.envCheck.close')" :aria-label="t('workspace.envCheck.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <p v-if="!root" class="p-4 text-xs text-ink-muted">{{ t('workspace.envCheck.noProject') }}</p>
        <div v-else-if="!report" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('workspace.envCheck.loading') }}</div>
        <p v-else-if="!ok" class="p-4 text-xs text-warning" role="status">{{ t(`workspace.envCheck.error.${report.ok ? 'failed' : report.error}`) }}</p>
        <p v-else-if="!ok.files.length" class="p-4 text-xs text-ink-muted" data-env-empty>
          {{ ok.template ? t('workspace.envCheck.onlyTemplate', { name: ok.template.name }) : t('workspace.envCheck.none') }}
        </p>
        <div v-else class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          <section v-for="g in shown" :key="g.file.name" class="py-0.5" :data-env-file="g.file.name">
            <button
              type="button"
              class="flex h-8 w-full cursor-pointer items-center gap-1.5 px-3 text-left text-xs hover:bg-fill"
              :aria-expanded="!folded.has(g.file.name)"
              @click="toggleFold(g.file.name)"
            >
              <ChevronRight :size="13" class="shrink-0 text-ink-faint transition-transform" :class="folded.has(g.file.name) ? '' : 'rotate-90'" aria-hidden="true" />
              <span class="min-w-0 truncate font-mono font-medium text-ink">{{ g.file.name }}</span>
              <span class="flex-1" />
              <template v-if="!g.file.error">
                <span
                  v-for="s in ISSUES.filter((x) => g.file.counts[x] > 0)"
                  :key="s"
                  class="tabular inline-flex shrink-0 items-center gap-1 text-2xs"
                  :class="STATUS[s].cls"
                  :data-env-count="s"
                >
                  <component :is="STATUS[s].icon" :size="12" aria-hidden="true" />{{ t(`workspace.envCheck.count.${s}`, { n: g.file.counts[s] }, g.file.counts[s]) }}
                </span>
                <span v-if="ISSUES.every((x) => g.file.counts[x] === 0)" class="inline-flex shrink-0 items-center gap-1 text-2xs text-success">
                  <CircleCheck :size="12" aria-hidden="true" />{{ t('workspace.envCheck.allGood') }}
                </span>
              </template>
            </button>
            <template v-if="!folded.has(g.file.name)">
              <p v-if="g.file.error" class="py-1 pr-3 pl-8 text-xs text-warning">{{ t(`workspace.envCheck.fileError.${g.file.error}`) }}</p>
              <p v-else-if="!g.rows.length" class="py-1 pr-3 pl-8 text-xs text-ink-faint">{{ g.file.rows.length ? t('workspace.envCheck.noIssues') : t('workspace.envCheck.noKeys') }}</p>
              <table v-else class="mb-1 w-full table-fixed text-xs">
                <thead class="sr-only">
                  <tr>
                    <th>{{ t('workspace.envCheck.col.key') }}</th>
                    <th>{{ t('workspace.envCheck.col.status') }}</th>
                    <th>{{ t('workspace.envCheck.col.value') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in g.rows" :key="row.key" class="group hover:bg-fill" :data-env-row="row.key" :data-env-status="row.status">
                    <td class="w-[40%] py-1 pr-2 pl-8">
                      <button
                        v-if="row.line !== null"
                        type="button"
                        class="block max-w-full cursor-pointer truncate text-left font-mono text-ink hover:underline"
                        :title="t('workspace.envCheck.openAt', { line: row.line })"
                        @click="openAt(g.file, row)"
                      >
                        {{ row.key }}
                      </button>
                      <span v-else class="block truncate font-mono text-ink-muted" :title="row.key">{{ row.key }}</span>
                    </td>
                    <td class="w-[22%] py-1 pr-2">
                      <span class="inline-flex items-center gap-1" :class="STATUS[row.status].cls">
                        <component :is="STATUS[row.status].icon" :size="13" class="shrink-0" aria-hidden="true" />
                        <span class="truncate">{{ t(`workspace.envCheck.status.${row.status}`) }}</span>
                      </span>
                    </td>
                    <td class="py-1 pr-3">
                      <div v-if="row.status !== 'missing'" class="flex min-w-0 items-center gap-1">
                        <span
                          v-if="revealed.has(idOf(g.file, row))"
                          class="min-w-0 flex-1 truncate font-mono text-ink select-all"
                          :title="revealed.get(idOf(g.file, row))"
                          data-env-value
                        >{{ revealed.get(idOf(g.file, row)) || t('workspace.envCheck.emptyValue') }}</span>
                        <span v-else class="min-w-0 flex-1 truncate font-mono text-ink-faint" aria-hidden="true">{{ row.empty ? '' : '••••••••' }}</span>
                        <button
                          v-if="!row.empty"
                          type="button"
                          class="ccm-btn-plain shrink-0"
                          :aria-pressed="revealed.has(idOf(g.file, row))"
                          :title="t(revealed.has(idOf(g.file, row)) ? 'workspace.envCheck.hide' : 'workspace.envCheck.reveal')"
                          :aria-label="t(revealed.has(idOf(g.file, row)) ? 'workspace.envCheck.hide' : 'workspace.envCheck.reveal')"
                          data-env-reveal
                          @click="toggleReveal(g.file, row)"
                        >
                          <LoaderCircle v-if="revealing === idOf(g.file, row)" :size="13" class="ccm-spin" aria-hidden="true" />
                          <EyeOff v-else-if="revealed.has(idOf(g.file, row))" :size="13" aria-hidden="true" />
                          <Eye v-else :size="13" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
          </section>
        </div>

        <footer v-if="root" class="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs">
          <span v-if="notice" class="min-w-0 flex-1 truncate text-warning" role="status" data-env-notice>{{ notice }}</span>
          <span v-else class="min-w-0 flex-1 truncate text-ink-faint">{{ ok?.truncated ? t('workspace.envCheck.truncated') : t('workspace.envCheck.privacy') }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
