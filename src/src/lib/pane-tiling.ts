import type { Edge, SerializedNode } from "./split-tree";

/**
 * Where a launcher-created pane goes when nobody named a side.
 *
 * Docking every Quick Launch on the right of the active pane halves the same
 * leaf over and over — the fourth agent lands in a 12% sliver, and every split
 * is a `row`, so a tab only ever grows narrow columns. This picks the leaf with
 * the most room and cuts it along its LONGER side instead, which walks a tab
 * through 1 → 2 columns → 1+2 → 2x2 while leaving the ratios the user dragged
 * by hand alone.
 *
 * Reads the STRUCTURAL ratios, not the Focus Expand overlay: the overlay is a
 * display-time transform re-applied on every render, so balancing against it
 * would make the anchor follow the focus instead of the layout.
 */

/** Equal areas differ in the last float bits after a few nested splits. */
const TIE_TOLERANCE = 1e-6;

export interface TileViewport {
  readonly width: number;
  readonly height: number;
}

export interface TilePlacement {
  readonly paneId: number;
  /** Always a fresh split of `paneId`; never "left"/"top" (see dockNewPane). */
  readonly edge: Edge;
}

interface TileBox {
  readonly paneId: number;
  readonly width: number;
  readonly height: number;
}

function area(box: TileBox): number {
  return box.width * box.height;
}

/**
 * Walk the serialized layout, zipping `paneIds` onto leaves left-to-right —
 * the order `leafIds`/`serializeTree` already agree on — and return the next
 * unused index. Ids shorter than the layout simply stop producing boxes
 * rather than throwing, unlike `treeFromLayout`: a launch must not fail
 * because a pane closed between the snapshot and this read.
 */
function collectBoxes(
  layout: SerializedNode,
  paneIds: readonly number[],
  offset: number,
  width: number,
  height: number,
  out: TileBox[],
): number {
  if (layout.type === "leaf") {
    const paneId = paneIds[offset];
    if (paneId !== undefined) {
      out.push({ paneId, width, height });
    }
    return offset + 1;
  }
  const ratio = Math.min(Math.max(layout.ratio, 0), 1);
  const horizontal = layout.direction === "row";
  const firstWidth = horizontal ? width * ratio : width;
  const firstHeight = horizontal ? height : height * ratio;
  const after = collectBoxes(layout.first, paneIds, offset, firstWidth, firstHeight, out);
  return collectBoxes(
    layout.second,
    paneIds,
    after,
    horizontal ? width - firstWidth : width,
    horizontal ? height : height - firstHeight,
    out,
  );
}

/** Larger area wins; an exact tie goes to the older (lower) pane id. */
function beats(candidate: TileBox, best: TileBox): boolean {
  const gap = area(candidate) - area(best);
  const scale = Math.max(area(candidate), area(best), 1);
  if (gap > scale * TIE_TOLERANCE) return true;
  if (gap < -scale * TIE_TOLERANCE) return false;
  return candidate.paneId < best.paneId;
}

/**
 * The pane to split and the side to split it on, or null when no leaf is
 * eligible (every pane exited, or the id list ran empty).
 */
export function chooseTilePlacement(
  layout: SerializedNode,
  paneIds: readonly number[],
  viewport: TileViewport,
  eligible: (paneId: number) => boolean = () => true,
): TilePlacement | null {
  const boxes: TileBox[] = [];
  collectBoxes(
    layout,
    paneIds,
    0,
    Math.max(viewport.width, 0),
    Math.max(viewport.height, 0),
    boxes,
  );
  let best: TileBox | null = null;
  for (const box of boxes) {
    if (!eligible(box.paneId)) continue;
    if (best === null || beats(box, best)) best = box;
  }
  return best === null
    ? null
    : { paneId: best.paneId, edge: best.width >= best.height ? "right" : "bottom" };
}
