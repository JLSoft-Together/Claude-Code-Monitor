# PLAN v12 — Desktop exe (Electron, Windows only)

Mục tiêu: thay `Claude-Code-Monitor.bat` (cần Node + npm install + build + mở browser) bằng app Electron
cài được (NSIS) + bản portable. macOS / Linux: chưa support.

## Quyết định

| Vấn đề | Chọn | Lý do |
|---|---|---|
| Tool đóng gói | electron-builder 26.15.3 | target `nsis` + `portable` có sẵn; Forge mặc định Squirrel |
| Electron | 44.4.5 (Node 24) | bản ≥ 2 tuần, cùng major Node với máy dev |
| Bundle | esbuild 0.28.2 → `main.cjs`, `collector.cjs` (CJS, 1 file) | không kéo node_modules monorepo; app `package.json` không có dependencies |
| Chạy collector | `utilityProcess.fork` (file unpacked) | tách event loop khỏi UI/tray; crash không kéo app chết; main restart tối đa 3 lần |
| Shutdown collector | `parentPort` message `shutdown` → save state → exit; quá 4 s thì kill | signal không tới utilityProcess trên Windows |
| UI | BrowserWindow load `http://127.0.0.1:<port>` | `server.ts` origin check chỉ nhận http localhost; web dựng WS từ `location.host` |
| Port đã có collector (bat đang chạy) | dùng luôn, không fork | tránh EADDRINUSE |
| Web dist | `extraResources` → `resources/web`, truyền `CCM_WEB_DIST` | |
| Status line bridge | copy vào `%LOCALAPPDATA%/ccm/bin/` (đường dẫn ổn định qua update / portable); có `node` → `node "<bridge>"`, không có + bản cài → `bridge.cmd` (`ELECTRON_RUN_AS_NODE=1` + exe) | Claude Code spawn ngoài, không đọc được asar; portable giải nén vào temp đổi path mỗi lần |
| Toast | giữ PowerShell toast (`toast.ts`) | chạy cả portable (không cần Start Menu shortcut); không 2 nguồn toast |
| Tray | Mở / Cửa sổ gọn (`?mode=compact`) / Mở trong trình duyệt / Chạy cùng Windows / Thoát; đóng cửa sổ = ẩn xuống tray | monitor phải sống nền |
| Bảo mật | contextIsolation + sandbox, không preload, chặn navigate khác origin, link ngoài → `shell.openExternal`, permission chỉ notifications + clipboard | |
| Ký số | không ký (SmartScreen cảnh báo "More info → Run anyway") | chưa có cert |

## Thay đổi collector

- `config.ts`: path fallback theo `import.meta.url` chỉ tính khi thiếu env (CJS bundle không có `import.meta`);
  thêm `CCM_STATUSLINE_BRIDGE`, `CCM_STATUSLINE_COMMAND`.
- `index.ts`: `statusLineCommand` lấy từ config; nghe `process.parentPort` `shutdown`.
- `launcher.ts`: bỏ `ELECTRON_RUN_AS_NODE` khỏi env terminal mở ra.

## Cấu trúc mới

```
apps/desktop/
  package.json            @ccm/desktop — electron, electron-builder, esbuild (dev)
  build.mjs               esbuild main + collector → stage/, ghi stage/package.json
  electron-builder.yml
  src/main.ts             lifecycle, collector host, window, tray
  src/collector-host.ts   fork / health / restart / shutdown
  src/bridge.ts           cài status line bridge, chọn lệnh
  src/loading.ts          trang chờ / lỗi (data: URL)
  resources/              statusline-bridge.cmd template? (sinh runtime)
```

Lệnh: `npm run desktop` (chạy dev từ stage), `npm run dist:win` (build web + desktop → `apps/desktop/release/`).

## Ngoài phạm vi / follow-up

- Auto update (electron-updater) — cần ký số + nơi host release.
- Toast mở cửa sổ app thay vì browser (protocol `ccm://`).
- macOS / Linux.
