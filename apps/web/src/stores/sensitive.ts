import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { defaultSensitiveSettings, type ActivityEvent, type SensitiveSettings } from '@ccm/shared'
import { useActivityStore } from './activity'

/** Sensitive watch settings from the collector (v76 R5) and per-session hit counts from the activity feed. */
export const useSensitiveStore = defineStore('sensitive', () => {
  const settings = shallowRef<SensitiveSettings>(defaultSensitiveSettings())
  const activity = useActivityStore()

  function set(value: SensitiveSettings | undefined): void {
    if (value) settings.value = value
  }

  const bySession = computed(() => {
    const out = new Map<string, ActivityEvent[]>()
    for (const e of activity.items) {
      if (e.kind !== 'sensitive' || !e.terminalId) continue
      const list = out.get(e.terminalId)
      if (list) list.push(e)
      else out.set(e.terminalId, [e])
    }
    return out
  })

  const ignored = (project: string | undefined, rule: string | undefined): boolean =>
    !!project && !!rule && (settings.value.ignore[project] ?? []).includes(rule)

  return { settings, set, bySession, ignored }
})
