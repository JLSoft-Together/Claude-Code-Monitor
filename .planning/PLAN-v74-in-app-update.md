# PLAN v74 — Cập nhật trong app (GitHub Releases)

Mục tiêu: đang chạy 2.4.0, GitHub có 2.5.0 → app báo, bấm **Tải & cài**, app tự tải, kiểm tra, cài, khởi động lại. Không phải lên GitHub tìm file.

## Dữ kiện đã kiểm (2026-10-29)

- Repo `JLSoft-Together/Claude-Code-Monitor` **public** → gọi `GET /repos/.../releases/latest` không cần token (60 lần/giờ/IP, thừa).
- Release có 4 file: `Orrery-Setup-x.exe`, `Orrery-Portable-x.exe`, `Orrery-x-arm64.dmg`, `Orrery-x-x64.dmg`. Không có `latest.yml` / `.blockmap`.
- Mỗi asset có trường `digest: "sha256:…"` do GitHub tính → dùng để kiểm file tải về, không cần sửa workflow release.
- macOS ký ad-hoc (`identity: '-'`), không notarize → **Squirrel.Mac / `electron-updater` MacUpdater không chạy** (đòi chữ ký Developer ID). Portable cũng không được `electron-updater` hỗ trợ.
- `main.ts` đã có `PORTABLE_EXE` (`PORTABLE_EXECUTABLE_FILE`), `confirmQuit()` (auto-save / hỏi file chưa lưu), `before-quit`.

## Quyết định

Tự viết updater nhỏ trong main process (`apps/desktop/src/update/`), **không thêm `electron-updater`**: một luồng cho cả 3 kiểu cài, dùng digest GitHub có sẵn, không phải đổi workflow. Đánh đổi: tải full ~150 MB (không có delta blockmap) — chấp nhận.

## Luồng

1. **Check** — 30 s sau khi mở app, rồi mỗi 12 h (một `setTimeout`, không polling dày), + nút "Kiểm tra cập nhật". Tắt được trong Settings. Bỏ qua bản `prerelease` / `draft`. So sánh semver với `app.getVersion()`; chỉ báo khi lớn hơn.
2. **Báo** — chấm trên icon Settings + banner nhỏ ở header "Có bản 2.5.0 · Xem". Dialog: version, ngày, release notes (markdown body GitHub, render sanitize), nút **Tải & cài** / **Để sau** / **Bỏ qua bản này**.
3. **Chọn asset** theo kiểu cài:
   - Windows NSIS (không có `PORTABLE_EXE`) → `Orrery-Setup-<v>.exe`
   - Windows Portable → `Orrery-Portable-<v>.exe`
   - macOS → `Orrery-<v>-<process.arch>.dmg`
   - Dev (`!app.isPackaged`) → chỉ check + mở trang release, không cài.
4. **Tải** — `net.fetch` từ `browser_download_url` (chỉ chấp nhận host `github.com` + redirect `*.githubusercontent.com`), ghi `<DATA_DIR>/updates/<file>.part`, tiến độ % + MB/s về UI, huỷ được. Xong → so SHA-256 với `digest`; sai thì xoá, báo lỗi. Đổi tên bỏ `.part`.
5. **Cài** — bấm **Khởi động lại để cập nhật**: hiện cảnh báo nếu còn pane agent / shell đang chạy ("N phiên sẽ đóng, agent mở lại được bằng resume"), chạy `confirmQuit()` (lưu file), rồi:
   - **NSIS**: spawn detached `Setup.exe --updated /S --force-run` (cờ electron-builder dùng cho update im lặng, cài đè đúng thư mục cũ, tự mở lại), rồi `app.quit()`.
   - **Portable**: ghi script `.cmd` tạm: chờ PID thoát → `move /Y` file mới đè `PORTABLE_EXE` → chạy lại. Spawn detached + `windowsHide`, rồi quit.
   - **macOS**: `hdiutil attach -nobrowse -readonly` → script `sh` tạm: chờ PID thoát → `ditto` `Orrery.app` đè bundle hiện tại (`app.getPath('exe')` → `.app`) → `xattr -dr com.apple.quarantine` → `hdiutil detach` → `open` app. Bundle không ghi được (vd `/Applications` của user khác) → fallback mở dmg trong Finder + hướng dẫn kéo thả.
6. **Sau khi mở lại** — dialog "Có gì mới" sẵn có tự hiện (đã gắn theo version), xoá file trong `updates/`.

## File dự kiến

- `apps/desktop/src/update/{github.ts,semver.ts,pick.ts,download.ts,install.ts,ipc.ts}` — `pick.ts`, `semver.ts` thuần, có test.
- `main.ts` — đăng ký IPC `ccm:update-check|download|cancel|install|state`, timer check, gửi `ccm:update-progress`.
- `preload.ts` — `ccm.update.*`.
- Web: `stores/update.ts`, `components/settings/UpdateSection.vue`, `components/UpdateDialog.vue`, banner header; i18n en/vi; màu theo `COLOR-SYSTEM.md` (accent cho nút chính, `success` khi tải xong).
- Settings: `update.autoCheck` (mặc định bật), `update.skipped` (version).
- `.code_index/desktop.md`, `web.md`, `_meta.md`; `docs/claude-code-integration.md` không cần đổi.

## Test

- Unit: semver (2.10.0 > 2.9.0, bỏ prerelease), `pick` (NSIS / portable / mac arm64 / x64 / thiếu asset), parse digest, từ chối host lạ.
- E2E: mock endpoint release qua env `CCM_UPDATE_FEED` (URL JSON giả + file nhỏ) → check → banner → tải → digest OK → nút restart hiện (không chạy installer thật).
- Thử tay: cài 2.4.0 NSIS + Portable trên Windows, mac 1 máy, lên bản thật khi ra 2.5.0.

## Rủi ro

- SmartScreen / Defender có thể chặn `Setup.exe` chưa ký khi chạy im lặng → ghi log, nếu installer thoát lỗi thì lần mở sau báo "cài chưa xong" + nút mở thư mục chứa file.
- `hdiutil` / `ditto` lỗi quyền → fallback Finder.
- Đang có bản 2.4.0 trên máy: bản đó **chưa có updater**, nên lần lên 2.5.0 vẫn phải tải tay một lần; từ 2.5.0 trở đi mới tự cập nhật.

## Câu hỏi cho chủ nhân

- Mặc định: chỉ **báo**, chủ nhân bấm mới tải (đề xuất), hay tự tải nền sẵn rồi chỉ hỏi khởi động lại?
- Ra kèm 2.5.0 (cần ghi vào dialog Có gì mới + `RELEASE-2.5.0.md`) hay để 2.6.0?
