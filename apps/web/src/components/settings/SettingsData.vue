<script setup lang="ts">
import { hasAgentData } from '../../lib/agentData'
import { hasBackup } from '../../lib/backup'
import { useUiStore } from '../../stores/ui'
import AgentDataSettings from '../AgentDataSettings.vue'
import BackupSettings from '../BackupSettings.vue'
import SettingEmbed from './SettingEmbed.vue'

const ui = useUiStore()
</script>

<template>
  <div>
    <SettingEmbed v-if="hasAgentData" id="agentData"><AgentDataSettings :open="ui.settingsOpen" /></SettingEmbed>
    <SettingEmbed v-if="hasBackup" id="backup"><BackupSettings /></SettingEmbed>
  </div>
</template>
