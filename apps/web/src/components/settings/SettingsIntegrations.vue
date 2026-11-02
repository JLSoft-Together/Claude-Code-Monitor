<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CircleAlert, CircleCheck, Copy } from 'lucide-vue-next'
import { hasCapture } from '../../lib/capture'
import { hasRun } from '../../lib/desktop'
import { useExtrasStore } from '../../stores/extras'
import { useUiStore } from '../../stores/ui'
import CaptureSettings from '../CaptureSettings.vue'
import RunSdkSettings from '../RunSdkSettings.vue'
import SettingEmbed from './SettingEmbed.vue'

const { t } = useI18n()
const extras = useExtrasStore()
const ui = useUiStore()

const snippet = computed(() =>
  extras.statusLineCommand ? JSON.stringify({ statusLine: { type: 'command', command: extras.statusLineCommand } }, null, 2) : '',
)
const copied = ref(false)
async function copySnippet(): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div>
    <SettingEmbed v-if="snippet" id="statusLine">
      <section aria-labelledby="set-statusline">
        <div class="mb-1.5 flex items-center justify-between gap-3 px-3">
          <h3 id="set-statusline" class="text-2xs font-semibold text-ink-muted">{{ t('limits.setupTitle') }}</h3>
          <span class="inline-flex items-center gap-1 text-2xs font-medium" :class="extras.limits ? 'text-success' : 'text-warning'">
            <CircleCheck v-if="extras.limits" :size="13" aria-hidden="true" /><CircleAlert v-else :size="13" aria-hidden="true" />
            {{ extras.limits ? t('settings.bridgeOn') : t('settings.bridgeOff') }}
          </span>
        </div>
        <div class="ccm-group">
          <div class="px-3 py-2">
            <p class="mb-2 text-2xs leading-relaxed text-ink-faint">{{ extras.limits ? t('limits.setupActive') : t('limits.setupHint') }}</p>
            <div class="relative">
              <pre class="max-h-36 overflow-auto rounded-inner bg-fill p-3 pr-11 font-mono text-2xs whitespace-pre-wrap break-all text-ink-muted">{{ snippet }}</pre>
              <button
                type="button"
                class="ccm-btn-plain absolute top-1.5 right-1.5"
                :aria-label="copied ? t('limits.copied') : t('limits.copy')"
                :title="copied ? t('limits.copied') : t('limits.copy')"
                @click="copySnippet"
              >
                <Check v-if="copied" :size="14" class="ccm-pop text-success" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />
              </button>
            </div>
            <p class="mt-2 text-2xs leading-relaxed text-ink-faint">{{ t('limits.chainHint') }}</p>
          </div>
        </div>
      </section>
    </SettingEmbed>
    <SettingEmbed v-if="hasRun" id="run"><RunSdkSettings :open="ui.settingsOpen" /></SettingEmbed>
    <SettingEmbed v-if="hasCapture" id="capture"><CaptureSettings :open="ui.settingsOpen" /></SettingEmbed>
  </div>
</template>
