<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Boxes, ChevronDown, FolderSearch, X } from 'lucide-vue-next'
import { baseName } from '../../lib/format'
import { useConnectionStore } from '../../stores/connection'
import { useUsageStore, type UsageMetric, type UsageRange } from '../../stores/usage'
import AppSelect from '../AppSelect.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ArtImage from '../ArtImage.vue'
import LottieArt from '../LottieArt.vue'
import UsageHero from './UsageHero.vue'
import UsageInfo from './UsageInfo.vue'
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
const pickerMode = ref<'pick' | 'all'>('pick')
const pickerOrigin = ref<HTMLElement | null>(null)

function openPicker(mode: 'pick' | 'all', origin: HTMLElement | null): void {
  pickerMode.value = mode
  pickerOrigin.value = origin
  pickerOpen.value = true
}

const modelOptions = computed(() => [
  { value: null as string | null, label: t('usage.allModels') },
  ...usage.models.map((m) => ({ value: m as string | null, label: m })),
])

const chips = computed(() => {
  const out: { key: string; label: string; title: string; clear: () => void }[] = []
  if (usage.model) out.push({ key: 'model', label: usage.model, title: usage.model, clear: () => (usage.model = null) })
  if (usage.project) out.push({ key: 'project', label: baseName(usage.project), title: usage.project, clear: () => (usage.project = null) })
  return out
})

const scanning = computed(() => usage.scan.state === 'scanning')
const progress = computed(() => (usage.scan.filesTotal > 0 ? usage.scan.filesDone / usage.scan.filesTotal : 0))
const waiting = computed(() => !usage.received || (!usage.hasData && usage.scan.state !== 'ready'))
const empty = computed(() => usage.received && !usage.hasData && usage.scan.state === 'ready')

onBeforeUnmount(() => usage.selectDay(null))
</script>

<template>
  <main class="mx-auto w-full max-w-[1560px] flex-1 px-4 py-4 sm:px-6 sm:py-5">
    <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
        <h2 class="text-2xl font-semibold tracking-tight">{{ t('usageV53.title') }}</h2>
        <UsageInfo :label="t('usageV53.about')" :text="t('usage.subtitle')" />
        <TransitionGroup tag="div" name="ccm-list" class="ccm-list-inflow relative flex flex-wrap items-center gap-1.5">
          <button
            v-for="chip in chips"
            :key="chip.key"
            type="button"
            class="inline-flex h-6 max-w-[240px] cursor-pointer items-center gap-1 rounded-inner bg-accent-soft px-2 text-xs font-medium text-accent-ink"
            :title="chip.title"
            :aria-label="t('usage.removeFilter', { name: chip.label })"
            @click="chip.clear"
          >
            <span class="truncate">{{ chip.label }}</span><X :size="14" class="shrink-0" aria-hidden="true" />
          </button>
        </TransitionGroup>
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
          :class="usage.project ? 'text-accent-ink!' : ''"
          aria-haspopup="dialog"
          :aria-expanded="pickerOpen && pickerMode === 'pick'"
          :title="usage.project ?? undefined"
          @click="openPicker('pick', $event.currentTarget as HTMLElement)"
        >
          <FolderSearch :size="14" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ usage.project ? baseName(usage.project) : t('usage.allProjects') }}</span>
          <span class="shrink-0 text-2xs text-ink-faint tabular">{{ usage.projects.length }}</span>
          <ChevronDown :size="14" class="shrink-0 text-ink-faint" aria-hidden="true" />
        </button>
      </div>
    </div>

    <Transition
      enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
      leave-to-class="opacity-0"
    >
      <div v-if="scanning" class="mt-4 flex items-center gap-3 rounded-card bg-surface px-4 py-3 shadow-card" role="status">
        <LottieArt name="radar-scan" loop class="size-10 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="text-sm text-ink">{{ t('usage.scanning', { done: usage.scan.filesDone, total: usage.scan.filesTotal }) }}</p>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-fill" aria-hidden="true">
            <div class="h-full origin-left rounded-full bg-accent transition-transform duration-(--ccm-dur-slow) ease-out-quint" :style="{ transform: `scaleX(${progress})` }" />
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="ccm-fade" mode="out-in">
      <div v-if="waiting" key="wait" class="mt-4 grid gap-4" aria-busy="true">
        <p class="sr-only">{{ connection.state === 'connected' ? t('usage.loading') : t('sessions.loading') }}</p>
        <div class="ccm-shimmer h-[384px] rounded-card bg-surface" />
        <div class="grid grid-cols-[minmax(0,1fr)] gap-4 min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div class="ccm-shimmer h-[268px] rounded-card bg-surface" />
          <div class="ccm-shimmer h-[268px] rounded-card bg-surface max-[1099px]:hidden" />
        </div>
      </div>

      <div v-else-if="empty" key="empty" class="mt-4 flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
        <ArtImage name="empty-stats" class="w-52 max-w-full" />
        <p class="text-base font-medium">{{ t('usage.empty') }}</p>
        <p class="text-sm text-ink-muted">{{ t('usage.emptyHint') }}</p>
      </div>

      <div v-else key="data" class="mt-4 space-y-4">
        <UsageHero />
        <div class="grid grid-cols-[minmax(0,1fr)] gap-4 min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <UsageProjects @see-all="openPicker('all', $event)" />
          <UsageModels />
        </div>
      </div>
    </Transition>

    <ProjectPickerDialog v-model="pickerOpen" :origin="pickerOrigin" :mode="pickerMode" />
  </main>
</template>
