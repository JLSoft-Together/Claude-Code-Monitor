<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { BatteryWarning } from 'lucide-vue-next'
import { AWAKE_MODES, DEFAULT_AWAKE_MODE, type AwakeMode } from '@ccm/shared'
import { useAwakeStore } from '../stores/awake'
import SegmentedControl from './ui/SegmentedControl.vue'

/** Settings › Keep awake (desktop): power save blocker while agents work (v76 R3). */
const { t } = useI18n()
const awake = useAwakeStore()
onMounted(() => awake.start())

const modes = computed(() => AWAKE_MODES.map((m) => ({ value: m, label: t(`awake.mode.${m}`) })))
const mode = computed({
  get: (): AwakeMode => awake.state?.mode ?? DEFAULT_AWAKE_MODE,
  set: (m: AwakeMode) => void awake.setMode(m),
})
</script>

<template>
  <section aria-labelledby="set-awake" class="mt-6" data-awake-settings>
    <h3 id="set-awake" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('awake.section') }}</h3>
    <div class="ccm-group">
      <div class="px-3 py-2">
        <p class="text-sm">{{ t('awake.setting') }}</p>
        <p class="mt-0.5 text-2xs text-ink-faint">{{ t('awake.settingHint') }}</p>
        <SegmentedControl v-model="mode" :options="modes" :label="t('awake.setting')" fill class="mt-2 w-full" data-setting="keep-awake" />
        <p v-if="awake.state?.reason === 'battery'" class="mt-2 flex items-center gap-1.5 text-2xs text-warning" role="status">
          <BatteryWarning :size="13" aria-hidden="true" />{{ t('awake.battery') }}
        </p>
      </div>
    </div>
  </section>
</template>
