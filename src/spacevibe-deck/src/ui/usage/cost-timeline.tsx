import type { AgentTotal } from "../../lib/usage-aggregate";
import { dotColor } from "../../lib/process-info";
import { formatUsd } from "../../lib/usage-pricing";
import { EM_DASH, formatTokens, USAGE_AGENT_LABEL, USAGE_AGENT_ORDER } from "./usage-format";
import type { UsageInterval, UsageTimeline } from "./usage-timeline";

const MIN_SCALE_USD = 0.01;
const MAX_VISIBLE_LABELS = 6;
const EXACT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});
export function timelineBoundary(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
function exactCost(agent: AgentTotal | undefined): string {
  if (!agent) return `${EM_DASH} No history`;
  if (agent.costUsd === null)
    return `${EM_DASH} Unpriced: ${agent.unpricedModels.join(", ")} (${formatTokens(agent.unpricedTokens)} tokens)`;
  const omitted =
    agent.unpricedTokens > 0
      ? ` · excludes ${formatTokens(agent.unpricedTokens)} tokens: ${agent.unpricedModels.join(", ")}`
      : "";
  return `${EXACT_USD.format(agent.costUsd)}${omitted}`;
}
function TimelineData({ intervals }: { readonly intervals: readonly UsageInterval[] }) {
  return (
    <details class="usage-overview__details">
      <summary>Chart data</summary>
      <div class="usage-overview__table-scroll" tabIndex={0} aria-label="Chart data table">
        <table>
          <caption>
            Estimated API cost in USD. Intervals include their start and exclude their end; the
            final interval includes the displayed end time.
          </caption>
          <thead>
            <tr>
              <th scope="col">Period (local time)</th>
              {USAGE_AGENT_ORDER.map((agent) => (
                <th scope="col" key={agent}>
                  {USAGE_AGENT_LABEL[agent]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {intervals.map((bin) => (
              <tr key={bin.startMs}>
                <th scope="row">
                  {timelineBoundary(bin.startMs)} – {timelineBoundary(bin.endMs)}
                </th>
                {USAGE_AGENT_ORDER.map((agent) => (
                  <td key={agent}>
                    {exactCost(bin.agents.find((entry) => entry.agent === agent))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Bounded, static stacks; exact data is reachable without color or hover (DL-16.6). */
export function CostTimeline({ timeline }: { readonly timeline: UsageTimeline }) {
  const { intervals, agents } = timeline;
  const labelStride = Math.ceil(intervals.length / MAX_VISIBLE_LABELS);
  const hasHistory = agents.length > 0;
  const hasPrice = agents.some((agent) => agent.costUsd !== null);
  const partial = hasPrice && agents.some((agent) => agent.unpricedModels.length > 0);
  const max = Math.max(MIN_SCALE_USD, ...intervals.map((bin) => bin.costUsd ?? 0));
  return (
    <section class="usage-timeline" aria-label="Cost over time">
      <h3>Cost over time</h3>
      <p class="usage-overview__note">{timeline.intervalLabel} · USD</p>
      {!hasHistory ? (
        <p class="usage-hero__empty">No recorded history in this period</p>
      ) : !hasPrice ? (
        <p class="usage-hero__empty">No priced data in this period</p>
      ) : (
        <div
          class="usage-timeline__plot"
          role="img"
          aria-label={`Estimated API cost across ${intervals.length} intervals. Exact values and missing data are in Chart data.`}
        >
          <div class="usage-timeline__scale">
            <span>{formatUsd(max)}</span>
            <span>{formatUsd(max / 2)}</span>
            <span>$0</span>
          </div>
          <div
            class="usage-timeline__columns"
            style={{ gridTemplateColumns: `repeat(${intervals.length}, minmax(0, 1fr))` }}
          >
            {intervals.map((bin, index) => (
              <div class="usage-timeline__column" key={bin.startMs}>
                <div class="usage-timeline__stack" data-state={bin.state}>
                  {USAGE_AGENT_ORDER.map((agent) => {
                    const cost = bin.agents.find((entry) => entry.agent === agent)?.costUsd;
                    return cost !== null && cost !== undefined && cost > 0 ? (
                      <span
                        key={agent}
                        style={{ height: `${(cost / max) * 100}%`, background: dotColor(agent) }}
                      />
                    ) : null;
                  })}
                  {(bin.state === "absent" || bin.state === "unpriced") && (
                    <span class="usage-timeline__missing">{EM_DASH}</span>
                  )}
                  {bin.state === "zero" && <span class="usage-timeline__zero">0</span>}
                </div>
                <span
                  class={`usage-timeline__label${index % labelStride !== 0 && index !== intervals.length - 1 ? " usage-timeline__label--hidden" : ""}${index % 2 ? " usage-timeline__label--alternate" : ""}`}
                >
                  {bin.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p class="usage-overview__note usage-timeline__boundaries">
        {timeline.startMs === null
          ? "No recorded boundaries"
          : `${timelineBoundary(timeline.startMs)} – ${timelineBoundary(timeline.endMs)}`}
      </p>
      <div class="usage-timeline__legend">
        {USAGE_AGENT_ORDER.map((agent) => (
          <span key={agent}>
            <i aria-hidden="true" style={{ background: dotColor(agent) }} />
            {USAGE_AGENT_LABEL[agent]}
          </span>
        ))}
      </div>
      {partial && <p class="usage-overview__note">Partial estimate · unpriced tokens excluded</p>}
      {intervals.some((bin) => bin.state === "absent" || bin.state === "unpriced") && (
        <p class="usage-overview__note">{EM_DASH} Missing or unpriced history · see Chart data</p>
      )}
      {intervals.length > 0 && <TimelineData intervals={intervals} />}
    </section>
  );
}
