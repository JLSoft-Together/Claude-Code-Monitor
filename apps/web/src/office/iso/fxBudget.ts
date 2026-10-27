export const LOW_FX_ENTER_MS = 45
export const LOW_FX_EXIT_MS = 22
export const LOW_FX_HOLD_MS = 2000
export const LOW_FX_RETRY_MS = 5000
export const LOW_FX_RETRIES = 2

export class FxBudget {
  low = false
  private avg = 1000 / 60
  private last = NaN
  private since = NaN
  private retries = 0

  tick(now: number): boolean {
    const dt = now - this.last
    this.last = now
    if (!(dt > 0) || dt > 1000) {
      this.since = NaN
      return this.low
    }
    this.avg += (dt - this.avg) * 0.1
    const flip = this.low ? this.avg < LOW_FX_EXIT_MS && this.retries < LOW_FX_RETRIES : this.avg > LOW_FX_ENTER_MS
    if (!flip) {
      this.since = NaN
      return this.low
    }
    if (Number.isNaN(this.since)) this.since = now
    if (now - this.since >= (this.low ? LOW_FX_RETRY_MS : LOW_FX_HOLD_MS)) {
      if (this.low) this.retries++
      this.low = !this.low
      this.since = NaN
    }
    return this.low
  }
}
