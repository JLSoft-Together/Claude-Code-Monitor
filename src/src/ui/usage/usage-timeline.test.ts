import { describe, expect, it } from "vitest";
import { agentTotals } from "../../lib/usage-aggregate";
import { EMPTY_COUNTERS, type UsageBucket } from "../../lib/usage-snapshot";
import { buildUsageTimeline, MAX_TIMELINE_COLUMNS } from "./usage-timeline";
import { rangeSinceMs, USAGE_RANGES } from "./usage-ranges";
const now = new Date(2026, 8, 14, 14).getTime();
const bucket = (at: number, patch: Partial<UsageBucket> = {}): UsageBucket => ({
  bucketStartMs: at,
  agent: "claude",
  model: "gpt-5",
  counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
  ...patch,
});

describe("real cost timeline", () => {
  it.each(USAGE_RANGES)("partitions $id once and agrees with canonical accounting", (range) => {
    const buckets = Array.from({ length: 1000 }, (_, i) =>
      bucket(new Date(2026, 8, 14 - i, 4).getTime(), { agent: i % 2 ? "claude" : "codex" }),
    );
    const timeline = buildUsageTimeline(buckets, range.id, now);
    const expected = agentTotals(buckets, rangeSinceMs(range, now));
    expect(timeline.agents).toEqual(expected);
    for (const agent of expected) {
      const sum = timeline.intervals.reduce(
        (sum, bin) => sum + (bin.agents.find((row) => row.agent === agent.agent)?.costUsd ?? 0),
        0,
      );
      expect(sum).toBeCloseTo(agent.costUsd!, 8);
    }
    expect(timeline.intervals.length).toBeLessThanOrEqual(MAX_TIMELINE_COLUMNS);
    expect(
      timeline.intervals.every((bin, i, all) => i === 0 || bin.startMs === all[i - 1].endMs),
    ).toBe(true);
  });
  it("distinguishes absent, measured zero, wholly unpriced and partial bins", () => {
    const at = (hour: number) => new Date(2026, 8, 14, hour).getTime();
    const timeline = buildUsageTimeline(
      [
        bucket(at(4), { counters: EMPTY_COUNTERS }),
        bucket(at(8), { model: "unknown" }),
        bucket(at(12)),
        bucket(at(12), { agent: "codex", model: "unknown" }),
      ],
      "today",
      now,
    );
    expect(timeline.intervals.map((bin) => bin.state)).toEqual([
      "absent",
      "zero",
      "unpriced",
      "partial",
    ]);
    expect(timeline.intervals[3].agents).toHaveLength(2);
  });
  it("includes exact start and now boundaries, excludes future history", () => {
    const since = new Date(2026, 8, 14).getTime();
    const timeline = buildUsageTimeline(
      [bucket(since - 1), bucket(since), bucket(now), bucket(now + 1)],
      "today",
      now,
    );
    expect(timeline.agents[0].counters.inputUncached).toBe(2_000_000);
    expect(timeline.intervals[0].agents).toHaveLength(1);
    expect(timeline.intervals.at(-1)?.endMs).toBe(now);
  });
  it("keeps an exact midnight contribution in a zero-length current interval", () => {
    const midnight = new Date(2026, 8, 14).getTime();
    const timeline = buildUsageTimeline([bucket(midnight)], "today", midnight);
    expect(timeline.intervals).toHaveLength(1);
    expect(timeline.intervals[0].costUsd).toBeGreaterThan(0);
  });
  it("labels actual partial first and last monthly boundaries", () => {
    const first = new Date(2021, 3, 17, 12).getTime();
    const timeline = buildUsageTimeline([bucket(first), bucket(now)], "all", now);
    expect(timeline.startMs).toBe(first);
    expect(timeline.intervals[0].startMs).toBe(first);
    expect(timeline.intervals.at(-1)?.endMs).toBe(now);
    expect(timeline.intervals.length).toBeLessThanOrEqual(24);
    expect(buildUsageTimeline([], "all", now).intervals).toEqual([]);
  });
  it.each(["America/New_York", "Pacific/Chatham"])(
    "uses calendar boundaries over DST and offsets in %s",
    (zone) => {
      const previous = process.env.TZ;
      process.env.TZ = zone;
      try {
        for (const date of [
          new Date(2026, 2, 8, 16),
          new Date(2026, 10, 1, 16),
          new Date(2026, 8, 27, 16),
        ]) {
          const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
          const result = buildUsageTimeline(
            [bucket(start), bucket(date.getTime())],
            "today",
            date.getTime(),
          );
          expect(result.intervals.map((bin) => new Date(bin.startMs).getHours())).toEqual([
            0, 4, 8, 12, 16,
          ]);
          expect(result.agents[0].counters.inputUncached).toBe(2_000_000);
          const week = buildUsageTimeline([bucket(start)], "7d", date.getTime());
          expect(week.intervals.every((bin) => new Date(bin.startMs).getHours() === 0)).toBe(true);
        }
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    },
  );
});
