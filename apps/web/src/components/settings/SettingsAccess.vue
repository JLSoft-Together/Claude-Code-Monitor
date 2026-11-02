<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, FolderX } from 'lucide-vue-next'
import { forgetGrants, fullAccess, hasGrants } from '../../lib/preview'
import SensitiveSettings from '../SensitiveSettings.vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import SettingEmbed from './SettingEmbed.vue'
import SettingSection from './SettingSection.vue'

const { t } = useI18n()
const grantsForgotten = ref(false)
const fullAccessOn = ref<boolean | null>(null)

async function onForgetGrants(): Promise<void> {
  grantsForgotten.value = await forgetGrants()
  if (grantsForgotten.value) setTimeout(() => (grantsForgotten.value = false), 4000)
}
async function setFullAccess(on: boolean): Promise<void> {
  const now = await fullAccess(on)
  fullAccessOn.value = typeof now === 'boolean' ? now : null
}
onMounted(() => void fullAccess().then((on) => (fullAccessOn.value = on)))
</script>

<template>
  <div>
    <SettingEmbed id="sensitive"><SensitiveSettings /></SettingEmbed>

    <SettingSection v-if="hasGrants" id="access" :title="t('settings.section.access')">
      <ToggleSwitch
        v-if="fullAccessOn !== null"
        :model-value="fullAccessOn"
        :label="t('settings.fullAccess')"
        :info="t('settings.fullAccessHint')"
        class="px-3"
        data-full-access
        data-setting-row="fullAccess"
        @update:model-value="setFullAccess"
      />
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-fill disabled:cursor-default"
        :disabled="grantsForgotten"
        data-forget-grants
        data-setting-row="forgetGrants"
        @click="onForgetGrants"
      >
        <component :is="grantsForgotten ? CircleCheck : FolderX" :size="16" class="shrink-0" :class="grantsForgotten ? 'text-success' : 'text-ink-muted'" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm">{{ grantsForgotten ? t('settings.forgetGrantsDone') : t('settings.forgetGrants') }}</span>
          <span class="mt-0.5 block text-2xs text-ink-faint">{{ t('settings.forgetGrantsHint') }}</span>
        </span>
      </button>
    </SettingSection>
  </div>
</template>
