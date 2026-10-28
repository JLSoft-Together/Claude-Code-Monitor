export interface TourStep {
  id: string
  /** `data-tour` value of the element to highlight; none = centered card. */
  target?: string
  /** Has a `tour.steps.<id>.absent` hint for when the element is not on screen yet. */
  absent?: boolean
  /** Monitor panel opened while this step shows (closed again after, if the tour opened it). */
  panel?: 'sessions'
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome' },
  { id: 'tabs', target: 'tabs' },
  { id: 'waiting', target: 'waiting', absent: true },
  { id: 'sessions', target: 'sessions', panel: 'sessions' },
  { id: 'map', target: 'map' },
  { id: 'limits', target: 'limits', absent: true },
  { id: 'palette', target: 'palette' },
  { id: 'compact', target: 'compact' },
  { id: 'settings', target: 'settings' },
  { id: 'finish' },
]

/** Workspace (desktop only): the parts used every day, nothing more. i18n under `wsTour.<id>`. */
export const WORKSPACE_TOUR_STEPS: TourStep[] = [
  { id: 'welcome' },
  { id: 'new', target: 'ws-new' },
  { id: 'split', target: 'ws-split', absent: true },
  { id: 'pane', target: 'ws-pane', absent: true },
  { id: 'sidebar', target: 'ws-sidebar', absent: true },
  { id: 'attach', target: 'ws-attach', absent: true },
  { id: 'keys', target: 'ws-help', absent: true },
]

export type TourId = 'monitor' | 'workspace'

export const TOURS: Record<TourId, { steps: TourStep[]; view: 'monitor' | 'workspace'; key: string; i18n: string }> = {
  monitor: { steps: TOUR_STEPS, view: 'monitor', key: 'ccm.tourDone', i18n: 'tour.steps' },
  workspace: { steps: WORKSPACE_TOUR_STEPS, view: 'workspace', key: 'ccm.tourWorkspaceDone', i18n: 'wsTour' },
}

export function tourDone(id: TourId = 'monitor'): boolean {
  try {
    return localStorage.getItem(TOURS[id].key) === '1'
  } catch {
    return true
  }
}

export function markTourDone(id: TourId = 'monitor'): void {
  try {
    localStorage.setItem(TOURS[id].key, '1')
  } catch {
    return
  }
}
