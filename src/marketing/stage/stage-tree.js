/**
 * The 2.10 window chrome, drawn: the rail as a tree of project → checkout →
 * session row (`src/ui/worktree-card.tsx`, docs/internals/agent-rail.md), the
 * create row and tools foot around it, the stage strip's breadcrumb and its
 * trailing chips, and panes as rounded cards with an agent header.
 *
 * It sits BESIDE `appwin.js` rather than replacing its renderers: the video
 * still draws the July window through them, until its own pass. Every renderer
 * here is a pure function of its argument; the styles are `appwin-tree.css`.
 * `renderCluster` is exported for the Watch chapter's rail widget, which draws
 * clusters of the same rail at one pixel per app pixel.
 *
 * Hooks the hero's beat writes through, same contract as the card rail:
 * `data-dot` on a row's state badge, `data-tail` on the sentence span alone
 * (the `Agent · ` prefix stays put), `data-need-*` on every count that has to
 * agree with the rows.
 */

import { BRAND_ICON_SRC, renderStageAgentMark } from "./appwin.js";
import { BRAND } from "./brand.js";
import { renderPhosphor } from "./stage-icons.js";

/** The app's working spinner (f1fa8fb1): ten braille frames, one `<i>` each. */
const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BRAILLE = BRAILLE_FRAMES.map((frame) => `<i>${frame}</i>`).join("");

/** `displayAgent` (`agent-rail-card-model.ts`): the label a row's second line opens with. */
const AGENT_LABEL = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini",
  agy: "Antigravity",
};

/** `stateWord`: what the second line says before the agent has said anything. */
const STATE_WORD = {
  working: "Working",
  asked: "Needs you",
  failed: "Failed",
  done: "Finished",
  idle: "Ready",
};

const NEEDS_YOU = new Set(["asked", "failed"]);

export function agentLabel(agent) {
  return AGENT_LABEL[agent] ?? agent;
}

/** `data-attr="value"`, or nothing for a row no beat repaints. */
function hook(name, value) {
  return value ? ` ${name}="${value}"` : "";
}

/* ------------------------------------------------------------ the column */

/**
 * The frame row: the lights' reservation, the sidebar toggle, the drag
 * spacer, then the brand (`SidebarFrameActions`). The version label is left
 * off: a number baked into a marketing page is wrong by the next release.
 */
function renderFrameRow() {
  return `
      <div class="a-tree__frame">
        <span class="a-appwin__lights"><i></i><i></i><i></i></span>
        <span class="a-tree__iconbtn">${renderPhosphor("sidebarSimple")}</span>
        <span class="a-tree__spacer"></span>
        <span class="a-tree__brand"><img src="${BRAND_ICON_SRC}" alt="" /><span>${BRAND.name}</span></span>
      </div>
    `;
}

/** `rail-create.tsx`: Worktree and Folder quiet, Agent the filled one on the right. */
function renderCreateRow() {
  const make = (icon, label, primary = false) =>
    `<span class="a-tree__make${primary ? " a-tree__make--primary" : ""}">${renderPhosphor(icon)}<span>${label}</span></span>`;

  return `
      <div class="a-tree__create">
        ${make("gitFork", "Worktree")}
        ${make("folderPlus", "Folder")}
        ${make("plus", "Agent", true)}
      </div>
    `;
}

/**
 * One session row: the logo with its state badge on the corner, then the
 * task label over `Agent · sentence`. The badge holds the braille frames in
 * every state; CSS shows them only while `data-state` is `working`, so a beat
 * repaints a row by writing one attribute.
 *
 * @param {{ id?: string, agent: string, label?: string, sentence?: string,
 *           state: string, focused?: boolean }} row
 */
function renderRow(row) {
  const name = agentLabel(row.agent);
  const sentence = row.sentence ?? STATE_WORD[row.state];

  return `
          <div class="a-tree__row"${row.focused ? ' data-focused="true"' : ""}>
            <span class="a-tree__glyph">
              ${renderStageAgentMark(row.agent, "a-tree__logo")}
              <span class="a-tree__dot" data-state="${row.state}"${hook("data-dot", row.id)}>${BRAILLE}</span>
            </span>
            <span class="a-tree__text">
              <span class="a-tree__name">${row.label ?? name}</span>
              <span class="a-tree__sentence">${name} · <span${hook("data-tail", row.id)}>${sentence}</span></span>
            </span>
          </div>
        `;
}

/** A checkout's label line — branch glyph, branch, `worktree` tag — then its rows. */
function renderCheckout(checkout) {
  const tag = checkout.worktree ? '<span class="a-tree__tag">worktree</span>' : "";

  return `
        <div class="a-tree__checkout">
          <div class="a-tree__line">
            <span class="a-tree__branch">${renderPhosphor("gitBranch")}</span>
            <span class="a-tree__checkoutname">${checkout.name}</span>
            ${tag}
          </div>
          ${checkout.rows.map(renderRow).join("")}
        </div>
      `;
}

/** Rows that need you: `asked` and `failed`, the header's own count (DL-27.27). */
function needsOf(cluster) {
  const live = (cluster.checkouts ?? [])
    .flatMap((checkout) => checkout.rows)
    .filter((row) => NEEDS_YOU.has(row.state)).length;

  return (cluster.needs ?? 0) + live;
}

/** The total the strip's needs-you chip counts, over every project. */
export function totalNeeds(rail) {
  return rail.reduce((sum, cluster) => sum + needsOf(cluster), 0);
}

/**
 * One project. A collapsed cluster draws its header alone; its caret shows at
 * rest only when there is no count to show in its place (`04a-agent-rail.css`).
 * `needs` is the count of rows a collapsed cluster hides, which the beat adds
 * to whatever its visible rows say (`data-need-base`).
 *
 * @param {{ project: string, collapsed?: boolean, needs?: number,
 *           checkouts?: Array<{ name: string, worktree?: boolean, rows: object[] }> }} cluster
 */
export function renderCluster(cluster) {
  const collapsed = cluster.collapsed === true;
  const needs = needsOf(cluster);
  const caret = collapsed ? `<span class="a-tree__caret">${renderPhosphor("caretRight")}</span>` : "";
  const body = collapsed ? "" : (cluster.checkouts ?? []).map(renderCheckout).join("");

  return `
      <section class="a-tree__cluster" data-collapsed="${collapsed}" data-need-scope data-need-base="${cluster.needs ?? 0}">
        <div class="a-tree__head">
          <span class="a-tree__folder">${renderPhosphor("folder")}</span>
          <span class="a-tree__project">${cluster.project}</span>
          <span class="a-tree__count" data-need-count${needs === 0 ? " hidden" : ""}>${needs} need you</span>
          ${caret}
        </div>
        ${body}
      </section>
    `;
}

/** The foot: the tools row (`sidebar-actions.tsx`, in its order), then the usage line. */
function renderFoot(usage) {
  const tools = ["clockCounterClockwise", "gauge", "treeView", "chatText", "globe", "gear"]
    .map((icon) => `<span class="a-tree__tool">${renderPhosphor(icon)}</span>`)
    .join("");
  const limits = usage
    .map((entry) => `<span>${entry.agent} <b>${entry.percent}%</b> · ${entry.window}</span>`)
    .join("");

  return `
      <div class="a-tree__tools">${tools}</div>
      <div class="a-tree__usage">${limits}</div>
    `;
}

/**
 * The whole column. `.a-appwin__sidebar` stays the outer class: the shell's
 * seam (`.a-appwin__sidebar + *`) and the narrow-width rules key off it.
 *
 * @param {object[]} rail clusters, see {@link renderCluster}
 * @param {Array<{ agent: string, percent: number, window: string }>} usage
 */
export function renderTreeRail(rail, usage) {
  return `
    <aside class="a-appwin__sidebar a-tree">
      ${renderFrameRow()}
      ${renderCreateRow()}
      <div class="a-tree__list">
        ${rail.map(renderCluster).join("")}
      </div>
      ${renderFoot(usage)}
    </aside>
  `;
}

/* ------------------------------------------------------------- the stage */

/**
 * The stage strip in sidebar mode: the focused pane's breadcrumb with no mark
 * row (`hideMarks`, owner 2026-10-09), then the needs-you chip, the Dev
 * servers chip, More, and the closed dock's toggle (`app.tsx`, in that order).
 *
 * @param {{ crumbs: string[], session: string, needs: number, servers: number }} strip
 */
export function renderTreeStrip(strip) {
  const sep = `<span class="a-tree__sep">${renderPhosphor("caretRight")}</span>`;
  const parts = strip.crumbs.map((part) => `<span class="a-tree__part">${part}</span>${sep}`).join("");

  return `
      <div class="a-tree__strip">
        <span class="a-tree__crumbs">${parts}<span class="a-tree__part a-tree__part--session">${strip.session}</span></span>
        <span class="a-tree__chip a-tree__chip--needs" data-need-total${strip.needs === 0 ? " hidden" : ""}><i class="a-tree__chipdot"></i><span data-need-total-count>${strip.needs}</span></span>
        <span class="a-tree__chip">${renderPhosphor("hardDrives")}<span>${strip.servers}</span><i class="a-tree__chipdot a-tree__chipdot--live"></i></span>
        <span class="a-tree__iconbtn">${renderPhosphor("dotsThreeOutline")}</span>
        <span class="a-tree__iconbtn">${renderPhosphor("sidebarSimple", { mirrored: true })}</span>
      </div>
    `;
}

/**
 * A static transcript frame: `history` first, then the pane's steps applied
 * in order up to `until`, the way the stream engine would leave them. A
 * `think` step still showing at the cut is the spinner line; `maxLines` trims
 * from the top.
 *
 * @param {{ steps: object[], maxLines: number }} pane
 * @param {number} [until] steps to apply
 * @param {Array<{ text: string, cls?: string }>} [history] lines printed earlier
 * @param {number} [maxLines] the pane's own cap unless a taller card asks for more
 */
export function transcriptFrame(
  pane,
  until = pane.steps.length,
  history = [],
  maxLines = pane.maxLines,
) {
  const lines = [...history];
  let spinner = null;

  for (const step of pane.steps.slice(0, until)) {
    if (step.kind === "line") {
      lines.push({ text: step.text ?? "", cls: step.cls });
      spinner = null;
    } else if (step.kind === "chunk" && lines.length > 0) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = { ...last, text: last.text + (step.text ?? "") };
    } else if (step.kind === "think") {
      spinner = step.text ?? "";
    }
  }

  return { lines: lines.slice(-maxLines), spinner };
}

function renderLine(line) {
  return `<div class="a-appwin__line${line.cls ? ` ${line.cls}` : ""}">${line.text}</div>`;
}

/**
 * One pane card: the agent header (logo and the rail's sentence,
 * `pane-agent-header.tsx`), then the terminal. `focused` traces the card's
 * edge in the inverted-row ink; the app does that only while the space holds
 * more than one pane, which every space on this stage does.
 *
 * @param {{ pane: { id: string, prompt: string, footer: object[], steps: object[], maxLines: number },
 *           agent: string, tailId?: string, header: string, focused?: boolean, until?: number,
 *           history?: Array<{ text: string, cls?: string }>, maxLines?: number }} card
 */
export function renderTreePane(card) {
  const { lines, spinner } = transcriptFrame(card.pane, card.until, card.history, card.maxLines);
  const footer = card.pane.footer
    .map((line) => `<span class="a-appwin__footline${line.cls ? ` ${line.cls}` : ""}">${line.text}</span>`)
    .join("");
  const thinking = spinner === null ? "" : `<div class="a-appwin__spinner">${spinner}</div>`;

  return `
        <article class="a-tree__pane${card.focused ? " is-focused" : ""}" data-pane="${card.pane.id}">
          <header class="a-tree__panehead">
            ${renderStageAgentMark(card.agent, "a-tree__panelogo")}
            <span class="a-tree__panemsg"${hook("data-tail", card.tailId)}>${card.header}</span>
          </header>
          <div class="a-tree__term">
            <div class="a-appwin__transcript">
              <div class="a-appwin__lines">${lines.map(renderLine).join("")}</div>
              ${thinking}
            </div>
            <div class="a-appwin__panefoot">
              <div class="a-appwin__promptbox">
                <span class="a-appwin__promptglyph">${card.pane.prompt}</span>
                <i class="a-appwin__cursor"></i>
              </div>
              ${footer}
            </div>
          </div>
        </article>
      `;
}
