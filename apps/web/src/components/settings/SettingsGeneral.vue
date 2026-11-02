<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { desktop, hasTerminals } from '../../lib/desktop'
import { hasAwake } from '../../lib/capture'
import { isMac } from '../../lib/platform'
import { RESTORE_MODES, restoreMode } from '../../lib/workspaceRestore'
import { useSettingsStore } from '../../stores/settings'
import { useTipsStore } from '../../stores/tips'
import { useUiStore } from '../../stores/ui'
import AwakeSettings from '../AwakeSettings.vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import SettingEmbed from './SettingEmbed.vue'
import SettingRow from './SettingRow.vue'
import SettingSection from './SettingSection.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const tips = useTipsStore()
const ui = useUiStore()
const tipsOn = computed({ get: () => !tips.state.off, set: (on: boolean) => tips.setOff(!on) })

const loginItem = ref<boolean | null>(null)
async function setLoginItem(on: boolean): Promise<void> {
  loginItem.value = on
  const now = await desktop?.loginItem?.(on)
  loginItem.value = typeof now === 'boolean' ? now : null
}
onMounted(() => void desktop?.loginItem?.().then((on) => (loginItem.value = typeof on === 'boolean' ? on : null)))

const locales = [
  { value: 'vi' as const, label: 'Tiếng Việt', lang: 'vi' },
  { value: 'en' as const, label: 'English', lang: 'en' },
]
const restoreModes = computed(() => RESTORE_MODES.map((mode) => ({ value: mode, label: t(`wsRestore.modes.${mode}`) })))
const terminalApps = computed(() => (['terminal', 'iterm'] as const).map((app) => ({ value: app, label: t(`settings.launchTerminalApp.${app}`) })))
</script>

<template>
  <div>
    <SettingSection id="general">
      <SettingRow :label="t('settings.language')" data-setting-row="language">
        <SegmentedControl v-model="settings.locale" :options="locales" :label="t('settings.language')" />
      </SettingRow>
      <ToggleSwitch v-model="settings.keyHints" :label="t('keys.hints')" :info="t('keys.hintsHint')" class="px-3" data-setting-row="keyHints" />
      <ToggleSwitch v-if="hasTerminals" v-model="tipsOn" :label="t('tips.setting')" :info="t('tips.settingHint')" class="px-3" data-setting-row="tips" />
      <SettingRow v-if="isMac" :label="t('settings.launchTerminal')" :info="t('settings.launchTerminalHint')" data-setting-row="launch">
        <SegmentedControl v-model="ui.launchTerminal" :options="terminalApps" :label="t('settings.launchTerminal')" />
      </SettingRow>
    </SettingSection>

    <SettingSection v-if="loginItem !== null || hasTerminals" id="startup" :title="t('settings.section.startup')">
      <SettingRow v-if="hasTerminals" :label="t('wsRestore.mode')" :info="t('wsRestore.modeHint')" stacked data-setting-row="restore">
        <SegmentedControl v-model="restoreMode" :options="restoreModes" :label="t('wsRestore.mode')" fill class="w-full" data-setting="restore-mode" />
      </SettingRow>
      <ToggleSwitch
        v-if="loginItem !== null"
        :model-value="loginItem"
        :label="t(isMac ? 'settings.loginItemMac' : 'settings.loginItem')"
        :info="t(isMac ? 'settings.loginItemHintMac' : 'settings.loginItemHint')"
        class="px-3"
        data-setting-row="loginItem"
        @update:model-value="setLoginItem"
      />
    </SettingSection>

    <SettingEmbed v-if="hasAwake" id="awake"><AwakeSettings /></SettingEmbed>
  </div>
</template>
