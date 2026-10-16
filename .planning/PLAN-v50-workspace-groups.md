# v50 — Nhóm pane trên rail, đặt tên tab, trạng thái subagent, Mission Control dễ dùng

> Trạng thái: **đã chốt** (§8) — đang code.

## 1. Yêu cầu (chủ nhân, 2026-10-16)

1. Tab chia nhiều pane (vd Shell + Claude) → rail hiện **nhóm dạng folder** chứa các pane; **đổi tên** nhóm ở rail và ở thanh tab.
2. Trạng thái trên rail chưa chuẩn, chưa có animation: agent chính "Sẵn sàng / Đã xong" trong khi **subagent vẫn chạy** → phải là "đang chờ subagent".
3. Thanh tab + Mission Control **chưa hiện tên session** (ghi "Shell …/acients-book", "acients-book 1…7") → thiết kế lại UI/UX, thêm **context menu + kéo-thả**.
4. Kéo-thả trên rail: **tách pane khỏi nhóm, gộp vào nhóm khác** (cùng project).

## 2. Hiện trạng (audit)

| Chỗ | Tên | Context menu | Kéo-thả |
|---|---|---|---|
| Rail header project | tên folder | ✅ `projectMenu` | ✅ đổi thứ tự (`useClusterDrag`) |
| Rail dòng session | ✅ tên session (`displayTitle`) | ✅ `rowMenu` | ❌ |
| Rail tab nhiều pane | ❌ chỉ hiện agent, shell bị ẩn, không có nhóm | — | ❌ |
| Thanh tab | ❌ preset của pane đầu ("Shell") | ❌ | chỉ kéo tab xuống canvas (gộp), không đổi thứ tự |
| Mission Control thumbnail | ❌ `spaceLabel` = "<project> N" | ❌ | ❌ |
| Mission Control thẻ pane | ✅ `titleOf` | ❌ | ❌ |
| Canvas pane | — | menu split ở header | ✅ v48 dock / swap / tách / gộp |

Trạng thái: `railModel.paneState` chỉ đọc `TerminalSession.status`; `useWorkspaceLinks` latch "done" khi main working → idle kể cả còn subagent chạy. Store đã có `movePane`, `swapPanes`, `mergeTab`, `detachPane` (v48) → kéo-thả rail / Mission Control tái dùng.

## 3. Tên tab (một nguồn duy nhất)

- `Tab.name?: string` (persist cùng tabs: sessionStorage, `ccm.workspace.last`, saved layouts).
- `tabTitle(tab)` = `tab.name` › tên session đã link của pane chính (`usePaneInfo().labelOf`: alias › title; shell gõ `claude` tay vẫn ra tên session) › nhãn preset / viewer.
- Dùng ở: thanh tab, tooltip, rail (header nhóm; dòng đơn khi tab có tên), Mission Control (thumbnail), live region.
- Đổi tên: double-click / F2 / menu "Đổi tên tab" ở thanh tab, header nhóm rail, dòng rail, thumbnail Mission Control. Inline input (`useInlineEdit`): Enter lưu, Esc huỷ, blur lưu, rỗng = về tên mặc định, ≤ 60 ký tự.

## 4. Rail nhóm

- Tab có ≥ 2 pane terminal / run (shell cũng tính) → **header nhóm**: chevron, icon folder, tên (`tabTitle`), số pane, badge trạng thái gộp khi đang gập; con thụt vào 1 bậc, mỗi pane 1 dòng (shell hiện "Shell · Sẵn sàng" hoặc tên lệnh). Tab 1 pane: như cũ.
- Gập/mở: `Tab.folded` (persist). Click header = vào tab; chevron / ←→ = gập mở.
- Menu header nhóm: Đổi tên, Gập/Mở, Tách nhóm (mỗi pane 1 tab), Đóng tab.
- Menu dòng: thêm "Đổi tên tab", "Chuyển vào nhóm ▸ <các tab cùng project>", "Tách khỏi nhóm" (= bản bàn phím của kéo-thả).

## 5. Kéo-thả rail (cùng project)

- Kéo dòng pane → thả lên dòng / header nhóm khác **cùng project** = gộp (`movePane` cạnh pane đích, cạnh theo `dockSpot`); thả vào khe giữa các tab / cuối project = tách ra tab riêng (`detachPane`).
- Kéo header nhóm → thả lên tab khác cùng project = gộp cả tab (`mergeTab`).
- Khác project: con trỏ "không cho", không có vạch thả. Ngưỡng 5 px, Esc huỷ, ghost + vạch/khung đích, live region đọc kết quả (như v48).

## 6. Trạng thái + animation

- `runningSubagents(terminal)` = subagent `working | waiting` (agents store). `RailState` thêm `subagents`: main idle + subagent chạy → "Chờ 2 subagent"; main working + subagent → "Đang chạy · 2 subagent".
- Latch attention dùng trạng thái hiệu dụng (idle + subagent chạy = working) → "Đã xong" chỉ khi subagent cũng xong.
- Icon trạng thái ở thanh tab + header TermPane dùng cùng trạng thái hiệu dụng.
- Animation (tắt hết khi reduced motion): dòng working / subagents có vạch trái 2 px màu `st-working` thở (`ccm-breathe`) + spinner badge; đổi trạng thái → dòng chữ thứ 2 crossfade 150 ms; chuyển sang "Cần bạn" / "Đã xong" → `ccm-flash` 1 lần.

## 6b. Motion cho mọi thay đổi (chủ nhân, 2026-10-16)

Mọi thêm / xoá / đổi tên / đổi trạng thái session, tab, nhóm, project phải có cảm giác: list enter/leave (`TransitionGroup` `ccm-list` / `ccm-tab`, FLIP khi đổi chỗ), đổi tên → `ccm-highlight` 1 lần trên tên, đổi trạng thái → crossfade chữ + `ccm-flash` khi sang Cần bạn / Đã xong / Lỗi, gập-mở nhóm → chevron xoay + chiều cao/opacity (transform/opacity, không layout jank), kéo-thả → ghost + vùng thả sáng lên + phần tử rơi vào chỗ mới có FLIP. Dùng token `--ccm-dur-*`, `ease-spring`; tắt hết khi reduced motion (giữ đổi màu tức thời).

## 7. Mission Control

Xem §8 câu 1. Chung cho mọi phương án: nhãn = `tabTitle`, badge trạng thái gộp + số pane, menu (Vào tab, Đổi tên, Tách nhóm, Đóng) trên thumbnail; menu thẻ pane (Focus, Chuyển vào tab ▸, Tách ra tab riêng, Đóng pane); kéo thẻ pane lên thumbnail khác cùng project = chuyển vào tab đó, kéo thumbnail lên thumbnail = gộp tab, thả vào ô "+ Tab mới" = tách.

## 8. Quyết định (2026-10-16)

1. Mission Control: **lưới thẻ** — mỗi tab 1 thẻ lớn (tên, trạng thái gộp, vài dòng output cuối của từng pane, chia ô theo pane), xếp theo project; bấm = vào tab; kéo thẻ / pane để gộp-tách; bỏ bước hover-preview.
2. Đổi tên **chỉ đổi tên tab** (alias session Monitor giữ nguyên).

## 9. Nền chung (đã làm, 2026-10-16)

- `stores/workspace.ts`: `Tab.name?` (`cleanTabName`, ≤ 60, ký tự điều khiển bỏ), `Tab.folded?`, persist sessionStorage + `ccm.workspace.last` (saved layouts chưa mang tên: validator desktop chưa có field). `tabTitle(tab, paneOf, titleOf)`. Action `renameTab`, `moveTab`, `setFolded`, `ungroup`, `movePaneToTab` (dock cạnh focus của tab đích theo `dockSpot`).
- `composables/usePaneInfo.ts`: `titleOf`, `tabTitle`, `subagentsOf`, `statusOf` (idle + subagent chạy = working). `lib/subagents.ts` `runningSubagents` (subagent working|waiting), `effectiveStatus`.
- `composables/useRail.ts`: `clusterOfTab`, `sameProject` (cùng project = cùng cluster rail).
- `components/workspace/TabRenameInput.vue` (inline, Enter/blur lưu, Esc huỷ, rỗng = tên tự động).
- Xoá kiểu "Thanos" (`lib/dust.ts`, chủ nhân 2026-10-16): IPC desktop `ccm:capture-rect` (main `capturePage` vùng CSS px × zoom, ≤ 4 MP, chỉ app frame) → PNG → `createImageBitmap` → chia pixel vào 20–28 lớp canvas (lớp theo x + ngẫu nhiên, ảnh thu ≤ 200k px) → mỗi lớp WAAPI bay lên-phải, xoay nhẹ, blur, mờ dần (1.1 s, trễ 30 ms/lớp) trên overlay `[data-dust]` fixed, pointer-events none. Phần tử gốc ẩn ngay sau khi chụp → layout dồn ngay (FLIP), bụi bay độc lập. `onDustLeave` cho TransitionGroup, `dustOut` cho xoá tay. Reduced motion / không có desktop → không bụi.
- i18n: `i18n/workspace-v50.ts` (`tabName`, `tabActions`, `paneDrop`, `subagentState`) + file riêng mỗi mảng (`-rail`, `-tabs`, `-mission`).

## 10. Owner follow-ups (2026-10-16)

- Rail group header looked like a new project (same leading chevron + Folder icon + bold name as the project header). Now: row-indented, icon = mini map of the tab split (`TabLayoutGlyph`, active pane filled), medium weight, trailing disclosure button (count + chevron) always visible, stem line from the glyph to its members; fold / unfold animates height, members slide + fade with a 28 ms stagger, chevron spring-rotates; all off under reduced motion.
- Colour on icons: only the folder (project) icon is tinted (owner: "icon chỗ thư mục thôi") — `fill-accent-soft text-accent` for live projects, ink-faint for remembered ones. The group glyph and row icons stay monochrome.
- Dust smoothness ("cần nhất là sự mượt mà", lighter effect is fine). Measured with rAF gaps in `v50-groups.cjs` while closing a tab:
  - before: 56 frames in ~2.2 s, worst 103–121 ms, 25 frames over 34 ms;
  - after: ~81 frames over the shorter run (~58 fps), worst 26–37 ms, 0–1 frames over 34 ms.
  - Causes and fixes: (1) main encoded a full HiDPI PNG → scale to layout size ≤ 160k px before `toPNG` (`capture.ts`); (2) renderer split 20–28 full-size ImageData per element on the main thread → Uint32 copy, layers cropped to their x band, 8–16 layers by size, `createImageBitmap` + `bitmaprenderer`, element stays visible until the dust is ready; (3) `filter: blur()` keyframes on every layer were not compositor-only → transform + opacity only; (4) the pane View Transition captured the page in the same frame the dust started and froze the overlay → no View Transition on a dust close, overlay named `ccm-dust` (old snapshot hidden) for any other transition; (5) strip tab / rail row were captured after the pane dust flew over them, each with its own IPC → captured with the panes up front, ground, kept 4 s, their leave only plays; calls in one tick are batched.
