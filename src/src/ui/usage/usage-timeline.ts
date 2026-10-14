import { agentTotals, localDayKey, type AgentTotal } from "../../lib/usage-aggregate";
import type { UsageBucket } from "../../lib/usage-snapshot";
import { rangeSinceMs, USAGE_RANGES, type UsageRangeId } from "./usage-ranges";

const HOURS_PER_INTERVAL = 4;
const DAYS_PER_INTERVAL = 5;
const MONTHS_PER_YEAR = 12;
export const MAX_TIMELINE_COLUMNS = 24;
export type TimelineState = "absent" | "zero" | "priced" | "unpriced" | "partial";
export interface UsageInterval {
  readonly startMs: number;
  readonly endMs: number;
  readonly label: string;
  readonly agents: readonly AgentTotal[];
  readonly costUsd: number | null;
  readonly state: TimelineState;
}
export interface UsageTimeline {
  readonly intervals: readonly UsageInterval[];
  readonly agents: readonly AgentTotal[];
  readonly startMs: number | null;
  readonly endMs: number;
  readonly intervalLabel: string;
}

function monthIndex(at: Date): number {
  return at.getFullYear() * MONTHS_PER_YEAR + at.getMonth();
}

function boundaries(startMs: number, nowMs: number, range: UsageRangeId) {
  const start = new Date(startMs);
  const now = new Date(nowMs);
  if (range === "today") {
    return {
      starts: Array.from({ length: Math.floor(now.getHours() / HOURS_PER_INTERVAL) + 1 }, (_, i) =>
        new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate(),
          i * HOURS_PER_INTERVAL,
        ).getTime(),
      ),
      intervalLabel: "4-hour local intervals",
    };
  }
  if (range === "7d" || range === "30d") {
    const step = range === "7d" ? 1 : DAYS_PER_INTERVAL;
    const days = range === "7d" ? 7 : 30;
    return {
      starts: Array.from({ length: Math.ceil(days / step) }, (_, i) =>
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * step).getTime(),
      ),
      intervalLabel: step === 1 ? "Local days" : "5-local-day intervals",
    };
  }
  const months = monthIndex(now) - monthIndex(start) + 1;
  const step = Math.ceil(months / MAX_TIMELINE_COLUMNS);
  return {
    starts: Array.from({ length: Math.ceil(months / step) }, (_, i) =>
      i === 0 ? startMs : new Date(start.getFullYear(), start.getMonth() + i * step, 1).getTime(),
    ),
    intervalLabel: step === 1 ? "Calendar months" : `${step}-calendar-month intervals`,
  };
}

function intervalLabel(startMs: number, range: UsageRangeId): string {
  const at = new Date(startMs);
  if (range === "today") return `${String(at.getHours()).padStart(2, "0")}:00`;
  if (range === "all")
    return `${at.toLocaleDateString("en-US", { month: "short" })} ${localDayKey(startMs).slice(2, 4)}`;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function interval(
  startMs: number,
  endMs: number,
  buckets: readonly UsageBucket[],
  range: UsageRangeId,
): UsageInterval {
  const agents = agentTotals(buckets, null);
  const priced = agents.filter((agent) => agent.costUsd !== null);
  const costUsd = priced.length ? priced.reduce((sum, agent) => sum + agent.costUsd!, 0) : null;
  const unpriced = agents.some((agent) => agent.unpricedModels.length > 0);
  const state = !agents.length
    ? "absent"
    : costUsd === null
      ? "unpriced"
      : unpriced
        ? "partial"
        : costUsd === 0
          ? "zero"
          : "priced";
  return { startMs, endMs, agents, costUsd, state, label: intervalLabel(startMs, range) };
}

/** Partition before pricing; each source bucket contributes to exactly one bounded bin. */
export function buildUsageTimeline(
  buckets: readonly UsageBucket[],
  range: UsageRangeId,
  nowMs: number,
): UsageTimeline {
  const definition = USAGE_RANGES.find((entry) => entry.id === range)!;
  const since = rangeSinceMs(definition, nowMs);
  const selected = buckets.filter(
    (bucket) => bucket.bucketStartMs <= nowMs && (since === null || bucket.bucketStartMs >= since),
  );
  const startMs =
    since ??
    selected.reduce<number | null>(
      (first, bucket) =>
        first === null ? bucket.bucketStartMs : Math.min(first, bucket.bucketStartMs),
      null,
    );
  if (startMs === null)
    return { intervals: [], agents: [], startMs, endMs: nowMs, intervalLabel: "Calendar months" };
  const { starts, intervalLabel: unit } = boundaries(startMs, nowMs, range);
  // The search is bounded at 24, independent of corpus length. Group arrays are local builders.
  const groups: UsageBucket[][] = starts.map(() => []);
  for (const bucket of selected) {
    const next = starts.findIndex((at) => at > bucket.bucketStartMs);
    groups[next < 0 ? starts.length - 1 : next - 1].push(bucket);
  }
  return {
    intervals: starts.map((at, index) =>
      interval(at, starts[index + 1] ?? nowMs, groups[index], range),
    ),
    agents: agentTotals(selected, null),
    startMs,
    endMs: nowMs,
    intervalLabel: unit,
  };
}
