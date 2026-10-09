import { nextTick, ref } from 'vue'

/** State for a one-field inline form; `save` gets the trimmed draft and returns false when it could not be sent. */
export function useInlineEdit() {
  const active = ref(false)
  const draft = ref('')
  const failed = ref(false)
  const input = ref<HTMLInputElement | null>(null)

  async function start(initial: string, select = false): Promise<void> {
    draft.value = initial
    failed.value = false
    active.value = true
    await nextTick()
    input.value?.focus()
    if (select) input.value?.select()
  }

  function commit(save: (value: string) => boolean): void {
    if (!active.value) return
    if (!save(draft.value.trim())) {
      failed.value = true
      return
    }
    active.value = false
  }

  function cancel(): void {
    active.value = false
    failed.value = false
  }

  return { active, draft, failed, input, start, commit, cancel }
}
