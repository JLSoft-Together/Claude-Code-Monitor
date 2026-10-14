<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Boxes, ChevronDown, FolderSearch, X } from 'lucide-vue-next'
import { PRICING_CHECKED_AT } from '@ccm/shared'
import { baseName } from '../../lib/format'
import { useConnectionStore } from '../../stores/connection'
import { useUsageStore, type UsageMetric, type UsageRange } from '../../stores/usage'
import AppSelect from '../AppSelect.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ArtImage from '../ArtImage.vue'
import LottieArt from '../LottieArt.vue'
import UsageDailyChart from './UsageDailyChart.vue'
import UsageKpis from './UsageKpis.vue'
import UsageLive from './UsageLive.vue'
import UsageModels from './UsageModels.vue'
import ProjectPickerDialog from './ProjectPickerDialog.vue'
import UsageProjects from './UsageProjects.vue'

const { t } = useI18n()
const usage = useUsageStore()
const connection = useConnectionStore()

const ranges = computed<{ value: UsageRange; label: string }[]>(() => [
  { value: 'today', label: t('usage.range.today') },
  { value: '7d', label: t('usage.range.7d') },
  { value: '30d', label: t('usage.range.30d') },
  { value: 'all', label: t('usage.range.all') },
])
const metrics = computed<{ value: UsageMetric; label: string }[]>(() => [
  { value: 'tokens', label: t('usage.metric.tokens') },
  { value: 'cost', label: t('usage.metric.cost') },
])

const pickerOpen = ref(false)
const modelOptions = computed(() => [
  { value: null as string | null, label: t('usage.allModels') },
  ...usage.models.map((m) => ({ value: m as string | null, label: m })),
])

const scanning = computed(() => usage.scan.state === 'scanning')
const progress = computed(() => (usage.scan.filesTotal > 0 ? usage.scan.filesDone / usage.scan.filesTotal : 0))
const waiting = computed(() => !usage.received || (!usage.hasData && usage.scan.state !== 'ready'))
const empty = computed(() => usage.received && !usage.hasData && usage.scan.state === 'ready')
</script>

<template>
  <main class="mx-auto w-full max-w-[1560px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="min-w-0">
        <h2 class="text-2xl font-semibold tracking-tight">{{ t('usage.title') }}</h2>
        <p class="mt-1 max-w-[70ch] text-sm text-ink-muted">{{ t('usage.subtitle') }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <SegmentedControl v-model="usage.range" :options="ranges" :label="t('usage.rangeLabel')" />
        <SegmentedControl v-model="usage.metric" :options="metrics" :label="t('usage.metricLabel')" />
        <div class="max-w-[240px] min-w-0">
          <AppSelect v-model="usage.model" :options="modelOptions" :label="t('usage.model')" :icon="Boxes" />
        </div>
        <button
          type="button"
          class="ccm-btn max-w-[260px] px-2.5!"
          :class="usage.project ? 'text-accent!' : ''"
          aria-haspopup="dialog"
          :aria-expanded="pickerOpen"
          :title="usage.project ?? undefined"
          @click="pickerOpen = true"
        >
          <FolderSearch :size="14" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ usage.project ? baseName(usage.project) : t('usage.allProjects') }}</span>
          <span class="shrink-0 text-2xs text-ink-faint tabular">{{ usage.projects.length }}</span>
          <ChevronDown :size="14" class="shrink-0 text-ink-faint" aria-hidden="true" />
        </button>
        <ProjectPickerDialog v-model="pickerOpen" />
      </div>
    </div>

    <div v-if="usage.model || usage.project" class="mt-3 flex flex-wrap gap-2">
      <button
        v-if="usage.model"
        type="button"
        class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-inner bg-accent-soft px-2 text-xs font-medium text-accent"
        :aria-label="t('usage.removeFilter', { name: usage.model })"
        @click="usage.model = null"
      >
        {{ usage.model }}<X :size="14" aria-hidden="true" />
      </button>
      <button
        v-if="usage.project"
        type="button"
        class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-inner bg-accent-soft px-2 text-xs font-medium text-accent"
        :title="usage.project"
        :aria-label="t('usage.removeFilter', { name: baseName(usage.project) })"
        @click="usage.project = null"
      >
        {{ baseName(usage.project) }}<X :size="14" aria-hidden="true" />
      </button>
    </div>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="scanning" class="mt-4 flex items-center gap-3 rounded-card bg-surface px-4 py-3 shadow-card" role="status">
        <LottieArt name="radar-scan" loop class="size-10 shrink-0" />
        <div class="min-w-0 flex-1">
        <p class="text-sm text-ink">{{ t('usage.scanning', { done: usage.scan.filesDone, total: usage.scan.filesTotal }) }}</p>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-fill" aria-hidden="true">
          <div class="h-full origin-left rounded-full bg-accent transition-transform duration-300" :style="{ transform: `scaleX(${progress})` }" />
        </div>
        </div>
      </div>
    </Transition>

    <div v-if="waiting" class="mt-6 grid gap-3" aria-busy="true">
      <p class="sr-only">{{ connection.state === 'connected' ? t('usage.loading') : t('sessions.loading') }}</p>
      <div class="ccm-shimmer h-[132px] rounded-card bg-surface" />
      <div class="ccm-shimmer h-[320px] rounded-card bg-surface" />
    </div>

    <div v-else-if="empty" class="mt-6 flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <ArtImage name="empty-stats" class="w-52 max-w-full" />
      <p class="text-base font-medium">{{ t('usage.empty') }}</p>
      <p class="text-sm text-ink-muted">{{ t('usage.emptyHint') }}</p>
    </div>

    <div v-else class="mt-5 space-y-4">
      <UsageKpis />
      <UsageDailyChart />
      <div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <UsageModels />
        <UsageLive />
      </div>
      <UsageProjects />
      <p class="text-xs text-ink-faint">{{ t('usage.footnote', { date: PRICING_CHECKED_AT }) }}</p>
    </div>
  </main>
</template>
