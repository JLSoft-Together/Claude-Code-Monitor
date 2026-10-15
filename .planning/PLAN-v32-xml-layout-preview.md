# PLAN v32 — Android XML Layout Preview (audit, 2026-10-15)

Source: `Plan triển khai XML Layout Preview.md` (repo root; layoutlib Render Daemon in Kotlin, JSON-RPC over stdio). Source stays the detail spec where not overridden here. Depends on v31 (`PLAN-v31-run-android-flutter.md`) Android detector + environment.

## Owner decisions
| Topic | Decision |
|---|---|
| UI | Inside `FilePane` for `res/layout/*.xml`: Code / Split / Design switch (Android Studio style). Click view → scroll + highlight XML line; click XML line → highlight view. Device / theme / night / locale bar in the preview half. |
| Update trigger | No editor (v29 read-only stays). Re-render on file change on disk (existing `RootWatcher`), debounce 300 ms, `cancel` the older request. Daemon still takes `xmlContent` (main reads the file), so the protocol is unchanged. |
| Distribution | Nothing extra in the installer. First Design open asks, then downloads layoutlib + native runtime from Google Maven (`https://dl.google.com/android/maven2/`; not on Maven Central — coordinates + sha256 in `apps/layout-daemon/README.md`), versions + sha256 pinned in the app, into `<dataDir>/layoutlib/<version>/`. JDK 17+ from `JAVA_HOME` / Android Studio JBR (same lookup as v31 Android environment). Render daemon jar (small) ships in `extraResources`. |
| Order | Phase 0 spike now (standalone, `spikes/layoutlib/`, Windows host). Phases 1–5 after v31 Android M2. |

## Audit fixes applied to the source plan
- Drop: preview of unsaved buffer, squiggles "in the editor", cursor-in-XML → highlight (becomes click-a-line in the viewer).
- Project model (Gradle `--init-script`) never runs on project open: runs after a successful Android build in the `run` pane, or via a "Refresh project model" button. Until then render framework views only + a notice.
- Kotlin toolchain is new to the repo: daemon lives in `apps/layout-daemon/` (Gradle, fat jar), built by `scripts/` before `dist`; CI `desktop.yml` builds it on both OS jobs.
- Daemon runs project code (custom views): own process, `-Xmx` cap, restart after N project reloads, killed on quit (listed nowhere in `confirmQuit`, it holds no user state).
- PNG out via temp file → renderer loads it through the preview server (image CORP already handled), not base64 over IPC.
- IPC `ccm:layout-*` behind `isAppFrame`, paths through `allowedPath`.
- Test matrix: Windows + macOS only (no Linux build). Golden images compared on the host OS only.
- Source diagram is missing (`[embedded content]`); architecture is described in the protocol section, nothing lost.

## Phase 0 go / no-go
PNG of a framework-only layout from a plain `main()` on this Windows machine + cold start ms + per-render ms. No PNG → stop and revisit (fallback idea in source "out of scope": HTML/CSS quick view).

**Result (2026-10-15): GO** — `spikes/layoutlib/README.md`. Paparazzi 2.0.0-alpha05.1 `PaparazziSdk` + layoutlib 16.2.3 (API 36), JBR 21. Cold setup ~4.3 s, first render 150–280 ms, warm ~40 ms, PNG write 200–290 ms (needs faster encoder / smaller image). Windows download ≈ 164 MB compressed. Gotchas for phase 1: KXml line cookie = line of the closing `>` of the start tag (track `<` ourselves); collect bounds before `snapshot()` detaches the view; `-XX:+EnableDynamicAgentLoading`; filter layoutlib log noise; system `java` here is 11 → JBR lookup matters.

## Out of scope
As in the source plan (drag-drop / attributes write-back, Compose Preview, HTML fallback), plus live-typing preview.

## Phase 1 done (2026-10-15)
`apps/layout-daemon/` (README = protocol, run args, classpath layout `<dir>/{layoutlib-16.2.3.jar, runtime/, resources/}`, sha256 pins). Cold `initialize` ~3 s, warm render 60–90 ms, PNG 32–60 ms, jar 30 MB. Open for phase 2: no per-render timeout in the daemon → IDE watchdog kills/restarts; `initialize` blocks ~3 s → spawn early; stdin EOF = exit; theme from project waits for phase 3.

## Phase 2 + 4 done (2026-10-15)
Desktop `apps/desktop/src/layout/` (bundle download + verify + unzip, daemon manager, `ccm:layout-*` IPC, `wireLayout`), web `LayoutPreview.vue` + FilePane Code / Split / Design, hover / click view ↔ line, blueprint. PNG via preview server (`cache/render` registered as a root). Smoke on this machine (JBR 21, dev bundle): cold first render ~3.9 s, warm 100–180 ms. Open: main.ts / preload.ts wiring (snippets in the hand-off), `layout.log` not in `logReport` yet, theme from project waits for Phase 3.

## Phase 3 done (2026-10-15)
Daemon side + model only; app wiring (when to run the init script, `project/load` / `project/changed` calls, restart on `restartSuggested`) is the integration agent's. Contract in `apps/layout-daemon/README.md` § Project model.
- `init/ccm-project-model.gradle`: read-only `ccmProjectModel` task per `com.android.application` module, JSON via `-Pccm.out`. Verified on a real AGP 8.10.1 / Gradle 8.11.1 app: ~6 s warm, project git status untouched.
- `apps/desktop/src/layout/projectModel.ts`: `projectModelArgs()` + `parseProjectModel()` (absolute paths, existence filter, caps 64 res / 1000 AAR / 4000 classpath).
- Daemon: project res + AAR res repositories, child-first project ClassLoader, R ids from every R class in R.jar, theme = request → `tools:context` activity → app theme → DayNight, `tools:*` shadowing, `tools:listitem` RecyclerView, placeholders for missing / crashing views.
- Real app (Material 1.12, ConstraintLayout 2.2, 74 res libs, 180 jars): `project/load` ≈ 1.1 s, warm render 100–320 ms; 10 layouts incl. MaterialButton / TextInputLayout / MaterialCardView / ConstraintLayout / module custom views render without diagnostics.
- Fixed on the way: indeterminate ProgressBar killed the JVM on its 2nd render (hwui abort "0 isn't a real frame time!") → snapshots at 1 ms.
- Limits: views needing a manifest/runtime (AdMob `NativeAdView`, `FragmentContainerView android:name`) become placeholders (whole subtree); data-binding `<layout>` roots, `<fragment>` and Compose not rendered; `res` change = full project folder reparse (no per-file incremental); generated res only from resValues; restart suggested after 6 project ClassLoaders.

## Phase 3 app wiring + Phase 5 done (2026-10-15)
- `apps/desktop/src/layout/model.ts` `LayoutModelService`: layout file → Gradle root + app module (own module; library → the app that references it in its build script, else the first app). Gradle runs only after an Android Run session reaches `running` (`RunManager.onSessionState`, skipped while the preview is not set up) or on "Refresh project model"; never on open. 5 min timeout, one run per root, output in `layout.log`. Model JSON cached per (root, module) under `<dataDir>/layoutlib/models/`, loaded lazily before a render and again after any daemon restart (no Gradle). Res dir changes → `project/changed res` (300 ms debounce, flushed before the next render); refresh with an unchanged payload → `project/changed classes`; `restartSuggested` → daemon restart when idle.
- Theme: requests send `theme: null` (Project theme, auto) unless picked; picker = auto, DayNight, app + activity themes from the merged manifest (no full style list: the init script does not export styles).
- Phase 5: Compare toggle renders 3 configurations (device light, dark, other form factor) in a wrapping strip; desktop render cache LRU 32 keyed by XML + config + model version (PNG copies in `cache/snap`). `<include>`/`<merge>` come from the daemon unchanged (synthetic `merge` node line 0 is never selected).
- Smoke (this machine, JBR 21, AndroidBaseKotlin, AGP 8.x, read-only, project git status untouched): refresh 2.9 s warm, `project/load` 76 res / 180 classpath 540–560 ms, renders 86–700 ms with project views; after a daemon restart the cached model reloads in ~540 ms without Gradle.
- Remaining limits: one project loaded in the daemon at a time (switching projects = full `project/load`); Flutter runs do not trigger a refresh (only native Android configs); library-module layouts use an app module's model (library-only roots stay framework-only); a failed refresh keeps the previous model (chip shows the error); generated res (`build/`) is not watched, only refreshed after a build; compare mode has no hover/blueprint/zoom and diagnostics come from the first cell; render cache is in memory (cleared on app restart).

## Gap follow-up (2026-10-15, `AUDIT-2026-10-15-plan-gaps.md` § v32)
- Warm-up: `ccm:layout-warmup {file}` (FilePane as soon as a layout / drawable XML opens, also in Code mode; LayoutPreview on mount) → `LayoutDaemon.ensure()` (`initialize` already renders a framework-only warm-up layout, now LinearLayout + TextView + Button + EditText + ImageView) + `model.prepare(file)` from the disk cache. Never Gradle; the 10 min idle shutdown still applies.
- Rebuild hint: while a model is loaded in the daemon, `.kt` / `.java` under `<module>/src` of every module with class output under the Gradle root (plus the modules owning the source res dirs) are watched; the first change → `{type:'code-changed'}` + `LayoutModelInfo.codeChanged` → note "Code changed — build the app to update custom views". Cleared by the next successful refresh (after a build or Refresh). Watches stop on daemon stop (idle). Edits made before the model was loaded into the daemon are not detected (no mtime scan on open, kept cheap).
- Density / API / zoom: density picker = device dpi, ldpi 120 … xxxhdpi 640, custom 72–960 (same pixels, other dp size, compare cells too); **API level read-only** `API 36` chip: the bundled layoutlib 16.2.3 renders exactly one API level (runtime `build.prop`), the daemon only adds an info diagnostic for another `apiLevel`; switching would need one layoutlib download per API. Zoom fit / 25–400 %.
- Tests: daemon `GoldenTest` (13 framework-only layouts + 3 drawables, PNGs in `src/test/resources/golden/<os>/`, recorded on Windows with `CCM_GOLDEN_RECORD=1`, per-channel tolerance 16, ≤ 0.5 % pixels; other OS = skipped, host OS only); `apps/desktop/test/layout-daemon.int.test.ts` spawns the real jar (skips without `build/libs/layout-daemon.jar` + `build/layoutlib-dist` + JDK 17+). CI `.github/workflows/test.yml` (windows + macos): daemon `assemble test`, `npm run typecheck`, `npm test`. **No AGP matrix in CI**: the init-script test needs an Android SDK + one sample project per AGP/Gradle version, each a multi-GB cold download — verified by hand instead (AGP 7.2.1 / 8.x, see daemon README).
- Deviation: the preview shows for every `res/layout*/x.xml`, also without a detected Android project (no Gradle root / app module) — a framework-only render is still useful, and gating would need the Gradle analysis before the first paint. The model chip says why (no Gradle / no app).
