import type { Component } from 'vue'
import {
  Box,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardList,
  Clock,
  Gamepad2,
  GitBranch,
  GitMerge,
  KeyRound,
  LayoutTemplate,
  MessagesSquare,
  Palette,
  PenTool,
  Puzzle,
  Shapes,
  Wrench,
} from 'lucide-vue-next'
import type { EntryState } from '../../lib/extensions'

export const ENTRY_ICONS: Record<string, Component> = {
  figma: PenTool,
  meshy: Box,
  unity: Gamepad2,
  blender: Shapes,
  github: GitBranch,
  gitlab: GitMerge,
  discord: MessagesSquare,
  'pm-skills': ClipboardList,
  'ui-ux-pro-max': Palette,
  'frontend-design': LayoutTemplate,
  'unity-plugin': Gamepad2,
}

export const entryIcon = (id: string): Component => ENTRY_ICONS[id] ?? Puzzle

/** Status = icon + text + colour (connection results use success / warning, failures st-error). */
export const STATE_META: Record<EntryState['state'], { icon: Component; cls: string }> = {
  connected: { icon: CircleCheck, cls: 'text-success' },
  installed: { icon: CircleCheck, cls: 'text-success' },
  needsAuth: { icon: KeyRound, cls: 'text-warning' },
  pending: { icon: Clock, cls: 'text-warning' },
  failed: { icon: CircleX, cls: 'text-st-error' },
  unknown: { icon: Circle, cls: 'text-ink-muted' },
  notInstalled: { icon: CircleDashed, cls: 'text-ink-faint' },
  guide: { icon: Wrench, cls: 'text-ink-muted' },
}
