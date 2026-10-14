// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RemainingAllowance } from "./remaining-allowance";
import { LIMIT_MAX_AGE_MS } from "../../lib/agent-limits";
import type { AgentLimitsView } from "./use-agent-limits";
const now = 1_800_000_000_000;
let host: HTMLDivElement;
const fixture = (patch: Partial<AgentLimitsView> = {}): AgentLimitsView => ({
  snapshot: [
    {
      agent: "claude",
      state: "ready",
      observedAtMs: now,
      windows: [
        { durationMinutes: 300, usedPercent: 32, resetsAtMs: now + 600_000 },
        { durationMinutes: 10080, usedPercent: 58, resetsAtMs: now + 6_000_000 },
      ],
    },
  ],
  nowMs: now,
  available: true,
  loading: false,
  error: false,
  ...patch,
});
beforeEach(() => {
  host = document.createElement("div");
});
afterEach(() => act(() => render(null, host)));
const mount = (props = fixture()) => act(() => render(<RemainingAllowance {...props} />, host));
it("shows true remaining amounts, returned windows, visible resets and associated headers", () => {
  mount();
  expect(host.textContent).toContain("68%");
  expect(host.textContent).toContain("42%");
  expect([...host.querySelectorAll('th[scope="col"]')].map((node) => node.textContent)).toEqual([
    "Agent",
    "5-hour",
    "Weekly",
  ]);
  expect(host.querySelectorAll('th[scope="row"]')).toHaveLength(2);
  expect(host.querySelectorAll("time")).toHaveLength(2);
  expect(host.textContent).toContain("Resets in 10m");
  expect(host.textContent).toContain("Limit unavailable");
});
it.each([
  [100, "0%"],
  [0, "100%"],
  [31.1, "68%"],
])("rounds used %s consistently", (usedPercent, expected) => {
  const props = fixture();
  mount({
    ...props,
    snapshot: props.snapshot.map((row) => ({
      ...row,
      windows: row.windows.map((window) => ({ ...window, usedPercent: Number(usedPercent) })),
    })),
  });
  expect(host.querySelector("strong")?.textContent).toBe(expected);
});
it("retains another valid window after a reset and labels nonstandard durations honestly", () => {
  const props = fixture();
  mount({
    ...props,
    snapshot: props.snapshot.map((row) => ({
      ...row,
      windows: [
        { ...row.windows[0], resetsAtMs: now },
        { ...row.windows[1], durationMinutes: 1440 },
      ],
    })),
  });
  expect(host.textContent).not.toContain("68%");
  expect(host.textContent).toContain("42%");
  expect(host.textContent).toContain("1d");
  expect(host.textContent).not.toContain("Weekly");
});
it.each([
  [{ loading: true, snapshot: [] }, "Reading limits"],
  [{ error: true }, "Could not refresh limits"],
  [{ available: false }, "Limits unavailable on this host"],
  [{ nowMs: now + LIMIT_MAX_AGE_MS + 1 }, "expired"],
  [{ nowMs: now - 1 }, "future"],
] as const)("distinguishes unavailable state %j", (patch, expected) => {
  mount(fixture(patch));
  expect(host.textContent).toContain(expected);
  expect(host.querySelector("strong")).toBeNull();
});
