import type { UsageTotals } from './types'

/** USD per million tokens. */
export interface ModelPrice {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  fastInput?: number
  fastOutput?: number
}

// Source: platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-07). Order matters: longer ids first.
export const PRICING_CHECKED_AT = '2026-10-07'

const p = (input: number, output: number, cacheRead: number, fast?: [number, number]): ModelPrice => ({
  input,
  output,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
  cacheRead,
  fastInput: fast?.[0],
  fastOutput: fast?.[1],
})

const PRICES: [string, ModelPrice][] = [
  ['claude-fable-5-1', p(10, 50, 0.25)],
  ['claude-mythos-5-1', p(10, 50, 0.25)],
  ['claude-fable-5', p(10, 50, 1)],
  ['claude-mythos-5', p(10, 50, 1)],
  ['claude-opus-5-5', p(4, 20, 0.2, [8, 40])],
  ['claude-opus-5', p(5, 25, 0.5, [10, 50])],
  ['claude-opus-4-8', p(5, 25, 0.5, [10, 50])],
  ['claude-opus-4-7', p(5, 25, 0.5)],
  ['claude-opus-4-6', p(5, 25, 0.5)],
  ['claude-opus-4-5', p(5, 25, 0.5)],
  ['claude-opus-4-1', p(15, 75, 1.5)],
  ['claude-opus-4', p(15, 75, 1.5)],
  ['claude-sonnet-5-5', p(2, 10, 0.2)],
  ['claude-sonnet-5', p(2, 10, 0.2)],
  ['claude-sonnet-4-6', p(3, 15, 0.3)],
  ['claude-sonnet-4-5', p(3, 15, 0.3)],
  ['claude-sonnet-4', p(3, 15, 0.3)],
  ['claude-haiku-4-5', p(1, 5, 0.1)],
  ['claude-3-5-haiku', p(0.8, 4, 0.08)],
]

export function priceOf(model: string): ModelPrice | null {
  const id = model.toLowerCase()
  for (const [prefix, price] of PRICES) {
    if (id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}[`)) return price
  }
  return null
}

/** API-equivalent cost in USD, or null when the model has no known price. */
export function estimateCost(totals: UsageTotals, model: string, fast = false): number | null {
  const price = priceOf(model)
  if (!price) return null
  const factor = fast && price.fastInput ? price.fastInput / price.input : 1
  const output = fast && price.fastOutput ? price.fastOutput : price.output
  return (
    (totals.input * price.input * factor +
      totals.cacheWrite5m * price.cacheWrite5m * factor +
      totals.cacheWrite1h * price.cacheWrite1h * factor +
      totals.cacheRead * price.cacheRead * factor +
      totals.output * output) /
    1_000_000
  )
}
