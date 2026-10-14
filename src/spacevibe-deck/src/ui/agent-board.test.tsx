// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("./controls/deck-icon", () => ({
  ROW_ICON: 14,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { AgentBoard, type AgentBoardActions, type AgentBoardProps } from "./agent-board";
import type { AgentBoardView, BoardCard } from "./agent-board-model";
import type { BoardPanelState } from "./agent-board-panel";

function card(
  paneId: number,
  rank: number,
  state: BoardCard["state"],
  selected = false,
): BoardCard {
  return {
    paneId,
    tabIndex: 0,
    ordinal: rank,
    rank,
    agent: "claude",
    departed: false,
    hasRun: true,
    state,
    name: `Agent ${rank}`,
    project: "deck",
    where: "deck · main",
    checkoutKey: "k",
    checkout: "main",
    branch: "main",
    directory: "/d",
    what: { kind: "none", text: "" },
    task: null,
    tail: null,
    up: "",
    changed: "1m",
    confidence: null,
    selected,
  };
}
function view(cards: BoardCard[], selected: BoardCard | null = null): AgentBoardView {
  return {
    all: cards,
    cards,
    total: cards.length,
    shown: cards.length,
    filter: "all",
    needs: cards.filter((entry) => entry.state === "asked" || entry.state === "failed").length,
    status: [{ filter: "all", label: "All", count: cards.length, active: true }],
    projects: cards.length
      ? [{ key: "k", label: "deck · main", count: cards.length, active: false }]
      : [],
    groups: cards.length ? [{ key: "k", label: "deck · main", cards }] : [],
    selected,
  };
}
const PANEL: BoardPanelState = {
  snapshot: null,
  replyEnabled: false,
  replyNotice: null,
  sending: false,
  paneExited: false,
};
function actions(): AgentBoardActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onSelect: vi.fn(),
    onOpenInStage: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onClose: vi.fn(),
    onReply: vi.fn(),
    onStatusFilter: vi.fn(),
    onProjectFilter: vi.fn(),
    onGroupByProject: vi.fn(),
    onDensity: vi.fn(),
    onNewAgent: vi.fn(),
    onEscape: vi.fn(),
  };
}
type Layout = Pick<AgentBoardProps, "grouped" | "density">;
const CARDS_LAYOUT: Layout = { grouped: false, density: "cards" };
function mount(v: AgentBoardView, a = actions(), layout: Layout = CARDS_LAYOUT) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    render(<AgentBoard view={v} actions={a} panel={PANEL} {...layout} />, host);
  });
  return { host, a };
}
/** A bar button by its visible text or, for an icon toggle, its label. */
function barButton(host: HTMLElement, label: string): HTMLButtonElement {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>(".board-bar__chip")];
  return buttons.find((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").startsWith(label),
  )!;
}

describe("AgentBoard", () => {
  // DECK-43: the grid is the whole Board. Both side columns left the render,
  // and this asserts it with a view that WOULD have raised the panel — a
  // selected card — so a re-mount cannot pass unnoticed.
  it("draws the bar in place of the heading, and neither side column", () => {
    const cards = [card(1, 1, "asked", true), card(2, 2, "working")];
    const { host } = mount(view(cards, cards[0]));
    // DL-34.11: the `N of M` heading left with the bar's arrival.
    expect(host.querySelector(".agent-board__heading")).toBeNull();
    const chips = [
      ...host.querySelectorAll<HTMLButtonElement>(".board-bar__chip:not(.board-bar__chip--icon)"),
    ];
    expect(chips.map((chip) => chip.textContent)).toEqual(["All2", "Needs me1"]);
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(host.querySelector(".agent-board__nav")).toBeNull();
    expect(host.querySelector(".agent-board__panel")).toBeNull();
    expect(host.querySelector(".agent-board")!.hasAttribute("data-panel")).toBe(false);
  });

  it("opens the pressed card's pane on the stage", () => {
    const cards = [card(1, 1, "asked"), card(2, 2, "working")];
    const { host, a } = mount(view(cards));
    act(() => host.querySelectorAll<HTMLButtonElement>(".board-card__hit")[1].click());
    expect(a.onOpenInStage).toHaveBeenCalledWith(expect.objectContaining({ paneId: 2 }));
    // The press SELECTED until DECK-43, and a selection with no panel behind
    // it would be a state the user cannot see.
    expect(a.onSelect).not.toHaveBeenCalled();
  });
  it("draws the empty Board with its launcher and the empty filter without it", () => {
    const empty = mount(view([]));
    expect(empty.host.querySelector(".agent-board__empty")!.textContent).toContain(
      "No agents running",
    );
    // The empty Board is unchanged by DL-34.11: nothing to filter, no bar.
    expect(empty.host.querySelector(".board-bar")).toBeNull();
    act(() => empty.host.querySelector<HTMLButtonElement>(".agent-board__empty button")!.click());
    expect(empty.a.onNewAgent).toHaveBeenCalledTimes(1);
    const filtered = mount({
      ...view([card(1, 1, "idle")]),
      cards: [],
      shown: 0,
      filter: "needs",
      groups: [],
    });
    expect(filtered.host.querySelector(".agent-board__none")!.textContent).toBe(
      "Nothing needs you",
    );
    expect(filtered.host.querySelector(".agent-board__empty")).toBeNull();
  });
  it("routes the bar's presses to its actions", () => {
    const { host, a } = mount(view([card(1, 1, "asked")]));
    act(() => barButton(host, "Needs me").click());
    expect(a.onStatusFilter).toHaveBeenCalledWith("needs");
    act(() => barButton(host, "Group by project").click());
    expect(a.onGroupByProject).toHaveBeenCalledWith(true);
    act(() => barButton(host, "List").click());
    expect(a.onDensity).toHaveBeenCalledWith("list");
  });
  it("draws one header per group and walks focus in the drawn order", () => {
    const first = { ...card(1, 1, "idle"), checkoutKey: "a" };
    const second = { ...card(2, 2, "idle"), checkoutKey: "b" };
    const third = { ...card(3, 3, "idle"), checkoutKey: "a" };
    const grouped: AgentBoardView = {
      ...view([first, second, third]),
      groups: [
        { key: "a", label: "deck · main", cards: [first, third] },
        { key: "b", label: "deck · fix", cards: [second] },
      ],
    };
    const { host } = mount(grouped, actions(), { grouped: true, density: "cards" });
    const labels = [...host.querySelectorAll(".agent-board__group .board-label")];
    expect(labels.map((label) => label.textContent)).toEqual(["deck · main", "deck · fix"]);
    const drawn = [...host.querySelectorAll<HTMLElement>(".board-card")];
    expect(drawn.map((entry) => entry.dataset.paneId)).toEqual(["1", "3", "2"]);
    const hits = host.querySelectorAll<HTMLButtonElement>(".board-card__hit");
    hits[0].focus();
    act(() => {
      hits[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(hits[1]);
  });
  it("lays the same cards out as a list", () => {
    const cards = [card(1, 1, "idle"), card(2, 2, "asked")];
    const { host } = mount(view(cards), actions(), { grouped: false, density: "list" });
    expect(host.querySelector(".agent-board__grid")!.getAttribute("data-density")).toBe("list");
    expect(host.querySelectorAll(".board-card")).toHaveLength(2);
    expect(barButton(host, "List").getAttribute("aria-pressed")).toBe("true");
  });
  it("opens by digit while the grid holds focus", () => {
    const cards = [card(1, 1, "idle"), card(2, 2, "idle")];
    const { host, a } = mount(view(cards));
    const grid = host.querySelector<HTMLElement>(".agent-board__grid")!;
    act(() => {
      grid.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    });
    // The keyboard twin of a press since DECK-43: the digit that names a card
    // does what pressing it does.
    expect(a.onOpenInStage).toHaveBeenCalledWith(expect.objectContaining({ paneId: 2 }));
    // The digit is read on the GRID, so a key pressed anywhere else in the
    // Board still cannot open a pane.
    act(() => {
      host
        .querySelector<HTMLElement>(".agent-board__main")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    });
    expect(a.onOpenInStage).toHaveBeenCalledTimes(1);
  });
  it("opens the focused card in the stage on ⌘Enter / Ctrl+Enter", () => {
    const cards = [card(1, 1, "idle"), card(2, 2, "idle")];
    const { host, a } = mount(view(cards));
    const grid = host.querySelector<HTMLElement>(".agent-board__grid")!;
    act(() => {
      grid.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });
    expect(a.onOpenInStage).toHaveBeenCalledWith(expect.objectContaining({ paneId: 1 }));
  });
  it("moves roving focus with the arrow keys", () => {
    const cards = [card(1, 1, "idle"), card(2, 2, "idle"), card(3, 3, "idle")];
    const { host } = mount(view(cards));
    const hits = host.querySelectorAll<HTMLButtonElement>(".board-card__hit");
    expect([...hits].map((h) => h.tabIndex)).toEqual([0, -1, -1]);
    hits[0].focus();
    act(() => {
      hits[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(hits[1]);
    act(() => {
      hits[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(document.activeElement).toBe(hits[2]);
  });
  // One Escape, not two. It closed the panel first and stepped the Board back
  // on the second press (DL-34.9) until DECK-43 removed the panel.
  it("steps the Board back on the first Escape", () => {
    const cards = [card(1, 1, "asked", true)];
    // A selected card in the view — the state that used to absorb the first
    // press — proves the branch is gone rather than merely unreached.
    const { host, a } = mount(view(cards, cards[0]));
    act(() => {
      host
        .querySelector<HTMLElement>(".agent-board")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(a.onEscape).toHaveBeenCalledTimes(1);
    expect(a.onSelect).not.toHaveBeenCalled();
  });
});
