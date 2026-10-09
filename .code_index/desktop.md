# desktop — apps/desktop (Electron, Windows + macOS)

Flow: `main.ts` `ready()` → `CollectorHost.start()` (reuse or fork collector) → BrowserWindow loads `http://127.0.0.1:<port>/`. Plan `.planning/PLAN-v12-electron.md`, docs §11j.

## Files
- `src/main.ts`: single-instance lock, AUMID `dev.ccm.monitor`, `lockPermissions` (notifications/clipboard/fullscreen, app origin only), `harden` (deny window.open → `openAppWindow` for app URLs / `shell.openExternal` http(s); block cross-origin navigate; F5/Ctrl R, F12, zoom keys), main window (bounds in `userData/window.json`, close = hide + one balloon), compact window (`?mode=compact`, 440×720), tray menu (open / compact / browser / Start with Windows `--hidden` / logs / quit), `boot()` loading page → host.start → load ORIGIN, `before-quit` → `host.stop()`.
- `src/collector-host.ts` `CollectorHost`: `isHealthy` (`GET /health`), `external` = port already healthy → no fork, poll every 3 s, 2 misses → `start()` own collector (bat closed); `utilityProcess.fork(collector.cjs)` stdout/stderr → `logs/collector.log` + 40-line `tail`; `stop()` posts `'shutdown'`, kill after 4 s.
- `src/bridge.ts` `installBridge`: copy bridge → `<dataDir>/bin/statusline-bridge.mjs` (write if changed); command `node "<script>"` if portable/dev or `node` on PATH, else Windows `statusline-bridge.cmd` / mac+linux `statusline-bridge.sh` (chmod 755) running the exe with `ELECTRON_RUN_AS_NODE=1`.
- `src/pages.ts`: loading / error `data:` pages (tokens match launcher page), retry link `ccm-desktop://retry` intercepted in `will-navigate` → `boot()`.
- `src/strings.ts`: en/vi by `app.getLocale()` (+ `trayLoginMac`, `move*`).
- `src/mac.ts`: `adoptLoginShellPath` (`$SHELL -ilc` PATH merge, launchd PATH is minimal), `setMacMenu` (app/edit/window roles), `offerMoveToApplications` (true → relaunching, `ready()` returns). `main.ts` `IS_MAC`: tray `ccmTrayTemplate.png`, no window icon / AUMID / balloon, `activate` → `showMain`, login item `{}`.
- `build.mjs`: esbuild → `stage/main.cjs` (external electron) + `stage/collector.cjs` (from `apps/collector/src/index.ts`), writes `stage/package.json` without dependencies.
- `electron-builder.yml`: app dir `stage`, output `release`; win nsis + portable x64 unsigned; mac dmg arm64 + x64, icon `scripts/assets/ccm-mac.png`, ad-hoc `identity: '-'`, `hardenedRuntime: false`. All dist scripts `--publish never`.
- `.github/workflows/desktop.yml`: manual / tag `v*` → `dist:mac` on macos-latest + `dist:win` on windows-latest → upload artifacts.
- Icons: source `scripts/assets/logo.svg` (also `web/src/assets/art/01-logo.svg`, `web/public/favicon.svg`); `scripts/make-icon.mjs` mirrors its geometry (`shapes()`: fill/ring/line SDF) and `render(size, {inset, radius, glyph})` → `ccm.ico` + `ccm-256.png` + PWA icons (full-bleed), `ccm-mac.png` (1024, inset 100, radius 230 — only rounded tile, macOS does not mask), `ccmTrayTemplate{,@2x}.png` (16/32 black glyph, strokes ×1.6, cropped to frame). Edit the SVG → update `shapes()` → rerun.

## Env passed to collector (`collectorEnv`)
`CCM_PORT`, `CCM_DATA_DIR` (collector `defaultDataDir`: win `%LOCALAPPDATA%/ccm`, mac `~/Library/Application Support/ccm`), `CCM_WEB_DIST` (resources/web), `CCM_STATUSLINE_BRIDGE`, `CCM_STATUSLINE_COMMAND`, + inherited env.

## Packaging layout
- `resources/app.asar` (main.cjs, package.json), `resources/app.asar.unpacked/collector.cjs` (path rewritten from `app.asar` in `ready()`).
- `resources/web` (apps/web/dist), `resources/bridge/statusline-bridge.mjs`, `resources/ccm.ico`, `resources/ccmTrayTemplate{,@2x}.png`.
- Dev (`npm run desktop`): `resource()` falls back to repo paths.

## Invariants
- Window must load the **http origin**, never `file://`: `server.ts` origin check accepts only http localhost; web builds WS URL from `location.host`.
- Collector bundle is CJS: `config.ts` `import.meta` fallbacks only run when `CCM_WEB_DIST` / `CCM_STATUSLINE_BRIDGE` are unset → host must always set both.
- Fatal/restart: exit code 3 (`PORT_IN_USE_EXIT`, mirrors collector `server.ts`) → `FatalReason` `port-in-use`, no restart, `strings.ts` `portInUse(port)`. Other child exit while not stopping → restart up to 3 times; then `onFatal` → error page with log tail + retry. Boot waits `/health` up to 30 s (timeout → fatal). Retry = `boot()` → `start()` resets restart count.
- Quit only via tray (`window-all-closed` no-op); `before-quit` waits `host.stop()` once (`stopped` flag).
- External collector (bat) is never stopped by the app.
