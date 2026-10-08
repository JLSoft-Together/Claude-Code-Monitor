import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { BackgroundJob, Diagnostics, MonitorSnapshot, NotifySettings, PlanLimits, ResponseStats, ToastHealth, ToastKind, ToastState, ToastTestResult } from '@ccm/shared'

/** Collector side-channels: background jobs, plan limits (status line bridge), reply times, model names. */
export const useExtrasStore = defineStore('extras', () => {
  const jobs = shallowRef<BackgroundJob[]>([])
  const limits = ref<PlanLimits | null>(null)
  const response = ref<ResponseStats | null>(null)
  const modelNames = shallowRef<Record<string, string>>({})
  const statusLineCommand = ref<string | null>(null)
  const diagnostics = ref<Diagnostics | null>(null)
  const dayStartedAt = ref<string | null>(null)
  const notify = ref<NotifySettings | null>(null)
  const toastTest = ref<{ state: 'sending' } | { state: 'done'; result: ToastTestResult | 'offline'; health?: ToastHealth } | null>(null)
  const toast = computed<ToastState | null>(() => notify.value?.toast ?? null)
  const toastCovers = (kind: ToastKind): boolean => notify.value?.toast === 'on' && notify.value.kinds[kind]

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
    dayStartedAt.value = snapshot.dayStartedAt ?? null
    notify.value = snapshot.notify ?? null
  }

  const setJobs = (next: BackgroundJob[]) => (jobs.value = next)
  const setLimits = (next: PlanLimits) => (limits.value = next)
  const setResponse = (next: ResponseStats) => (response.value = next)
  const setModelNames = (next: Record<string, string>) => (modelNames.value = next)
  const setDiagnostics = (next: Diagnostics) => (diagnostics.value = next)
  const setNotify = (next: NotifySettings) => (notify.value = next)
  const setToastTest = (next: typeof toastTest.value) => (toastTest.value = next)

  return { jobs, limits, response, modelNames, statusLineCommand, dayStartedAt, blockedJobs, activeJobs, hydrate, setJobs, setLimits, setResponse, setModelNames, diagnostics, setDiagnostics, notify, toast, toastCovers, setNotify, toastTest, setToastTest }
})
