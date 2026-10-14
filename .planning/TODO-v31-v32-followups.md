# v31/v32 — việc còn lại (2026-10-15)

Sau khi xong v31 (Run pane) + v32 (XML Layout Preview).

Đã xong (2026-10-15, chưa commit):
- [x] Chạy Flutter (thiết bị Android) làm mới model preview (`afterRunTarget`, 1 lần / session).
- [x] Watch res sinh ra trong `build/` (generated res, qua thư mục module, debounce 1.5 s); refresh cùng payload gửi `changed res` + `classes`.
- [x] Daemon giữ warm cache 3 project (`projectId`, `classesChanged`), đổi project không nạp lại toàn bộ.
- [x] Compare mode có zoom + blueprint (`LayoutBoxes.vue`, `compareCellAt`).

Chưa làm:
- [ ] E2E (`apps/desktop/e2e/run.cjs`) với flutter/adb/gradlew giả — cần build app trước.
- [ ] Thử trên macOS.
- [ ] Daemon dùng API nội bộ Paparazzi alpha (2.0.0-alpha05.1) → nâng version có thể vỡ render; cần test lại khi bump.
- [ ] Layout trong module library mượn model của một app module.
- [ ] Compare: phím mũi tên / Enter chỉ có ở single view; caption cell bị cắt khi zoom nhỏ.
- [ ] Thử thật trong app: Flutter run → model chip đổi; sửa resValues + build → preview cập nhật; đổi qua lại 2 project → log `(warm)`.

Liên quan: `.planning/PLAN-v31-run-android-flutter.md`, `.planning/PLAN-v32-xml-layout-preview.md`, `.planning/PLAN-v31-v32-tasks.md`.
