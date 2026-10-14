import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { samePath } from '../lib/changesView'
import { parseUnifiedDiff } from '../lib/diff'
import { changeBlocks } from '../lib/diffBlocks'
import { changesFile, changesUnwatch, changesWatch, hasFileChanges, onChangesUpdated, type ChangesFile } from '../lib/preview'

/**
 * Change markers for one viewed file (IntelliJ LineStatusTracker, read-only): the file's diff vs HEAD,
 * re-read when the working tree or the git dir (commit, checkout, stage) changes while `active`.
 */
export function useFileChanges(path: () => string, active: () => boolean) {
  const info = shallowRef<ChangesFile | null>(null)
  let seq = 0
  let watched: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const file = computed(() => {
    const i = info.value
    return i?.ok && i.text && !i.binary && !i.tooLarge ? (parseUnifiedDiff(i.text)[0] ?? null) : null
  })
  const blocks = computed(() => (file.value ? changeBlocks(file.value) : []))
  const ok = computed(() => (info.value?.ok ? info.value : null))

  async function load(): Promise<void> {
    if (!hasFileChanges) return
    const run = ++seq
    const res = await changesFile(path())
    if (run !== seq) return
    // Unchanged reply: keep the same object so nothing re-renders.
    if (JSON.stringify(res) !== JSON.stringify(info.value)) info.value = res
    syncWatch()
  }

  function reload(delay = 150): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void load()
    }, delay)
  }

  function syncWatch(): void {
    const next = active() && info.value?.ok ? info.value.root : null
    if (watched === next) return
    if (watched) void changesUnwatch(watched)
    watched = next
    if (next) void changesWatch(next)
  }

  const off = onChangesUpdated((c) => {
    if (info.value?.ok && samePath(c.root, info.value.root)) reload()
  })

  watch(
    path,
    () => {
      seq++
      info.value = null
      void load()
    },
    { immediate: true },
  )
  watch(active, (on) => {
    syncWatch()
    if (on) reload(0)
  })

  onBeforeUnmount(() => {
    off()
    if (timer) clearTimeout(timer)
    if (watched) void changesUnwatch(watched)
    watched = null
  })

  return { info, ok, file, blocks, reload }
}
