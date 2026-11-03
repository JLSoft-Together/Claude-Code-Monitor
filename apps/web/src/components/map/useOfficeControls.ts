import { computed, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Maximize, Minus, Plus, Volume1, Volume2, VolumeX } from 'lucide-vue-next'
import { modalOpen } from '@ccm/habblaud/client/src/world/input'
import { useFullscreen } from '../../composables/useFullscreen'
import { isTyping } from '../../lib/shortcuts'
import { useOfficeStore } from '../../stores/office'
import { useUiStore } from '../../stores/ui'

/** Office view toolbar: zoom buttons, volume and the Shift+F full-screen toggle of the map canvas. */
export function useOfficeControls(canvas: Ref<HTMLElement | null>) {
  const { t } = useI18n()
  const ui = useUiStore()
  const office = useOfficeStore()

  const officeControls = computed<{ key: string; label: string; icon: typeof Plus; hint?: string; run: () => unknown }[]>(() => [
    { key: 'zoomIn', label: t('officeV60.zoomIn'), icon: Plus, run: () => office.zoomBy(1.25) },
    { key: 'zoomOut', label: t('officeV60.zoomOut'), icon: Minus, run: () => office.zoomBy(0.8) },
    { key: 'overview', label: t('officeV60.overview'), icon: Maximize, hint: 'F', run: () => office.overview() },
  ])
  const volumePct = computed(() => Math.round(office.volume * 100))
  const volumeIcon = computed(() => (!office.sound || volumePct.value === 0 ? VolumeX : volumePct.value < 50 ? Volume1 : Volume2))
  /** Wheel over the speaker or slider nudges the volume by one step, as on the macOS menu bar. */
  function onVolumeWheel(e: WheelEvent): void {
    if (!e.deltaY) return
    office.setVolume((volumePct.value + (e.deltaY < 0 ? 5 : -5)) / 100)
  }

  const officeFs = useFullscreen(canvas)
  const officeFullscreen = computed(() => officeFs.active.value && ui.mapView === 'office')
  watch(officeFs.active, (on) => (office.fullscreen = on), { immediate: true, flush: 'sync' })
  watch(
    () => ui.mapView,
    (v) => {
      if (v !== 'office') void officeFs.exit()
    },
  )
  function toggleOfficeFullscreen(): void {
    if (ui.mapView !== 'office') return
    void officeFs.toggle()
  }
  function onOfficeFullscreenKey(e: KeyboardEvent): void {
    if (e.code !== 'KeyF' || !e.shiftKey || e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    if (ui.view !== 'monitor' || ui.mapView !== 'office' || isTyping(e.target)) return
    if (modalOpen(e.target instanceof HTMLElement ? e.target : null)) return
    if (ui.paletteOpen || ui.settingsOpen || ui.tourOpen || ui.recapOpen || ui.diagnosticsOpen || ui.shortcutsOpen) return
    e.preventDefault()
    toggleOfficeFullscreen()
    ui.pressKey('⇧F')
  }
  onMounted(() => document.addEventListener('keydown', onOfficeFullscreenKey))
  onBeforeUnmount(() => document.removeEventListener('keydown', onOfficeFullscreenKey))

  return { officeControls, volumePct, volumeIcon, onVolumeWheel, officeFullscreen, toggleOfficeFullscreen }
}
