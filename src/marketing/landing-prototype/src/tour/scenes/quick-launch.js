/**
 * ⌘T's Quick Launch page — the data the Launch chapter's ⌘T widget reads.
 *
 * In Deck 2.10 ⌘T opens a transient stage page, not a popover, on the focused
 * checkout (`src/launcher/agent-launch-page.tsx`, DL-32.6;
 * `docs/internals/agent-rail.md`, "One create row"). The widget draws its two
 * working parts and leaves the page's heading, Back and footer out:
 *
 * - the context row (`agent-launch-context.tsx`): the workspace picker, the
 *   checkout picker by branch, and a placement chip that is identity, not a
 *   control — `Split beside <agent>` when the focused pane belongs to the
 *   chosen checkout, else `New space` (`agent-launch-context-model.ts:87`);
 * - the cards (`agent-launch-cards.tsx`): logo, name and an arrow, pressing
 *   which splits; and, while the folder already has a tab, a `PlusCircle`
 *   button on the card's right edge that starts a `New space` instead, its
 *   tip reading `New space` (`NEW_SPACE_TIP`, :14; DL-32.6). The agent is the
 *   card's own name and nothing else: the page prints no command, so neither
 *   does the widget.
 *
 * The agents are the installed three (`catalog.js`) in registry order, then the
 * `Terminal` card the page always appends (`terminal` is passed,
 * `agent-launch-page.tsx:103`).
 */

import { INSTALLED } from "./catalog.js";

/** The checkout the focused Claude pane sits in (the rail widget's `main`). */
export const CONTEXT = { workspace: "spacevibe-deck", checkout: "main" };

/** The agent holding the focused pane, whose name the placement chip prints. */
const FOCUSED = INSTALLED[0];

export const CHIP = `Split beside ${FOCUSED.label}`;

/**
 * The card whose ⊕ the pointer rests on, raising the `New space` tip. The last
 * card, so the tip hangs into the page's own padding instead of covering the
 * ⊕ of a card beneath it, whether the grid runs two across or one.
 */
export const HOVERED_CARD = "terminal";

export const CARDS = [
  ...INSTALLED.map((agent) => ({ id: agent.id, label: agent.label, mark: agent.mark })),
  { id: "terminal", label: "Terminal", mark: null },
];
