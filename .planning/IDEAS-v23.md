# Feature ideas after v21 (brainstorm 2026-10-14)

Ranked by value for the owner's flow (agent writes code/HTML in a terminal, owner reviews in the app). None sends prompts on its own; anything into a terminal is an explicit user action.

## Tier 1 — builds directly on v20–v22

1. **Changes / diff tab** — per worktree: files the agent touched (git status), side-by-side or inline diff (diff-* tokens, shiki), discard file / hunk, open in file tab. Tab label "Changes (7)". Biggest gap: today review needs another tool.
2. **Dev server detection** — terminal output `Local: http://localhost:5173` → chip on the pane "Open preview" → browser tab; remembers per project; auto-reopens on restore.
3. **Browser → agent handoff** — toolbar "Send to terminal": screenshot of the page (or device frame) into clipboard image paste of the linked Claude pane; console errors list with "Copy to terminal". User presses Enter.
4. **Element picker** — click an element in browser tab → inserts `selector + short outerHTML + file:line if source map` into the terminal input.
5. **Quick open (Ctrl/⌘+P)** — fuzzy file search in the active project → file tab; recent files.
6. **Terminal find (Ctrl/⌘+F in pane)** — xterm search addon, match count, prev/next.

## Tier 2 — workspace polish

7. **Sidebar like reference** — per project: sessions with live title (agent's last line/task), age, agent glyph, spinner/attention glyph; click jumps to pane.
8. **Layouts per project** — save tab/split set (Claude + shell + browser localhost:5173) and reopen with one click.
9. **Scripts menu** — `package.json` scripts / Makefile targets → run in new shell pane.
10. **Prompt snippets** — saved texts inserted into terminal input (no auto Enter).
11. **Plan viewer** — `.planning/*.md` list per project, open in file tab (markdown preview).
12. **Broadcast input** — type once to several selected panes (off by default, clear banner).

## Tier 3 — monitor / ops

13. Cost and tokens per tab/pane (only where reliable data exists).
14. Session timeline export (markdown recap of what an agent did, from existing activity data).
15. macOS parity pass (zsh PTY, ⌘ keys, dmg, dock click → pane).
16. Auto-update (electron-updater, GitHub releases).
