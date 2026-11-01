import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { DiskState } from '@ccm/shared'
import { diskOpen, diskProjects, diskRefresh, diskSet, diskState, hasDisk, onDisk } from '../lib/buildClean'

/** Free space of the drives desktop main watches (v77 R9); the page only shows it and reports open project folders. */
export const useDiskStore = defineStore('disk', () => {
  const state = shallowRef<DiskState | null>(null)
  const open = ref(false)
  let started = false
  let lastProjects = ''

  function start(): void {
    if (started || !hasDisk) return
    started = true
    onDisk((s) => (state.value = s))
    void diskState().then((s) => {
      if (s) state.value = s
    })
  }

  const low = computed(() => (state.value?.drives ?? []).filter((d) => d.level !== 'ok'))
  const worst = computed(() => (low.value.some((d) => d.level === 'danger') ? 'danger' : low.value.length ? 'warn' : null))

  async function refresh(): Promise<void> {
    const s = await diskRefresh()
    if (s) state.value = s
  }

  async function setWarnGb(gb: number): Promise<void> {
    const s = await diskSet(gb)
    if (s) state.value = s
  }

  function reportProjects(dirs: string[]): void {
    const key = dirs.join('\n')
    if (!hasDisk || key === lastProjects) return
    lastProjects = key
    void diskProjects(dirs)
  }

  return { state, open, low, worst, start, refresh, setWarnGb, reportProjects, openFolder: diskOpen }
})
