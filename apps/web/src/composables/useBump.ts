import { ref, watch, type Ref } from 'vue'

/** Counter that increments when `source` changes (not on mount); use as a `:key` to replay a one-shot animation. */
export function useBump(source: () => unknown): Ref<number> {
  const n = ref(0)
  watch(source, () => n.value++)
  return n
}
