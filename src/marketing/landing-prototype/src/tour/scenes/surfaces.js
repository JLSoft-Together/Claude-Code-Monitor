/**
 * The Keep chapter's surfaces widget: terminals beside the docked side panel.
 *
 * Files and Token usage do not sit on the stage strip: they open in the docked
 * side panel, which has hosted the explorer, usage and sessions since
 * 2026-08-16 and took files off the strip in 2.10.0 (CHANGELOG, "Read files
 * beside the Explorer"; `src/ui/dock/dock-panel.tsx`,
 * `docs/internals/file-surface.md`, "Surfaces beside tabs"), a right-hand
 * column the terminal grid resizes around. Its header is a row of three
 * ICON-ONLY tabs and the hide control; each tab's name and chord ride a hover
 * tip (`dock-tabs.tsx:59-65`), so the drawing carries the names as the chips'
 * `aria-label` and in the keys row beneath it; a native `title` is left off,
 * as the app left it off, so the tile's own tooltip is the one that shows. The browser is a stage surface, not
 * a dock tab, and is not drawn.
 *
 * The tabs are `DOCK_TABS` (`src/ui/dock/dock-tab-registry.ts:43-56`) — copied
 * rather than imported, because that module pulls in `@phosphor-icons/react`:
 * `File explorer`, `Token usage`, `Session history`, with the explorer showing.
 * The chips draw the filled weight (`dock-tabs.tsx:56`).
 *
 * The explorer's first row is the Files / Changes switch (`explorer-switch.tsx`),
 * Changes carrying `+N −M` in green and red (`DiffCounts`,
 * `changes-list.tsx:46`); under it the tree: the root is row 0 and a data row is 22px
 * (`docs/internals/file-surface.md`, "Explorer and editor"). No document is
 * open, so no row is marked: a marked row is the document on the stage (same
 * page, "The active document is marked"), and with one open the column splits
 * into the document panel and the list (`.explorer-tab--document`,
 * `src/styles/14-dock.css:666`), which does not read at a widget's width.
 *
 * The chords are `docs/user/keyboard-shortcuts.md:67-73`.
 */

export const DOCK_TABS = [
  { id: "explorer", label: "File explorer", icon: "treeViewFilled", active: true },
  { id: "usage", label: "Token usage", icon: "gauge" },
  { id: "sessions", label: "Session history", icon: "clockCounterClockwiseFilled" },
];

export const EXPLORER_SWITCH = { files: "Files", changes: "Changes", added: 64, removed: 12 };

/** The tree: depth, glyph and name. */
export const TREE_ROWS = [
  { depth: 0, kind: "root", name: "spacevibe-deck" },
  { depth: 1, kind: "folder", name: "src" },
  { depth: 2, kind: "folder", name: "terminal" },
  { depth: 3, kind: "code", name: "layout-engine.ts" },
  { depth: 3, kind: "code", name: "pane-lifecycle.ts" },
  { depth: 2, kind: "closed", name: "ui" },
  { depth: 1, kind: "closed", name: "docs" },
];

/** The pane beside the dock: Claude's header sentence (DL-32.7) over a few lines of its transcript. */
export const PANE = {
  agent: "claude",
  header: "The ratio rounds to integer cells before the flex pass.",
  lines: [
    { cls: "user", text: "> fix the pane divider drift on resize" },
    { cls: "body", text: "● I'll trace why the pane divider drifts on resize." },
    { cls: "tool", text: "  Read(src/terminal/layout-engine.ts)" },
    { cls: "body", text: "● The ratio rounds to integer cells before the flex pass." },
    { cls: "tool", text: "  Update(src/terminal/layout-engine.ts)" },
  ],
};

/**
 * Chords from `docs/user/keyboard-shortcuts.md:67-73`, in the order the page
 * lists them: the three tabs by their registry names, then the document's own.
 */
export const KEYS = [
  ["⌘⇧B", "File explorer"],
  ["⌘⇧U", "Token usage"],
  ["⌘⇧Y", "Session history"],
  ["⌘⇧V", "Markdown source"],
  ["⌘S", "Save"],
];
