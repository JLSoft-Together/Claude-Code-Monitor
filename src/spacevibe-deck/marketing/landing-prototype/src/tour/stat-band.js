/**
 * The stat band: three numbers, set huge — the Chapters layout's Launch
 * chapter opens on it.
 *
 * Every figure is read, not written: the agent count is the app's own registry
 * (`AGENT_MARKS`), and the download total is the same GitHub request the hero
 * already makes — `upgradeReleaseLinks` fills every `[data-download-proof]`
 * on the page, this one included.
 */

import { AGENT_MARKS, renderAgentMark } from "../agent-strip.js";

/** @param {Record<string, string>} copy */
export function renderStatBand(copy) {
  const marks = AGENT_MARKS.map((agent) => renderAgentMark(agent, "stat-band__mark", 18)).join("");

  return `
    <section class="stat-band" aria-label="${copy.statBandLabel}">
      <div class="stat-band__inner">
        <div class="stat-band__cell" data-reveal style="--reveal-delay: 0ms">
          <strong class="stat-band__num">${AGENT_MARKS.length}</strong>
          <span class="stat-band__unit" data-copy="statAgentsUnit">${copy.statAgentsUnit}</span>
          <span class="stat-band__marks" aria-hidden="true">${marks}</span>
        </div>
        <div
          class="stat-band__cell"
          data-reveal
          data-download-proof
          data-download-state="loading"
          aria-live="polite"
          style="--reveal-delay: 90ms"
        >
          <strong class="stat-band__num" data-download-count>—</strong>
          <span class="stat-band__unit" data-copy="downloadCountUnit">${copy.downloadCountUnit}</span>
        </div>
        <div class="stat-band__cell" data-reveal style="--reveal-delay: 180ms">
          <strong class="stat-band__num">$0</strong>
          <span class="stat-band__unit" data-copy="statFreeUnit">${copy.statFreeUnit}</span>
        </div>
      </div>
    </section>
  `;
}
