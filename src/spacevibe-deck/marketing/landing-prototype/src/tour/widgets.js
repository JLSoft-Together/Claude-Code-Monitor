/**
 * Feature widgets — each feature drawn as ONE glanceable fact instead of a
 * whole app window (owner, 2026-10-12: "too many app stages, it reads dense").
 *
 * The rule a widget is held to: no window chrome — no traffic lights, no
 * sidebar, no tab strip wrapped around it. A widget that needs chrome has
 * turned back into an app stage. Sizes are real px (widgets*.css), the app's
 * own values, and the colours are the 2.10 `deck-dark` palette the hero draws
 * with (appwin-tree.css): the scene CSS resolves `cqw` against `.a-appwin`,
 * which a widget does not have, so the one widget that borrows the hero's rail
 * rules sets `--u: 1px` instead.
 *
 * The DATA lives in `./scenes/`, imported rather than copied, so two widgets
 * cannot disagree about a command or a figure; where the app has a pure-data
 * module the scene imports it (`src/lib/`, `src/ui/usage/`), and each fact
 * that is still copied carries the `file:line` it came from.
 */

import { renderCluster } from "../../../stage/stage-tree.js";
import { renderPhosphor } from "../../../stage/stage-icons.js";
import { sceneAgentMark } from "./scenes/chrome.js";
import { RAIL_CLUSTERS } from "./scenes/rail.js";
import { CARDS, CHIP, CONTEXT, HOVERED_CARD } from "./scenes/quick-launch.js";
import { AVAILABLE, INSTALLED } from "./scenes/catalog.js";
import { LAST_SESSION_META, RESUME_LINES } from "./scenes/restore.js";
import {
  DOCK_TABS,
  EXPLORER_SWITCH,
  KEYS,
  PANE,
  TREE_ROWS,
} from "./scenes/surfaces.js";
import { AGENTS as USAGE_AGENTS, EYEBROW, FOOTNOTE, RANGES, TOTAL } from "./scenes/usage.js";

const ATTR_ESCAPES = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" };

const attr = (text) => String(text).replace(/[&"<>]/g, (char) => ATTR_ESCAPES[char]);

const mark = (id, size = 16) => sceneAgentMark(id, "w-mark", size);

const icon = (name, className = "", options = {}) =>
  `<span class="w-icon ${className}">${renderPhosphor(name, options)}</span>`;

/** Only this many Available rows are drawn; the header's count says how many exist. */
const AVAILABLE_SHOWN = 3;

/** Rail: the hero's tree rail — a project, its checkouts, a badge on every logo. */
function rail() {
  return `<div class="w w-rail">${RAIL_CLUSTERS.map(renderCluster).join("")}</div>`;
}

/** One Quick Launch card: the press that splits, and the ⊕ that starts a new space. */
function launchCard(card) {
  const logo =
    card.id === "terminal"
      ? icon("terminal", "w-card__logo")
      : sceneAgentMark(card.id, "w-card__logo", 20);
  // One ⊕ is hovered, and the app's own tip (`NewSpaceTip`) names it.
  const hovered = card.id === HOVERED_CARD;
  const tip = hovered ? '<span class="w-tip" role="tooltip">New space</span>' : "";

  return `
    <div class="w-card">
      <span class="w-card__main">${logo}<strong>${card.label}</strong>${icon("arrowRight")}</span>
      <span class="w-card__alt${hovered ? " is-hovered" : ""}" role="img" aria-label="New space">${icon("plusCircle")}${tip}</span>
    </div>
  `;
}

/** ⌘T: the Quick Launch page in miniature — where, then which agent. */
function quickLaunch() {
  const picker = (lead, label) =>
    `<span class="w-picker">${icon(lead)}${label}${icon("caretDown")}</span>`;

  return `
    <div class="w w-ql">
      <p class="w-ql__bar"><span>QUICK LAUNCH</span><kbd>⌘T</kbd></p>
      <div class="w-ql__context">
        ${picker("folder", CONTEXT.workspace)}
        ${picker("gitBranch", CONTEXT.checkout)}
        <span class="w-ql__chip">${icon("columns")}${CHIP}</span>
      </div>
      <div class="w-ql__grid">${CARDS.map(launchCard).join("")}</div>
    </div>
  `;
}

/** The command a row prints: the binary in full ink, its flags a step fainter. */
function command(row) {
  const flags = row.flags === "" ? "" : ` <span class="w-cat__flags">${row.flags}</span>`;

  return `<span class="w-cat__cmd"><span>${row.binary}</span>${flags}</span>`;
}

function catalogRow(row) {
  const get = row.offer === "none" ? "" : `<span class="w-btn">${row.offer === "get" ? "Get" : "Install"}</span>`;

  return `
    <div class="w-cat__row">
      ${mark(row.id, 15)}
      <span class="w-cat__text"><span class="w-cat__name">${row.label}</span>${command(row)}</span>
      ${get}
      <span class="w-switch">on</span>
    </div>
  `;
}

/** Catalog: Settings → Agents — what is installed, what is not, and each command. */
function catalog() {
  const head = (title, count) =>
    `<p class="w-cat__head"><span>${title}</span><span>${count}</span></p>`;

  return `
    <div class="w w-cat">
      ${head("Installed", `${INSTALLED.length} detected`)}
      ${INSTALLED.map(catalogRow).join("")}
      ${head("Available to install", `${AVAILABLE.length} agents`)}
      <div class="w-cat__more">${AVAILABLE.slice(0, AVAILABLE_SHOWN).map(catalogRow).join("")}</div>
    </div>
  `;
}

/** Restore: the start screen's Last session line, then what Reopen types in each pane. */
function restore() {
  const lines = RESUME_LINES.map(
    (line) => `
      <div class="w-resume__line">
        ${mark(line.agent, 14)}<span class="w-resume__cmd">${attr(line.command)}</span>
      </div>
    `,
  ).join("");

  return `
    <div class="w w-restore">
      <div class="w-last">
        ${icon("clockCounterClockwise")}
        <span class="w-last__text"><b>Last session</b><span>${LAST_SESSION_META}</span></span>
        <span class="w-btn w-btn--solid">Reopen</span>
        ${icon("x", "w-last__x")}
      </div>
      <div class="w-resume">${lines}</div>
    </div>
  `;
}

const TREE_GLYPH = {
  root: "caretDown",
  folder: "caretDown",
  closed: "caretRight",
  code: "fileCode",
};

function treeRow(row) {
  const lead =
    row.kind === "code"
      ? icon("fileCode", "w-tree__file")
      : `${icon(TREE_GLYPH[row.kind], "w-tree__caret")}${icon("folder", "w-tree__folder")}`;

  return `
    <div class="w-tree__row${row.kind === "root" ? " is-root" : ""}" style="--depth: ${row.depth}">
      ${lead}<span>${row.name}</span>
    </div>
  `;
}

/** Surfaces: terminals beside the docked side panel, and the keys that open it. */
function surfaces() {
  const tabs = DOCK_TABS.map(
    (tab) =>
      `<span class="w-dock__tab${tab.active ? " is-active" : ""}" role="img" aria-label="${attr(tab.label)}">${icon(tab.icon)}</span>`,
  ).join("");
  const lines = PANE.lines
    .map((line) => `<div class="w-pane__line is-${line.cls}">${attr(line.text)}</div>`)
    .join("");
  const keys = KEYS.map(([combo, label]) => `<span><kbd>${combo}</kbd>${label}</span>`).join("");
  const { files, changes, added, removed } = EXPLORER_SWITCH;

  return `
    <div class="w w-surfaces">
      <div class="w-stage">
        <article class="w-pane">
          <header>${mark(PANE.agent, 16)}<span>${PANE.header}</span></header>
          <div class="w-pane__body">${lines}</div>
        </article>
        <aside class="w-dock">
          <div class="w-dock__head">${tabs}${icon("sidebarSimple", "w-dock__hide", { mirrored: true })}</div>
          <div class="w-dock__switch"><span class="is-active">${files}</span><span>${changes} <small><i class="is-add">+${added}</i> <i class="is-del">−${removed}</i></small></span></div>
          <div class="w-tree">${TREE_ROWS.map(treeRow).join("")}</div>
        </aside>
      </div>
      <div class="w-keys">${keys}</div>
    </div>
  `;
}

/** Usage: Overview — the figure, who spent it (biggest first), and the range. */
function usage() {
  const agents = USAGE_AGENTS.map(
    (agent) => `
      <li class="w-usage__agent" data-agent="${agent.id}">
        <div class="w-usage__line">
          ${mark(agent.id, 18)}<span>${agent.label}</span><span>${agent.amount}</span>
        </div>
        <div class="w-usage__bar"><i style="--share: ${agent.share}%"></i></div>
        <p>${agent.sub}</p>
      </li>
    `,
  ).join("");
  const ranges = RANGES.map(
    (range) => `<span${range.active ? ' class="is-active"' : ""}>${range.label}</span>`,
  ).join("");

  return `
    <div class="w w-usage">
      <p class="w-usage__eyebrow">${EYEBROW}</p>
      <strong class="w-usage__total">${TOTAL}</strong>
      <p class="w-usage__foot">${FOOTNOTE}</p>
      <ul class="w-usage__agents">${agents}</ul>
      <div class="w-range">${ranges}</div>
    </div>
  `;
}

const WIDGETS = {
  panelRail: rail,
  panelWorktree: quickLaunch,
  panelCatalog: catalog,
  panelRestore: restore,
  panelSurfaces: surfaces,
  panelUsage: usage,
};

/**
 * One feature as a tile: its title, then its widget. The long panel body
 * rides in the tooltip — the owner prefers a tooltip to an explaining
 * sentence.
 *
 * @param {string} key a panel copy key, e.g. "panelRail"
 * @param {Record<string, string>} copy
 * @param {number} index position, for the reveal stagger
 */
export function renderWidgetTile(key, copy, index) {
  const widget = WIDGETS[key];

  if (!widget) {
    throw new Error(`No widget for feature "${key}".`);
  }

  return `
    <article
      class="wtile"
      data-widget="${key}"
      title="${attr(copy[`${key}Body`])}"
      data-reveal
      style="--reveal-delay: ${index * 70}ms"
    >
      <h3 data-copy="${key}Title">${copy[`${key}Title`]}</h3>
      ${widget()}
    </article>
  `;
}
