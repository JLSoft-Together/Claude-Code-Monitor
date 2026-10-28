# PLAN v67 — 5 tính năng IDE (2026-10-29)

Nguồn: `.planning/IDEAS-2026-10-28-ide.md` (chi tiết, file:line). Chủ nhân: "ok làm cả đi". Ưu tiên số 1: IDE mượt.

## Quyết định (chủ nhân chốt 2026-10-29)

- Commit `--amend`: chỉ khi HEAD chưa có trên upstream, qua native confirm.
- Copy sang worktree mới: `.env*`, `local.properties`, `key.properties`, `**/google-services.json` (Settings sửa được; chỉ file chưa track, không ghi đè).
- Checkpoint: kho git riêng `<dataDir>/checkpoints/<repoHash>` (`GIT_DIR` riêng + `GIT_WORK_TREE` = repo), không ghi ref vào repo chủ nhân.
- Checks: chỉ chạy khi bấm, không tự chạy khi agent xong lượt.

## Ràng buộc mượt

- Không index nền, không watcher mới; git chạy khi chủ nhân bấm / gõ (debounce), có timeout, huỷ việc cũ.
- Kết quả lớn bị cắt (grep 2000 dòng, output check 1 MB cuối).
- Pane mới lazy (`defineAsyncComponent`), không render khi ẩn.

## Thứ tự

1. Find in Files (`git grep`) — Explorer tab Search + Ctrl/⌘+Shift+F.
2. Review & Commit trong Changes pane (stage/unstage file + hunk, message, commit, đã xem).
3. Checks pane (chạy script khi bấm, parse lỗi → mở dòng, "Gửi lỗi cho agent" chỉ prefill).
4. Worktree lifecycle (copy file, so nhánh, merge ff-only/squash sau confirm, dọn).
5. Checkpoint theo lượt agent (thử nghiệm).

Backlog v66 còn: heatmap, hook bridge, bottom sheet — làm xen sau mục 1.

## Tiến độ

- [x] 2026-10-29 Find in Files: desktop `preview/search.ts` (`git grep -z --untracked`, 2000 match, abort qua `execGit` `signal`), IPC `ccm:search`; web `ExplorerSearch.vue` (tab Search trong Explorer, windowed rows, highlight `lib/searchView.ts`), phím ⇧⌘F / Alt+Shift+F (`workspaceKeys` + desktop `keys.ts`). Test desktop `search.test.ts`, web `searchView.test.ts`.
- [x] 2026-10-29 Review & Commit: desktop `preview/commit.ts` (stage / unstage paths, stage hunk `apply --cached`, commit qua stdin, amend chỉ khi HEAD chưa có trên remote + `confirmGit`), IPC `ccm:git-stage|unstage|can-amend|commit|commit-cancel`; web `CommitBox.vue` + nút stage từng file / nhóm trong `ExplorerChanges.vue`, Stage file / Stage đoạn (block đang chọn) trong `ChangesPane.vue`, i18n `workspace-commit.ts`. Test `commit.test.ts`, `changesView.test.ts`.
- [x] v66: tour sửa chữ + mở panel Sessions; `ProjectStrip.vue` live theo project; Recap 7 ngày + so kỳ trước.
- [x] Checks: desktop `preview/checks.ts` (chỉ chạy script desktop tự tìm thấy — `detectScripts` / `flutter analyze`; 1 / thư mục, 2 / app; parse tsc / vue-tsc / ESLint / Vitest / dart / Kotlin), IPC `ccm:check-run|cancel`; web tab Checks `ExplorerChecks.vue` + `stores/checks.ts` + `lib/checks.ts`; gửi lỗi cho agent = `sendErrorToAgent` (prefill).
- [x] Worktree: `pty/wtCopy.ts` copy file setup (`settings.worktreeCopy`), desktop `preview/worktrees.ts` so nhánh + gộp ff / squash sau `confirmRun` (native, `strings.ts` `runTitle`), web `WorktreeMenu.vue`.
- [x] Checkpoint: `preview/checkpoints.ts` `CheckpointStore` (kho git riêng `<dataDir>/checkpoints/<hash>.git`, bật theo repo, giữ 30), IPC `ccm:cp-*`; web `useTurnCheckpoints` (mốc working ↔ idle/waiting), `stores/checkpoints.ts`, `CheckpointsPanel.vue` dưới Changes.
- [x] Heatmap: collector `usage.ts` đếm message theo `day|hour` (cache v3 → quét lại 1 lần), `heatmap.get` / `heatmap.data`; web `HeatmapChart.vue` trong History.
- [x] Hook bridge: script + desktop `hooks.ts` + IPC + collector `HookReader`; web `QuickSetup.vue` mục `hooks` (Bật / Tắt), `SessionCardSignals.vue` + `MainNode.vue` (đang compact, auto từ chối N), docs §11y.
- [x] Bottom sheet < 768 px: `ui.narrow` (matchMedia) → `MonitorView.vue` panel Sessions thành sheet dưới (scrim, nút kéo, Esc đóng).
- [x] 2026-10-29 00:40 Handoff mới: `.planning/HANDOFF-2026-10-29-0040.md`.
- [x] 2026-10-29 Kiểm: `npm run typecheck` sạch; `npm test` web 1233 / desktop 712 / collector 310 / shared 538 pass; build web + desktop; E2E desktop-only, csp, v27, explorer, diff, sidebar, agent-map, explorer-menu 135 pass + `e2e/v67-ide.cjs` mới 10 pass.
- [x] `.code_index/` web / desktop / collector / protocol cập nhật.
- Chưa commit.
