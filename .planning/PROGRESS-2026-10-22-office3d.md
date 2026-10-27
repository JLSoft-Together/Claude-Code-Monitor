# PROGRESS 2026-10-22 — Office theme packs (v62) + Office 3D (v63)

Mới nhất ở cuối. Plan: `.planning/PLAN-v62-office-packs-fullscreen.md`, `.planning/PLAN-v63-office-iso.md`,
contract art `.planning/CONTRACT-v63-office3d-assets.md`, tài liệu `docs/office-iso.md`.

## Phiên 2026-10-22 (cả ngày) — chủ nhân chốt: thêm theme pixel, full screen, rồi một kiểu văn phòng 3D hoàn toàn mới làm OPTION (pixel vẫn mặc định)

- [x] v62: 4 pack pixel (japandi, night-shift, forest-cabin, retro-80s) `apps/web/public/assets/themes/`, chọn pack, Office full screen (Shift+F). Biển lễ tân "Orrery".
- [x] v63 renderer 3D (`apps/web/src/office/iso/`), vendored patch G/H/I (`packages/habblaud/UPSTREAM.md`). Góc chính diện 3/4 (yaw 0, k 0.7), bỏ cảnh ngoài.
- [x] Art 3D (Codex): furniture 81, surfaces, wallart, 6 nhân vật (jin, theo, kofi, mai, rosa, ava), seasonal 6, icons 24 — `apps/web/public/assets/iso3d/`. Nguồn `assets-src/office-3d-*`, `assets-src/office-iso/`.
- [x] Jin persona: cà phê ×2.5, vệ sinh ×3 TỔNG (`office/iso/archetypes.ts`).
- [x] Fix wave 1–2: manifest chars 192×352 + `figure.standH`, thảm 9-slice, ghế xám, kim đồng hồ, biển tên, nhân vật 58 px, max zoom, font Be Vietnam Pro, padding.
- [x] P5: ánh sáng ngày/đêm, hiệu ứng, màn hình, biển 2 dòng, docs. Walk 8 frame rosa/ava/jin-coffee.
- [x] Seasonal 3D + icon 3D + declutter nhãn (✋ chờ duyệt luôn hiện).
- [x] Chuyển kiểu mượt: dựng ngầm + crossfade, hiện dần theo phòng, pill loading >150 ms, preload nhẹ, decode khi có ý định, nhả RAM 60 s, lỗi thì quay về kiểu cũ.
- [x] Xoá bộ nhân vật phẳng cũ `apps/web/public/assets/iso/` (chủ nhân yêu cầu).
- [x] Test cuối: `npm test -w @ccm/web` 110 files / 1191 tests pass; `npm test -w @ccm/habblaud` 54 / 535 pass (golden pixel xanh); `npm run typecheck` OK.
- [x] Chủ nhân thử bản dev, OK. Bản dev đã tắt.
- [x] 16:50 Handoff mới: `.planning/HANDOFF-2026-10-22-1650.md`. Push lên nhánh `feat/office-3d` (chủ nhân yêu cầu).

## Phiên 2026-10-27 13:3x (sau HANDOFF-2026-10-22-1650) — chủ nhân chốt: merge master (--no-commit), header gộp vào thanh tiêu đề cửa sổ (kiểu VS Code), hoàn thiện office 3D + tối ưu hiệu năng
- [x] `git merge --no-commit --no-ff origin/master` (9 commit, tới `d8b4c84`). Conflict: `AgentMap.vue` (giữ fullscreen v62, bỏ timeline + nút Activity theo master), habblaud `world/index.ts` (giữ `personTarget` + `drawnCam`), `.code_index/_meta.md` + `web.md` (giữ cả hai). Patch habblaud của master D/E/F trùng chữ → đổi thành J/K/L (`UPSTREAM.md`, comment `world/index.ts`, `art/api.ts`, `scene.local.test.ts`).
- [x] Golden pixel ghi lại: chỉ đổi hash canvas sprite + nhãn tên lệch 2–3 px do patch J (fake `getImageData` trong recorder trả ảnh trong suốt). Lý do ghi ở `UPSTREAM.md` mục J.
- [x] Kiểm: typecheck OK; web 111/1194; habblaud 55/537; desktop 50/688 pass. Merge CHƯA commit (để chủ nhân commit).
- [x] Header → thanh tiêu đề (chủ nhân chọn "Gộp vào thanh tiêu đề"): `apps/desktop/src/main.ts` `baseWindow` frameless (Win `titleBarStyle:'hidden'` + `titleBarOverlay()` cao `TITLE_BAR_H` 40, màu `look.bar`/`ink`, cập nhật trong `ccm:appearance`; mac `hiddenInset`, đèn {14,14}); `appearance.ts` `Look.bar?`; preload `titleBar`; `pages.ts` dải kéo 40 px cho màn khởi động/lỗi. Web: `lib/desktop.ts` `titleBar`, `lib/appearance.ts` `readLook().bar` (= `--ccm-material` trộn trên canvas), `AppHeader.vue` 1 hàng h-10: logo · tab Monitor/Workspace (+ tab đang mở nếu là màn phụ) · nút ⋯ (`ContextMenu`: Usage/History/Extensions/Devices) · vùng kéo · `PlanLimits compact` · chấm kết nối · compact/search/settings; bỏ chữ tiêu đề, FlipClock, nút ngôn ngữ (có trong Settings). CSS `.ccm-titlebar[data-title-bar]` drag/no-drag (`style.css`). i18n `nav.more`. Test desktop `appearance.test.ts` thêm case `bar`.
- [x] Chủ nhân báo giữa chừng: thả file vào session tự mở panel attachment → bỏ `open = true` trong `stores/attachments.ts` `add()`; test `attachments.test.ts` "adding a drop does not open the tray".
- [x] Kiểm: typecheck OK; web 111/1194 (trước khi thêm test attach) + attachments 6/6; desktop appearance 12/12.
- [ ] Chưa chạy app thật để xem title bar (rule không build verify) → chủ nhân thử `npm run desktop:dev`.
- [x] Đo hiệu năng Office 3D bằng Edge + CDP (dev collector 4417 + Vite, demo 8×4) — chủ nhân sau đó dặn chỉ chạy app desktop, không mở test web → đã tắt hết, gỡ code đo tạm. Kết quả: 3D 1.6 fps headless (pixel 52), 72 % ở `drawSheetCharacter` vẽ thẳng từ sheet 1536×4576; trên Edge GPU tắt riêng sàn 2→6.8 fps, tắt hết các lớp 58 fps. Script `D:/tmp/ccm-prof/prof.mjs` (không thuộc repo).
- [x] Sửa: `office/iso/charFrames.ts` `CharFrames` (frame scale sẵn qua `createImageBitmap`) + `IsoRenderer` `cachedFloor`/`drawFloors` (lớp sàn cache theo camera). Test `charFrames.test.ts`; office 25/272 pass; typecheck web OK. Docs `office-iso.md` §Performance, `.code_index` web/desktop/_meta.
- [ ] Chưa đo lại trên app desktop (chủ nhân tự chạy).
- [x] 15:00 Handoff mới: `.planning/HANDOFF-2026-10-27-1500.md`.
- [x] Chủ nhân: "full cả cho pixel 2D" → vào/ra full màn tự canh khung lại; patch Habblaud M `overview({ fill })` bỏ chặn zoom 4× khi full màn. Test habblaud 55/538, office 2/84 pass, typecheck OK.
- [x] Chủ nhân: "tự build mà test hộ" → chạy dev Electron (4417, user-data `D:/tmp/ccm-dev-userdata-test`, demo 8×4) + CDP `D:/tmp/ccm-prof/*.mjs`. Đã tắt hết sau khi đo.
  - Title bar OK: WCO 137 px, padding 145 px, drag/no-drag đúng; menu ⋯ OK; màn phụ thành tab 3. Fix: nền modal `no-drag`.
  - Full màn: pixel 0.756→1.457 lấp kín, thoát về 0.756. 3D không refit vì fps thấp → `overview(opts)` resize trước khi tính (patch M).
  - 3D: `screens.ts` paintCached (47.8% → ~0), pattern/rug/floor → ImageBitmap (`bitmap.ts`), sheet @1x + @2x lười (`isoArt.ts`). Đo 4–7 fps nhưng Orrery portable (PID 19852) chiếm ~33% GPU iGPU cùng lúc → số đo nhiễu.
  - Chủ nhân: "ở tab workspace đừng chạy canvas monitor" → MonitorView vốn unmount khi sang Workspace; thủ phạm là chấm kết nối `animate-ping` vô hạn trong header blur (18% GPU) → chỉ ping 3 lần. Workspace idle: GPU 0%, renderer 1%.
  - Chủ nhân: "ưu tiên IDE mượt" → 4 shell + 4000 dòng output: 60 fps, renderer 3–8%.
  - Chủ nhân: "asset nặng thì giảm" → đĩa chỉ ~4 MB; RAM giải nén char 177→44 MB nhờ @1x.
  - Test: office 25/273, habblaud 55/538, typecheck web OK.
- [ ] Monitor → Sơ đồ (Vue Flow) ăn ~185% CPU với demo 46 agent → ứng viên tối ưu tiếp.
- [x] 16:00 Handoff mới: `.planning/HANDOFF-2026-10-27-1600.md`.
