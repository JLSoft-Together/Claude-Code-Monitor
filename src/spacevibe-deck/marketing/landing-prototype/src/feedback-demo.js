/**
 * Dev-only stand-in for the Worker, switched on with `?demo` under
 * `npm run prototype:landing` so the page can be reviewed without a Linear
 * key. `?demo=empty` and `?demo=error` show those board states. feedback.js
 * imports this behind `import.meta.env.DEV`, so production never ships it.
 */
import { groupFeedbackBoard } from "./feedback-api.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const LATENCY_MS = 650;

const ago = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ITEMS = [
  {
    id: "DECK-131",
    title: "Let me pin an agent card to the top of the rail",
    category: "idea",
    status: "pending",
    updatedAt: ago(0),
  },
  {
    id: "DECK-128",
    title: "Windows installer fails on a secondary drive",
    category: "bug",
    status: "pending",
    updatedAt: ago(1),
  },
  {
    id: "DECK-126",
    title: "Export token usage as CSV",
    category: "idea",
    status: "pending",
    updatedAt: ago(3),
  },
  {
    id: "DECK-122",
    title: "Codex pane loses scrollback after resume",
    category: "bug",
    status: "review",
    updatedAt: ago(0),
  },
  {
    id: "DECK-119",
    title: "Keyboard shortcut to jump to the next waiting agent",
    category: "idea",
    status: "review",
    updatedAt: ago(4),
  },
  {
    id: "DECK-110",
    title: "Support Gemini CLI in the agent catalog",
    category: "other",
    status: "done",
    updatedAt: ago(6),
  },
  {
    id: "DECK-104",
    title: "Browser tab should remember zoom level",
    category: "idea",
    status: "done",
    updatedAt: ago(12),
  },
];

export function createDemoFeedbackApi(mode) {
  return {
    async fetchBoard() {
      await wait(LATENCY_MS);

      if (mode === "error") {
        throw new Error("Demo board failure.");
      }

      return {
        board: groupFeedbackBoard({
          items:
            mode === "empty"
              ? []
              : ITEMS.map((item) => ({
                  ...item,
                  description: "An example report shared by a Deck user.",
                })),
        }),
        nextCursor: null,
      };
    },
    async submit() {
      await wait(LATENCY_MS);
    },
  };
}
