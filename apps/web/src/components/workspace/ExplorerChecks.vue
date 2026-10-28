<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BuildError } from '@ccm/shared'
import { CircleAlert, CircleCheck, LoaderCircle, Play, Send, Square, TriangleAlert } from 'lucide-vue-next'
import { checkKey, checkOptions, groupErrors, type CheckOption } from '../../lib/checks'
import { duration } from '../../lib/format'
import { scriptsIn, type ScriptsResult } from '../../lib/projects'
import { relativeTo } from '../../lib/explorer/tree'
import { useChecksStore } from '../../stores/checks'
import { useRunStore } from '../../stores/run'
import AppSelect from '../AppSelect.vue'

const props = defineProps<{ root: string; flutter: boolean }>()
const emit = defineEmits<{ open: [path: string, keep: boolean, line: number] }>()

const { t } = useI18n()
const checks = useChecksStore()
const runStore = useRunStore()

const scripts = ref<ScriptsResult | null>(null)
const loading = ref(true)
watch(
  () => props.root,
  async (root) => {
    loading.value = true
    const res = await scriptsIn(root)
    if (root !== props.root) return
    scripts.value = res
    loading.value = false
  },
  { immediate: true },
)

const options = computed<CheckOption[]>(() => checkOptions(scripts.value, props.flutter))
const picked = ref<string | null>(null)
const last = computed(() => checks.of(props.root))
watch(
  options,
  (opts) => {
    const want = last.value ? checkKey(last.value.check) : picked.value
    picked.value = opts.some((o) => checkKey(o) === want) ? want : (opts[0] ? checkKey(opts[0]) : null)
  },
  { immediate: true },
)
const selectOptions = computed(() => options.value.map((o) => ({ value: checkKey(o), label: o.label })))
const current = computed(() => options.value.find((o) => checkKey(o) === picked.value) ?? null)

const running = computed(() => !!last.value?.running)
const result = computed(() => last.value?.result ?? null)
const okResult = computed(() => (result.value?.ok ? result.value : null))
const groups = computed(() => (okResult.value ? groupErrors(okResult.value.errors) : []))
const counts = computed(() => {
  const errs = okResult.value?.errors ?? []
  return { errors: errs.filter((e) => e.severity === 'error').length, warnings: errs.filter((e) => e.severity === 'warning').length }
})
const showLog = ref(false)
const sent = ref<string | null>(null)

function start(): void {
  if (current.value) void checks.run(props.root, { source: current.value.source, name: current.value.name })
  showLog.value = false
}

function send(e: BuildError): void {
  sent.value = runStore.sendErrorToAgent(e, props.root) ? `${e.file}:${e.line}` : null
  if (!sent.value) sent.value = 'none'
}

const rel = (file: string): string => (file.toLowerCase().startsWith(props.root.replace(/[\\/]+$/, '').toLowerCase()) ? relativeTo(props.root, file) || file : file)
const elapsed = (ms: number): string => duration(new Date(0).toISOString(), ms) ?? '0s'
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1">
    <p v-if="loading" class="px-2 py-2 text-xs text-ink-muted" role="status">{{ t('workspace.checks.loading') }}</p>
    <p v-else-if="!options.length" class="px-2 py-2 text-xs text-ink-muted">{{ t('workspace.checks.none') }}</p>
    <template v-else>
      <div class="flex shrink-0 items-center gap-1 px-1">
        <AppSelect v-model="picked" :options="selectOptions" :label="t('workspace.checks.pick')" size="sm" class="min-w-0 flex-1" :disabled="running" />
        <button v-if="running" type="button" class="ccm-btn h-6 gap-1 px-2 text-2xs" @click="checks.cancel(root)">
          <Square :size="11" aria-hidden="true" />{{ t('workspace.checks.stop') }}
        </button>
        <button v-else type="button" class="ccm-btn ccm-btn-primary h-6 gap-1 px-2 text-2xs" :disabled="!current" @click="start">
          <Play :size="11" aria-hidden="true" />{{ t('workspace.checks.run') }}
        </button>
      </div>

      <p class="flex shrink-0 items-center gap-1.5 px-2 text-2xs" role="status" aria-live="polite">
        <template v-if="running">
          <LoaderCircle :size="12" class="ccm-spin text-ink-muted" aria-hidden="true" />
          <span class="text-ink-muted">{{ t('workspace.checks.running', { name: last?.check.name }) }}</span>
        </template>
        <template v-else-if="result && !result.ok">
          <CircleAlert :size="12" class="text-st-error" aria-hidden="true" />
          <span class="text-st-error">{{ t(`workspace.checks.error.${result.error}`, { detail: result.detail ?? '' }) }}</span>
        </template>
        <template v-else-if="okResult">
          <CircleCheck v-if="okResult.code === 0 && !counts.errors" :size="12" class="text-success" aria-hidden="true" />
          <CircleAlert v-else :size="12" class="text-st-error" aria-hidden="true" />
          <span :class="okResult.code === 0 && !counts.errors ? 'text-ink-muted' : 'text-st-error'">
            {{ okResult.code === 0 && !counts.errors ? t('workspace.checks.passed') : t('workspace.checks.failed', { code: okResult.code ?? '?' }) }}
          </span>
          <span class="text-ink-faint">· {{ t('workspace.checks.counts', counts) }} · {{ elapsed(okResult.ms) }}</span>
          <button type="button" class="ms-auto cursor-pointer text-accent-ink hover:underline" :aria-expanded="showLog" @click="showLog = !showLog">
            {{ showLog ? t('workspace.checks.hideLog') : t('workspace.checks.showLog') }}
          </button>
        </template>
      </p>
      <p v-if="sent" class="px-2 text-2xs text-ink-muted" role="status">{{ sent === 'none' ? t('workspace.checks.noAgent') : t('workspace.checks.sent') }}</p>

      <pre v-if="showLog && okResult" class="ccm-scroll mx-1 max-h-64 shrink-0 overflow-auto rounded-inner bg-fill p-2 font-mono text-2xs whitespace-pre-wrap text-ink-muted">{{ okResult.tail || t('workspace.checks.emptyLog') }}</pre>

      <div v-if="groups.length" class="ccm-scroll min-h-0 flex-1 overflow-y-auto pb-1">
        <section v-for="g in groups" :key="g.file" class="mb-1">
          <p class="truncate px-2 pt-1 text-2xs font-semibold text-ink" :title="g.file">{{ rel(g.file) }}</p>
          <div v-for="(e, i) in g.items" :key="i" class="group flex min-w-0 items-start gap-1.5 rounded-inner px-2 py-0.5 text-xs hover:bg-fill">
            <component :is="e.severity === 'error' ? CircleAlert : TriangleAlert" :size="12" class="mt-0.5 shrink-0" :class="e.severity === 'error' ? 'text-st-error' : 'text-warning'" aria-hidden="true" />
            <span class="sr-only">{{ t(`workspace.checks.severity.${e.severity}`) }}:</span>
            <button type="button" class="min-w-0 flex-1 cursor-pointer text-left" :title="`${rel(e.file)}:${e.line}:${e.col}`" @click="emit('open', e.file, false, e.line)">
              <span class="text-ink-faint tabular">{{ e.line }}:{{ e.col }}</span>
              <span class="ml-1.5 break-words text-ink">{{ e.message }}</span>
            </button>
            <button
              type="button"
              class="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-fill-strong hover:text-ink focus-visible:opacity-100"
              :title="t('workspace.checks.sendToAgent')"
              :aria-label="t('workspace.checks.sendToAgent')"
              @click="send(e)"
            >
              <Send :size="11" aria-hidden="true" />
            </button>
          </div>
        </section>
        <p v-if="okResult?.errorsTruncated" class="px-2 text-2xs text-ink-faint">{{ t('workspace.checks.truncated') }}</p>
      </div>
    </template>
  </div>
</template>
