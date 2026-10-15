# layout-daemon (v32 Phase 1 + 3)

Kotlin render daemon for the XML Layout Preview: keeps one warm layoutlib (via Paparazzi `PaparazziSdk`) and answers JSON-RPC 2.0 over stdio.
Pinned: Paparazzi 2.0.0-alpha05.1, layoutlib 16.2.3 (API 36), Kotlin 2.3.0, Gradle 8.14.3, JDK 17+ (tested with Android Studio JBR 21).

## Build
```sh
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"   # system java 11 is too old
./gradlew assemble   # build/libs/layout-daemon.jar (~30 MB) + build/layoutlib-dist/ (dev copy of the download folder)
./gradlew test       # JUnit5, renders against build/layoutlib-dist
node smoke.mjs [layoutlibDir] [layout.xml]   # spawns the jar, initialize + 5 renders, prints timings + png path
```

## Run
The jar does **not** bundle layoutlib; the app puts the downloaded jar on `-cp` (simplest robust option: Paparazzi and layoutlib must share one classloader, ByteBuddy patches layoutlib classes in place).
```sh
java -Xmx1g -XX:+EnableDynamicAgentLoading -Djdk.attach.allowAttachSelf=true \
  -cp "layout-daemon.jar<sep><dir>/layoutlib-16.2.3.jar" \
  dev.ccm.layoutdaemon.MainKt --layoutlib <dir>
```
`<sep>` = `;` on Windows, `:` on macOS. `-XX:+EnableDynamicAgentLoading` silences the JDK 21 agent self-attach warning (and keeps it working on later JDKs); `-Xmx1g` caps project code (custom views) later. stdout is protocol only; stray prints become `log` notifications, native noise may still hit stderr.

## Download folder (`<dataDir>/layoutlib/16.2.3/`)
```
layoutlib-16.2.3.jar       as downloaded (on -cp)
runtime/                   unzipped layoutlib-runtime-16.2.3-<os>.jar (build.prop, data/fonts, data/icu, data/<os>/lib64 …)
resources/                 unzipped layoutlib-resources-16.2.3.jar (res/, overlays/)
```
Artifacts live on **Google Maven** (`https://dl.google.com/android/maven2/`), not Maven Central:

| Coordinate | Size | sha256 |
|---|---|---|
| `com.android.tools.layoutlib:layoutlib:16.2.3` | 60 286 750 | `5dbdbd3e35abb8f8bab4c3019869642f515afd31c43d230ece0be082486c3ec8` |
| `com.android.tools.layoutlib:layoutlib-runtime:16.2.3:win` | 76 544 623 | `adadac21f5a9bfde4336d834ce0f9db83a478c65f27afd48751c470b3d708c6f` |
| `com.android.tools.layoutlib:layoutlib-runtime:16.2.3:mac` (x64) | 80 275 609 | `2b4462089c3976735cd79570e3ce35b4fe24d1c70112a8c75f422dac477ef732` |
| `com.android.tools.layoutlib:layoutlib-runtime:16.2.3:mac-arm` | 79 334 417 | `2ca430114a7ec0c718b998ef12af915a724f7a2530dc3c382c616a2ca9076e38` |
| `com.android.tools.layoutlib:layoutlib-resources:16.2.3` | 34 854 638 | `b4c4582e3680cbc8e0248223dc6ccf393bdedecd38cfccd03a33014b9238c559` |

URL pattern: `…/maven2/com/android/tools/layoutlib/<artifact>/16.2.3/<artifact>-16.2.3[-<classifier>].jar` (sha1 verified against Google's `.sha1`).

## Protocol
`Content-Length: N\r\n\r\n<utf-8 JSON>` both ways, JSON-RPC 2.0.

| Method | Params | Result |
|---|---|---|
| `initialize` | `protocolVersion`, `cacheDir`, `prefetchAars?` (`[{dir, name}]`, parsed in parallel while layoutlib boots; v46) | `{protocolVersion, layoutlibVersion, apiLevel, initMs, timings {checksMs, setupMs, prepareMs, warmupRenderMs}}` — blocks until Bridge is warm (incl. one warm-up render) |
| `render` | `requestId`, `layoutPath`, `xmlContent`, `device {width, height, density(dpi)}`, `theme`, `night`, `locale`, `apiLevel?`, `scale?` (0.125–1, v46) | `{requestId, png, width, height, imageWidth, imageHeight, viewTree, diagnostics[], renderMs, timings {configMs, inflateMs, drawMs, pngMs}}` |
| `drawable/render` | `requestId`, `path`, `xmlContent`, `device {width, height, density}` (px), `night`, `states[]` (pressed, focused, selected, checked, activated, disabled), `colorList` | `{requestId, png, width, height, swatches: [{state, color '#AARRGGBB'}] \| null, diagnostics[], renderMs}`; color lists return swatches and `png: null` |
| `cancel` | `requestId` | `{cancelled}`; a still-queued render then fails with error `-32800` |
| `project/load` | see below (+ `projectId?`, `classesChanged?`); `{}` = back to framework-only (cache kept) | `{ok, frameworkOnly, resCount, classpathCount, rIds, loadMs, reused, cached, restartSuggested, warnings[]}` |
| `project/changed` | `kind: 'res' \| 'classes'`, `files[]` (informational) | `{ok, frameworkOnly, kind, reloadMs, restartSuggested, warnings[]}`; without a project `{ok, frameworkOnly: true}` |
| `shutdown` | — | `null`, then the process exits |
| `log` (notification, daemon→IDE) | `{level, message}` | layoutlib noise filtered |
| `progress` (notification, v46) | `{stage: setup | prepare | warmup}` | sent during `initialize` |

- `scale` < 1 (v46): layoutlib draws through a scaled canvas into a smaller image (`IImageFactory` + `FLAG_KEY_RESULT_IMAGE_AUTO_SCALE`); device dp, density qualifier and resources are unchanged, `width`/`height` and view-tree bounds stay in device px, `imageWidth`/`imageHeight` give the PNG size. Snapped to 1/16; ≥ 0.95 = 1. `project/load` results carry `timings {aarResMs, projectResMs, classesMs}`; its AAR dirs (and `initialize.prefetchAars`) start parsing on the reader thread (`AarPrefetch`).
- PNG: ARGB_PRE frames read from the raster directly, up to 4 strips deflated in parallel (one zlib stream), encoder JIT-warmed after `initialize`.
- Renders run serialized on one worker thread. `png` is an absolute path under `<cacheDir>/render/`, the last 8 files are kept (cleared on `initialize`). `png` is `null` when nothing could be drawn.
- `viewTree` node: `{class, xmlId ("@+id/x" as written or null), line, column, bounds [l,t,r,b] in image px, children}`; `line/column` = the `<` of the start tag (1-based). `<merge>` roots get a synthetic `merge` node.
- `diagnostics`: `{severity: error|warning|info, message, line?, column?}`. Inflate/render exceptions never crash the daemon. Unknown classes render as a placeholder (`MockView`, tree keeps the XML class name) plus an error diagnostic.
- `theme`: `android:Theme.X`, `@android:style/Theme.X`; default `android:Theme.DeviceDefault.DayNight`. `locale`: BCP-47 (`vi`, `en-US`, `zh-Hans-CN`) or Android qualifier; RTL locales flip layout direction.
- `theme` resolution: request `theme` (`@style/X`, `@android:style/X`, `android:X`, `X`) → root `tools:context` activity in `activityThemes` → `appTheme` → `android:Theme.DeviceDefault.DayNight`. Without a project, a project theme falls back to the default with a warning.
- `tools:*` design-time attributes (`tools:text`, `tools:visibility`, `tools:src`…) shadow their `android:` twin; `tools:listitem` / `tools:itemCount` fill a RecyclerView (generated adapter, default 10 items).
- Missing class → placeholder + `Class not found: X — build the project…`; a view whose constructor throws (or misses a dependency class) → placeholder + `X failed to render: …` with an `isInEditMode()` hint. The daemon never dies on project code.
- Errors: `-32002` not initialized, `-32602` bad params, `-32603` internal, `-32601` unknown method.

## Project model (Phase 3)
Framework views only until the app sends `project/load` (owner decision: after a successful Android build in the Run pane, or "Refresh project model"). Inputs come from the Gradle init script, mapped by `apps/desktop/src/layout/projectModel.ts`.

`project/load` params:

| Field | Meaning |
|---|---|
| `resDirs[]` | module res dirs, **lowest priority first** (main, flavor, build type) + generated (resValues) |
| `aarResDirs[]` | `{dir, name}` or a plain path: exploded AAR / library module `res` dirs, earlier wins |
| `classpath[]` | jars + class dirs (module classes first, then AAR `classes.jar`, jars) |
| `rJar?` | `compile_and_runtime_not_namespaced_r_class_jar/.../R.jar`; every `*/R.class` in it feeds the id map (nonTransitiveRClass) |
| `packageName`, `namespace?` | applicationId / R + `tools:context` package (namespace defaults to packageName) |
| `appTheme?`, `activityThemes?` | from the merged manifest, `{"com.x.MainActivity": "@style/Theme.X"}` |
| `minSdk?`, `targetSdk?` | session SDK values (default 0 / layoutlib API) |
| `projectId?` | stable id per (Gradle root, module); enables the warm cache below |
| `classesChanged?` | `true` = the model was refreshed while this project was inactive, so a cached copy recreates its ClassLoader |

How it works: resources = Paparazzi's `AppResourceRepository` (project folders) over cached `AarSourceResourceRepository`s (built in parallel); classes = child-first `ProjectClassLoader` over the classpath (platform `android.*`, layoutlib, JDK stay parent-only; `android.os.Build` is defined from layoutlib's `_Original_Build` because only android.jar has it). layoutlib talks to our `ProjectCallback` instead of `PaparazziCallback`: `SessionSwapper` rebuilds PaparazziSdk's render session with our callback + resources (reflection on Paparazzi internals is confined to `Session.kt` / `PaparazziInternals.java`).

Warm cache: projects loaded with a `projectId` stay in an access-order LRU of 3 (`MAX_CACHED_PROJECTS`, incl. the active one). Re-loading a cached id with an equal spec (`ProjectSpec` equality) reuses it: project res are always re-read (~10–30 ms, they may have changed while inactive), the ClassLoader is recreated only with `classesChanged: true`; result `reused: true`. Same id + different spec → the old copy is closed and reloaded. A 4th project closes the least recently used one (never the one being activated). Without `projectId` there is one anonymous slot that every load replaces (pre-cache behaviour). `project/load {}` only deactivates; `project/changed` applies to the active project; nothing survives `shutdown`/restart. Memory: each cached project pins its AAR repositories + ClassLoader (tens of MB on a real app), which is why the cap is 3 under `-Xmx1g`.

`project/changed`: `res` rebuilds only the project folders (AAR repos kept, ~10–30 ms); `classes` drops and recreates the ClassLoader (and R ids). Every project ClassLoader leaks some layoutlib/JDK caches, so after 6 loaders (`MAX_PROJECT_LOADERS`, counting loads, `classes` changes and `classesChanged` reuses; a plain reuse creates none) `restartSuggested: true` — the IDE should restart the daemon at a convenient time.

Measured on a real app (AGP 8.10, Material 1.12, ConstraintLayout 2.2, 74 AAR/library res dirs, 180 classpath entries, 6117 R ids): `project/load` ≈ 1.1 s, warm render 100–320 ms (inflate 15–200 ms, PNG 50–95 ms).

### Loose kit (PLAN-v44)
`./gradlew stageLooseKit` (part of `assemble`; `build.mjs --dist` runs it) → `build/loose-kit/`: `aars/<lib>/{res,R.txt,AndroidManifest.xml}`, `classes/<lib>.jar`, `R.jar`, `kit.json`. Configuration `looseKit` = constraintlayout 2.2.1 + appcompat 1.6.1 + material 1.12.0, transitive, minus Kotlin/coroutines (the daemon jar carries a stdlib) and start-up / background libs (profileinstaller, startup, lifecycle-process, core-ktx, …; re-add one if a `NoClassDefFoundError` names it). ~14 MB, 39 jars, 23 res dirs. AAR `R.txt` ids are placeholders (`0x0`), so `src/kitgen` (`LooseKitGen`, ASM from byte-buddy) assigns one app-wide id per (type, name) like AGP's final R and writes every library package's R (non-final, `ConstantValue` ints, styleable arrays in per-array helper methods; android attrs keep their framework ids) plus an empty `dev.ccm.loosekit.R`. The desktop loads it via `project/load` (`projectId: "loose-kit"`) when a layout has no usable project model. `tools:theme` on the root wins over the kit's `Theme.Material3.DayNight.NoActionBar`. `LayoutParser` rewrites `@id/x` to `@+id/x` for ids the buffer itself declares (a loose / unsaved file is in no res repository, so `layout_below="@id/a"` / `constraintTop_toBottomOf` would not resolve). AAR res are uncompiled sources: inline `<aapt:attr>` blocks (Material checkbox / switch animated-vectors) reach layoutlib as `@aapt:_aapt/<id>` values, which `ProjectCallback.getParser` serves from the tags collected while parsing the enclosing file (as `PaparazziCallback` does). Test `LooseKitTest`.

### Gradle init script
`init/ccm-project-model.gradle` (Groovy, AGP 8.x / Gradle 8.x; also verified on AGP 7.2.1 + Gradle 7.3.3 / 7.5 with JDK 17/18, where `runtimeConfiguration` falls back to the `<variant>RuntimeClasspath` configuration and `minSdk` to `minSdkVersion`; read-only: registers one help task, compiles nothing, writes only `-Pccm.out`):
```sh
<project>/gradlew -q --init-script <abs>/ccm-project-model.gradle :app:ccmProjectModel -Pccm.out=<abs>/model.json [-Pccm.variant=debug]
```
Output (one module): `version, module, projectDir, variant, namespace, applicationId, minSdk, targetSdk, compileSdk, resDirs[], generatedResDirs[], aarRes[{dir, package, name}], classpath[], classDirs[], projectDeps[] (project modules on the runtime classpath, transitive), rJar, manifest, appTheme, activityThemes{}, warnings[]`.
Sources: variant API (`androidComponents.onVariants`: namespace, applicationId, min/targetSdk, `runtimeConfiguration` artifact views `android-classes-jar` / `android-res` / `android-symbol-with-package-name`), compile task `destinationDirectory` for class dirs, `SingleArtifact.MERGED_MANIFEST`. Fallbacks (documented, AGP 8 paths): res source sets when `sources.res.all` refuses to read task outputs of this invocation (it always does when resValues exist); `process<V>Resources.rClassOutputJar` → `build/intermediates/compile_and_runtime_not_namespaced_r_class_jar/<v>/process<V>Resources/R.jar`; merged manifest → `build/intermediates/merged_manifest/<v>/process<V>MainManifest/AndroidManifest.xml` → `src/main/AndroidManifest.xml`. Marked `notCompatibleWithConfigurationCache`. Takes ~6 s warm (~45 s on a cold Gradle cache).

### Tests
`GoldenTest` renders `src/test/resources/golden/layouts/*.xml` (framework-only: Linear/Frame/RelativeLayout, text styles, ImageView, ScrollView, framework `<include>`, `<merge>`, widgets, light / night theme) and `golden/drawables/*.xml` and compares with `golden/<os>/*.png` (per-channel tolerance 16, at most 0.5 % of pixels). Goldens are **host OS only** (fonts / antialiasing differ): only `win/` is recorded, other OSes skip the comparison. Re-record after an intended rendering change: `CCM_GOLDEN_RECORD=1 ./gradlew test --tests dev.ccm.layoutdaemon.GoldenTest`; mismatches land in `build/golden-out/`.

`ProjectCacheTest` copies the fixture into 4 projects with different colours (reuse, `classesChanged`, LRU eviction, `{}` keeps the cache, anonymous slot). `ProjectTest` uses `src/test/resources/fixture-app/` (res + a fake AAR res dir) and the `fixture` source set (custom views + hand-written R, kept off the test classpath so they only load through the project ClassLoader). `RealProjectTest` is skipped unless `CCM_PROJECT_MODEL=<model.json>` and `CCM_PROJECT_LAYOUTS=<a.xml,b.xml>` are set; PNGs go to `build/real-project/`.
