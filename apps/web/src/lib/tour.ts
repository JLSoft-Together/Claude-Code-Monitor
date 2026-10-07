export interface TourStep {
  id: string
  /** `data-tour` value of the element to highlight; none = centered card. */
  target?: string
  /** Has a `tour.steps.<id>.absent` hint for when the element is not on screen yet. */
  absent?: boolean
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome' },
  { id: 'tabs', target: 'tabs' },
  { id: 'waiting', target: 'waiting', absent: true },
  { id: 'metrics', target: 'metrics' },
  { id: 'sessions', target: 'sessions' },
  { id: 'map', target: 'map' },
  { id: 'activity', target: 'activity' },
  { id: 'limits', target: 'limits', absent: true },
  { id: 'palette', target: 'palette' },
  { id: 'compact', target: 'compact' },
  { id: 'settings', target: 'settings' },
  { id: 'finish' },
]

const KEY = 'ccm.tourDone'

export function tourDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

export function markTourDone(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    return
  }
}
