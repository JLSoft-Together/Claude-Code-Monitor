import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { BackgroundJob, MonitorSnapshot, PlanLimits, ResponseStats } from '@ccm/shared'

/** Collector side-channels: background jobs, plan limits (status line bridge), reply times, model names. */
export const useExtrasStore = defineStore('extras', () => {
  const jobs = shallowRef<BackgroundJob[]>([])
  const limits = ref<PlanLimits | null>(null)
  const response = ref<ResponseStats | null>(null)
  const modelNames = shallowRef<Record<string, string>>({})
  const statusLineCommand = ref<string | null>(null)

  const blockedJobs = computed(() =>
    jobs.value.filter((j) => j.state === 'blocked').sort((a, b) => (a.stateSince ?? '').localeCompare(b.stateSince ?? '')),
  )
  const activeJobs = computed(() => jobs.value.filter((j) => j.state !== 'done'))

  function hydrate(snapshot: MonitorSnapshot): void {
    jobs.value = snapshot.jobs ?? []
    limits.value = snapshot.limits ?? null
    response.value = snapshot.response ?? null
    modelNames.value = snapshot.modelNames ?? {}
    statusLineCommand.value = snapshot.statusLineCommand ?? null
  }

  const setJobs = (next: BackgroundJob[]) => (jobs.value = next)
  const setLimits = (next: PlanLimits) => (limits.value = next)
  const setResponse = (next: ResponseStats) => (response.value = next)
  const setModelNames = (next: Record<string, string>) => (modelNames.value = next)

  return { jobs, limits, response, modelNames, statusLineCommand, blockedJobs, activeJobs, hydrate, setJobs, setLimits, setResponse, setModelNames }
})
