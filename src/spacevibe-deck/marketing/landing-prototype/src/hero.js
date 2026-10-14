import { STAGE_ARIA_LABEL } from "../../stage/brand.js";
import { renderTreePane, renderTreeRail, renderTreeStrip, totalNeeds } from "../../stage/stage-tree.js";
import {
  sessionPanes,
  sessionRail,
  sessionStrip,
  sessionUsage,
} from "../../stage/working-session.js";
import { mountAskedBeat, mountMotionGate } from "./hero-asked-beat.js";
import {
  mountInstallOrder,
  renderAgentRow,
  renderHeadline,
  renderInstallBlock,
} from "./hero-copy-column.js";
import { mountTopbarDownload, renderTopbar } from "./topbar.js";

/**
 * The hero (2026-10-10): the copy column on the dark ground, then the window
 * standing on a light of its own, with no painting behind it (owner,
 * 2026-10-12; the light is styles/hero.css, 2026-10-13). The owner kept that
 * order over a spread with the product beside the copy: whole and at one
 * scale, the window reads as the app, and a cut or magnified one read as a
 * broken layout.
 *
 * The window is Deck 2.10 in the middle of a working day (2026-10-12): the
 * tree rail across four projects, the focused space's three agents on the
 * stage, Claude mid-run in the pane you are in. The one loop on the page
 * happens in the rail, AWAY from that space: an agent in another checkout or
 * project asks, is answered and finishes, and the project's count and the
 * strip's needs-you chip follow it.
 */

/*
 * Every beat holds at most one working and one asked row (motion review,
 * 2026-10-10): the working one is the focused Claude row, which no beat
 * touches, so a beat only ever raises one question or settles it. Asked beats
 * dwell longer: that frame is the message.
 */
const BEATS = [
  { hold: 4200, rows: {} },
  {
    hold: 5600,
    rows: { "api-claude": { state: "asked", tail: "Apply the pending migration 0042?" } },
  },
  {
    hold: 4200,
    rows: { "api-claude": { state: "done", tail: "Migration 0042 applied · 3 tables" } },
  },
  {
    hold: 5600,
    rows: { "detach-codex": { state: "asked", tail: "Run the full e2e suite? About 4 min." } },
  },
  { hold: 4200, rows: { "detach-codex": { state: "done", tail: "e2e · 48 passed" } } },
  {
    hold: 5600,
    rows: { "detach-claude": { state: "asked", tail: "Open a PR for the detach fix?" } },
  },
  {
    hold: 4200,
    rows: { "detach-claude": { state: "done", tail: "Opened PR #412 · ready for review" } },
  },
];

/**
 * The beat a reader who asked for no motion is left on: the worktree's Codex
 * asking. A row of the focused project, so a phone, whose window shows the
 * top of the rail only, still sees the question.
 */
const STILL_BEAT = 3;

function renderPanes() {
  const [claude, codex, opencode] = sessionPanes;

  return `
    <div class="a-tree__panes">
      <div class="a-tree__col">
        ${renderTreePane(claude)}
        ${renderTreePane(codex)}
      </div>
      ${renderTreePane(opencode)}
    </div>
  `;
}

export function renderHero(copy) {
  const strip = { ...sessionStrip, needs: totalNeeds(sessionRail) };

  return {
    markup: `
      <section class="direction-a hero">
        <div class="a-main">
          ${renderTopbar(copy)}

          <div class="hero-copy">
            ${renderHeadline(copy)}
            ${renderInstallBlock(copy)}
            ${renderAgentRow(copy)}
          </div>

          <div class="hero-stage">
            <div class="hero-desk">
              <figure class="a-appwin a-appwin--tree hero-window" role="img" aria-label="${STAGE_ARIA_LABEL}">
                <div class="a-appwin__body">
                  ${renderTreeRail(sessionRail, sessionUsage)}
                  <div class="a-appwin__stage a-tree__stage">
                    ${renderTreeStrip(strip)}
                    ${renderPanes()}
                  </div>
                </div>
              </figure>
            </div>
          </div>
        </div>
      </section>
    `,
    mount(root) {
      const section = root.querySelector(".hero");

      if (!section) {
        throw new Error("Hero root is missing.");
      }

      mountInstallOrder(section);
      mountTopbarDownload(section);

      // The panes hold their frame; the rail is the one thing that moves.
      const beat = mountAskedBeat(section.querySelector(".hero-window"), BEATS, {
        stillBeat: STILL_BEAT,
      });
      const disposeGate = mountMotionGate(section, {
        watch: section.querySelector(".hero-desk"),
        onPlay: beat.play,
        onPause: beat.pause,
      });

      return () => {
        disposeGate();
        beat.dispose();
      };
    },
  };
}
