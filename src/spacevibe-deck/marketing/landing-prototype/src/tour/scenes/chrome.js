/**
 * The one scene helper the chapters' widgets still reach: an agent mark by id.
 *
 * The scene fixtures carry agent IDS (`"claude"`), while `renderAgentMark`
 * takes the catalog ENTRY — so the lookup has to happen somewhere, and one
 * copy here beats one copy in each widget that draws a mark. An id the catalog
 * does not know falls back to a synthetic markless entry rather than throwing.
 */

import { AGENT_MARKS, renderAgentMark } from "../../agent-strip.js";

const MARK_BY_ID = Object.fromEntries(AGENT_MARKS.map((agent) => [agent.id, agent]));

/**
 * One agent mark, looked up by id.
 *
 * @param {string} id agent id, as the scene fixtures spell it
 * @param {string} className the caller's base class, carried by both branches
 * @param {number} [size] intrinsic size in px
 */
export function sceneAgentMark(id, className, size = 18) {
  const agent = MARK_BY_ID[id] ?? { id, label: id, mark: null };

  return renderAgentMark(agent, className, size);
}
