<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlarmClock, Hourglass } from 'lucide-vue-next'
import type { LimitHit } from '@ccm/shared'
import { now } from '../../lib/format'
import { cleanText, resetAtOf, RESUME_TEXT_MAX } from '../../lib/resumeSchedule'
import { useResumeScheduleStore } from '../../stores/resumeSchedule'

const props = defineProps<{ paneKey: string; hit: LimitHit | undefined }>()
const { t } = useI18n()
const store = useResumeScheduleStore()

const entry = computed(() => store.get(props.paneKey))
const resetAt = computed(() => resetAtOf(props.hit, now.value))
const shown = computed(() => resetAt.value !== null || !!entry.value)
const time = computed(() => {
  const at = resetAt.value ?? entry.value?.at
  return at ? store.label(at) : ''
})
const label = computed(() => (entry.value ? t('limitResume.scheduled', { time: time.value }) : t('limitResume.waiting', { time: time.value })))

const button = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const field = ref<HTMLInputElement | null>(null)
const anchor = ref<DOMRect | null>(null)
const draft = ref('')

const style = computed(() => {
  const r = anchor.value
  if (!r) return {}
  const w = Math.min(360, window.innerWidth - 24)
  return { left: `${Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))}px`, top: `${r.bottom + 6}px`, width: `${w}px` }
})

function open(): void {
  const r = button.value?.getBoundingClientRect()
  if (!r) return
  draft.value = entry.value?.text ?? store.defaultText()
  anchor.value = r
  document.addEventListener('pointerdown', onOutside, true)
  void nextTick(() => field.value?.select())
}
function close(): void {
  anchor.value = null
  document.removeEventListener('pointerdown', onOutside, true)
}
function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!pop.value?.contains(target) && !button.value?.contains(target)) close()
}
onBeforeUnmount(close)

const text = computed(() => cleanText(draft.value))
function confirm(): void {
  if (!text.value || resetAt.value === null) return
  store.schedule(props.paneKey, text.value, resetAt.value)
  close()
  button.value?.focus()
}
function cancel(): void {
  store.cancel(props.paneKey)
  close()
  button.value?.focus()
}
</script>

<template>
  <span v-if="shown" class="inline-flex shrink-0">
    <button
      ref="button"
      type="button"
      class="inline-flex h-5 max-w-full min-w-6 cursor-pointer items-center gap-1 rounded-inner px-1.5 text-2xs font-medium whitespace-nowrap transition-colors duration-(--ccm-dur-fast) ease-out-quint hover:text-ink"
      :class="entry ? 'bg-accent-soft text-accent-ink' : 'bg-warning-soft text-warning'"
      :title="entry ? label : `${label} · ${t('limitResume.schedule')}`"
      :aria-label="entry ? label : `${label}. ${t('limitResume.schedule')}`"
      aria-haspopup="dialog"
      :aria-expanded="!!anchor"
      :data-limit-resume="entry ? 'scheduled' : 'waiting'"
      data-no-drag
      @click.stop="anchor ? close() : open()"
    >
      <AlarmClock v-if="entry" :size="12" class="shrink-0" aria-hidden="true" />
      <Hourglass v-else :size="12" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 truncate @max-[520px]:sr-only">{{ label }}</span>
      <span v-if="!entry" class="border-l border-line pl-1 @max-[760px]:hidden">{{ t('limitResume.schedule') }}</span>
    </button>
    <Teleport to="body">
      <div
        v-if="anchor"
        ref="pop"
        class="ccm-menu fixed z-50 flex flex-col gap-2 p-3 text-xs text-ink outline-none"
        :style="style"
        role="dialog"
        tabindex="-1"
        :aria-label="t('limitResume.title')"
        data-limit-resume-pop
        @keydown.esc.stop="close()"
      >
        <p class="font-semibold">{{ t('limitResume.title') }}</p>
        <p v-if="resetAt !== null" class="text-ink-muted">{{ t('limitResume.hit', { time }) }}</p>
        <p v-if="hit?.autoResume" class="text-2xs text-warning" data-limit-resume-auto>{{ t('limitResume.auto') }}</p>
        <label class="flex flex-col gap-1">
          <span class="text-2xs text-ink-muted">{{ t('limitResume.textLabel') }}</span>
          <input
            ref="field"
            v-model="draft"
            type="text"
            class="ccm-field font-mono text-xs"
            :maxlength="RESUME_TEXT_MAX"
            data-limit-resume-text
            @keydown.enter.prevent="confirm"
          />
        </label>
        <p class="text-2xs text-ink-faint">{{ t('limitResume.hint') }}</p>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <button v-if="entry" type="button" class="ccm-btn h-7 text-2xs" data-limit-resume-cancel @click="cancel">{{ t('limitResume.cancel') }}</button>
          <button v-else type="button" class="ccm-btn h-7 text-2xs" @click="close()">{{ t('limitResume.close') }}</button>
          <button
            type="button"
            class="ccm-btn ccm-btn-primary h-7 text-2xs"
            :disabled="!text || resetAt === null"
            data-limit-resume-confirm
            @click="confirm"
          >
            {{ entry ? t('limitResume.update') : t('limitResume.confirm') }}
          </button>
        </div>
      </div>
    </Teleport>
  </span>
</template>
