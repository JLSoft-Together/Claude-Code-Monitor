# PLAN v31 — Run Android / Flutter projects (audit, 2026-10-15)

Source: `Plan run android project.md` + `Plan run flutter proejct.md` (repo root, generic "IDE" plans). This file records the audit against the real app and the owner's decisions; the source plans stay the detail spec where not overridden here.

## Owner decisions
| Topic | Decision |
|---|---|
| UI + execution | New pane kind `run` (like `changes`): in-pane bar (project/config, device, Run/Stop/Hot Reload/Hot Restart/DevTools) + tabs Build / Logcat (Android) or Run log (Flutter). Desktop main spawns gradle/adb/`flutter --machine` with a state machine; not typed into a terminal pane. |
| Order | Shared core first (Detector / ConfigType / Runner interface, Flutter plan §11 + RunConfigurationStore) → Flutter M1–M4 → Android M1–M4. Android also uses Run Configurations (type `android`). |
| Hot reload | Manual only (⚡ / ↻). No reload-on-save, no file watcher trigger. Drop the `hotReloadOnSave` field. |
| Config storage | Personal: `<dataDir>/run-configs/` per project key. Shared ("Store as project file"): `<repo>/.agent-monitor/run/<id>.json`. Import one-way from `.run/*.run.xml` and `.vscode/launch.json`; never write other IDEs' files. |
| `ANDROID_UNKNOWN` | Guess from manifest: a module whose manifest has a LAUNCHER activity is runnable, labelled "guessed". No "Deep analysis" button. |
| Concurrency | One session per (config, device). Run again on the same pair = stop then restart. Different pairs run in parallel; the pane picks which session the buttons/log target. |
| Agent link | Parsed build error → "Send to agent" pastes `file:line:col message` into the input of the Claude/Codex pane bound to the project (no Enter). Session card / sidebar row shows Building / Running for the project. No logcat → agent. |
| Quit | `confirmQuit` lists live run sessions; on quit: `app.stop` / `am force-stop`, then kill gradle/flutter trees (`taskkill /T` on win). Gradle daemon left alone. |

## Audit fixes applied to the source plans
- No editor in the app (v29 read-only): drop "auto-save open files" before Run.
- No IDE toolbar / bottom panel / status bar / SDK settings page: toolbar + panels live inside the `run` pane; Flutter version + FVM shown in the pane bar; SDK/JDK paths go in SettingsMenu (desktop section).
- IPC follows app convention: `ccm:run-*` channels behind `isAppFrame`, paths through `allowedPath` / `repoOf`, push events via the preview event channel; not `android:*` / `flutter:*`.
- Platforms: Windows + macOS only (no Linux build). iOS simulator only on macOS.
- Android detector also scans 1–2 levels deep like Flutter (monorepo native apps), skipping folders owned by a Flutter project.
- Process lifecycle: one `flutter daemon` per SDK, started lazily when a `run` pane needs devices, stopped when the last `run` pane closes / app quits. `adb track-devices` same.
- Spawn without shell, args split with quote support, `${projectDir}` `${workspaceDir}` `${env:NAME}` only. Logs and the agent paste go through `log-mask` (no env values).
- Fix source refs: Flutter plan links `android-run-plan.md` (does not exist) → `Plan run android project.md`.

## Open (decide during implementation, no owner input needed)
- Install path: `adb install -r -t` from `output-metadata.json` (source plan) vs `gradlew install<Variant>`; keep source plan unless output-metadata is missing.
- Pane persistence in layouts (`cleanLayout`) for kind `run`: store config id only.

## Out of scope
As listed in both source plans (debug adapters, attach, flavors/ABI splits for Android, multi-device for one config, test runner, release builds, in-app DevTools), plus reload-on-save.

## Deviations recorded (plan-gaps pass, 2026-10-15)
- Flutter daemon / adb tracker: one per SDK as planned; they now stop when no Run pane holds a project root (`ccm:run-hold`) and no session is live, and restart on the next device request. The Flutter Widget Preview panel asks for devices without a hold, so it can restart them; they stop again at the next idle point.
- Device lost during a Flutter run: per plan §6 → state `stopped` (idle) with a `device-lost` notice in `RunSession.failure`, not `failed`.
- Flavor configs: auto-created per detected flavor on the main entrypoint (plan said "suggest"); the template flavor applies to the entrypoint configs only when the project declares it.
- Gradle args: per configuration (Android `args`, default from "Edit configuration templates…"), not a global Settings field as in the Android plan §6.
- `flutter doctor --machine` is tried first; SDKs without it fall back to parsing `flutter doctor -v`.
- Run output masking uses `createLogMasker` (same home / token rules as `maskLog`, minus the bare 32+ alphanumeric rule, which mangled Gradle task names); build-error file paths stay absolute so they can open.
