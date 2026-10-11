# PLAN v17 — Đổi tên Agent Monitor, art mới, chip quota Codex gọn

Yêu cầu (2026-10-11): đổi tên Claude Code Monitor → **Agent Monitor**; thêm art cho sinh động (vẽ bằng Codex CLI image gen); làm gọn chip quota Codex.

## Đổi tên
- Đổi: UI/i18n (`app.title`, tour welcome), `index.html`, manifest, trang collector (`server.ts`), toast test, desktop `productName`/shortcut/artifact/tray/dialog/service name, workflow GitHub, README, CLAUDE.md.
- Giữ (để cập nhật đè, không mất cài đặt): `appId`/AUMID `dev.ccm.monitor`, data dir `ccm`, `CCM_*`, `ccm.*` localStorage, npm `@ccm/*`, tên repo/thư mục.
- `Agent-Monitor.bat` + `Claude-Code-Monitor.bat` chỉ chuyển tiếp (lối tắt cũ vẫn chạy); `launch.mjs` `migrateShortcuts` đổi `.lnk` cũ (project, Desktop, Startup) sang `Agent-Monitor.lnk`.
- Desktop `repairLoginItem`: exe đổi tên theo productName → mục "Chạy cùng Windows" cũ (cùng tên value `dev.ccm.monitor`, cùng thư mục cài) được trỏ sang exe mới.
- macOS: bundle đổi tên → bản cũ còn trong Applications, README dặn xoá.

## Art
- Codex `image_gen` (1 lệnh `codex exec`, 5 ảnh line art đen + 1 điểm đỏ) → potrace (scratchpad, không thêm dependency) → SVG 2 lớp `#8A8880` / `#B4532F` để `ArtImage` thay token.
- Chỗ dùng: ActivityFeed trống, HistoryView trống, CompactView không có session, BreakToast (thay CupSoda), tour welcome; CommandPalette không kết quả dùng lại `empty-project-search`.
- Codex shell trên Windows lỗi sandbox (`helper_unknown_error`) nên không tự chép file; lấy từ `~/.codex/generated_images/<thread>/`.

## Chip quota Codex
- Trước: 2 cột 124px, chữ xuống dòng. Sau: 1 grid 2 hàng (nhãn ngắn · thanh · % · thời gian reset rút gọn `1h 16m` / `6d 3h`), icon chỉ khi warn/critical/risk; dự báo chi tiết trong popover.
- Chip Claude dùng chung layout (cột provider ✱ Claude), theo yêu cầu sau khi xem chip Codex.
- Build lỗi `<template v-for> key should be placed on the <template> tag` → `.bug_feedback/vue-template-v-for-child-key-build-fail.md`.

## Header không đè (màn ~1280–1700px)
- Lỗi: hàng header `xl:flex-nowrap`, 2 chip quota làm tràn → tablist (grid `minmax(0,1fr)`) bị co về ~0, chip đè lên tab.
- Thiết kế: brand + tab không co; cụm quota (1 khung chung Claude | Codex, nửa nào bấm mở popover nửa đó) + cụm điều khiển nằm trong nhóm `flex-wrap-reverse` → thiếu chỗ thì cụm quota xuống dòng dưới điều khiển, không bao giờ đè.
- Ẩn theo độ ưu tiên: < 2xl nút ngôn ngữ/theme (vẫn có trong Settings, Ctrl K) + gợi ý Ctrl K; < 3xl (110rem) ngày ở đồng hồ, tên provider, chữ "Đã kết nối" (còn chấm + tooltip; mất kết nối luôn hiện chữ).

## Tiến độ
- [x] rename + migrate lối tắt / login item
- [x] art 10–14 + gắn vào UI
- [x] chip Codex gọn
- [x] test web 40, collector 126 (không build theo rule)
