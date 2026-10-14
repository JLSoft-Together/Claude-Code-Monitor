// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AgentLimitsSnapshot } from "../lib/agent-limits";
const mock = vi.hoisted(() => ({ available: true, read: vi.fn() }));
vi.mock("../host/agent-limits-host", () => ({
  get available() {
    return mock.available;
  },
  readAgentLimits: mock.read,
}));
const reading: AgentLimitsSnapshot = [
  { agent: "claude", state: "ready", observedAtMs: 10, windows: [] },
];
let cleanups: (() => void)[];
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mock.available = true;
  mock.read.mockReset().mockResolvedValue(reading);
  cleanups = [];
});
afterEach(() => {
  cleanups.forEach((stop) => stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("shares one read, interval and focus listener and makes disposal idempotent", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const store = await import("./agent-limits-store");
  cleanups = [store.observeAgentLimits(), store.observeAgentLimits()];
  await Promise.resolve();
  expect(mock.read).toHaveBeenCalledTimes(1);
  expect(add.mock.calls.filter(([name]) => name === "focus")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);
  cleanups[0]();
  cleanups[0]();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mock.read).toHaveBeenCalledTimes(2);
  cleanups[1]();
  expect(vi.getTimerCount()).toBe(0);
  expect(remove.mock.calls.filter(([name]) => name === "focus")).toHaveLength(1);
  window.dispatchEvent(new Event("focus"));
  expect(mock.read).toHaveBeenCalledTimes(2);
});
it("drops old replies after final unmount and reopen, retaining single-flight per generation", async () => {
  let resolveOld!: (value: AgentLimitsSnapshot) => void;
  mock.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const store = await import("./agent-limits-store");
  cleanups.push(store.observeAgentLimits());
  expect(store.agentLimitsLoading.value).toBe(true);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mock.read).toHaveBeenCalledTimes(1);
  cleanups[0]();
  cleanups.push(store.observeAgentLimits());
  await Promise.resolve();
  expect(store.agentLimits.value).toEqual(reading);
  resolveOld([]);
  await Promise.resolve();
  expect(store.agentLimits.value).toEqual(reading);
  expect(store.agentLimitsLoading.value).toBe(false);
});
it("clears an old allowance on refresh error and recovers on focus", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const store = await import("./agent-limits-store");
  cleanups.push(store.observeAgentLimits());
  await Promise.resolve();
  mock.read.mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(store.agentLimits.value).toEqual([]);
  expect(store.agentLimitsError.value).toBe(true);
  window.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  expect(store.agentLimitsError.value).toBe(false);
  expect(store.agentLimits.value).toEqual(reading);
});
it("does no work on unsupported hosts", async () => {
  mock.available = false;
  const store = await import("./agent-limits-store");
  cleanups.push(store.observeAgentLimits());
  expect(store.agentLimitsAvailable).toBe(false);
  expect(store.agentLimitsLoading.value).toBe(false);
  expect(mock.read).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
