import { useEffect, useState } from "preact/hooks";
import {
  currentLimitWindows,
  LIMIT_MAX_AGE_MS,
  type AgentLimitsSnapshot,
} from "../../lib/agent-limits";
import {
  agentLimits,
  agentLimitsAvailable,
  agentLimitsError,
  agentLimitsLoading,
  observeAgentLimits,
} from "../../usage/agent-limits-store";

const MINUTE_MS = 60_000;
export interface AgentLimitsView {
  readonly snapshot: AgentLimitsSnapshot;
  readonly nowMs: number;
  readonly available: boolean;
  readonly loading: boolean;
  readonly error: boolean;
}

/** One bounded timeout per mounted view for minute labels and exact reset/TTL boundaries. */
export function useAgentLimits(): AgentLimitsView {
  const [clock, setClock] = useState(Date.now());
  const snapshot = agentLimits.value;
  const nowMs = Math.max(clock, Date.now());
  useEffect(() => observeAgentLimits(), []);
  useEffect(() => {
    const now = Date.now();
    const active = snapshot.filter((row) => currentLimitWindows(row, now).length > 0);
    if (!active.length) return;
    const boundaries = active
      .flatMap((row) => [
        row.observedAtMs + LIMIT_MAX_AGE_MS + 1,
        ...row.windows.map((window) => window.resetsAtMs),
      ])
      .filter((at) => at > now);
    const nextMinute = now + MINUTE_MS - (now % MINUTE_MS);
    const timer = setTimeout(() => setClock(Date.now()), Math.min(nextMinute, ...boundaries) - now);
    return () => clearTimeout(timer);
  }, [snapshot, clock]);
  return {
    snapshot,
    nowMs,
    available: agentLimitsAvailable,
    loading: agentLimitsLoading.value,
    error: agentLimitsError.value,
  };
}
