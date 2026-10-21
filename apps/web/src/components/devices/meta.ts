import type { Component } from 'vue'
import { CircleCheck, CircleHelp, CircleOff, ShieldAlert } from 'lucide-vue-next'
import type { AdbDevice, AdbState } from '@ccm/shared'

export const STATE_META: Partial<Record<AdbState, { icon: Component; cls: string }>> = {
  ready: { icon: CircleCheck, cls: 'text-success' },
  unauthorized: { icon: ShieldAlert, cls: 'text-warning' },
  offline: { icon: CircleOff, cls: 'text-ink-muted' },
}
export const OTHER_STATE = { icon: CircleHelp, cls: 'text-ink-muted' }

/** Remembered rows report `offline` whatever adb said last. */
export const stateOf = (d: AdbDevice): AdbState => (d.online ? d.state : 'offline')

export type RowAction = 'toWifi' | 'disconnect' | 'reconnect' | 'forget'

export function rowActions(d: AdbDevice): RowAction[] {
  if (!d.online) return d.transport === 'wifi' ? ['reconnect', 'forget'] : ['forget']
  if (d.transport === 'wifi') return ['disconnect']
  return d.transport === 'usb' && d.state === 'ready' ? ['toWifi'] : []
}

/** Shared by the list header and each row (md and up); smaller widths wrap the row as flex. */
export const ROW_GRID = 'md:grid md:grid-cols-[1rem_8.5rem_minmax(0,1.3fr)_minmax(0,1fr)_5rem_minmax(9rem,auto)] md:gap-x-3'
