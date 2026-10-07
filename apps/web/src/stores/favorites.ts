import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Favorite, FavoriteRejectReason } from '@ccm/shared'

export const dirKey = (dir: string): string => dir.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()

export const useFavoritesStore = defineStore('favorites', () => {
  const list = ref<Favorite[]>([])
  const keys = computed(() => new Set(list.value.map((f) => dirKey(f.dir))))
  const rejected = ref<{ dir: string; reason: FavoriteRejectReason; n: number } | null>(null)

  function replaceAll(next: Favorite[]): void {
    list.value = next
  }

  function has(dir: string | undefined): boolean {
    return !!dir && keys.value.has(dirKey(dir))
  }

  function reject(dir: string, reason: FavoriteRejectReason): void {
    rejected.value = { dir, reason, n: (rejected.value?.n ?? 0) + 1 }
  }

  return { list, rejected, replaceAll, has, reject }
})
