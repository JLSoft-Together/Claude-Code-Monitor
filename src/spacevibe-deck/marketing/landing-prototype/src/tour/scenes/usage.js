/**
 * The token usage dashboard — the data the Watch chapter's usage widget reads.
 *
 * The widget draws OVERVIEW, the dashboard's first view
 * (`src/ui/usage/sections/overview-section.tsx`, `OverviewContent`), in the
 * order the app lays it out: the eyebrow, the figure, its footnote, one block
 * per agent (logo, name, amount, a share bar, then `n% of cost · n tokens`),
 * and the range selector under them. The allowance and the cost timeline that
 * follow in the app are left out.
 *
 * What the app does NOT do any more is worth keeping out of the drawing: the
 * figure carries no asterisk — `formatUsd(total)` is printed bare — and the
 * footnote under it is `API equivalent, not your subscription bill`
 * (`overview-section.tsx:212`). The old `* if billed at full API rate` line is
 * gone.
 *
 * Rows are sorted by cost, descending (`compareBlocks`, :90), so the agent
 * that spent more comes first: Codex above Claude Code here, whatever order
 * the scanner reads them in. Names are `USAGE_AGENT_LABEL`
 * (`src/ui/usage/usage-format.ts:41`), the figures `formatUsd`
 * (`src/lib/usage-pricing.ts:113`) and `formatTokensCompact`
 * (`usage-format.ts:98`), imported rather than re-spelled.
 *
 * The figures are internally consistent by construction: the total is the sum
 * of the two costs, and the shares are each cost over that total, to one
 * decimal — 58.8 + 41.2 = 100.0, which is what `largestRemainderShares`
 * (:67) guarantees on real data. A reader who adds the column up is entitled
 * to get the number at the top.
 *
 * `share` is a datum rather than a style, so it rides the markup as `--share`,
 * the way the app sets the fill's width inline. The colour is the stylesheet's,
 * keyed off `data-agent`: the app's own mapping is `dotColor(agent)`
 * (`src/lib/process-info.ts:43`) — claude is the theme magenta, codex the
 * theme green.
 */

import { formatUsd } from "../../../../../src/lib/usage-pricing.ts";
import { USAGE_RANGES, DEFAULT_USAGE_RANGE } from "../../../../../src/ui/usage/usage-ranges.ts";
import { formatTokensCompact, USAGE_AGENT_LABEL } from "../../../../../src/ui/usage/usage-format.ts";

/** The four range labels in the app's order, and the one a resting tab shows (`all`). */
export const RANGES = USAGE_RANGES.map((range) => ({
  label: range.label,
  active: range.id === DEFAULT_USAGE_RANGE,
}));

/** The hero's eyebrow, `overview-section.tsx:208`. */
export const EYEBROW = "Estimated API cost";
/** The footnote under the figure, `overview-section.tsx:212`. */
export const FOOTNOTE = "API equivalent, not your subscription bill";

const SPEND = [
  { id: "claude", costUsd: 5509.67, tokens: 1.2e9 },
  { id: "codex", costUsd: 7863.31, tokens: 2.4e9 },
];

const TOTAL_USD = SPEND.reduce((sum, entry) => sum + entry.costUsd, 0);

export const TOTAL = formatUsd(TOTAL_USD);

/** Cost descending, as `compareBlocks` orders the app's own rows. */
export const AGENTS = [...SPEND]
  .sort((left, right) => right.costUsd - left.costUsd)
  .map((entry) => {
    const share = ((entry.costUsd / TOTAL_USD) * 100).toFixed(1);

    return {
      id: entry.id,
      label: USAGE_AGENT_LABEL[entry.id],
      amount: formatUsd(entry.costUsd),
      share,
      sub: `${share}% of cost · ${formatTokensCompact(entry.tokens)} tokens`,
    };
  });
