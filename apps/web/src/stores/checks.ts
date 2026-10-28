import { defineStore } from 'pinia'
import { ref } from 'vue'
import { checkKey } from '../lib/checks'
import { checkCancel, checkRun, type CheckRequest, type CheckResult } from '../lib/preview'
import { dirKey } from './favorites'

export interface CheckRun {
  check: CheckRequest
  running: boolean
  result: CheckResult | null
  at: number
}

/** Last check per folder; kept while the app runs so switching tabs or roots does not lose it. */
export const useChecksStore = defineStore('checks', () => {
  const runs = ref<Record<string, CheckRun>>({})

  const of = (root: string): CheckRun | undefined => runs.value[dirKey(root)]

  async function run(root: string, check: CheckRequest): Promise<void> {
    const key = dirKey(root)
    if (runs.value[key]?.running) return
    runs.value = { ...runs.value, [key]: { check, running: true, result: null, at: Date.now() } }
    const result = await checkRun(root, check)
    const cur = runs.value[key]
    if (!cur || checkKey(cur.check) !== checkKey(check)) return
    runs.value = { ...runs.value, [key]: { ...cur, running: false, result } }
  }

  const cancel = (root: string): Promise<boolean> => checkCancel(root)

  return { runs, of, run, cancel }
})
