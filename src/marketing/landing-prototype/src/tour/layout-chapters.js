/**
 * The feature chapters (owner, 2026-10-12) — the features grouped under three
 * verbs, each chapter a band of its own ground, edge to edge, holding a small
 * grid of widgets (widgets.js).
 *
 * The grounds alternate value so no two neighbouring sections share one:
 * the dark demo loop, then Watch on ivory paper, Launch on a gold-lit black,
 * Keep on a painting, then the dark finale. That replaced two page patterns —
 * "one dark value from top to bottom" and "one picture at full strength per
 * page" (Keep stands on a plate) — and the seven stacked panels, each with its
 * own app-window mock: the hero keeps the page's only app window.
 */

import { renderStatBand } from "./stat-band.js";
import { renderWidgetTile } from "./widgets.js";

/** The first feature of a two-feature row takes the wider column. */
/*
 * No Board: the Agent Board was retired on 2026-09-28, and Mission Control,
 * which took its chord, is slated for removal (owner, 2026-10-12), so neither
 * is advertised. Usage moved to Watch — what the agents cost is part
 * of keeping an eye on them.
 */
const CHAPTERS = [
  { key: "chapterWatch", tone: "paper", rows: [["panelRail", "panelUsage"]] },
  {
    key: "chapterLaunch",
    tone: "gold",
    numbers: true,
    rows: [["panelWorktree", "panelCatalog"]],
  },
  { key: "chapterKeep", tone: "plate", rows: [["panelRestore", "panelSurfaces"]] },
];

const pad = (n) => String(n).padStart(2, "0");

/**
 * @param {Record<string, string>} copy
 * @param {{ featuresId: string }} parts
 */
export function renderChapters(copy, { featuresId }) {
  let running = 0;

  return CHAPTERS.map((chapter, index) => {
    const rows = chapter.rows
      .map(
        (row) => `
          <div class="chapter__row" data-count="${row.length}">
            ${row.map((key) => renderWidgetTile(key, copy, running++)).join("")}
          </div>
        `,
      )
      .join("");

    return `
      <section
        class="chapter"
        data-tone="${chapter.tone}"${index === 0 ? ` id="${featuresId}"` : ""}
      >
        <header class="chapter__head">
          <h2 class="chapter__word" data-reveal data-copy="${chapter.key}">${copy[chapter.key]}</h2>
          <span class="chapter__index" data-reveal style="--reveal-delay: 120ms"
            >${pad(index + 1)} / ${pad(CHAPTERS.length)}</span
          >
        </header>
        ${chapter.numbers ? renderStatBand(copy) : ""}
        <div class="chapter__grid">${rows}</div>
      </section>
    `;
  }).join("");
}
