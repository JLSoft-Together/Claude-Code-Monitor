<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, TriangleAlert } from 'lucide-vue-next'
import { CAPTURE_KEEP_DAYS, CAPTURE_MAX_GB, type CaptureConfig, type CaptureStatus } from '@ccm/shared'
import { captureOpen, capturePick, captureSet, captureStatus } from '../lib/capture'
import SegmentedControl from './ui/SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'

/** Settings › Screenshots and recordings (desktop): capture folder, attach-as-file, retention (v76 R4). */
const props = defineProps<{ open: boolean }>()

const { t } = useI18n()
const status = ref<CaptureStatus | null>(null)
const failed = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) void captureStatus().then((s) => (status.value = s))
  },
  { immediate: true },
)

const cfg = computed(() => status.value?.config ?? null)
const dayOptions = computed(() => CAPTURE_KEEP_DAYS.map((n) => ({ value: n as number, label: t('capture.days', { n }, n) })))
const gbOptions = computed(() => CAPTURE_MAX_GB.map((n) => ({ value: n as number, label: t('capture.gb', { n }) })))

function took(s: CaptureStatus | null): void {
  failed.value = !s
  if (s) status.value = s
}

const choose = async (): Promise<void> => took(await capturePick())
const set = async (patch: Partial<CaptureConfig>): Promise<void> => took(await captureSet(patch))
</script>

<template>
  <section v-if="cfg" aria-labelledby="set-capture" class="mt-6" data-capture-settings>
    <h3 id="set-capture" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('capture.section') }}</h3>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <div class="flex min-w-0 items-center gap-2 px-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-ink">{{ t('capture.folder') }}</p>
          <p class="mt-0.5 truncate font-mono text-2xs" :class="cfg.dir ? 'text-ink-muted' : 'text-ink-faint'" :title="cfg.dir ?? undefined" data-capture-dir>
            {{ cfg.dir ?? t('capture.none') }}
          </p>
        </div>
        <button
          v-if="status?.active"
          type="button"
          class="ccm-btn-plain size-7 shrink-0"
          :aria-label="t('capture.open')"
          :title="t('capture.open')"
          @click="captureOpen()"
        >
          <FolderOpen :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="ccm-btn shrink-0" :aria-label="t('capture.chooseFor')" data-capture-choose @click="choose">{{ t('capture.choose') }}</button>
        <button
          v-if="cfg.dir"
          type="button"
          class="ccm-btn-plain shrink-0 text-xs"
          :aria-label="t('capture.clearFor')"
          :title="t('capture.clearFor')"
          data-capture-clear
          @click="set({ dir: null })"
        >
          {{ t('capture.clear') }}
        </button>
      </div>
      <p v-if="status?.problem" class="flex items-start gap-1.5 px-3 py-2 text-2xs text-warning" role="alert" :data-capture-problem="status.problem">
        <TriangleAlert :size="13" class="mt-px shrink-0" aria-hidden="true" />{{ t(status.problem === 'missing' ? 'capture.missing' : 'capture.notWritable') }}
      </p>
      <template v-if="cfg.dir">
        <ToggleSwitch :model-value="cfg.asFile" :label="t('capture.asFile')" :hint="t('capture.asFileHint')" class="px-3" data-capture-as-file @update:model-value="(on: boolean) => set({ asFile: on })" />
        <div class="px-3 py-2">
          <p class="text-sm">{{ t('capture.keep') }}</p>
          <p class="mt-0.5 text-2xs text-ink-faint">{{ t('capture.keepHint') }}</p>
          <SegmentedControl :model-value="cfg.keepDays" :options="dayOptions" :label="t('capture.keep')" fill class="mt-2 w-full" data-capture-keep @update:model-value="(n: number) => set({ keepDays: n })" />
          <p class="mt-2 text-2xs text-ink-muted">{{ t('capture.maxSize') }}</p>
          <SegmentedControl :model-value="cfg.maxGb" :options="gbOptions" :label="t('capture.maxSize')" fill class="mt-1 w-full" data-capture-max @update:model-value="(n: number) => set({ maxGb: n })" />
        </div>
      </template>
    </div>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('capture.folderHint') }}</p>
    <p v-if="failed" class="mt-1 px-3 text-2xs text-st-error" role="alert">{{ t('capture.failed') }}</p>
  </section>
</template>
