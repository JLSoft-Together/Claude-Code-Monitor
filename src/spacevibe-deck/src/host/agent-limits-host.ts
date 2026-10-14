import { invoke } from "./bridge";
import { parseLimitsSnapshot, type AgentLimitsSnapshot } from "../lib/agent-limits";

export const available = (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

/** Electron-only; subscription limits never reuse the frozen token-usage contract. */
export async function readAgentLimits(): Promise<AgentLimitsSnapshot> {
  if (!available) return [];
  return parseLimitsSnapshot(await invoke<unknown>("agent_limits_snapshot"));
}
