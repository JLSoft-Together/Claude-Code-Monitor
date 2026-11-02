<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Minus, Plus } from 'lucide-vue-next'
import { CODE_SIZE_MAX, CODE_SIZE_MIN } from '../../lib/fonts'
import { desktop, hasTerminals } from '../../lib/desktop'
import { isMac } from '../../lib/platform'
import { stepCodeSize, zoomApp, zoomHud } from '../../composables/useWheelZoom'
import { useSettingsStore } from '../../stores/settings'
import ToggleSwitch from '../ToggleSwitch.vue'
import FontPicker from '../ui/FontPicker.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ThemePicker from '../ui/ThemePicker.vue'
import SettingRow from './SettingRow.vue'
import SettingSection from './SettingSection.vue'

const { t } = useI18n()
const settings = useSettingsStore()

// App zoom lives in the main process (Chromium level); read once per visit, then follow the HUD.
const appZoom = ref<number | null>(null)
onMounted(() => void desktop?.zoomApp?.('get').then((pct) => (appZoom.value = typeof pct === 'number' ? pct : null)))
watch(zoomHud, (h) => {
  if (h?.kind === 'app') appZoom.value = h.value
})

const steppers = computed(() => [
  {
    id: 'codesize',
    label: t('fonts.size'),
    hint: t(isMac ? 'fonts.sizeHintMac' : 'fonts.sizeHint'),
    value: t('fonts.px', { n: settings.codeFontSize }),
    canDown: settings.codeFontSize > CODE_SIZE_MIN,
    canUp: settings.codeFontSize < CODE_SIZE_MAX,
    step: (d: -1 | 0 | 1) => stepCodeSize(settings, d),
  },
  ...(desktop?.zoomApp && appZoom.value !== null
    ? [
        {
          id: 'appzoom',
          label: t('fonts.zoom'),
          hint: t(isMac ? 'fonts.zoomHintMac' : 'fonts.zoomHint'),
          value: `${appZoom.value}%`,
          // Chromium levels -3…+3 ≈ 58%…173%.
          canDown: appZoom.value > 58,
          canUp: appZoom.value < 173,
          step: (d: -1 | 0 | 1) => void zoomApp(d === 0 ? 'reset' : d > 0 ? 'in' : 'out'),
        },
      ]
    : []),
])

const fileIconStyles = computed(() => [
  { value: 'atom' as const, label: t('settings.fileIconsAtom') },
  { value: 'simple' as const, label: t('settings.fileIconsSimple') },
])
</script>

<template>
  <div>
    <SettingSection id="theme" :title="t('settings.theme')">
      <div class="px-3 py-2" data-setting-row="theme"><ThemePicker /></div>
    </SettingSection>

    <SettingSection id="text" :title="t('fonts.section')">
      <FontPicker kind="ui" data-setting-row="uiFont" />
      <FontPicker kind="code" data-setting-row="codeFont" />
      <SettingRow v-for="row in steppers" :key="row.id" :label="row.label" :label-id="`set-${row.id}`" :info="row.hint" :data-setting-row="row.id">
        <div class="flex shrink-0 items-center gap-0.5" role="group" :aria-labelledby="`set-${row.id}`" :data-stepper="row.id">
          <button type="button" class="ccm-btn-plain size-7" :aria-label="t('fonts.smaller')" :title="t('fonts.smaller')" :disabled="!row.canDown" @click="row.step(-1)">
            <Minus :size="14" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="ccm-btn-plain h-7 min-w-14 justify-center px-1.5 text-sm tabular"
            :title="t('fonts.reset')"
            :aria-label="`${row.value} · ${t('fonts.reset')}`"
            @click="row.step(0)"
          >
            {{ row.value }}
          </button>
          <button type="button" class="ccm-btn-plain size-7" :aria-label="t('fonts.larger')" :title="t('fonts.larger')" :disabled="!row.canUp" @click="row.step(1)">
            <Plus :size="14" aria-hidden="true" />
          </button>
        </div>
      </SettingRow>
    </SettingSection>

    <SettingSection v-if="hasTerminals" id="look">
      <SettingRow :label="t('settings.fileIcons')" :info="t('settings.fileIconsHint')" data-setting-row="fileIcons">
        <SegmentedControl v-model="settings.fileIcons" :options="fileIconStyles" :label="t('settings.fileIcons')" data-setting="file-icons" />
      </SettingRow>
      <ToggleSwitch v-model="settings.dustEffect" :label="t('settings.dust')" :info="t('settings.dustHint')" class="px-3" data-setting-row="dust" />
    </SettingSection>
  </div>
</template>
