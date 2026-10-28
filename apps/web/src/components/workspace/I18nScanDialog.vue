<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, CircleAlert, CircleCheck, CirclePlus, ClipboardCopy, Equal, Languages, RefreshCw, X } from 'lucide-vue-next'
import { joinPath } from '../../lib/fileLinks'
import { hasIssues, I18N_ISSUES, i18nReportText, i18nTotals } from '../../lib/i18nReport'
import { baseName, i18nScan, type I18nIssue, type I18nKey, type I18nLocale, type I18nScan, type I18nSet } from '../../lib/preview'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{ root: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()

const report = shallowRef<I18nScan | null>(null)
const loading = ref(false)
const onlyIssues = ref(true)
const open = ref(new Set<string>())
const notice = ref<string | null>(null)
const card = ref<HTMLElement | null>(null)
const AUTO_OPEN_MAX = 200

const ISSUE: Record<I18nIssue, { icon: typeof CircleAlert; cls: string }> = {
  missing: { icon: CircleAlert, cls: 'text-warning' },
  same: { icon: Equal, cls: 'text-ink-muted' },
  extra: { icon: CirclePlus, cls: 'text-ink-muted' },
}

const idOf = (s: I18nSet, l: I18nLocale): string => `${s.kind}\n${s.dir}\n${l.locale}`

async function load(): Promise<void> {
  if (!props.root) return
  loading.value = true
  notice.value = null
  const res = await i18nScan(props.root)
  report.value = res
  loading.value = false
  if (!res.ok) return
  const listed = res.sets.reduce((n, s) => n + s.locales.reduce((m, l) => m + l.missing.length + l.extra.length + l.same.length, 0), 0)
  open.value = listed <= AUTO_OPEN_MAX ? new Set(res.sets.flatMap((s) => s.locales.map((l) => idOf(s, l)))) : new Set()
}

onMounted(async () => {
  await load()
  await nextTick()
  card.value?.focus()
})

const ok = computed(() => (report.value?.ok ? report.value : null))
const totals = computed(() => i18nTotals(ok.value?.sets ?? []))
const shown = computed(() => (ok.value?.sets ?? []).map((s) => ({ set: s, locales: onlyIssues.value ? s.locales.filter(hasIssues) : s.locales })))

function toggle(id: string): void {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}

function openAt(k: I18nKey): void {
  if (!props.root) return
  emit('close')
  workspace.openFile(joinPath(props.root, k.file), k.line, { cwd: props.root })
}

async function copyList(): Promise<void> {
  const sets = ok.value?.sets
  if (!sets) return
  const text = i18nReportText(sets, { missing: t('workspace.i18nScan.kind.missing'), extra: t('workspace.i18nScan.kind.extra'), same: t('workspace.i18nScan.kind.same') })
  try {
    await navigator.clipboard.writeText(text || t('workspace.i18nScan.nothing'))
    notice.value = t('workspace.i18nScan.copied')
  } catch {
    notice.value = t('workspace.i18nScan.copyFailed')
  }
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
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-i18n-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,720px)] w-[min(94vw,820px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.i18nScan.title')"
        data-i18n-scan
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <Languages :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 truncate text-sm font-semibold text-ink" :title="root ?? undefined">
            {{ root ? t('workspace.i18nScan.titleOf', { name: baseName(root) }) : t('workspace.i18nScan.title') }}
          </h2>
          <span v-if="ok?.sets.length" class="flex min-w-0 shrink items-center gap-2 truncate text-2xs" data-i18n-totals>
            <span v-for="k in I18N_ISSUES" :key="k" class="tabular inline-flex shrink-0 items-center gap-1" :class="totals[k] ? ISSUE[k].cls : 'text-ink-faint'">
              <component :is="ISSUE[k].icon" :size="12" aria-hidden="true" />{{ t(`workspace.i18nScan.count.${k}`, { n: totals[k] }, totals[k]) }}
            </span>
          </span>
          <span class="flex-1" />
          <label v-if="ok?.sets.length" class="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
            <input v-model="onlyIssues" type="checkbox" class="accent-(--ccm-accent)" data-i18n-issues />
            {{ t('workspace.i18nScan.issuesOnly') }}
          </label>
          <button v-if="ok?.sets.length" type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.i18nScan.copy')" :aria-label="t('workspace.i18nScan.copy')" data-i18n-copy @click="copyList">
            <ClipboardCopy :size="14" aria-hidden="true" />
          </button>
          <button v-if="root" type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.i18nScan.refresh')" :aria-label="t('workspace.i18nScan.refresh')" :disabled="loading" @click="load()">
            <RefreshCw :size="14" :class="loading ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.i18nScan.close')" :aria-label="t('workspace.i18nScan.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <p v-if="!root" class="p-4 text-xs text-ink-muted">{{ t('workspace.i18nScan.noProject') }}</p>
        <div v-else-if="!report" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('workspace.i18nScan.loading') }}</div>
        <p v-else-if="!ok" class="p-4 text-xs text-warning" role="status">{{ t(`workspace.i18nScan.error.${report.ok ? 'failed' : report.error}`) }}</p>
        <p v-else-if="!ok.sets.length" class="p-4 text-xs text-ink-muted" data-i18n-empty>{{ t('workspace.i18nScan.none') }}</p>
        <div v-else class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          <section v-for="g in shown" :key="`${g.set.kind}:${g.set.dir}`" class="pb-1" :data-i18n-set="g.set.dir">
            <h3 class="flex h-8 items-center gap-2 px-3 text-xs">
              <span class="shrink-0 rounded-full bg-fill px-1.5 text-2xs text-ink-muted">{{ t(`workspace.i18nScan.set.${g.set.kind}`) }}</span>
              <span class="min-w-0 truncate font-mono font-medium text-ink" :title="g.set.dir || '.'">{{ g.set.dir || '.' }}</span>
              <span class="shrink-0 text-2xs text-ink-faint">{{ t('workspace.i18nScan.base', { locale: g.set.base.locale, n: g.set.base.keys }, g.set.base.keys) }}</span>
              <span v-if="g.set.base.error" class="shrink-0 text-2xs text-warning">{{ t(`workspace.i18nScan.fileError.${g.set.base.error}`) }}</span>
            </h3>
            <p v-if="!g.locales.length" class="py-1 pr-3 pl-8 text-xs text-ink-faint">
              <CircleCheck :size="12" class="mr-1 inline text-success" aria-hidden="true" />{{ g.set.locales.length ? t('workspace.i18nScan.allGood') : t('workspace.i18nScan.onlyBase') }}
            </p>
            <div v-for="l in g.locales" :key="l.locale" :data-i18n-locale="l.locale">
              <button
                type="button"
                class="flex h-7 w-full cursor-pointer items-center gap-1.5 pr-3 pl-5 text-left text-xs hover:bg-fill"
                :aria-expanded="open.has(idOf(g.set, l))"
                :title="l.files.join('\n')"
                @click="toggle(idOf(g.set, l))"
              >
                <ChevronRight :size="13" class="shrink-0 text-ink-faint transition-transform" :class="open.has(idOf(g.set, l)) ? 'rotate-90' : ''" aria-hidden="true" />
                <span class="shrink-0 font-mono font-medium text-ink">{{ l.locale }}</span>
                <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint">{{ l.files[0] }}</span>
                <span v-if="l.error" class="shrink-0 text-2xs text-warning">{{ t(`workspace.i18nScan.fileError.${l.error}`) }}</span>
                <template v-else>
                  <span
                    v-for="k in I18N_ISSUES.filter((x) => l.counts[x] > 0)"
                    :key="k"
                    class="tabular inline-flex shrink-0 items-center gap-1 text-2xs"
                    :class="ISSUE[k].cls"
                    :data-i18n-count="k"
                  >
                    <component :is="ISSUE[k].icon" :size="12" aria-hidden="true" />{{ t(`workspace.i18nScan.count.${k}`, { n: l.counts[k] }, l.counts[k]) }}
                  </span>
                  <span v-if="!hasIssues(l)" class="inline-flex shrink-0 items-center gap-1 text-2xs text-success">
                    <CircleCheck :size="12" aria-hidden="true" />{{ t('workspace.i18nScan.complete') }}
                  </span>
                </template>
              </button>
              <template v-if="open.has(idOf(g.set, l)) && !l.error">
                <div v-for="k in I18N_ISSUES.filter((x) => l[x].length)" :key="k" class="pb-1" :data-i18n-kind="k">
                  <p class="flex items-center gap-1 py-0.5 pr-3 pl-10 text-2xs font-medium" :class="ISSUE[k].cls">
                    <component :is="ISSUE[k].icon" :size="12" aria-hidden="true" />{{ t(`workspace.i18nScan.kind.${k}`) }}
                    <span class="text-ink-faint">· {{ t(`workspace.i18nScan.hint.${k}`) }}</span>
                  </p>
                  <ul class="pr-3 pl-14" role="list">
                    <li v-for="e in l[k]" :key="e.key">
                      <button
                        type="button"
                        class="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-1 py-0.5 text-left text-xs hover:bg-fill"
                        :title="t('workspace.i18nScan.openAt', { file: e.file, line: e.line })"
                        data-i18n-key
                        @click="openAt(e)"
                      >
                        <span class="min-w-0 flex-1 truncate font-mono text-ink">{{ e.key }}</span>
                        <span class="shrink-0 font-mono text-2xs text-ink-faint tabular">{{ baseName(e.file) }}:{{ e.line }}</span>
                      </button>
                    </li>
                    <li v-if="l.counts[k] > l[k].length" class="px-1 text-2xs text-ink-faint">{{ t('workspace.i18nScan.more', { n: l.counts[k] - l[k].length }) }}</li>
                  </ul>
                </div>
              </template>
            </div>
          </section>
        </div>

        <footer v-if="root" class="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs">
          <span v-if="notice" class="min-w-0 flex-1 truncate text-ink-muted" role="status" data-i18n-notice>{{ notice }}</span>
          <span v-else class="min-w-0 flex-1 truncate text-ink-faint" :title="t('workspace.i18nScan.scope')">{{ ok?.truncated ? t('workspace.i18nScan.truncated') : t('workspace.i18nScan.scope') }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
