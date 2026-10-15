# v31/v32 — việc còn lại (2026-10-15)

Sau khi xong v31 (Run pane) + v32 (XML Layout Preview).

Đã xong (2026-10-15, chưa commit):
- [x] Chạy Flutter (thiết bị Android) làm mới model preview (`afterRunTarget`, 1 lần / session).
- [x] Watch res sinh ra trong `build/` (generated res, qua thư mục module, debounce 1.5 s); refresh cùng payload gửi `changed res` + `classes`.
- [x] Daemon giữ warm cache 3 project (`projectId`, `classesChanged`), đổi project không nạp lại toàn bộ.
- [x] Compare mode có zoom + blueprint (`LayoutBoxes.vue`, `compareCellAt`).

Chưa làm:
- [x] E2E `apps/desktop/e2e/run-pane.cjs` (trong `run.cjs`) với flutter/adb/java/gradlew giả (`e2e/fixtures/run-fakes/`): Flutter run/reload/restart/stop/fail, Android build→install→launch→logcat→stop, needs-you.
- [ ] Thử trên macOS.
- [ ] Daemon dùng API nội bộ Paparazzi alpha (2.0.0-alpha05.1) → nâng version có thể vỡ render; cần test lại khi bump.
- [x] Layout trong module library mượn model của một app module (`pickModule` transitive + `projectDeps`, app ưu tiên lưu `preferred-apps.json`, chip "qua :app" + AppSelect khi nhiều app).
- [x] Compare: phím mũi tên / Enter chỉ có ở single view; caption cell bị cắt khi zoom nhỏ (`stepView`, Tab giữa cell, `COMPARE_CAPTION_MIN`).
- [ ] Thử thật trong app: Flutter run → model chip đổi; sửa resValues + build → preview cập nhật; đổi qua lại 2 project → log `(warm)`.

Liên quan: `.planning/PLAN-v31-run-android-flutter.md`, `.planning/PLAN-v32-xml-layout-preview.md`, `.planning/PLAN-v31-v32-tasks.md`.
