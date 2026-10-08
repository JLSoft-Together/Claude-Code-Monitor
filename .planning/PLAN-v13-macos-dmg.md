# PLAN v13 — macOS DMG (Electron)

Mục tiêu: ngoài NSIS + portable (Windows), xuất thêm `.dmg` cho macOS (arm64 + x64) và app chạy đúng
trên Mac ở mức "giám sát đầy đủ" (= PLAN-v8 bước 1). Focus terminal / chọn thư mục / mở Claude mới /
toast vẫn chỉ Windows (web hiện thông báo `unsupported` như cũ).

## Ràng buộc

- DMG chỉ build được trên macOS (hdiutil + symlink trong `Electron.framework`) → build bằng
  GitHub Actions `macos-latest` (hoặc máy Mac: `npm run dist:mac`). Windows vẫn `npm run dist:win`.
- Chưa có Apple Developer ID → ký **ad-hoc** (`identity: "-"`, `hardenedRuntime: false`), không notarize.
  Arm64 bắt buộc có chữ ký (không ký = "app is damaged"). Người dùng mở lần đầu: System Settings →
  Privacy & Security → Open Anyway (hoặc `xattr -dr com.apple.quarantine "/Applications/Claude Code Monitor.app"`).

## Collector (PLAN-v8 bước 1, mục 1–4)

1. `process.ts`: `ProcessInfo.start` = `{kind:'filetime'}` | `{kind:'lstart'}`; `parsePsOutput` (thuần) +
   `queryProcessesUnix` (`ps -o pid=,ppid=,lstart=,comm=` + 1 lệnh tên cha, `LC_ALL=C TZ=UTC`, không shell);
   `procStartMatches` so lstart sau khi gộp khoảng trắng.
2. `config.ts`: `verifyProcesses` bật cho win32/linux/darwin.
3. `datadir.ts` `defaultDataDir(env, platform, home)`: win `%LOCALAPPDATA%/ccm`, mac
   `~/Library/Application Support/ccm`, khác `$XDG_DATA_HOME/ccm` | `~/.local/share/ccm`. Bridge
   (`statusline-bridge.mjs`) chép logic + test so khớp.
4. `opener.ts`: mac `open <dir>` / `code` trên PATH → `open -a "Visual Studio Code"`; linux `xdg-open` / `code`.
   i18n `open.app.explorer` → "Thư mục"/"Folder".

## Desktop

- `main.ts`: data dir dùng `defaultDataDir`; mac: lấy PATH từ login shell (GUI app chỉ có PATH tối giản),
  menu ứng dụng (app/edit/window — Cmd+C/V/Q), `activate` → mở lại cửa sổ, tray `ccmTrayTemplate.png`,
  bỏ AUMID / balloon, login item không `path/args`, hỏi chuyển vào /Applications khi chạy từ DMG/Downloads.
- `bridge.ts`: tìm `node` theo PATH (không `where.exe`); fallback mac/linux = `statusline-bridge.sh`
  (`ELECTRON_RUN_AS_NODE=1 exec <exe>`), chmod 755.
- `strings.ts`: chuỗi tray/move theo nền tảng ("Chạy cùng Windows" → "Mở khi đăng nhập" trên mac).
- `make-icon.mjs`: thêm `ccm-512.png` (có lề theo lưới icon macOS) + `ccmTrayTemplate{,@2x}.png`.
- `electron-builder.yml`: `mac` dmg arm64 + x64, icon png 512, ad-hoc, category developer-tools.
- Scripts: `dist:mac` (desktop + root).

## Build

- Trên Mac: `npm ci && npm test && npm run dist:mac` → `apps/desktop/release/*.dmg`.
- CI (repo public → runner macOS miễn phí): `.github/workflows/desktop.yml`, `workflow_dispatch` + tag `v*`
  → job mac (`dist:mac`) + job win (`dist:win`), upload artifact. Không publish release tự động.
  Workflow chỉ chạy được sau khi file đã push lên GitHub.

## Test

`process.test.ts` (parsePsOutput, lstart match), `datadir.test.ts` (3 nền tảng, so với bridge),
`opener.test.ts` (3 nền tảng × 2 app + ENOENT), `monitor.test.ts` ca lstart (khớp / PID tái dùng).

## Kiểm trên máy thật (chủ nhân)

1. Chạy workflow → tải `Claude-Code-Monitor-<ver>-arm64.dmg` → kéo vào Applications → Open Anyway.
2. Mở 2 session `claude` trong Terminal/iTerm → hiện thẻ; tắt 1 session → ended ≤ 60 s.
3. Tray menu bar, Cmd+Q thoát, Cmd+W ẩn, bấm Dock mở lại; status line bridge ghi vào
   `~/Library/Application Support/ccm/statusline/`.

## Ngoài phạm vi

Notarize / Developer ID, auto update, universal binary, focus terminal / folder picker / launcher / toast trên mac.
