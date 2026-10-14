import {
  currentLimitWindows,
  limitWindowLabel,
  type AgentLimitReading,
  type LimitWindow,
} from "../../lib/agent-limits";
import { AgentGlyph } from "../controls/agent-glyph";
import { EM_DASH, USAGE_AGENT_LABEL, USAGE_AGENT_ORDER } from "./usage-format";
import type { AgentLimitsView } from "./use-agent-limits";

export const LOW_ALLOWANCE_PERCENT = 15;
const FIVE_HOURS = 300;
const WEEK_MINUTES = 10080;
const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 1440;

function durationLabel(minutes: number): string {
  return minutes === FIVE_HOURS
    ? "5-hour"
    : minutes === WEEK_MINUTES
      ? "Weekly"
      : limitWindowLabel(minutes);
}

function resetLabel(resetsAtMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.ceil((resetsAtMs - nowMs) / MINUTE_MS));
  if (minutes >= DAY_MINUTES)
    return `${Math.floor(minutes / DAY_MINUTES)}d ${Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES)}h`;
  if (minutes >= HOUR_MINUTES)
    return `${Math.floor(minutes / HOUR_MINUTES)}h ${minutes % HOUR_MINUTES}m`;
  return `${minutes}m`;
}

function unknownReason(reading: AgentLimitReading | undefined, props: AgentLimitsView): string {
  if (!props.available) return "Limits unavailable on this host";
  if (props.loading) return "Reading limits…";
  if (props.error || reading?.state === "error") return "Could not refresh limits";
  if (reading?.observedAtMs && reading.observedAtMs > props.nowMs)
    return "Limit observation is in the future";
  if (reading?.windows.length) return "Limit data expired or unavailable";
  return "Limit unavailable";
}

function AllowanceCell({
  window,
  nowMs,
  reason,
}: {
  readonly window?: LimitWindow;
  readonly nowMs: number;
  readonly reason: string;
}) {
  if (!window)
    return (
      <td>
        <span class="usage-allowance__unknown">{EM_DASH}</span>
        <small>{reason}</small>
      </td>
    );
  const remaining = Math.floor(100 - window.usedPercent);
  return (
    <td class={remaining <= LOW_ALLOWANCE_PERCENT ? "usage-allowance__low" : ""}>
      <strong>{remaining}%</strong>
      {remaining <= LOW_ALLOWANCE_PERCENT && <span class="usage-allowance__warning">Low</span>}
      <small>Resets in {resetLabel(window.resetsAtMs, nowMs)}</small>
      <time dateTime={new Date(window.resetsAtMs).toISOString()}>
        {new Date(window.resetsAtMs).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </time>
    </td>
  );
}

/** Current allowance has no cost-period input (DL-16.1); zero is a real measurement. */
export function RemainingAllowance(props: AgentLimitsView) {
  const durations = [
    ...new Set(
      props.snapshot.flatMap((reading) => reading.windows.map((window) => window.durationMinutes)),
    ),
  ].sort((a, b) => a - b);
  const columns = durations.length ? durations : [null];
  return (
    <section class="usage-allowance" aria-label="Remaining allowance">
      <h3>Remaining allowance</h3>
      <p class="usage-overview__note">Current limits · independent of cost period</p>
      <div class="usage-overview__table-scroll" tabIndex={0} aria-label="Remaining allowance table">
        <table>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              {columns.map((duration) => (
                <th scope="col" key={duration ?? "unknown"}>
                  {duration === null ? "Allowance" : durationLabel(duration)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {USAGE_AGENT_ORDER.map((agent) => {
              const reading = props.snapshot.find((row) => row.agent === agent);
              const windows =
                props.available && !props.error ? currentLimitWindows(reading, props.nowMs) : [];
              return (
                <tr key={agent}>
                  <th scope="row">
                    <span class="usage-allowance__agent">
                      <AgentGlyph agent={agent} className="usage-allowance__logo" />
                      {USAGE_AGENT_LABEL[agent]}
                    </span>
                  </th>
                  {columns.map((duration) => (
                    <AllowanceCell
                      key={duration ?? "unknown"}
                      window={windows.find((window) => window.durationMinutes === duration)}
                      nowMs={props.nowMs}
                      reason={unknownReason(reading, props)}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
