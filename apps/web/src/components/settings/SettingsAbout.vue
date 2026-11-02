<script setup lang="ts">
import { computed, nextTick, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, FileText, GraduationCap, ListChecks, Sparkles, Stethoscope } from 'lucide-vue-next'
import { APP_VERSION } from '../../lib/changelog'
import { desktop, hasTerminals } from '../../lib/desktop'
import { hasUpdater } from '../../lib/update'
import { useUiStore } from '../../stores/ui'
import UpdateSettings from '../UpdateSettings.vue'
import SettingEmbed from './SettingEmbed.vue'
import SettingSection from './SettingSection.vue'

const { t } = useI18n()
const ui = useUiStore()

const openFontLicenses = (): void => void window.open('/fonts-LICENSES.txt', '_blank')
const openIconLicense = (): void => void window.open('/file-icons-LICENSE.txt', '_blank')
const openHabblaudLicense = (): void => void window.open('/habblaud-LICENSE.txt', '_blank')

const helpItems = computed<{ key: string; icon: Component; label: string; hint: string; run: () => void }[]>(() => [
  { key: 'whatsNew', icon: Sparkles, label: t('whatsNew.open'), hint: t('whatsNew.openHint', { version: APP_VERSION }), run: () => (ui.whatsNewOpen = true) },
  { key: 'tour', icon: GraduationCap, label: t('tour.open'), hint: t('settings.tourHint'), run: () => (ui.tourOpen = 'monitor') },
  ...(hasTerminals ? [{ key: 'wsTour', icon: GraduationCap, label: t('wsHelp.tour'), hint: t('wsTour.welcome.title'), run: () => (ui.tourOpen = 'workspace' as const) }] : []),
  { key: 'diag', icon: Stethoscope, label: t('diag.open'), hint: t('settings.diagHint'), run: () => (ui.diagnosticsOpen = true) },
  ...(desktop ? [{ key: 'setup', icon: ListChecks, label: t('setup.open'), hint: t('setup.openHint'), run: () => (ui.setupOpen = true) }] : []),
  { key: 'fonts', icon: FileText, label: t('fonts.licenses'), hint: t('fonts.licensesHint'), run: openFontLicenses },
  ...(hasTerminals ? [{ key: 'fileIcons', icon: FileText, label: t('settings.fileIconsLicense'), hint: t('settings.fileIconsLicenseHint'), run: openIconLicense }] : []),
  { key: 'habblaud', icon: FileText, label: t('settings.habblaudLicense'), hint: t('settings.habblaudLicenseHint'), run: openHabblaudLicense },
])

// Each help action opens its own overlay, so the settings window closes first.
function openFrom(action: () => void): void {
  ui.settingsOpen = false
  void nextTick(action)
}
</script>

<template>
  <div>
    <SettingEmbed v-if="hasUpdater" id="update"><UpdateSettings /></SettingEmbed>

    <SettingSection id="help" :title="t('settings.section.help')">
      <button
        v-for="h in helpItems"
        :key="h.key"
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-fill"
        :data-setting-row="`help-${h.key}`"
        @click="openFrom(h.run)"
      >
        <component :is="h.icon" :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm">{{ h.label }}</span>
          <span class="mt-0.5 block text-2xs text-ink-faint">{{ h.hint }}</span>
        </span>
        <ChevronRight :size="14" class="shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
    </SettingSection>
  </div>
</template>
