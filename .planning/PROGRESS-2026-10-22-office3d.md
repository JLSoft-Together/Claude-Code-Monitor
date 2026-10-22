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
