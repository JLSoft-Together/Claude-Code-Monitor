import type { Agent, ToolSpan } from '@ccm/shared'
import { treeOrder } from './layout'

export const WINDOWS = [15, 30, 60] as const
export type WindowMin = (typeof WINDOWS)[number]

const MIN_MS = 60_000

export function spansInWindow(spans: Iterable<ToolSpan>, fromMs: number): ToolSpan[] {
  const out: ToolSpan[] = []
  for (const s of spans) if (!s.end || Date.parse(s.end) >= fromMs) out.push(s)
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

export interface Bar {
  span: ToolSpan
  left: number
  width: number
  running: boolean
}

const clamp = (v: number) => Math.min(100, Math.max(0, v))

export function laneLayout(spans: ToolSpan[], fromMs: number, nowMs: number): Bar[] {
  const range = Math.max(1, nowMs - fromMs)
  return spans.map((span) => {
    const running = !span.end
    const start = Math.max(fromMs, Date.parse(span.start))
    const end = running ? nowMs : Math.min(nowMs, Date.parse(span.end!))
    const left = clamp(((start - fromMs) / range) * 100)
    const width = Math.min(100 - left, clamp(((end - start) / range) * 100))
    return { span, left, width, running }
  })
}

export interface Lane {
  agentId: string
  agent?: Agent
  depth: number
  spans: ToolSpan[]
}

export function lanesFor(spans: ToolSpan[], agents: Agent[]): Lane[] {
  const byAgent = new Map<string, ToolSpan[]>()
  for (const s of spans) {
    const list = byAgent.get(s.agentId) ?? []
    list.push(s)
    byAgent.set(s.agentId, list)
  }
  const lanes: Lane[] = []
  const known = new Set<string>()
  const add = (agent: Agent, depth: number) => {
    known.add(agent.id)
    const own = byAgent.get(agent.id)
    if (own?.length) lanes.push({ agentId: agent.id, agent, depth, spans: own })
  }
  const main = agents.find((a) => a.role === 'main')
  if (main) add(main, 0)
  for (const { agent, depth } of treeOrder(agents)) add(agent, depth)
  for (const [agentId, own] of byAgent) if (!known.has(agentId)) lanes.push({ agentId, depth: 1, spans: own })
  return lanes
}

export interface ToolStat {
  tool: string
  calls: number
  errors: number
  errorRate: number
  interrupted: number
  running: number
  p50?: number
  p95?: number
  totalMs: number
  warn: boolean
}

export function percentile(sortedMs: number[], p: number): number | undefined {
  if (!sortedMs.length) return undefined
  return sortedMs[Math.max(0, Math.ceil((p / 100) * sortedMs.length) - 1)]
}

export function toolStats(spans: ToolSpan[], nowMs: number): ToolStat[] {
  const groups = new Map<string, ToolSpan[]>()
  for (const s of spans) {
    const list = groups.get(s.tool) ?? []
    list.push(s)
    groups.set(s.tool, list)
  }
  const stats: ToolStat[] = []
  for (const [tool, list] of groups) {
    let ok = 0
    let errors = 0
    let interrupted = 0
    let running = 0
    let totalMs = 0
    const durations: number[] = []
    for (const s of list) {
      const start = Date.parse(s.start)
      if (!s.end) {
        running++
        totalMs += Math.max(0, nowMs - start)
        continue
      }
      const ms = Math.max(0, Date.parse(s.end) - start)
      totalMs += ms
      if (s.outcome === 'interrupted') interrupted++
      else if (s.outcome === 'ok' || s.outcome === 'error') {
        if (s.outcome === 'ok') ok++
        else errors++
        durations.push(ms)
      }
    }
    durations.sort((a, b) => a - b)
    const done = ok + errors
    const errorRate = done ? errors / done : 0
    stats.push({
      tool,
      calls: list.length,
      errors,
      errorRate,
      interrupted,
      running,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      totalMs,
      warn: errors >= 3 && errorRate >= 0.2,
    })
  }
  return stats.sort((a, b) => b.totalMs - a.totalMs || a.tool.localeCompare(b.tool))
}

export function ticks(fromMs: number, nowMs: number, windowMin: WindowMin): number[] {
  const step = (windowMin === 60 ? 10 : 5) * MIN_MS
  const out: number[] = []
  for (let t = Math.ceil(fromMs / step) * step; t <= nowMs; t += step) out.push(t)
  return out
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < MIN_MS) return `${(ms / 1000).toFixed(1)} s`
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}m ${total % 60}s`
}
