import { batch, signal } from "@preact/signals";
import { available, readAgentLimits } from "../host/agent-limits-host";
import type { AgentLimitsSnapshot } from "../lib/agent-limits";

const LOCAL_REFRESH_MS = 15_000;
export const agentLimits = signal<AgentLimitsSnapshot>([]);
export const agentLimitsLoading = signal(false);
export const agentLimitsError = signal(false);
export const agentLimitsAvailable = available;
let observers = 0;
let stop: (() => void) | null = null;

/** One loop per mounted renderer generation; old replies cannot reach a reopened surface. */
function startObservation(): () => void {
  let disposed = false;
  let pending = false;
  const refresh = async () => {
    if (pending || disposed) return;
    pending = true;
    if (!agentLimits.value.length) agentLimitsLoading.value = true;
    try {
      const snapshot = await readAgentLimits();
      if (!disposed)
        batch(() => {
          agentLimits.value = snapshot;
          agentLimitsError.value = false;
        });
    } catch (error) {
      if (!disposed) {
        console.warn("Deck: could not read agent limits", error);
        batch(() => {
          agentLimits.value = [];
          agentLimitsError.value = true;
        });
      }
    } finally {
      pending = false;
      if (!disposed) agentLimitsLoading.value = false;
    }
  };
  const focus = () => {
    void refresh();
  };
  const timer = setInterval(focus, LOCAL_REFRESH_MS);
  window.addEventListener("focus", focus);
  focus();
  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("focus", focus);
    agentLimitsLoading.value = false;
  };
}

/** Sidebar and Overview share the first read, cadence and focus listener (DL-16.1). */
export function observeAgentLimits(): () => void {
  if (!available) return () => undefined;
  observers += 1;
  if (observers === 1) stop = startObservation();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    observers -= 1;
    if (observers === 0) {
      stop?.();
      stop = null;
    }
  };
}
