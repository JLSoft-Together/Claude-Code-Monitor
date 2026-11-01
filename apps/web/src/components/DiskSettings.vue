<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_DISK_WARN_GB, DISK_WARN_CHOICES } from '@ccm/shared'
import { useDiskStore } from '../stores/disk'
import SegmentedControl from './ui/SegmentedControl.vue'

/** Settings › Notifications: low disk threshold (v77 R9); 0 = off. */
const { t } = useI18n()
const disk = useDiskStore()
onMounted(() => disk.start())

const options = computed(() => DISK_WARN_CHOICES.map((n) => ({ value: n as number, label: n ? t('disk.gb', { n }) : t('disk.off') })))
const value = computed(() => disk.state?.warnGb ?? DEFAULT_DISK_WARN_GB)
</script>

<template>
  <div class="ccm-group mt-4" data-disk-settings>
    <div class="px-3 py-2">
      <p class="text-sm">{{ t('disk.setting') }}</p>
      <p class="mt-0.5 text-2xs text-ink-faint">{{ t('disk.settingHint') }}</p>
      <SegmentedControl
        :model-value="value"
        :options="options"
        :label="t('disk.setting')"
        fill
        class="mt-2 w-full"
        data-disk-threshold
        @update:model-value="(gb: number) => disk.setWarnGb(gb)"
      />
    </div>
  </div>
</template>
