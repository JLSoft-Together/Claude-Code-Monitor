import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { desktop } from '../lib/desktop'
import { cleanPrompts, fitsPrompt, MAX_PROMPTS, type SavedPrompt } from '../lib/promptLibrary'
import { PROMPT_SAMPLES } from '../lib/promptSamples'
import { applyImport, exportText, parseImport, planImport, type ClashChoice, type ImportOutcome, type ImportPlan } from '../lib/promptTransfer'

const KEY = 'ccm.prompts'
const HIDDEN_KEY = 'ccm.prompts.hiddenSamples'
const SAMPLES_OFF_KEY = 'ccm.prompts.samplesOff'

interface TransferBridge {
  promptsExport?: (text: string) => Promise<{ ok: true; file: string; count: number } | { ok: false; error: string } | null>
  promptsImport?: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string } | null>
}
const bridge = desktop as unknown as TransferBridge | undefined
export const hasPromptTransfer = typeof bridge?.promptsImport === 'function'

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage full or blocked: the change still works until reload
  }
}

const newId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export type ImportStart = { ok: true; plan: ImportPlan } | { ok: false; error: string }

/** Owner-saved prompts (local only, never logged or sent anywhere) and the picker's open flag. */
export const usePromptsStore = defineStore('prompts', () => {
  const list = ref<SavedPrompt[]>(cleanPrompts(readJson(KEY) ?? []))
  const open = ref(false)
  const known = new Set(PROMPT_SAMPLES.map((s) => s.id))
  const storedHidden = readJson(HIDDEN_KEY)
  const hiddenSamples = ref<string[]>(Array.isArray(storedHidden) ? storedHidden.filter((id): id is string => typeof id === 'string' && known.has(id)) : [])
  const samplesOff = ref(readJson(SAMPLES_OFF_KEY) === 1)

  watch(list, (v) => writeLocal(KEY, JSON.stringify(v)), { deep: true })
  watch(hiddenSamples, (v) => writeLocal(HIDDEN_KEY, JSON.stringify(v)), { deep: true })
  watch(samplesOff, (v) => writeLocal(SAMPLES_OFF_KEY, v ? '1' : '0'))

  const samples = computed(() => (samplesOff.value ? [] : PROMPT_SAMPLES.filter((s) => !hiddenSamples.value.includes(s.id))))

  const forScope = (scope: string | null): SavedPrompt[] => list.value.filter((p) => p.scope === 'global' || p.scope === scope)

  function save(p: Omit<SavedPrompt, 'id'> & { id?: string }): SavedPrompt | null {
    const name = p.name.trim()
    if (!name || !fitsPrompt(p.text)) return null
    const at = p.id ? list.value.findIndex((x) => x.id === p.id) : -1
    if (at < 0 && list.value.length >= MAX_PROMPTS) return null
    const next: SavedPrompt = { id: at >= 0 ? p.id! : newId(), name, text: p.text, scope: p.scope }
    list.value = at >= 0 ? list.value.map((x, i) => (i === at ? next : x)) : [...list.value, next]
    return next
  }

  const remove = (id: string): void => {
    list.value = list.value.filter((p) => p.id !== id)
  }

  function hideSample(id: string): void {
    if (known.has(id) && !hiddenSamples.value.includes(id)) hiddenSamples.value = [...hiddenSamples.value, id]
  }
  function showAllSamples(): void {
    hiddenSamples.value = []
    samplesOff.value = false
  }

  async function exportAll(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
    const res = await bridge?.promptsExport?.(exportText(list.value)).catch(() => null)
    if (!res) return { ok: false, error: 'failed' }
    return res.ok ? { ok: true, count: res.count } : { ok: false, error: res.error }
  }

  async function startImport(): Promise<ImportStart> {
    const res = await bridge?.promptsImport?.().catch(() => null)
    if (!res) return { ok: false, error: 'failed' }
    if (!res.ok) return res
    const incoming = parseImport(res.data)
    if (!incoming) return { ok: false, error: 'invalid' }
    return { ok: true, plan: planImport(list.value, incoming) }
  }

  function finishImport(plan: ImportPlan, choice: ClashChoice): ImportOutcome {
    const out = applyImport(list.value, plan, choice, newId)
    list.value = out.list
    return out
  }

  return { list, open, samples, hiddenSamples, samplesOff, forScope, save, remove, hideSample, showAllSamples, exportAll, startImport, finishImport }
})
