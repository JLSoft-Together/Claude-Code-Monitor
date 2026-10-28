import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { cleanPrompts, fitsPrompt, MAX_PROMPTS, type SavedPrompt } from '../lib/promptLibrary'

const KEY = 'ccm.prompts'

function read(): SavedPrompt[] {
  try {
    return cleanPrompts(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return []
  }
}

/** Owner-saved prompts (local only, never logged or sent anywhere) and the picker's open flag. */
export const usePromptsStore = defineStore('prompts', () => {
  const list = ref<SavedPrompt[]>(read())
  const open = ref(false)

  watch(
    list,
    (v) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(v))
      } catch {
        // storage full or blocked: the list still works until reload
      }
    },
    { deep: true },
  )

  const forScope = (scope: string | null): SavedPrompt[] => list.value.filter((p) => p.scope === 'global' || p.scope === scope)

  function save(p: Omit<SavedPrompt, 'id'> & { id?: string }): SavedPrompt | null {
    const name = p.name.trim()
    if (!name || !fitsPrompt(p.text)) return null
    const at = p.id ? list.value.findIndex((x) => x.id === p.id) : -1
    if (at < 0 && list.value.length >= MAX_PROMPTS) return null
    const next: SavedPrompt = { id: at >= 0 ? p.id! : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, text: p.text, scope: p.scope }
    list.value = at >= 0 ? list.value.map((x, i) => (i === at ? next : x)) : [...list.value, next]
    return next
  }

  const remove = (id: string): void => {
    list.value = list.value.filter((p) => p.id !== id)
  }

  return { list, open, forScope, save, remove }
})
