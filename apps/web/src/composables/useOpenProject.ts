import { ref } from 'vue'
import { desktop } from '../lib/desktop'
import { useWorkspaceStore } from '../stores/workspace'

/** Rail "Open project…": native folder picker, then a new tab there with the current preset. */
export function useOpenProject() {
  const workspace = useWorkspaceStore()
  const picking = ref(false)
  const available = !!desktop?.pickFolder

  async function openProject(): Promise<void> {
    if (picking.value || !desktop) return
    picking.value = true
    try {
      const dir = await desktop.pickFolder(workspace.recentDirs[0])
      if (dir) workspace.open(workspace.preset, dir)
    } finally {
      picking.value = false
    }
  }

  return { available, picking, openProject }
}
