# desktop — apps/desktop (Electron, Windows only)

Flow: `main.ts` `ready()` → `CollectorHost.start()` (reuse or fork collector) → BrowserWindow loads `http://127.0.0.1:<port>/`. Plan `.planning/PLAN-v12-electron.md`, docs §11j.

## Files
- `src/main.ts`: single-instance lock, AUMID `dev.ccm.monitor`, `lockPermissions` (notifications/clipboard/fullscreen, app origin only), `harden` (deny window.open → `openAppWindow` for app URLs / `shell.openExternal` http(s); block cross-origin navigate; F5/Ctrl R, F12, zoom keys), main window (bounds in `userData/window.json`, close = hide + one balloon), compact window (`?mode=compact`, 440×720), tray menu (open / compact / browser / Start with Windows `--hidden` / logs / quit), `boot()` loading page → host.start → load ORIGIN, `before-quit` → `host.stop()`.
- `src/collector-host.ts` `CollectorHost`: `isHealthy` (`GET /health`), `external` = port already healthy → no fork; `utilityProcess.fork(collector.cjs)` stdout/stderr → `logs/collector.log` + 40-line `tail`; `stop()` posts `'shutdown'`, kill after 4 s.
- `src/bridge.ts` `installBridge`: copy bridge → `<dataDir>/bin/statusline-bridge.mjs` (write if changed); command `node "<script>"` if portable/dev or `where node` ok, else write `statusline-bridge.cmd` (`ELECTRON_RUN_AS_NODE=1` + exe).
- `src/pages.ts`: loading / error `data:` pages (tokens match launcher page), retry link `ccm-desktop://retry` intercepted in `will-navigate` → `boot()`.
- `src/strings.ts`: en/vi by `app.getLocale()`.
- `build.mjs`: esbuild → `stage/main.cjs` (external electron) + `stage/collector.cjs` (from `apps/collector/src/index.ts`), writes `stage/package.json` without dependencies.
- `electron-builder.yml`: app dir `stage`, output `release`, targets nsis + portable x64, unsigned.

## Env passed to collector (`collectorEnv`)
`CCM_PORT`, `CCM_DATA_DIR` (`%LOCALAPPDATA%/ccm`), `CCM_WEB_DIST` (resources/web), `CCM_STATUSLINE_BRIDGE`, `CCM_STATUSLINE_COMMAND`, + inherited env.

## Packaging layout
- `resources/app.asar` (main.cjs, package.json), `resources/app.asar.unpacked/collector.cjs` (path rewritten from `app.asar` in `ready()`).
- `resources/web` (apps/web/dist), `resources/bridge/statusline-bridge.mjs`, `resources/ccm.ico`.
- Dev (`npm run desktop`): `resource()` falls back to repo paths.

## Invariants
- Window must load the **http origin**, never `file://`: `server.ts` origin check accepts only http localhost; web builds WS URL from `location.host`.
- Collector bundle is CJS: `config.ts` `import.meta` fallbacks only run when `CCM_WEB_DIST` / `CCM_STATUSLINE_BRIDGE` are unset → host must always set both.
- Fatal/restart: child exit while not stopping → restart up to 3 times; then `onFatal` → error page with log tail + retry. Boot waits `/health` up to 30 s (timeout → fatal). Retry = `boot()` → `start()` resets restart count.
- Quit only via tray (`window-all-closed` no-op); `before-quit` waits `host.stop()` once (`stopped` flag).
- External collector (bat) is never stopped by the app.
