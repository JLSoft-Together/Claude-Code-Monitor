# v31 + v32 task breakdown (2026-10-15)

Decisions: `PLAN-v31-run-android-flutter.md`, `PLAN-v32-xml-layout-preview.md`. Contract: `packages/shared/src/run.ts`.

## IPC contract (preload `window.ccmDesktop`, all behind `isAppFrame`, paths via `repoOf ?? allowedPath`)
| Preload method | Channel | Returns |
|---|---|---|
| `runDetect(root)` | `ccm:run-detect` | `RunDetectResult \| null` (also pushed as `projects` event on change) |
| `runEnv(dir, kind)` | `ccm:run-env` | `RunEnv \| null` |
| `runDevices()` | `ccm:run-devices` | `RunDevice[]` (starts trackers lazily; changes pushed as `devices`) |
| `runEmulators()` | `ccm:run-emulators` | `RunEmulator[]` |
| `runLaunchEmulator(id, source)` | `ccm:run-launch-emulator` | `RunResult` |
| `runConfigs(root)` | `ccm:run-configs` | `RunConfig[]` (auto-generated defaults when none) |
| `runConfigSave(root, cfg)` | `ccm:run-config-save` | `RunConfig \| null` |
| `runConfigDelete(root, id)` | `ccm:run-config-delete` | `boolean` |
| `runConfigImport(root)` | `ccm:run-config-import` | `RunConfig[]` (imported) |
| `runPreview(root, cfg, deviceId)` | `ccm:run-preview` | `RunCommandPreview` |
| `runStart(req)` | `ccm:run-start` | `RunResult` |
| `runStop(sessionId)` | `ccm:run-stop` | `RunResult` |
| `runReload(sessionId, full)` | `ccm:run-reload` | `RunResult` |
| `runPubGet(dir)` | `ccm:run-pub-get` | `RunResult` |
| `runSessions()` | `ccm:run-sessions` | `RunSession[]` |
| `onRunEvent(handler)` | push `ccm:run-event` | `RunEvent` (log lines batched ≤ 100 ms) |

## Waves
**W0 (main thread)**: contract above.

**W1 (parallel sub agents, disjoint files)**
- A1 spike layoutlib → `spikes/layoutlib/` (v32 phase 0, go/no-go numbers).
- A2 Flutter detect + env → `apps/desktop/src/run/flutter/{detect,env}.ts`, `test/run-flutter.test.ts`.
- A3 Android detect + env → `apps/desktop/src/run/android/{detect,env}.ts`, `test/run-android.test.ts`.
- A4 Configs + command → `apps/desktop/src/run/{configs,command,importers,args}.ts`, `test/run-configs.test.ts`.
- A5 Run pane UI → `apps/web/src/stores/run.ts`, `components/workspace/RunPane*.vue`, pane kind `run` in `stores/workspace.ts` + `WorkspaceView.vue`, `lib/desktop.ts` bridge types, i18n.

**W2**: device services (flutter daemon, adb track-devices), Flutter runner (`--machine`), Android runner (gradle → install → launch → logcat), session manager + `registerRunIpc` + main/preload wiring, confirmQuit census.

**W3**: Edit Configurations dialog, Send-to-agent on build errors, run state on session card / sidebar, layouts persistence for `run` panes, E2E `e2e/run.cjs` (fake flutter / adb / gradlew).

**W4 (v32, after spike go)**: daemon phases 1–5.
