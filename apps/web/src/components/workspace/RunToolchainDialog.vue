<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, CircleX, LoaderCircle, Stethoscope, TriangleAlert, X } from 'lucide-vue-next'
import type { RunConfig, ToolchainReport, ToolchainStatus } from '@ccm/shared'
import { desktop } from '../../lib/desktop'
import { retireOverlay } from '../../lib/motion'
import { issueKey, tidyIssueText } from '../../lib/runUi'
import { useRunStore } from '../../stores/run'

/** Run pane › Project SDK & toolchain: per-project Flutter SDK, and `flutter doctor` / Android tool checks on request only. */
const props = defineProps<{ open: boolean; root: string; config: RunConfig | null }>()
const emit = defineEmits<{ close: [] }>()

const { t, te } = useI18n()
const run = useRunStore()

const target = computed<{ dir: string; kind: 'flutter' | 'android' } | null>(() => {
  const c = props.config
  if (c && c.type !== 'custom') return { dir: c.cwd, kind: c.type }
  const p = run.projectsFor(props.root).find((x) => x.kind === 'android' || x.type === 'app')
  return p ? { dir: p.dir, kind: p.kind } : null
})

const report = ref<ToolchainReport | null>(null)
const checking = ref(false)
const sdkFailed = ref(false)
const sheet = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    sdkFailed.value = false
    if (report.value && report.value.kind !== target.value?.kind) report.value = null
    void run.loadSettings()
    if (target.value?.kind === 'flutter') void run.loadEnv(target.value.dir, 'flutter')
    await nextTick()
    sheet.value?.querySelector<HTMLElement>('[data-toolchain-check]')?.focus()
  },
  { immediate: true },
)

const env = computed(() => (target.value?.kind === 'flutter' ? run.envFor(target.value.dir, 'flutter') : null))
const projectSdk = computed(() => {
  const dir = target.value?.dir
  if (!dir || !run.settings?.flutterSdkProjects) return null
  const want = dir.replace(/[\\/]+$/, '').toLowerCase()
  const hit = Object.entries(run.settings.flutterSdkProjects).find(([k]) => k.replace(/[\\/]+$/, '').toLowerCase() === want)
  return hit?.[1] ?? null
})

async function chooseSdk(): Promise<void> {
  const dir = target.value?.dir
  if (!dir) return
  const picked = await desktop?.pickFolder(projectSdk.value ?? (env.value?.kind === 'flutter' ? (env.value.sdk ?? undefined) : undefined))
  if (picked) sdkFailed.value = !(await run.setProjectSdk(dir, picked))
}

async function resetSdk(): Promise<void> {
  if (target.value) sdkFailed.value = !(await run.setProjectSdk(target.value.dir, null))
}

async function check(): Promise<void> {
  const tg = target.value
  if (!tg || checking.value) return
  checking.value = true
  try {
    report.value = await run.toolchain(tg.dir, tg.kind)
  } finally {
    checking.value = false
  }
}

const ICON: Record<ToolchainStatus, typeof CircleCheck> = { ok: CircleCheck, warning: TriangleAlert, error: CircleX }
const TONE: Record<ToolchainStatus, string> = { ok: 'text-success', warning: 'text-warning', error: 'text-st-error' }

const checkName = (name: string): string => (report.value?.kind === 'android' && te(`run.toolchain.names.${name}`) ? t(`run.toolchain.names.${name}`) : name)
const issueText = (i: { code: string; detail?: string }, groups: string[]): string => {
  const { key, params } = issueKey(i, groups, te)
  return tidyIssueText(t(key, params))
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4" @mousedown.self="emit('close')">
        <div
          ref="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-toolchain-title"
          class="ccm-sheet flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden"
          data-run-toolchain
          @keydown.esc.stop="emit('close')"
        >
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <Stethoscope :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 id="run-toolchain-title" class="min-w-0 flex-1 truncate text-sm font-semibold text-ink" :title="target?.dir">{{ t('run.toolchain.title') }}</h2>
            <button type="button" class="ccm-btn-plain shrink-0" :title="t('run.toolchain.close')" :aria-label="t('run.toolchain.close')" @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </header>

          <div class="ccm-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4">
            <section v-if="target?.kind === 'flutter'" aria-labelledby="run-project-sdk" data-run-project-sdk>
              <h3 id="run-project-sdk" class="mb-1.5 text-xs font-semibold text-ink">{{ t('run.projectSdk.title') }}</h3>
              <div class="ccm-group flex min-w-0 items-center gap-2 px-3 py-2">
                <p class="min-w-0 flex-1 truncate font-mono text-2xs text-ink-muted" :title="env?.kind === 'flutter' ? (env.sdk ?? undefined) : undefined">
                  <template v-if="env?.kind === 'flutter' && env.sdk">
                    {{ t('run.projectSdk.inUse', { path: env.sdk }) }}<span v-if="env.source" class="font-sans"> · {{ t(`run.projectSdk.source.${env.source}`) }}</span>
                  </template>
                  <template v-else>{{ t('run.projectSdk.none') }}</template>
                </p>
                <button type="button" class="ccm-btn shrink-0" data-run-project-sdk-choose @click="chooseSdk">{{ t('run.projectSdk.choose') }}</button>
                <button v-if="projectSdk" type="button" class="ccm-btn-plain shrink-0 text-xs" data-run-project-sdk-reset @click="resetSdk">{{ t('run.projectSdk.reset') }}</button>
              </div>
              <p class="mt-1 text-2xs leading-relaxed text-ink-faint">{{ t('run.projectSdk.hint') }}</p>
              <p v-if="sdkFailed" class="mt-1 text-2xs text-st-error" role="alert">{{ t('run.projectSdk.failed') }}</p>
            </section>

            <section aria-labelledby="run-toolchain-check" class="flex min-w-0 flex-col gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <h3 id="run-toolchain-check" class="min-w-0 flex-1 text-xs font-semibold text-ink">{{ t('run.toolchain.check') }}</h3>
                <button type="button" class="ccm-btn shrink-0" :disabled="!target || checking" data-toolchain-check @click="check">
                  <LoaderCircle v-if="checking" :size="13" class="ccm-spin" aria-hidden="true" />{{ report ? t('run.toolchain.again') : t('run.toolchain.check') }}
                </button>
              </div>
              <p class="text-2xs leading-relaxed text-ink-faint">{{ t('run.toolchain.hint') }}</p>
              <p v-if="checking" class="text-xs text-ink-muted" role="status">{{ t('run.toolchain.checking') }}</p>
              <p v-else-if="report?.error" class="flex items-start gap-1.5 text-xs text-st-error" role="alert">
                <CircleX :size="13" class="mt-px shrink-0" aria-hidden="true" />{{ issueText(report.error, ['toolchainError', 'env', 'error']) }}
              </p>
              <p v-else-if="!report" class="text-xs text-ink-muted">{{ t('run.toolchain.empty') }}</p>
              <ul v-if="report && !checking" class="ccm-group divide-y divide-line" aria-live="polite" data-toolchain-results>
                <li v-for="c in report.checks" :key="c.name" class="flex min-w-0 items-start gap-2 px-3 py-2" :data-toolchain-row="c.status">
                  <component :is="ICON[c.status]" :size="14" class="mt-0.5 shrink-0" :class="TONE[c.status]" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm text-ink">
                      {{ checkName(c.name) }} <span class="text-2xs" :class="TONE[c.status]">· {{ t(`run.toolchain.status.${c.status}`) }}</span>
                    </p>
                    <p v-if="c.summary" class="truncate text-2xs text-ink-muted" :title="c.summary">{{ c.summary }}</p>
                    <ul v-if="c.messages.length" class="mt-1 flex flex-col gap-0.5">
                      <li v-for="(m, i) in c.messages" :key="i" class="flex min-w-0 items-start gap-1.5 text-2xs">
                        <component :is="ICON[m.status]" :size="11" class="mt-px shrink-0" :class="TONE[m.status]" aria-hidden="true" />
                        <span class="sr-only">{{ t(`run.toolchain.status.${m.status}`) }}:</span>
                        <span class="min-w-0 break-words text-ink-muted">{{ m.issue ? issueText(m.issue, ['env']) : m.text }}</span>
                      </li>
                    </ul>
                  </div>
                </li>
              </ul>
              <p v-if="report && !checking" class="text-2xs text-ink-faint">{{ t('run.toolchain.at', { time: new Date(report.at).toLocaleTimeString() }) }}</p>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
