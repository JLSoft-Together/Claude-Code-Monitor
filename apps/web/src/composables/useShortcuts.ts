import { onBeforeUnmount, onMounted } from 'vue'
import { isTyping } from '../lib/shortcuts'
import { useSettingsStore } from '../stores/settings'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

/** Single-key shortcuts of the Monitor view; see `lib/shortcuts.ts` for the list shown to users. */
export function useShortcuts(): void {
  const ui = useUiStore()
  const settings = useSettingsStore()
  const terminals = useTerminalsStore()

  function onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    if (isTyping(e.target)) return
    if (e.key === '?') {
      e.preventDefault()
      ui.shortcutsOpen = !ui.shortcutsOpen
      return
    }
    if (ui.paletteOpen || ui.settingsOpen || ui.tourOpen || ui.recapOpen || ui.diagnosticsOpen || ui.shortcutsOpen) return

    if (e.key === 'Escape') {
      if (ui.selectedAgentId) ui.selectAgent(null)
      else if (!ui.closeFloating()) return
      e.preventDefault()
      return
    }

    // `code`, not `key`: Vietnamese input methods and other layouts still map the physical key.
    switch (e.code) {
      case 'KeyS':
        if (e.shiftKey) ui.togglePanelPin('sessions')
        else ui.togglePanel('sessions')
        break
      case 'KeyA':
        if (e.shiftKey) ui.togglePanelPin('activity')
        else ui.togglePanel('activity')
        break
      case 'KeyB':
        if (e.shiftKey) ui.toggleBarDock()
        else ui.toggleBar()
        break
      case 'KeyF':
        if (e.shiftKey) return
        ui.requestFit()
        break
      case 'KeyH':
        if (e.shiftKey) return
        settings.keyHints = !settings.keyHints
        break
      default: {
        const digit = /^Digit(\d)$/.exec(e.code)
        if (!digit || e.shiftKey) return
        const n = Number(digit[1])
        if (n === 0) ui.openSessionTab(null)
        else {
          const target = terminals.list[n - 1]
          if (!target) return
          ui.openSessionTab(target.id)
        }
      }
    }
    e.preventDefault()
  }

  onMounted(() => document.addEventListener('keydown', onKey))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
}
