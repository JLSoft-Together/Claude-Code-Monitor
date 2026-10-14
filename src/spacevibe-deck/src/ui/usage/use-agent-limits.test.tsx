// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentLimits } from "./use-agent-limits";
import { currentLimitWindows, LIMIT_MAX_AGE_MS } from "../../lib/agent-limits";
vi.mock("../../usage/agent-limits-store", async () => {
  const { signal } = await import("@preact/signals");
  return {
    agentLimits: signal([]),
    agentLimitsAvailable: true,
    agentLimitsLoading: signal(false),
    agentLimitsError: signal(false),
    observeAgentLimits: vi.fn(() => vi.fn()),
  };
});
const { agentLimits } = await import("../../usage/agent-limits-store");
const now = new Date(2026, 8, 14, 14).getTime();
let host: HTMLDivElement;
function Probe() {
  const state = useAgentLimits();
  return (
    <p>
      {state.nowMs}:{currentLimitWindows(state.snapshot[0], state.nowMs).length}
    </p>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  host = document.createElement("div");
});
afterEach(() => {
  act(() => render(null, host));
  agentLimits.value = [];
  vi.useRealTimers();
});
it.each([2000, LIMIT_MAX_AGE_MS + 1])(
  "expires at the exact boundary %s without a reply",
  async (boundary) => {
    agentLimits.value = [
      {
        agent: "claude",
        state: "ready",
        observedAtMs: now,
        windows: [
          {
            durationMinutes: 300,
            usedPercent: 32,
            resetsAtMs: boundary === 2000 ? now + boundary : now + 600_000,
          },
        ],
      },
    ];
    act(() => render(<Probe />, host));
    expect(host.textContent).toBe(`${now}:1`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(boundary);
    });
    expect(host.textContent).toBe(`${now + boundary}:0`);
    act(() => render(null, host));
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("ticks at minute boundaries while valid and does not animate", async () => {
  agentLimits.value = [
    {
      agent: "claude",
      state: "ready",
      observedAtMs: now,
      windows: [{ durationMinutes: 300, usedPercent: 32, resetsAtMs: now + 600_000 }],
    },
  ];
  act(() => render(<Probe />, host));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(host.textContent).toBe(`${now + 60_000}:1`);
});
it("does not show or schedule future observations", () => {
  agentLimits.value = [
    {
      agent: "claude",
      state: "ready",
      observedAtMs: now + 60_000,
      windows: [{ durationMinutes: 300, usedPercent: 32, resetsAtMs: now + 600_000 }],
    },
  ];
  act(() => render(<Probe />, host));
  expect(host.textContent).toBe(`${now}:0`);
  expect(vi.getTimerCount()).toBe(0);
});
