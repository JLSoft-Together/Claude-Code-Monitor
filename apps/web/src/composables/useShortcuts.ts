import { onBeforeUnmount, onMounted } from 'vue'
import { withViewTransition } from '../lib/motion'
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
      ui.pressKey('?')
      return
    }
    if (ui.paletteOpen || ui.settingsOpen || ui.tourOpen || ui.recapOpen || ui.diagnosticsOpen || ui.shortcutsOpen) return

    if (e.key === 'Escape') {
      if (ui.selectedAgentId) ui.selectAgent(null)
      else if (!ui.closeFloating()) return
      e.preventDefault()
      ui.pressKey('Esc')
      return
    }

    const shift = e.shiftKey ? '⇧' : ''
    // `code`, not `key`: Vietnamese input methods and other layouts still map the physical key.
    switch (e.code) {
      case 'KeyS':
        if (e.shiftKey) ui.togglePanelPin('sessions')
        else ui.togglePanel('sessions')
        ui.pressKey(`${shift}S`)
        break
      case 'KeyA':
        if (e.shiftKey) ui.togglePanelPin('activity')
        else ui.togglePanel('activity')
        ui.pressKey(`${shift}A`)
        break
      case 'KeyB':
        if (e.shiftKey) withViewTransition(() => ui.toggleBarDock())
        else ui.toggleBar()
        ui.pressKey(`${shift}B`)
        break
      case 'KeyF':
        if (e.shiftKey) return
        ui.requestFit()
        ui.pressKey('F')
        break
      case 'KeyH':
        if (e.shiftKey) return
        settings.keyHints = !settings.keyHints
        ui.pressKey('H')
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
        ui.pressKey(String(n))
      }
    }
    e.preventDefault()
  }

  onMounted(() => document.addEventListener('keydown', onKey))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
}
