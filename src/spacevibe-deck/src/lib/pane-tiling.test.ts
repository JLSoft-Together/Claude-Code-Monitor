import { describe, expect, it } from "vitest";
import { chooseTilePlacement, type TileViewport } from "./pane-tiling";
import { dockNewPane, leaf, leafIds, serializeTree, setRatio, type TreeNode } from "./split-tree";

const WIDE: TileViewport = { width: 1600, height: 900 };
const TALL: TileViewport = { width: 800, height: 1400 };

/** Replay what Quick Launch does: place pane N where the tiler says it goes. */
function grow(viewport: TileViewport, panes: number): TreeNode {
  let tree: TreeNode = leaf(1);
  for (let next = 2; next <= panes; next++) {
    const placement = chooseTilePlacement(serializeTree(tree), leafIds(tree), viewport);
    if (placement === null) throw new Error("no placement");
    tree = dockNewPane(tree, placement.paneId, next, placement.edge);
  }
  return tree;
}

describe("chooseTilePlacement", () => {
  it("walks a wide stage from one pane to a 2x2 grid", () => {
    expect(leafIds(grow(WIDE, 2))).toEqual([1, 2]);
    expect(serializeTree(grow(WIDE, 2))).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.5,
      first: { type: "leaf" },
      second: { type: "leaf" },
    });
    // Third agent cuts the left column instead of halving one pane again.
    expect(serializeTree(grow(WIDE, 3))).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.5,
      first: {
        type: "split",
        direction: "column",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      second: { type: "leaf" },
    });
    const quad = grow(WIDE, 4);
    expect(leafIds(quad)).toEqual([1, 3, 2, 4]);
    expect(serializeTree(quad)).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.5,
      first: {
        type: "split",
        direction: "column",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      second: {
        type: "split",
        direction: "column",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
    });
  });

  it("cuts a tall stage across first, and still reaches a 2x2", () => {
    const pair = serializeTree(grow(TALL, 2));
    expect(pair.type === "split" && pair.direction).toBe("column");
    const quad = serializeTree(grow(TALL, 4));
    expect(quad.type === "split" && quad.direction).toBe("column");
    expect(quad.type === "split" && quad.first.type === "split" && quad.first.direction).toBe(
      "row",
    );
  });

  it("follows the ratio a user dragged rather than the newest pane", () => {
    // Pane 1 widened to 80%: the next agent belongs in it, not beside pane 2.
    const dragged = setRatio(dockNewPane(leaf(1), 1, 2, "right"), [], 0.8);
    expect(chooseTilePlacement(serializeTree(dragged), leafIds(dragged), WIDE)).toEqual({
      paneId: 1,
      edge: "right",
    });
  });

  it("only ever splits an existing pane, never docks outside it", () => {
    for (let panes = 1; panes <= 8; panes++) {
      const tree = grow(WIDE, panes);
      const placement = chooseTilePlacement(serializeTree(tree), leafIds(tree), WIDE);
      expect(["right", "bottom"]).toContain(placement?.edge);
      expect(leafIds(tree)).toContain(placement?.paneId);
    }
  });

  it("skips panes the caller rejects", () => {
    const tree = grow(WIDE, 3);
    const placement = chooseTilePlacement(
      serializeTree(tree),
      leafIds(tree),
      WIDE,
      (id) => id !== 2,
    );
    expect(placement?.paneId).not.toBe(2);
    expect(chooseTilePlacement(serializeTree(tree), leafIds(tree), WIDE, () => false)).toBeNull();
  });

  it("survives an id list shorter than the layout instead of throwing", () => {
    const tree = grow(WIDE, 3);
    expect(chooseTilePlacement(serializeTree(tree), [1], WIDE)).toEqual({
      paneId: 1,
      edge: "right",
    });
    expect(chooseTilePlacement(serializeTree(tree), [], WIDE)).toBeNull();
  });

  it("still answers when the stage has not been measured", () => {
    const tree = grow(WIDE, 2);
    expect(
      chooseTilePlacement(serializeTree(tree), leafIds(tree), { width: 0, height: 0 }),
    ).toEqual({
      paneId: 1,
      edge: "right",
    });
  });
});
