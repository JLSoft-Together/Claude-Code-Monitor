import { computed, ref, watch } from 'vue'
import { withViewTransition } from '../../../lib/motion'
import { clampSideWidth, EXPLORER_DEFAULT, EXPLORER_WIDTH_KEY, readSideWidth, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, writeSideWidth } from '../../../lib/sideWidth'
import { useExplorerStore } from '../../../stores/explorer'
import { useWorkspaceStore } from '../../../stores/workspace'

const SIDEBAR_KEY = 'ccm.workspace.sidebar'
const EXPLORER_KEY = 'ccm.workspace.explorerOpen'

/** Closed sidebar = the rail's avatar column; below SIDE_NARROW run badges in project headers shrink to icons. */
export const RAIL_COLUMN_W = 52
export const SIDE_NARROW = 264

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0'
  } catch {
    return true
  }
}

function persistFlag(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? '1' : '0')
  } catch {
    // preference only
  }
}

/** Sidebar + Explorer panels: open state and widths. Stored preferences; what is drawn is clamped to the window so a narrow window never hides the stage. */
export function useSidePanels() {
  const workspace = useWorkspaceStore()
  const explorer = useExplorerStore()

  const sidebarOpen = ref(readFlag(SIDEBAR_KEY))
  const explorerOpen = ref(readFlag(EXPLORER_KEY))
  const toggleSidebar = (): void => withViewTransition(() => (sidebarOpen.value = !sidebarOpen.value))
  const toggleExplorer = (): void => withViewTransition(() => (explorerOpen.value = !explorerOpen.value))
  watch(sidebarOpen, (open) => persistFlag(SIDEBAR_KEY, open))
  watch(explorerOpen, (open) => persistFlag(EXPLORER_KEY, open))

  // The panel is on screen from the start, so it can ask for a new terminal's folder before main allows it.
  watch(
    () => workspace.active?.state,
    (state) => {
      if (state === 'running' && explorerOpen.value) void explorer.retryFailed()
    },
  )

  // The left panel leaves room for the Explorer at its minimum; the Explorer takes what the left panel left.
  const sideWidthPref = ref(readSideWidth())
  const explorerWidthPref = ref(readSideWidth(EXPLORER_WIDTH_KEY, EXPLORER_DEFAULT))
  const viewportW = ref(window.innerWidth)
  const sideRoom = computed(() => viewportW.value - (explorerOpen.value ? SIDE_MIN : 0))
  const sideWidth = computed(() => clampSideWidth(sideWidthPref.value, sideRoom.value))
  const sideMax = computed(() => clampSideWidth(SIDE_MAX, sideRoom.value))
  const explorerRoom = computed(() => viewportW.value - (sidebarOpen.value ? sideWidth.value : RAIL_COLUMN_W))
  const explorerWidth = computed(() => clampSideWidth(explorerWidthPref.value, explorerRoom.value))
  const explorerMax = computed(() => clampSideWidth(SIDE_MAX, explorerRoom.value))
  const sideDragging = ref(false)
  const explorerDragging = ref(false)

  function onViewportResize(): void {
    viewportW.value = window.innerWidth
  }
  function resizeSide(px: number): void {
    sideWidthPref.value = clampSideWidth(px, sideRoom.value)
  }
  function resetSide(): void {
    sideWidthPref.value = SIDE_DEFAULT
    writeSideWidth(SIDE_DEFAULT)
  }
  function resizeExplorer(px: number): void {
    explorerWidthPref.value = clampSideWidth(px, explorerRoom.value)
  }
  function resetExplorer(): void {
    explorerWidthPref.value = EXPLORER_DEFAULT
    writeSideWidth(EXPLORER_DEFAULT, EXPLORER_WIDTH_KEY)
  }
  const commitSide = (): void => writeSideWidth(sideWidthPref.value)
  const commitExplorer = (): void => writeSideWidth(explorerWidthPref.value, EXPLORER_WIDTH_KEY)

  return {
    sidebarOpen,
    explorerOpen,
    toggleSidebar,
    toggleExplorer,
    sideWidth,
    sideMax,
    explorerWidth,
    explorerMax,
    sideDragging,
    explorerDragging,
    onViewportResize,
    resizeSide,
    resetSide,
    resizeExplorer,
    resetExplorer,
    commitSide,
    commitExplorer,
  }
}
