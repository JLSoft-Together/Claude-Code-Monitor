import { FolderSimple, Rows, SquaresFour, type Icon } from "@phosphor-icons/react";
import type { AgentBoardView, BoardDensity, BoardStatusFilter } from "./agent-board-model";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";

/**
 * The Board's one bar (DL-34.11): `All` / `Needs me` on the left, then group
 * by project and cards / list as icon toggles. It replaced the `N of M`
 * heading, and it is the way back DECK-43 left for the STATUS/PROJECTS nav —
 * a row above the grid instead of a column beside it, and only the controls a
 * user reaches for often.
 */
export interface AgentBoardBarProps {
  readonly view: AgentBoardView;
  readonly grouped: boolean;
  readonly density: BoardDensity;
  readonly onStatusFilter: (filter: BoardStatusFilter) => void;
  readonly onGroupByProject: (grouped: boolean) => void;
  readonly onDensity: (density: BoardDensity) => void;
}

interface FilterChipProps {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onPress: () => void;
}

function FilterChip({ label, count, active, onPress }: FilterChipProps) {
  return (
    <button type="button" class="board-bar__chip" aria-pressed={active} onClick={onPress}>
      <span>{label}</span>
      <span class="board-bar__count">{count}</span>
    </button>
  );
}

interface LayoutToggleProps {
  readonly icon: Icon;
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}

function LayoutToggle({ icon, label, active, onPress }: LayoutToggleProps) {
  return (
    <button
      type="button"
      class="board-bar__chip board-bar__chip--icon"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onPress}
    >
      <DeckIcon icon={icon} size={ROW_ICON} />
    </button>
  );
}

export function AgentBoardBar({
  view,
  grouped,
  density,
  onStatusFilter,
  onGroupByProject,
  onDensity,
}: AgentBoardBarProps) {
  return (
    <div class="board-bar">
      <div class="board-bar__group" role="group" aria-label="Filter">
        <FilterChip
          label="All"
          count={view.total}
          active={view.filter === "all"}
          onPress={() => onStatusFilter("all")}
        />
        <FilterChip
          label="Needs me"
          count={view.needs}
          active={view.filter === "needs"}
          onPress={() => onStatusFilter("needs")}
        />
      </div>
      <div class="board-bar__group" role="group" aria-label="Layout">
        <LayoutToggle
          icon={FolderSimple}
          label="Group by project"
          active={grouped}
          onPress={() => onGroupByProject(!grouped)}
        />
        <span class="board-bar__gap" aria-hidden="true" />
        <LayoutToggle
          icon={SquaresFour}
          label="Cards"
          active={density === "cards"}
          onPress={() => onDensity("cards")}
        />
        <LayoutToggle
          icon={Rows}
          label="List"
          active={density === "list"}
          onPress={() => onDensity("list")}
        />
      </div>
    </div>
  );
}
