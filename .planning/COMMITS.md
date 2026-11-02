# Commit đề xuất v79 (chưa commit — chờ chủ nhân nói "commit")

Các WP chạm chung file (i18n en/vi, e2e, ui.ts), nên gom 1 commit là an toàn nhất:

🧹 v79 simplify the UI: Settings as a sidebar window with search, Monitor grouped by need with three-line cards, one-line Workspace rail, lean pane headers, one status popover in the top bar, cleaner History / Usage / Devices / Extensions / Git Log, Vietnamese status labels

Nếu muốn tách theo WP (thứ tự, mỗi commit `git add` đúng file trong report WP đó; en.ts / vi.ts / e2e chung đi với WP cuối chạm):
1. 🪟 Settings as a sidebar window with search, ten pages and an events by channel notification table
2. 🧹 Monitor: group sessions by need, three-line cards with a more menu, project filter dropdown and calmer Agent Map
3. 📐 Compact Workspace rail with one-line rows, agent-first project sections, filter box and icon open button
4. 🧹 Simplify workspace pane headers: tab bar hosts the lone pane header, extra actions move to the more menu
5. 🧹 Fold header limits, keep-awake, disk, resources and connection into one status popover, move Compact to the more menu and show only the guide on a fresh profile
6. 🧹 Simplify History, Usage, Devices, Extensions pages and the Git Log branches toolbar
7. 🌐 Vietnamese status labels everywhere and remove the unused session bar, dim toggle and dead strings

Không add: spikes/, bg_native_ad_cta.xml, git-gui.bat, apps/desktop/test/__snapshots__/fwp-host.test.ts.snap, apps/*/.vitest/, .planning/HANDOFF-2026-11-01-v76.md (sửa cũ).
