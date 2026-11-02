<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BREAK_MINUTES, breakAnchor, nextBreakAt } from '../../lib/breaks'
import { now } from '../../lib/format'
import { useConnectionStore } from '../../stores/connection'
import { useExtrasStore } from '../../stores/extras'
import { STUCK_CHOICES, useSettingsStore } from '../../stores/settings'
import ToggleSwitch from '../ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import SettingRow from './SettingRow.vue'
import SettingSection from './SettingSection.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const extras = useExtrasStore()
const connection = useConnectionStore()

const stuckOptions = computed(() => STUCK_CHOICES.map((m) => ({ value: m as number, label: m ? t('settings.minutes', { n: m }) : t('settings.off') })))
function setStuck(minutes: number): void {
  settings.stuckMinutes = minutes
  connection.updateNotify({ stuckMinutes: minutes })
}

// The hint carries live times (anchor of the day, next break), so it stays inline.
const breakHint = computed(() => {
  const anchor = breakAnchor(extras.dayStartedAt, now.value)
  if (anchor === null) return t('settings.breakHint', { n: BREAK_MINUTES })
  const fmt = new Intl.DateTimeFormat(settings.locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  return t('settings.breakHintAt', { n: BREAK_MINUTES, since: fmt.format(anchor), next: fmt.format(nextBreakAt(anchor, now.value)) })
})
</script>

<template>
  <div>
    <SettingSection id="reminders">
      <ToggleSwitch v-model="settings.breakReminder" :label="t('settings.breakReminder')" :hint="breakHint" class="px-3" data-setting-row="break" />
      <SettingRow :label="t('settings.stuck')" :info="t('settings.stuckHint')" stacked data-setting-row="stuck">
        <SegmentedControl :model-value="settings.stuckMinutes" :options="stuckOptions" :label="t('settings.stuck')" fill class="w-full" @update:model-value="setStuck" />
      </SettingRow>
      <SettingRow :label="t('settings.budget')" label-for="set-budget" :info="t('settings.budgetHint')" data-setting-row="budget">
        <div class="flex shrink-0 items-center gap-1.5">
          <div class="ccm-field flex w-24 items-center gap-1">
            <span class="text-ink-muted" aria-hidden="true">$</span>
            <input
              id="set-budget"
              :value="settings.dailyBudget || ''"
              type="number"
              min="0"
              step="1"
              inputmode="decimal"
              :placeholder="t('settings.off')"
              class="ccm-bare-input h-full min-w-0 flex-1 bg-transparent tabular outline-none placeholder:text-ink-faint"
              @change="settings.dailyBudget = Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)"
            />
          </div>
          <span class="text-2xs text-ink-faint">{{ t('settings.perDay') }}</span>
        </div>
      </SettingRow>
    </SettingSection>
  </div>
</template>
