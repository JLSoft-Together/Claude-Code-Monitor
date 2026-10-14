// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CostTimeline } from "./cost-timeline";
import { buildUsageTimeline } from "./usage-timeline";
import { EMPTY_COUNTERS, type UsageBucket } from "../../lib/usage-snapshot";
const now = new Date(2026, 8, 14, 14).getTime();
const bucket = (model = "gpt-5", inputUncached = 1_000_000): UsageBucket => ({
  bucketStartMs: now,
  agent: "claude",
  model,
  counters: { ...EMPTY_COUNTERS, inputUncached },
});
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
});
afterEach(() => act(() => render(null, host)));
const mount = (buckets: readonly UsageBucket[]) =>
  act(() => render(<CostTimeline timeline={buildUsageTimeline(buckets, "today", now)} />, host));
it("shows a shared scale, interval unit, legend and exact cost disclosure", () => {
  mount([bucket()]);
  expect(host.querySelector(".usage-timeline__scale")?.textContent).toContain("$1.25");
  expect(host.textContent).toContain("4-hour local intervals · USD");
  expect(host.querySelector(".usage-timeline__legend")?.textContent).toBe("Claude CodeCodex");
  expect(host.querySelector("summary")?.textContent).toBe("Chart data");
  expect(host.querySelector("tbody")?.textContent).toContain("$1.25");
  expect(host.querySelector("tbody")?.textContent).toContain("No history");
  expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("Exact values");
});
it("does not draw fabricated amounts for absent or wholly unpriced history", () => {
  mount([]);
  expect(host.textContent).toContain("No recorded history");
  expect(host.querySelector('[role="img"]')).toBeNull();
  mount([bucket("unknown")]);
  expect(host.textContent).toContain("No priced data");
  expect(host.querySelector('[role="img"]')).toBeNull();
  expect(host.textContent).toContain("Unpriced: unknown (1,000,000 tokens)");
});
it("keeps measured zero and small prices without invalid heights", () => {
  mount([bucket("unknown", 0)]);
  expect(host.querySelector('[data-state="zero"]')).not.toBeNull();
  expect(host.textContent).toContain("$0.00");
  expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  mount([bucket("gpt-5", 1)]);
  expect(host.querySelector("tbody")?.textContent).toContain("$0.00000125");
});
it("discloses the omitted models next to a partial chart and in exact data", () => {
  mount([bucket(), bucket("unknown")]);
  expect(host.textContent).toContain("Partial estimate");
  expect(host.querySelector("tbody")?.textContent).toContain("excludes 1,000,000 tokens: unknown");
});
