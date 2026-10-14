import { describe, expect, it } from "vitest";
import {
  claudeLimits,
  codexLimits,
  currentLimitWindows,
  LIMIT_MAX_AGE_MS,
  limitWindowLabel,
  parseLimitsSnapshot,
} from "./agent-limits";

const NOW = 1_800_000_000_000;
const RESET = NOW / 1000 + 3600;

describe("subscription limit readings", () => {
  it("uses the Codex bucket and provider duration instead of assuming primary means 5h", () => {
    const reading = codexLimits(
      {
        rateLimitsByLimitId: {
          codex: { primary: { usedPercent: 82, windowDurationMins: 10080, resetsAt: RESET } },
          codex_other: { primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: RESET } },
        },
      },
      NOW,
    );
    expect(currentLimitWindows(reading, NOW)).toEqual([
      { durationMinutes: 10080, usedPercent: 82, resetsAtMs: RESET * 1000 },
    ]);
    expect(limitWindowLabel(reading.windows[0].durationMinutes)).toBe("7d");
  });
  it("does not substitute a model-specific bucket when the account bucket is absent", () => {
    expect(
      codexLimits(
        {
          rateLimitsByLimitId: { other: {} },
          rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: RESET } },
        },
        NOW,
      ).windows,
    ).toEqual([]);
  });
  it("keeps missing Claude windows distinct from 0% used", () => {
    const reading = claudeLimits({ five_hour: { used_percentage: 0, resets_at: RESET } }, NOW);
    expect(reading.windows).toHaveLength(1);
    expect(reading.windows[0].usedPercent).toBe(0);
    expect(claudeLimits({}, NOW).windows).toEqual([]);
  });
  it("expires windows at the reset boundary and stale observations without guessing a reset", () => {
    const reading = claudeLimits({ five_hour: { used_percentage: 100, resets_at: RESET } }, NOW);
    expect(currentLimitWindows(reading, NOW)).toHaveLength(1);
    expect(currentLimitWindows(reading, NOW + LIMIT_MAX_AGE_MS + 1)).toEqual([]);
    expect(currentLimitWindows({ ...reading, observedAtMs: RESET * 1000 }, RESET * 1000)).toEqual(
      [],
    );
    expect(currentLimitWindows(reading, NOW - 1)).toEqual([]);
  });
  it("rejects reset timestamps outside the JavaScript Date range", () => {
    const snapshot = parseLimitsSnapshot([
      {
        agent: "claude",
        state: "ready",
        observedAtMs: NOW,
        windows: [{ usedPercent: 32, durationMinutes: 300, resetsAtMs: 9_000_000_000_000_000 }],
      },
    ]);
    expect(currentLimitWindows(snapshot[0], NOW)).toEqual([]);
  });
  it("rejects invalid percentages, durations and timestamps at both boundaries", () => {
    for (const used of [-1, 101, "82", null, Infinity, NaN]) {
      expect(
        claudeLimits({ five_hour: { used_percentage: used, resets_at: RESET } }, NOW).windows,
      ).toEqual([]);
    }
    expect(
      parseLimitsSnapshot([
        {
          agent: "codex",
          state: "ready",
          observedAtMs: NOW,
          windows: [{ usedPercent: 2, durationMinutes: -300, resetsAtMs: RESET * 1000 }],
        },
      ])[1].windows,
    ).toEqual([]);
  });
});
