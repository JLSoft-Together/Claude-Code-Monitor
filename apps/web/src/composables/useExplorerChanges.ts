import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { gitMarks, samePath } from '../lib/changesView'
import { createChangesScheduler } from '../lib/explorer/changesScheduler'
import { changesStatus, changesUnwatch, changesWatch, onChangesUpdated, type ChangesStatus } from '../lib/preview'

/**
 * Git status for the Explorer's Changes view (ported from spacevibe-deck `changes-controller.ts`).
 * Reads once per root (repo or not, totals for the switch); watches and re-reads only while `active`.
 */
export function useExplorerChanges(root: Ref<string | null>, active: Ref<boolean>) {
  const status = shallowRef<ChangesStatus | null>(null)
  const reading = ref(false)
  let watched: string | null = null
  let last = ''
  let seq = 0

  async function read(): Promise<void> {
    const at = root.value
    if (!at) return
    const run = ++seq
    reading.value = true
    const res = await changesStatus(at)
    if (run !== seq) return
    reading.value = false
    // A transient failure keeps the last list; "not a repo" clears it.
    if (!res.ok && res.error === 'failed' && status.value?.ok) return
    const key = JSON.stringify(res)
    if (key !== last) {
      last = key
      status.value = res
    }
    syncWatch()
  }

  const scheduler = createChangesScheduler({ read })

  function syncWatch(): void {
    const next = active.value && status.value?.ok ? status.value.root : null
    if (watched === next) return
    if (watched) void changesUnwatch(watched)
    watched = next
    if (next) void changesWatch(next)
  }

  watch(
    root,
    () => {
      seq++
      status.value = null
      last = ''
      reading.value = false
      syncWatch()
      if (active.value) {
        scheduler.setActive(false)
        scheduler.setActive(true)
      } else void read()
    },
    { immediate: true },
  )

  watch(active, (on) => {
    scheduler.setActive(on && !!root.value)
    syncWatch()
  })

  const off = onChangesUpdated((c) => {
    if (status.value?.ok && samePath(c.root, status.value.root)) scheduler.trigger('watch')
  })
  const onFocus = (): void => scheduler.trigger('focus')
  window.addEventListener('focus', onFocus)

  onBeforeUnmount(() => {
    off()
    window.removeEventListener('focus', onFocus)
    scheduler.dispose()
    if (watched) void changesUnwatch(watched)
    watched = null
  })

  const totals = computed(() => {
    const s = status.value
    if (!s?.ok) return null
    return s.entries.reduce((acc, e) => ({ added: acc.added + (e.added ?? 0), removed: acc.removed + (e.removed ?? 0) }), { added: 0, removed: 0 })
  })
  const isRepo = computed(() => (status.value ? status.value.ok || (status.value.error !== 'not-repo' && status.value.error !== 'no-git') : true))

  const marks = computed(() => (status.value?.ok ? gitMarks(status.value.root, status.value.entries) : null))

  return { status, reading, totals, isRepo, marks, refresh: () => scheduler.trigger('refresh'), read }
}
