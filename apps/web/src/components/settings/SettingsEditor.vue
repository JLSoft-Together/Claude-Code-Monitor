<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AUTO_SAVE_DELAYS, AUTO_SAVE_MODES } from '../../lib/autoSave'
import { useSettingsStore } from '../../stores/settings'
import ToggleSwitch from '../ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import SettingRow from './SettingRow.vue'
import SettingSection from './SettingSection.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const autoSaveModes = computed(() => AUTO_SAVE_MODES.map((mode) => ({ value: mode, label: t(`settings.autoSaveMode.${mode}`) })))
const autoSaveDelays = computed(() => AUTO_SAVE_DELAYS.map((ms) => ({ value: ms, label: t('settings.seconds', { n: ms / 1000 }) })))
</script>

<template>
  <div>
    <SettingSection id="editor">
      <SettingRow :label="t('settings.autoSave')" :info="t('settings.autoSaveHint')" stacked data-setting-row="autoSave">
        <SegmentedControl v-model="settings.autoSave" :options="autoSaveModes" :label="t('settings.autoSave')" fill class="w-full" data-setting="auto-save" />
        <SegmentedControl
          v-if="settings.autoSave === 'afterDelay'"
          v-model="settings.autoSaveDelay"
          :options="autoSaveDelays"
          :label="t('settings.autoSaveDelay')"
          fill
          class="mt-2 w-full"
          data-setting="auto-save-delay"
        />
      </SettingRow>
      <ToggleSwitch v-model="settings.minimap" :label="t('settings.minimap')" :info="t('settings.minimapHint')" class="px-3" data-setting-row="minimap" />
      <ToggleSwitch v-model="settings.dimInactive" :label="t('workspace.dim.setting')" :info="t('workspace.dim.settingHint')" class="px-3" data-setting-row="dim" />
      <ToggleSwitch
        v-model="settings.shellIntegration"
        :label="t('shellMarks.setting')"
        :info="t('shellMarks.settingHint')"
        class="px-3"
        data-setting="shell-integration"
        data-setting-row="shell"
      />
      <ToggleSwitch
        v-model="settings.agentShim"
        :label="t('shellMarks.agentShim')"
        :info="t('shellMarks.agentShimHint')"
        class="px-3"
        data-setting="agent-shim"
        data-setting-row="agentShim"
      />
    </SettingSection>
  </div>
</template>
