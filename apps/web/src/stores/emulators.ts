import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AvdErrorCode, AvdInfo, AvdResult, AvdStartMode } from '@ccm/shared'
import * as api from '../lib/devices'

// An emulator boot takes up to a couple of minutes; past this the row stops showing "Starting".
const START_WAIT_MS = 180_000

export const useEmulatorsStore = defineStore('emulators', () => {
  const avds = ref<AvdInfo[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const missing = ref(false)
  const busy = ref<Set<string>>(new Set())
  const starting = ref<Set<string>>(new Set())
  const lastError = ref<{ code: AvdErrorCode; detail?: string } | null>(null)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let gen = 0

  function setStarting(name: string, on: boolean): void {
    const next = new Set(starting.value)
    clearTimeout(timers.get(name))
    timers.delete(name)
    if (on) {
      next.add(name)
      timers.set(name, setTimeout(() => setStarting(name, false), START_WAIT_MS))
    } else next.delete(name)
    starting.value = next
  }

  async function load(): Promise<void> {
    if (!api.hasEmulators) return
    const mine = ++gen
    loading.value = true
    try {
      const r = await api.avdList()
      if (mine !== gen) return
      missing.value = !r.ok && r.error === 'emulator-missing'
      if (r.ok) {
        avds.value = r.avds
        for (const a of r.avds) if (a.serial && starting.value.has(a.name)) setStarting(a.name, false)
      } else {
        avds.value = []
        if (!missing.value) lastError.value = { code: r.error, detail: r.detail }
      }
      loaded.value = true
    } finally {
      if (mine === gen) loading.value = false
    }
  }

  async function act(name: string, fn: () => Promise<AvdResult>): Promise<AvdResult> {
    lastError.value = null
    busy.value = new Set([...busy.value, name])
    try {
      const r = await fn()
      if (!r.ok && r.error !== 'cancelled') lastError.value = { code: r.error, detail: r.detail }
      return r
    } finally {
      const next = new Set(busy.value)
      next.delete(name)
      busy.value = next
    }
  }

  async function start(name: string, mode: AvdStartMode): Promise<void> {
    const r = await act(name, () => api.avdStart(name, mode))
    if (r.ok) setStarting(name, true)
  }

  async function stop(name: string): Promise<void> {
    const r = await act(name, () => api.avdStop(name))
    if (r.ok) setStarting(name, false)
  }

  function dispose(): void {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    starting.value = new Set()
  }

  return { avds, loaded, loading, missing, busy, starting, lastError, load, start, stop, dispose }
})
