# PLAN v47 — Agent Map interactions (IDE-grade)

Owner (2026-10-15): "Tab Monitor, Agent Map ít tương tác — vd bôi đen text để copy…".

## 1. Audit (trước v47)

| Mảng | Có | Thiếu |
|---|---|---|
| Chọn | Click node = mở `AgentDetails` (popover cạnh node) + lineage dim; Ctrl/⇧+click chọn nhiều **session** (map All) để kéo cả cụm | Không có "cursor" bàn phím tách khỏi details; box select không có (`elements-selectable=false`) |
| Text | Không bôi đen được: `.vue-flow__node { user-select: none }`, mousedown trên node = kéo node | Không copy được tên / mô tả / model |
| Context menu | `AgentContextMenu` (v25): Show in workspace / Open in GolAIm (confirm 2 bước) / đưa terminal lên trước / Show session / Show details | Không có copy nào, không có menu nền canvas, không Zoom tới node, không fold |
| Bàn phím | Node `tabindex=0` (1000 tab stop + mọi edge cũng focusable); Shift+F10 / ContextMenu mở menu; F = fit, Esc đóng details (global) | Mũi tên của Vue Flow **di chuyển node** đã chọn (picked) thay vì điều hướng; không Enter / Ctrl+C / tìm |
| Tìm | — | Không tìm được node theo tên / task / id |
| Zoom / fit | Toolbar + / − / Fit (F) / Reset layout, `ui.focusTerminal` zoom theo session | Không "zoom tới agent" |
| Hover | `title` tooltip trên tiêu đề, phụ đề, model, tokens | — (đủ) |
| Feedback / a11y | Status = icon + text | Không có "Đã sao chép", node không có aria-label / mô tả phím, không focus ring riêng |
| Cây | — | Không thu gọn / mở rộng nhánh |
| Timeline | `ToolTimeline` riêng (roving tabindex, ←/→) — không dùng chung node | Ngoài phạm vi v47 |

## 2. Đề xuất + trạng thái

- [x] **Bôi đen text**: tiêu đề, phụ đề, chip model có `nodrag select-text cursor-text` — kéo trên chữ là bôi đen (không kéo node, không pan); kéo ở phần còn lại của card vẫn kéo node; nền canvas vẫn pan. Click kết thúc một lần bôi đen không mở details. Ctrl+C khi có vùng chọn = copy native. `AgentDetails` cũng `select-text`.
- [x] **Context menu node** (dùng `ui/ContextMenu`, entries ở `lib/mapMenu.ts`): Show in workspace / Open in GolAIm (session còn chạy → submenu "Open anyway" kèm cảnh báo, `wrapHint`) / Go to terminal window · Copy summary (Ctrl+C) · Copy ▸ Name, Agent ID, Session ID, Working directory, Branch, Task description, Session as text · Copy N selected sessions (khi đang chọn nhiều) · Show/Hide details (↵) · Zoom to agent · Show session · Collapse/Expand subtree (Space).
- [x] **Menu nền canvas**: Fit (F), Reset layout, Expand all, Collapse all, Show/Hide finished, Copy map as text, Find (Ctrl+F).
- [x] **Bàn phím** (roving tabindex: 1 tab stop cho cả map; node/edge của Vue Flow không focusable, `disable-keyboard-a11y` để mũi tên không kéo node): ↑↓ trong cột session, ← cha (ở root: session trước), → con đầu (ở root: session sau; node đang gập thì → mở ra), Home/End; Enter = details, ⇧Enter = Show in workspace; Space = gập/mở nhánh; Ctrl+C = copy tóm tắt (hoặc cây các session đang chọn nhiều); Ctrl+F hoặc `/` = tìm; Esc: đóng tìm → details (global) → bỏ chọn nhiều; F = fit (global); Shift+F10 / phím Menu = menu. Pan giữ node trong khung khi di chuyển.
- [x] **Tìm**: thanh tìm dưới toolbar, khớp tên / type / mô tả / model / id (gồm agent trong nhánh gập — tự mở nhánh), "1 of 3", Enter / ⇧Enter / ↑↓ chuyển, node khớp viền accent, node không khớp mờ đi, zoom tới kết quả; Esc đóng và focus node vừa tìm.
- [x] **Thu gọn nhánh**: `ui.collapsedAgents` (bộ nhớ, dùng chung map All và tab session); nút ⌄ / "› +N" ở mép dưới node; layout tính lại qua `structureKey` (vẫn incremental).
- [x] **Multi-select → copy**: tận dụng chọn nhiều session sẵn có (Ctrl/⇧+click) — Ctrl+C / menu "Copy N selected sessions" = cây text các session đó. Box select của Vue Flow **không làm** (cần `elements-selectable`, đụng logic kéo cụm).
- [x] **Feedback / a11y**: dòng trạng thái `role=status` ("Session ID copied" / lỗi clipboard), focus ring `outline-focus` khi focus bằng phím, node `role=group` + `aria-roledescription` + aria-label (tên · trạng thái) + `aria-describedby` mô tả phím; ShortcutsDialog thêm 6 phím map.
- [ ] **Export PNG**: bỏ — không có thư viện html-to-image trong repo, chụp DOM Vue Flow (SVG edge + HTML node + font bundle) không đủ tin cậy để thêm dependency chỉ cho việc này.
- [x] **SessionCard dùng chung menu node** (follow-up): `nodeMenu` scope `card` (bỏ Zoom / Show session / Fold / Copy N selected), logic chung ở `composables/useAgentActions.ts` (AgentMap cũng dùng). Card focus được (tabindex, outline focus): Shift+F10 / phím Menu mở menu, Ctrl/⌘+C copy tóm tắt main agent, dòng "copied" `[data-card-notice]`. Show details = chuyển map + zoom session + mở details main agent. `AgentContextMenu.vue` đã xoá (không còn ai dùng).
- [x] **Phím tắt theo nền tảng** (follow-up): `lib/shortcuts.ts` dùng token `Mod`/`Ctrl`/`Alt`/`Shift` + `formatKeys`/`keyCombo` — macOS ⌘ (Mod), ⌃ chỉ cho Control thật (⌃ + cuộn zoom, ⌃⇧Tab / ⌃⇧D của diff), ⌥, ⇧, thứ tự ⌃⌥⇧⌘; Windows giữ Ctrl+/Alt+/Shift+. Áp cho ShortcutsDialog, hint menu map/card, kbd + aria-keyshortcuts nút palette, hint ⇧↩ palette, chuỗi i18n (map node keys, tour palette, Shift+F7, Alt+↑/↓) qua tham số; sửa thứ tự ⌘⇧ → ⇧⌘ / ⌘⌥ → ⌥⌘ ở menu explorer / rail / chip. Chưa đụng: badge KeyHint (⇧B — keycap gọn), `layout.keysCompare` (Tab / Shift+Tab, vùng Layout Preview của agent khác).

## 3. Hiệu năng (~1000 agent)

- `buildNav` chỉ dựng lại khi `structureKey` đổi (cache), không theo từng event trạng thái.
- `hideCollapsed` / `childCounts` O(n), không spread mảng trong vòng lặp.
- Node đọc `tabStop` / `matches` qua inject: đổi cursor chỉ render lại 2 node; danh sách khớp tìm chỉ tính khi thanh tìm mở và có chữ.

## 4. Test

- Unit follow-up: `lib/shortcuts.test.ts` (win/mac, thứ tự modifier, run F7 ⇧F7, không còn token thô trên mac), `lib/mapText.test.ts` thêm menu card. E2E `agent-map.cjs` §6: chuột phải session card → Copy ▸ Session ID → clipboard + notice, Shift+F10 / Esc trả focus, Ctrl+C card.
- Unit: `lib/mapNav.test.ts` (cột, ←→↑↓ Home End, fold đếm đúng kể cả gập lồng nhau), `lib/mapText.test.ts` (tên, session id theo provider, thời lượng, tóm tắt, cây text, search text, entries menu node/canvas).
- E2E `apps/desktop/e2e/agent-map.cjs` (fixture `scripts/demo-fixture.mjs` tĩnh, không đụng session thật): menu → Copy ▸ Session ID → clipboard + dòng "copied"; kéo bôi đen tiêu đề (node không dịch, details không mở) + Ctrl+C; ↓ ← Enter Ctrl+C Space; Ctrl+F tìm id → "1 of 1" + highlight, Esc focus kết quả; `/`; menu nền → Copy map as text. `v25.cjs` đổi selector sang `[data-context-menu] [data-menu-id=show-in-workspace]`. Đã thêm vào `run.cjs`.
