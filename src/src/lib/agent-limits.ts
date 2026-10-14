/** Subscription allowance, separate from token costs and context-window capacity. */
export const LIMIT_MAX_AGE_MS = 5 * 60_000;
export const LIMIT_REFRESH_MS = 60_000;
export type LimitAgent = "claude" | "codex";
export interface LimitWindow {
  readonly durationMinutes: number;
  readonly usedPercent: number;
  readonly resetsAtMs: number;
}
export interface AgentLimitReading {
  readonly agent: LimitAgent;
  readonly state: "ready" | "unavailable" | "error";
  readonly observedAtMs: number;
  readonly windows: readonly LimitWindow[];
}
export type AgentLimitsSnapshot = readonly AgentLimitReading[];

export function limitRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function absentLimits(
  agent: LimitAgent,
  state: "unavailable" | "error" = "unavailable",
): AgentLimitReading {
  return { agent, state, observedAtMs: 0, windows: [] };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseLimitWindow(
  used: unknown,
  duration: unknown,
  resetsSeconds: unknown,
): LimitWindow | null {
  if (
    !finite(used) ||
    used < 0 ||
    used > 100 ||
    !finite(duration) ||
    duration <= 0 ||
    !Number.isSafeInteger(duration) ||
    !finite(resetsSeconds) ||
    resetsSeconds <= 0 ||
    !Number.isSafeInteger(resetsSeconds * 1000) ||
    !Number.isFinite(new Date(resetsSeconds * 1000).getTime())
  )
    return null;
  return { usedPercent: used, durationMinutes: duration, resetsAtMs: resetsSeconds * 1000 };
}

export function codexLimits(value: unknown, observedAtMs: number): AgentLimitReading {
  const root = limitRecord(value);
  const byId = limitRecord(root?.rateLimitsByLimitId);
  const bucket = limitRecord(byId ? byId.codex : root?.rateLimits);
  if (!bucket) return absentLimits("codex");
  const windows = [bucket.primary, bucket.secondary].flatMap((entry) => {
    const node = limitRecord(entry);
    const parsed = parseLimitWindow(node?.usedPercent, node?.windowDurationMins, node?.resetsAt);
    return parsed ? [parsed] : [];
  });
  return { agent: "codex", state: windows.length ? "ready" : "unavailable", observedAtMs, windows };
}

export function claudeLimits(value: unknown, observedAtMs: number): AgentLimitReading {
  const root = limitRecord(value);
  const windows = [
    ["five_hour", 300],
    ["seven_day", 10080],
  ].flatMap(([key, duration]) => {
    const node = limitRecord(root?.[key]);
    const parsed = parseLimitWindow(node?.used_percentage, duration, node?.resets_at);
    return parsed ? [parsed] : [];
  });
  return {
    agent: "claude",
    state: windows.length ? "ready" : "unavailable",
    observedAtMs,
    windows,
  };
}

/** Validate the host boundary; discard unexpected agents, fields and malformed windows. */
export function parseLimitsSnapshot(raw: unknown): AgentLimitsSnapshot {
  const rows = Array.isArray(raw) ? raw : [];
  return (["claude", "codex"] as const).map((agent) => {
    const node = rows.map(limitRecord).find((entry) => entry?.agent === agent);
    if (
      !node ||
      !finite(node.observedAtMs) ||
      node.observedAtMs < 0 ||
      !["ready", "unavailable", "error"].includes(String(node.state)) ||
      !Array.isArray(node.windows)
    ) {
      return absentLimits(agent, "error");
    }
    const windows = node.windows.flatMap((entry) => {
      const w = limitRecord(entry);
      const parsed = parseLimitWindow(
        w?.usedPercent,
        w?.durationMinutes,
        finite(w?.resetsAtMs) ? w.resetsAtMs / 1000 : null,
      );
      return parsed ? [parsed] : [];
    });
    return {
      agent,
      state: node.state as AgentLimitReading["state"],
      observedAtMs: node.observedAtMs,
      windows,
    };
  });
}

export function currentLimitWindows(
  reading: AgentLimitReading | undefined,
  nowMs: number,
): readonly LimitWindow[] {
  if (
    !reading ||
    reading.state !== "ready" ||
    reading.observedAtMs > nowMs ||
    nowMs - reading.observedAtMs > LIMIT_MAX_AGE_MS
  )
    return [];
  return reading.windows
    .filter((window) => window.resetsAtMs > nowMs)
    .sort((a, b) => a.durationMinutes - b.durationMinutes);
}

export function limitWindowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}
