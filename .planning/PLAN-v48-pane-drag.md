# v48 — Kéo-thả pane / tab trong Workspace (kiểu Deck)

## Context

Hiện tại mỗi terminal Claude Code thường nằm ở **một tab riêng** (ảnh 1–2): muốn xem nhiều agent cùng lúc chỉ có Mission Control (thumbnail nhỏ) hoặc nút Split (luôn tạo pane *mới*). Không có cách đưa các terminal **đang chạy** vào cạnh nhau, hay sắp xếp lại các pane đã split.

Mong muốn (ảnh 3–4, giống app Deck trong `src/spacevibe-deck`): các terminal xếp cạnh nhau trong một tab, **kéo header của pane thả vào cạnh trái/phải/trên/dưới của pane khác** để dock (tạo split lồng nhau), giữ Ctrl/⌘ khi thả để **hoán đổi** hai pane, và **kéo một tab thả vào khung** để gộp terminal của tab đó vào tab hiện tại.

Nền tảng đã có: `apps/web/src/lib/splitLayout.ts` (cây split thuần, `splitLeaf/removeLeaf/boxes/dividers/neighbor`), store `apps/web/src/stores/workspace.ts` (`Tab.root: LayoutNode`, panes render phẳng trong canvas theo box → đổi layout **không remount terminal**), divider resize đã có trong `WorkspaceView.vue`. Quyết định của user: nút “+” vẫn mở **tab mới** như cũ.

## 1. Layout thuần — `apps/web/src/lib/splitLayout.ts`

Port từ Deck `src/spacevibe-deck/src/lib/split-tree.ts` (`movePane`, `dockNewPane`, `dockIntoLeaf`, `swapLeaves`) sang kiểu `LayoutNode` của mình:

- `export type Edge = 'left' | 'right' | 'top' | 'bottom'`
- `dockTree(n, target, sub: LayoutNode, edge)` — thay leaf `target` bằng `{dir, ratio: 0.5, a, b}`, `sub` ở `a` khi edge left/top (row cho left/right, col cho top/bottom). Trả `n` nguyên tham chiếu khi không có target.
- `movePane(n, src, target, edge)` — `removeLeaf(src)` rồi `dockTree(…, {pane: src}, edge)`; no-op (trả `n`) khi src === target hoặc thiếu leaf.
- `swapPanes(n, a, b)` — đổi chỗ hai leaf, giữ nguyên dir/ratio.
- `edgeAt(rect, x, y): Edge` (cạnh gần nhất theo khoảng cách chuẩn hoá — `edgeFor` của Deck) và `dropTargetAt(rects, x, y, exclude)`.
- Test thêm vào `apps/web/src/lib/splitLayout.test.ts` (dock 4 cạnh, move giữ nguyên số leaf, swap, no-op, edgeAt các góc/chéo, dock tree con nhiều leaf).

## 2. Store — `apps/web/src/stores/workspace.ts`

Thêm và export:

- `movePane(src, target, edge)` — cùng tab: `tab.root = movePane(...)`. Khác tab (dùng cho bước 4): gỡ `src` khỏi tab nguồn (`removeLeaf`; tab rỗng thì xoá tab, chỉnh `focus`), `dockTree` vào tab đích. Sau đó `activate(src)`.
- `swapPanes(a, b)` — chỉ khi cùng tab.
- `mergeTab(tabKey, target, edge)` — `dockTree(targetTab.root, target, srcTab.root, edge)`, xoá tab nguồn, giữ `project` của tab đích, focus = focus cũ của tab nguồn.
- `detachPane(key)` — gỡ pane khỏi tab (nếu tab còn ≥ 2 pane) và đẩy tab mới `{ root: {pane:key}, focus: key, project: tab.project ?? pane.cwd }` ngay sau tab cũ.
- Persist đã tự chạy qua watcher hiện có của `tabs`; không đổi format lưu.
- Test store (file test workspace store hiện có, cùng pattern): move cross-tab xoá tab rỗng, merge giữ project, detach.

## 3. Composable kéo — `apps/web/src/composables/usePaneDrag.ts` (mới)

Theo pattern `composables/useClusterDrag.ts` + `pane-drag.ts` của Deck:

- Một `pointerdown` uỷ quyền trên canvas và tab strip. Nguồn kéo:
  - **pane**: `closest('[data-pane-grip]')` — header TermPane (vùng trống, bỏ qua `button, a, input, [data-no-drag]`) và một grip trong `ViewPaneControls.vue` cho viewer pane. Chỉ bật khi tab có ≥ 2 pane (`multiPane`) hoặc khi có ≥ 2 tab (để kéo ra tab strip / sang tab khác qua strip không cần — xem dưới).
  - **tab**: `closest('[data-tab]')` khi `workspace.tabs.length > 1`.
- Ngưỡng 5 px; khi bắt đầu kéo: bật một **shield** trong suốt phủ canvas (chặn iframe/webview của BrowserPane và xterm nuốt pointer), ghost nhỏ theo con trỏ (icon + nhãn pane/tab), overlay trong canvas (`absolute rounded-card border border-accent bg-accent-soft`, transition left/top/width/height 120ms, tắt khi `prefers-reduced-motion`).
- Hit-test: rect của `[data-pane]` đang hiển thị (lấy từ DOM khi bắt đầu kéo, tính lại khi resize). Overlay = nửa pane phía cạnh `edgeAt`; giữ Ctrl (⌘ trên mac, theo `isMac`) → overlay phủ cả pane = swap (chỉ cho nguồn pane). Thả lên chính pane nguồn / tab nguồn đang active → không làm gì.
- Pane kéo lên **tab strip** (vùng trống, không phải tab khác) → overlay dải accent ở strip, thả = `detachPane`.
- Esc / `pointercancel` huỷ; nuốt click ngay sau khi thả (như `useClusterDrag.finish`) để không kích hoạt `onTabClick` / nút trong header.
- Commit qua `withViewTransition` (`lib/motion.ts`) — các pane đã có `view-transition-name` nên trượt mượt về vị trí mới.
- Live region (sr-only) thông báo kết quả: “Đã chuyển pane sang phải …”.

## 4. Gắn vào UI

- `apps/web/src/components/workspace/WorkspaceView.vue`: gọi `usePaneDrag(canvas, tabStrip, {...})`, render overlay/shield/ghost trong canvas (Teleport ghost ra body), class `select-none` khi đang kéo, tắt resize divider khi kéo. Handlers → `workspace.movePane/swapPanes/mergeTab/detachPane`.
- `TermPane.vue`: header thêm `data-pane-grip`, `cursor-grab` + `title` “Kéo để di chuyển” khi `multi`; các nút trong header không phải grip (đã là `<button>`).
- `ViewPaneControls.vue`: thêm nút grip (`GripVertical` lucide, `data-pane-grip`, `aria-hidden` cho icon, label i18n) trước nút Split; viewer wrapper trong WorkspaceView đã có `data-pane`.
- Tab button: thêm `cursor-grab` khi kéo được; không đổi click/keyboard hiện có.
- **Bàn phím** (thay thế cho kéo): `Alt+Shift+←↑→↓` / `⌥⌘⇧+mũi tên` (mac) = hoán đổi pane đang focus với `neighbor()` theo hướng đó. Thêm vào `lib/workspaceKeys.ts`, `lib/shortcuts.ts` (`wsSwap*`), danh sách Shortcuts. Cùng họ với Alt+mũi tên đổi focus; trong editor Alt+Shift+↑↓ vẫn thuộc editor (`editorKeepsKey`).

## 5. i18n, docs, index

- Chuỗi mới (en + vi) trong file i18n workspace: `workspace.drag.hint`, `workspace.drag.grip`, `workspace.drag.swapHint`, `workspace.drag.newTab`, thông báo live region, nhãn phím tắt.
- `.planning/PLAN-v48-pane-drag.md` (bản của plan này), `.code_index/web.md` (mục v48: `splitLayout` dock/move/swap, store actions, `usePaneDrag`, data attrs), `.code_index/_meta.md` 1–2 dòng.

## Verification

1. `npm test -w @ccm/web -- src/lib/splitLayout.test.ts` + test store; `npm run typecheck`.
2. `npm run desktop:dev` (đóng app đang chạy trước): mở 2 tab Claude cùng project → kéo tab thứ 2 thả vào cạnh phải pane của tab 1 → 2 terminal cạnh nhau, tab 2 biến mất, terminal **không khởi động lại** (scrollback còn nguyên). Mở thêm 1 shell, kéo header thả vào nửa dưới pane phải → layout giống ảnh 4. Giữ Ctrl khi thả → hai pane đổi chỗ. Kéo pane lên tab strip → tách ra tab mới. Esc giữa chừng → không đổi gì. Kéo qua BrowserPane vẫn bắt được. Divider resize vẫn hoạt động. Restart app → layout được khôi phục.
3. Kiểm tra theme sáng/tối, `prefers-reduced-motion`, cửa sổ hẹp (không cuộn ngang).
4. E2E mới `apps/desktop/e2e/pane-drag.cjs` (theo `split.cjs`): split → mô phỏng pointer kéo header sang cạnh trái pane kia → assert thứ tự `[data-pane]` theo `left`; kéo tab vào canvas → số tab giảm, số pane giữ nguyên. Chạy `npm run e2e -w @ccm/desktop` sau khi build web + desktop.

## 6. Bổ sung (owner, 2026-10-15): terminal mới vào tab của project

Thay quyết định "+ vẫn mở tab mới": mọi terminal mới (`workspace.open` — nút "+", rail, Explorer → Terminal, WorktreeMenu, Open Project, resume phiên từ Monitor) **ghép vào tab của project đó** cạnh pane đang focus, không còn tạo tab mới mỗi lần.

- Tab của project: tab đang active nếu `cwd` nằm trong `tabProject` của nó (bằng hoặc thư mục con), ngược lại tab cùng project được focus gần nhất. Home (không cwd) chỉ khớp tab home. Worktree `<repo>-wt/<branch>` là project riêng.
- Vị trí: `splitLayout.dockSpot(root, focus, canvasSize)` — chia pane rộng nhất (pane focus thắng khi bằng nhau) theo cạnh dài, nên 2 → hai cột, 3 → trái + phải chồng hai, 4 → lưới 2 × 2 đều nhau; chia theo cạnh dài (`w ≥ 1.4h` → cạnh nhau, ngược lại chồng dọc), đổi hướng nếu hướng kia không đủ `MIN_PANE` (220 × 140 px). Không pane nào còn chỗ → tab mới. Canvas chưa đo (0 × 0) → cạnh nhau.
- `workspace.canvasSize` do `WorkspaceView` ghi từ ResizeObserver của canvas.
- `open(…, { tab: true })` vẫn ép tab riêng (test Spaces dùng). Spaces (nhiều tab một project) vẫn có qua kéo pane lên thanh tab.
- Trình duyệt / file / changes / log từ menu "+" vẫn mở tab như cũ. Nhãn nút "+" đổi thành "New terminal or tab" / "Terminal hoặc tab mới".
- Test (owner yêu cầu 3, 4 terminal cùng group): `workspace.test.ts` (3 = trái + phải chồng, 4 = lưới 2 × 2 đều, đầy thì sang tab mới), E2E `apps/desktop/e2e/project-panes.cjs` (qua nút "+" thật: 2 / 3 / 4 / 5 terminal, không chồng lấn, mỗi pane ≥ 200 × 120 px, phủ canvas, project khác mở tab riêng, quay lại project cũ thì ghép vào group). E2E cũ dựng nhiều tab cùng folder (`tier2`, `rail`, `p6`) dùng `{ tab: true }`.
