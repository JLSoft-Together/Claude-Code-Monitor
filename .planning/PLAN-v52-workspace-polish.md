# PLAN v52 — Workspace: sửa UI + motion, phóng to pane, hoàn tác đóng, dòng "đang làm gì", Mission v2, làm mờ pane

Nguồn: `.planning/AUDIT-v52-workspace-ui-motion.md`. Chủ nhân (2026-10-16): "làm hết", F6 phải dễ thấy, không giấu trong Settings.

## 1. Phạm vi

Lỗi A1–A9, motion B1–B5, a11y C1–C3, tính năng F1–F6 (bảng ở file audit).

## 2. Quyết định thiết kế

### A3 — một bộ từ trạng thái
- Header, rail, tile Mission đều dùng `RailState` + `stateWord` (`lib/rail/railModel.ts`). Helper chung `usePaneInfo().railStateOf(pane)` / `stateText(pane)`.
- Header: shell đang chạy bình thường → không chip (rail vẫn "Ready"). Chỉ hiện chip tiến trình khi Starting / Ended / Failed. Agent: chip theo `RailState` (idle = "Ready", không còn "Idle").

### A1/A2/A9 — header co giãn (container query)
- `section` của pane = `@container`. Phải vừa ở `MIN_PANE.w` = 220px, không bao giờ tràn.
- Thứ tự rút: session title → dev chip label → cwd → nhãn nhánh (còn icon, tooltip tên nhánh) → nhãn chip trạng thái (còn icon, `aria-label` giữ chữ) → attach / scripts / restart vào menu "…" (`ContextMenu`). Split + close + zoom luôn còn.

### A4 + F6 — pane active rõ, làm mờ pane khác
- Multi-pane: header pane active `text-ink`, pane khác `text-ink-muted`; viền active 2px `outline-focus`.
- F6 setting `settings.dimInactive` (`ccm.workspace.dim`, mặc định tắt). Lớp phủ `pointer-events-none` chỉ animate `opacity` (`--ccm-dur-base`): terminal phủ `bg-well`, viewer phủ `bg-canvas`, độ mờ ~0.45.
- **Dễ thấy (yêu cầu chủ nhân):**
  1. Nút bật/tắt trên thanh tab (bên phải, cạnh chip "need you" / "?"), chỉ hiện khi tab đang mở có ≥ 2 pane; `aria-pressed`, tooltip giải thích.
  2. Lần đầu một tab có ≥ 2 pane (và đang tắt): bong bóng gợi ý neo vào nút đó — "Nhiều pane? Làm mờ pane không dùng để dễ thấy pane đang gõ" [Bật] [Để sau]; chỉ hiện 1 lần (`ccm.workspace.dimTip`).
  3. Mục có dấu tick trong menu chuột phải của tab.
  4. Settings → mục Workspace.

### F1 — phóng to pane
- `Tab.zoom?: string` (key pane). `tabBoxes` khi zoom = chỉ pane đó, box `{0,0,1,1}`; không divider; bọc `withViewTransition` (morph sẵn có).
- Bật/tắt: nút trong header pane (`Maximize2`/`Minimize2`, `aria-pressed`), double-click vùng trống header (giống thanh tiêu đề macOS), phím ⌘⇧↩ / Ctrl+Shift+Enter, mục trong menu tab.
- Tự bỏ zoom khi: `activate` pane khác cùng tab, split / close / move / swap / merge / detach trong tab đó, pane zoom bị xoá. Lưu cùng Tab, khi load kiểm `zoom ∈ leaves` không thì bỏ.
- Khi zoom: header có chip "+N pane" bấm để thoát zoom; tab trên thanh tab có glyph `Maximize2` nhỏ.

### F2 — hoàn tác đóng
- Store: `closedStack` (runtime, tối đa 10). Mỗi mục ghi pane đã đóng (kind, preset, cwd, `agentSessionId ?? resume`, url, path, line, tên hiển thị) + nếu đóng cả tab: `root`, `focus`, `name`; nếu đóng 1 phần tab: neo `{ siblingKey, dir, side }`.
- `reopenClosed()`: agent → `addPane(preset, cwd, sessionId)` (= `--resume`); shell → shell mới cùng cwd (mất lịch sử lệnh, ghi rõ trong tooltip); viewer → `addView`. Neo còn → split cạnh sibling đúng phía, không → tab mới.
- Ghi vào stack ở mọi đường đóng do người dùng: nút ✕ pane, ✕ tab, Mod+W, menu, đóng project, confirm sheet. Không ghi khi pane tự biến mất (`gone`) hay store dọn.
- Toast `UndoToast.vue` đáy giữa canvas: "Đã đóng {name} · Hoàn tác" + phím; 6 s, dừng khi hover/focus, Esc tắt; `aria-live="polite"`; vào: trượt lên 8px + fade (`--ccm-dur-base`, out-quint), ra: fade `--ccm-dur-fast`.
- Phím: macOS ⌘⇧T; Windows/Linux Ctrl+Shift+Z (Ctrl+Shift+T đã là "tab mới").
- Motion: **bụi ghép ngược** — `dust.ts` giữ bitmap đã chụp lúc đóng theo key pane (`UNDO_MS` 8 s), `dustIn(el, oldKey)` cho các lớp bay ngược về ghép thành pane, xong mới hiện pane thật. Không có bitmap / reduced motion → scale 0.98 + fade.

### F3 — dòng "đang làm gì"
- Helper `usePaneInfo().activityOf(pane)` → `{ tool, since, diff }` (`Agent.currentTool` của main agent khi working; `TerminalSession.statusSince`; `TerminalSession.diff`). Chỉ tên tool, không tham số (hard rule).
- Rail dòng 2 khi working: `Edit · 2m 14s` — đồng hồ là span riêng ngoài key Transition (không cross-fade mỗi giây), `tabular-nums`. Diff `+12 −3` (màu `diff-*`) khi có.
- Header: thay chỗ session title bằng `tool · thời gian` khi working (ẩn theo container query như title).

### F4 — gợi ý Compact
- Header: `context.pct >= CONTEXT_THRESHOLDS.warn` (shared) và `compactFlow.stateOf(pane) === 'ready'` → chip nút "Ngữ cảnh 82% · Compact…" → `compactFlow.start(key)` (cùng hành động menu v51, chủ nhân bấm mới chạy). Docs §11x thêm 1 dòng.

### F5 — Mission Control v2
- Lưới tự lấp chỗ trống (kiểu Exposé): tính số cột + cao thẻ theo kích thước overlay và số tab, không còn `h-40` cố định; thumbnail hiện N dòng cuối vừa chỗ.
- Thứ tự: tab có pane "Cần bạn"/Failed lên đầu trong mỗi project (giữ ổn định, FLIP khi đổi chỗ).
- Gõ để lọc (ô lọc ở thanh tiêu đề, theo tên tab / pane / project), phím số 1–9 chọn thẻ, mũi tên giữ như cũ.
- B1: tile FLIP bằng `transform`, bỏ transition `left/top/width/height`.

### Motion chung
- B3: `--ease-spring` (vọt) chỉ cho phản hồi "pop"; scale tab vào, chevron, chrome → `--ease-out-quint`.
- B4: gom 240/320/340/480/520ms + 2 `cubic-bezier` lẻ vào token (`--ccm-dur-*`, `--ease-*`; thêm token mới nếu cần, đặt tên theo vai trò).
- A6: thanh tab ẩn scrollbar, mờ mép (`mask-image`) khi thật sự tràn.
- A5: menu mở bằng chuột không tô mục nào; focus nằm ở khung menu; mũi tên mới tô. Mở bằng phím (Shift+F10, phím menu) vẫn tô mục đầu.

## 3. Chia việc (mỗi agent sở hữu file riêng)

| Agent | File | Việc |
|---|---|---|
| NỀN (con) | `composables/usePaneInfo.ts`, `stores/settings.ts` (`dimInactive`), `i18n/workspace-v52.ts` (`workspace.dim`, `workspace.activity`) + đăng ký en/vi, file i18n trống cho từng agent | helper chung |
| PANE | `TermPane.vue`, `ViewPaneControls.vue`, header trong `FilePane.vue` / `BrowserToolbar.vue` / `RunPane.vue` / `LogPane` / `ChangesPane` (chỉ phần header), `i18n/workspace-v52-pane.ts` (`workspace.paneHead`) | A1 A2 A3 A4(header) A9 F1(nút + dblclick) F3(header) F4 F6(lớp phủ terminal) |
| TABS | `WorkspaceView.vue`, `stores/workspace.ts` (+test), `lib/workspaceKeys.ts` (+test), `lib/shortcuts.ts` (+test), `lib/tabMenu.ts` (+test), `UndoToast.vue` mới, `i18n/workspace-v52-tabs.ts` (`workspace.zoom`, `workspace.undo`) | F1 F2 F6(nút, tip, menu tab, lớp phủ viewer) A4(wrapper viewer) A6(template) |
| MOTION | `lib/dust.ts` (+test), `style.css`, `components/ui/ContextMenu.vue` (+test), `SplitMenu.vue`, `SettingsMenu.vue` (mục F6) | A5 A6(CSS) B3 B4 `dustIn` |
| RAIL | `WorkspaceSidebar.vue`, `rail/*`, `lib/rail/railModel.ts` + `rail.test.ts`, `i18n/workspace-v52-rail.ts` (`workspace.railTree`) | A8 B2 B5 C1 C2 C3 F3(rail) |
| MISSION | `MissionControl.vue`, `mission/*`, `lib/rail/mission.ts`, `missionMenu.ts` + test, `i18n/workspace-v52-mission.ts` (`workspace.missionV2`) | A7 B1 F5 |

i18n: spread nông trong `en.ts`/`vi.ts` → mỗi file chỉ dùng namespace của mình (cột trên), không đụng `en.ts`/`vi.ts`.

## 4. Hợp đồng giữa các phần

- `TermPane` props mới: `zoomed: boolean`, `hiddenCount: number`, `dim: boolean`; emit `zoom: []`.
- `ViewPaneControls` props mới: `zoomable: boolean`, `zoomed: boolean`, `hiddenCount: number`; emit `zoom: []`.
- `stores/workspace.ts`: `Tab.zoom?`, `toggleZoom(paneKey)`, `clearZoom(tabKey)`, `closedStack`, `recordClosed(keys)`, `reopenClosed(): { keys: string[]; from: string[] } | null` (key pane mới ↔ key cũ để `dustIn`).
- `lib/dust.ts`: `dustOutAll(els, later, opts?: { keep?: (el: HTMLElement) => string | undefined })` giữ bitmap theo key; `dustIn(el: HTMLElement, key: string): Promise<boolean>` (false = không có bitmap / reduced motion → caller tự fade); `dropKept(key)`.
- `usePaneInfo`: `railStateOf(pane): RailState | null`, `stateText(pane): string | null`, `activityOf(pane): { tool: string | null; since?: string; diff?: GitDiffStat } | null`.
- `settings.dimInactive: Ref<boolean>`.

## 5. Kiểm

- Mỗi agent: test unit file mình + `vue-tsc` không lỗi ở file mình. Không chạy E2E (Electron 1 instance).
- Con: typecheck root, test web/desktop/collector, build, E2E `v52-polish.cjs` mới (header 220px không tràn, chữ trạng thái thống nhất, zoom, hoàn tác đóng + resume, dim toggle + tip, menu chuột không tô, Mission lọc + lấp màn, đo frame bụi ghép ngược) + chạy lại `v50-groups`, `v51-compact`, `rail`, `pane-drag`, `tabs-cwd`.

## 6. Trạng thái (2026-10-16): XONG, chờ chủ nhân chạy thử

- Typecheck root sạch; test web 682/682; build web + desktop OK.
- E2E `v52-polish.cjs` 35/35 (bụi bay ra worst 24 ms, ghép lại worst 21 ms, 0 frame > 34 ms).
- Suite đầy đủ: mọi script pass trừ nhóm dùng clipboard (rail "Copy path", split-diff copy, file-editor copy, agent-map copy, v25 dán ảnh) — clipboard Windows trên máy đang hỏng ở mức OS (PowerShell `Set-Clipboard` → `Get-Clipboard` ra rỗng), không liên quan v52. Chạy lại 5 script đó khi clipboard bình thường.
- E2E cũ đã sửa theo UI mới: p4 (`[data-pane-worktrees]`), split / browser / tabs-cwd (`[data-pane-split]`, menu mở bằng chuột focus khung `[data-menu-panel]`), p2 (chữ "Ready"), p5 (lỗi có từ v48: `open(..., { tab: true })`).
- Con chỉnh thêm sau agent: ngưỡng thu header nới ra (cwd ẩn < 380px, nhánh < 440px, diff < 480px, title < 640px), số thứ tự thẻ Mission chuyển lên đầu tiêu đề (tránh nhầm với số pane), thumbnail canh trên, RunBar có container query (refresh / separator < 320px, devtools < 280px), thu/mở cụm dự án trên rail có motion (`.ccm-rail-fold` thay `v-show`), bỏ key thừa `workspace.missionGrid.hint`.
- Còn mở: A4 tô chữ header theo focus cho viewer pane (viewer không nhận prop focus; đã có viền 2px); `role="treeitem"` đặt trên `<button>` (giữ selector E2E cũ).
- Sau khi clipboard bình thường: rail 37/37, split-diff 29/29, file-editor 20/20, agent-map 34/34; v25 30/30 sau khi cho pane Claude mở tab riêng (lỗi cũ từ v48: pane Claude thành split hẹp, token `[Image #3]` bị Claude ngắt dòng giữa chừng nên tray không nhận ra — giới hạn có sẵn của bộ quét prompt khi pane hẹp, chưa sửa).
- Thêm theo chủ nhân: Quick Look cho attachments (`AttachmentLook.vue`, `Attachment.view` ≤ 960px), v52 E2E thêm 6 bước → 41/41.
