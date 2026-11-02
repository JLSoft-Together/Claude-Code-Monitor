import { ref } from 'vue'
import { dropMru, MRU_KEY, readMru, touchMru, type MruEntry } from '../lib/projectSwitcher'

function load(): MruEntry[] {
  try {
    return readMru(localStorage.getItem(MRU_KEY))
  } catch {
    return []
  }
}

const mru = ref<MruEntry[]>(load())

function save(next: MruEntry[]): void {
  mru.value = next
  try {
    localStorage.setItem(MRU_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable
  }
}

/** Projects in the order the owner last worked in them (Go to project); longer than the rail's remembered folders. */
export function useProjectMru() {
  return {
    mru,
    touch: (dir: string): void => {
      if (mru.value[0]?.dir === dir) return
      save(touchMru(mru.value, dir, Date.now()))
    },
    drop: (dir: string): void => save(dropMru(mru.value, dir)),
  }
}
