<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleArrowDown, CircleCheck, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { APP_VERSION } from '../lib/changelog'
import { relativeTime, now } from '../lib/format'
import { useUpdateStore } from '../stores/update'
import ToggleSwitch from './ToggleSwitch.vue'

/** Settings › Updates (v74): version, manual check, status and the auto-check switch. */
const { t, locale } = useI18n()
const store = useUpdateStore()
const s = computed(() => store.state)
const checking = computed(() => store.manualCheck || s.value?.phase === 'checking')

const status = computed<{ tone: 'ok' | 'new' | 'error' | 'muted'; text: string } | null>(() => {
  const st = s.value
  if (!st || checking.value) return null
  if (st.release && ['available', 'downloading', 'ready', 'installing'].includes(st.phase)) return { tone: 'new', text: t('update.availableShort', { version: st.release.version }) }
  if (st.phase === 'error' && st.error) return { tone: 'error', text: t(`update.error.${st.error}`) }
  if (st.phase === 'none') return { tone: 'ok', text: t('update.upToDate') }
  return null
})
const checkedText = computed(() => {
  const at = s.value?.checkedAt
  const ago = at ? relativeTime(at, locale.value, now.value) : ''
  return ago ? t('update.checkedAt', { time: ago }) : t('update.neverChecked')
})
</script>

<template>
  <section aria-labelledby="set-update" class="mt-6" data-update-settings>
    <h3 id="set-update" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('update.section') }}</h3>
    <div class="ccm-group overflow-hidden">
      <div class="flex min-w-0 items-center gap-3 px-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-ink tabular-nums">{{ t('update.current', { version: s?.current ?? APP_VERSION }) }}</p>
          <p class="mt-0.5 truncate text-2xs text-ink-faint">{{ checkedText }}</p>
        </div>
        <button type="button" class="ccm-btn shrink-0" :disabled="checking" :aria-busy="checking" data-update-check @click="store.check()">
          <LoaderCircle v-if="checking" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <RefreshCw v-else :size="13" aria-hidden="true" />
          {{ checking ? t('update.checking') : t('update.check') }}
        </button>
      </div>
      <div v-if="status" class="flex min-w-0 items-start gap-2 px-3 py-2 text-xs" :role="status.tone === 'error' ? 'alert' : 'status'" data-update-status>
        <CircleCheck v-if="status.tone === 'ok'" :size="14" class="mt-px shrink-0 text-success" aria-hidden="true" />
        <CircleArrowDown v-else-if="status.tone === 'new'" :size="14" class="mt-px shrink-0 text-accent-ink" aria-hidden="true" />
        <CircleAlert v-else :size="14" class="mt-px shrink-0 text-st-error" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-ink">{{ status.text }}</span>
        <button v-if="status.tone === 'new'" type="button" class="ccm-btn-plain shrink-0 text-xs" @click="store.dialogOpen = true">{{ t('update.view') }}</button>
      </div>
      <ToggleSwitch
        :model-value="s?.autoCheck ?? true"
        :label="t('update.autoCheck')"
        :hint="t('update.autoCheckHint')"
        class="px-3"
        data-setting="update-auto"
        @update:model-value="store.setAutoCheck"
      />
    </div>
    <p v-if="s && !s.canDownload" class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('update.devHint') }}</p>
  </section>
</template>
