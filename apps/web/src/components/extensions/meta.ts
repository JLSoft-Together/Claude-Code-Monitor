import type { Component } from 'vue'
import {
  Box,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardList,
  Clock,
  KeyRound,
  Palette,
  Puzzle,
  Wrench,
} from 'lucide-vue-next'
import type { EntryState } from '../../lib/extensions'
import { BRAND_ICONS, type Brand } from './brandIcons'

export const ENTRY_ICONS: Record<string, Component> = {
  figma: BRAND_ICONS.figma,
  meshy: Box,
  unity: BRAND_ICONS.unity,
  blender: BRAND_ICONS.blender,
  godot: BRAND_ICONS.godot,
  'godot-editor': BRAND_ICONS.godot,
  'godot-funplay': BRAND_ICONS.godot,
  github: BRAND_ICONS.github,
  gitlab: BRAND_ICONS.gitlab,
  discord: BRAND_ICONS.discord,
  'pm-skills': ClipboardList,
  'ui-ux-pro-max': Palette,
  'frontend-design': BRAND_ICONS.anthropic,
  'unity-plugin': BRAND_ICONS.unity,
}

export const entryIcon = (id: string): Component => ENTRY_ICONS[id] ?? Puzzle

/** Brand mark for a server / plugin found in the config by name (`plugin:github:github`, `figma-dev-mode`), null when unknown. */
export function brandIcon(name: string): Component | null {
  const words = name.toLowerCase().split(/[^a-z0-9]+/)
  const hit = (Object.keys(BRAND_ICONS) as Brand[]).find((b) => words.includes(b))
  return hit ? BRAND_ICONS[hit] : null
}

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
