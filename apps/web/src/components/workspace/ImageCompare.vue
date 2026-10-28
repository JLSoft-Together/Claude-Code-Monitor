<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Blend, Columns2, ImageOff, SlidersHorizontal } from 'lucide-vue-next'
import { clampPercent, COMPARE_MODES, imageSides, readMode, type CompareMode } from '../../lib/imageCompare'
import { gitShowImage, previewUrl, type ChangeEntry, type HeadImage } from '../../lib/preview'

const props = defineProps<{ root: string; entry: ChangeEntry; abs: string; rev: number }>()
const { t } = useI18n()

const MODE_KEY = 'ccm.imageCompare.mode'
const stored = (() => {
  try {
    return localStorage.getItem(MODE_KEY)
  } catch {
    return null
  }
})()

type SideError = Exclude<HeadImage, { ok: true }>['error'] | 'new-missing'
const mode = ref<CompareMode>(readMode(stored))
const split = ref(50)
const opacity = ref(50)
const oldUrl = ref<string | null>(null)
const newUrl = ref<string | null>(null)
const oldError = ref<SideError | null>(null)
const newError = ref<SideError | null>(null)
const loading = ref(true)
const dims = ref<{ old: string | null; new: string | null }>({ old: null, new: null })
const stage = ref<HTMLElement | null>(null)
let seq = 0

const sides = computed(() => imageSides(props.entry))
const both = computed(() => !!sides.value.old && sides.value.new)
const shownMode = computed<CompareMode>(() => (both.value ? mode.value : 'side'))

async function load(): Promise<void> {
  const run = ++seq
  loading.value = true
  const { old, new: hasNew } = sides.value
  const [before, after] = await Promise.all([old ? gitShowImage(props.root, old) : null, hasNew ? previewUrl(props.abs) : null])
  if (run !== seq) return
  oldUrl.value = before?.ok ? before.dataUrl : null
  oldError.value = before && !before.ok ? before.error : null
  // The preview server answers no-store; the query only makes <img> fetch the file again after a save.
  newUrl.value = after ? `${after.url}${after.url.includes('?') ? '&' : '?'}v=${props.rev}` : null
  newError.value = hasNew && !after ? 'new-missing' : null
  dims.value = { old: null, new: null }
  loading.value = false
}

watch(() => [props.root, props.entry.path, props.entry.origPath, props.entry.kind, props.rev], () => void load(), { immediate: true })

function setMode(m: CompareMode): void {
  mode.value = m
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    // storage unavailable
  }
}

function onLoad(side: 'old' | 'new', e: Event): void {
  const img = e.target as HTMLImageElement
  dims.value = { ...dims.value, [side]: img.naturalWidth ? `${img.naturalWidth} × ${img.naturalHeight}` : null }
}

function dragTo(e: PointerEvent): void {
  const box = stage.value?.getBoundingClientRect()
  if (box?.width) split.value = clampPercent(((e.clientX - box.left) / box.width) * 100)
}

function onPointerDown(e: PointerEvent): void {
  if (shownMode.value !== 'slider' || e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragTo(e)
}

function onPointerMove(e: PointerEvent): void {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) dragTo(e)
}

const MODE_ICON = { side: Columns2, slider: SlidersHorizontal, onion: Blend } as const
const errorText = (e: SideError): string => t(`workspace.imageCompare.error.${e}`)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-image-compare :data-image-mode="shownMode">
    <div class="flex h-8 shrink-0 items-center gap-2 border-b border-well-line px-2 text-2xs text-well-ink">
      <div v-if="both" class="flex shrink-0 rounded-inner bg-fill p-0.5" role="group" :aria-label="t('workspace.imageCompare.mode')">
        <button
          v-for="m in COMPARE_MODES"
          :key="m"
          type="button"
          class="flex h-6 cursor-pointer items-center gap-1 rounded-[5px] px-2 font-medium"
          :class="mode === m ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
          :aria-pressed="mode === m"
          :data-image-mode-btn="m"
          @click="setMode(m)"
        >
          <component :is="MODE_ICON[m]" :size="12" aria-hidden="true" />{{ t(`workspace.imageCompare.${m}`) }}
        </button>
      </div>
      <label v-if="shownMode !== 'side'" class="flex min-w-0 items-center gap-1.5">
        <span class="shrink-0">{{ shownMode === 'slider' ? t('workspace.imageCompare.split') : t('workspace.imageCompare.opacity') }}</span>
        <input
          v-if="shownMode === 'slider'"
          v-model.number="split"
          type="range"
          min="0"
          max="100"
          class="w-28 accent-(--ccm-accent)"
          data-image-range
        />
        <input v-else v-model.number="opacity" type="range" min="0" max="100" class="w-28 accent-(--ccm-accent)" data-image-range />
      </label>
      <span class="flex-1" />
      <span v-if="dims.old" class="tabular shrink-0">{{ t('workspace.imageCompare.before') }} {{ dims.old }}</span>
      <span v-if="dims.new" class="tabular shrink-0">{{ t('workspace.imageCompare.after') }} {{ dims.new }}</span>
    </div>

    <div v-if="loading" class="grid flex-1 place-items-center text-xs text-well-ink" role="status">{{ t('workspace.changes.loading') }}</div>

    <div v-else-if="shownMode === 'side'" class="grid min-h-0 flex-1 gap-px bg-well-line" :class="both ? 'grid-cols-2' : 'grid-cols-1'">
      <figure v-if="sides.old" class="flex min-h-0 min-w-0 flex-col bg-well" data-image-side="old">
        <figcaption class="shrink-0 px-3 pt-2 text-2xs font-medium text-diff-del">{{ both ? t('workspace.imageCompare.before') : t('workspace.imageCompare.deleted') }}</figcaption>
        <div class="checker grid min-h-0 flex-1 place-items-center overflow-auto p-3">
          <img v-if="oldUrl" :src="oldUrl" :alt="t('workspace.imageCompare.before')" class="max-h-full max-w-full object-contain" @load="onLoad('old', $event)" />
          <p v-else-if="oldError" class="flex items-center gap-1.5 text-xs text-well-ink"><ImageOff :size="14" aria-hidden="true" />{{ errorText(oldError) }}</p>
        </div>
      </figure>
      <figure v-if="sides.new" class="flex min-h-0 min-w-0 flex-col bg-well" data-image-side="new">
        <figcaption class="shrink-0 px-3 pt-2 text-2xs font-medium text-diff-add">{{ both ? t('workspace.imageCompare.after') : t('workspace.imageCompare.added') }}</figcaption>
        <div class="checker grid min-h-0 flex-1 place-items-center overflow-auto p-3">
          <img v-if="newUrl" :src="newUrl" :alt="t('workspace.imageCompare.after')" class="max-h-full max-w-full object-contain" @load="onLoad('new', $event)" />
          <p v-else-if="newError" class="flex items-center gap-1.5 text-xs text-well-ink"><ImageOff :size="14" aria-hidden="true" />{{ errorText(newError) }}</p>
        </div>
      </figure>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col p-3">
      <p v-if="oldError || newError" class="mb-2 flex shrink-0 items-center gap-1.5 text-xs text-well-ink">
        <ImageOff :size="14" aria-hidden="true" />{{ errorText((oldError ?? newError)!) }}
      </p>
      <div
        ref="stage"
        class="checker relative min-h-0 flex-1 touch-none select-none"
        :class="shownMode === 'slider' ? 'cursor-ew-resize' : ''"
        data-image-stage
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
      >
        <img v-if="oldUrl" :src="oldUrl" :alt="t('workspace.imageCompare.before')" class="pointer-events-none absolute inset-0 size-full object-contain" draggable="false" @load="onLoad('old', $event)" />
        <img
          v-if="newUrl"
          :src="newUrl"
          :alt="t('workspace.imageCompare.after')"
          class="pointer-events-none absolute inset-0 size-full object-contain"
          :style="shownMode === 'slider' ? { clipPath: `inset(0 0 0 ${split}%)` } : { opacity: opacity / 100 }"
          draggable="false"
          @load="onLoad('new', $event)"
        />
        <div v-if="shownMode === 'slider'" class="pointer-events-none absolute inset-y-0 w-px bg-accent" :style="{ left: `${split}%` }" aria-hidden="true" />
        <span v-if="shownMode === 'slider'" class="pointer-events-none absolute top-1 left-1 rounded-[4px] bg-well px-1 text-2xs text-diff-del">{{ t('workspace.imageCompare.before') }}</span>
        <span v-if="shownMode === 'slider'" class="pointer-events-none absolute top-1 right-1 rounded-[4px] bg-well px-1 text-2xs text-diff-add">{{ t('workspace.imageCompare.after') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.checker {
  background-color: var(--ccm-well);
  background-image:
    linear-gradient(45deg, var(--ccm-well-line) 25%, transparent 25%, transparent 75%, var(--ccm-well-line) 75%),
    linear-gradient(45deg, var(--ccm-well-line) 25%, transparent 25%, transparent 75%, var(--ccm-well-line) 75%);
  background-position:
    0 0,
    8px 8px;
  background-size: 16px 16px;
}
</style>
