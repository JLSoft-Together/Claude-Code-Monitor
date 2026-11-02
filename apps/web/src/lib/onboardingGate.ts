export interface WhatsNewGate {
  due: boolean
  whatsNewOpen: boolean
  setupOpen: boolean
  tourOpen: boolean
  tourDue: boolean
  tourShownThisSession: boolean
}

let tourShown = false
export const markTourShownThisSession = (): void => {
  tourShown = true
}
export const tourShownThisSession = (): boolean => tourShown

/** On a fresh profile the guide runs alone; What's new waits for the next start (its seen key stays unset). */
export function canOfferWhatsNew(g: WhatsNewGate): boolean {
  return g.due && !g.tourShownThisSession && !g.whatsNewOpen && !g.setupOpen && !g.tourOpen && !g.tourDue
}
