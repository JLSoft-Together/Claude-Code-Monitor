import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { checkKey } from '../lib/checks'
import { problemFiles, type ProblemRun } from '../lib/problems'
import { checkCancel, checkRun, type CheckRequest, type CheckResult } from '../lib/preview'
import { dirKey } from './favorites'

export interface CheckRun {
  root: string
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
    runs.value = { ...runs.value, [key]: { root, check, running: true, result: null, at: Date.now() } }
    const result = await checkRun(root, check)
    const cur = runs.value[key]
    if (!cur || checkKey(cur.check) !== checkKey(check)) return
    runs.value = { ...runs.value, [key]: { ...cur, running: false, result } }
  }

  const cancel = (root: string): Promise<boolean> => checkCancel(root)

  const isAbs = (p: string) => /^(?:[A-Za-z]:[\/]|[\/])/.test(p)
  const problemRuns = computed<ProblemRun[]>(() => {
    const out: ProblemRun[] = []
    for (const r of Object.values(runs.value)) {
      if (r.running || !r.result?.ok || !r.result.errors.length) continue
      const root = r.root.replace(/[\/]+$/, '')
      out.push({ label: r.check.name, at: r.at, errors: r.result.errors.map((e) => (isAbs(e.file) ? e : { ...e, file: `${root}/${e.file}` })) })
    }
    return out
  })
  const marked = computed(() => problemFiles(problemRuns.value))

  return { runs, of, run, cancel, problemRuns, marked }
})
