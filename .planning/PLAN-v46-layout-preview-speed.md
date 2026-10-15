# PLAN v46 — XML layout preview speed + waiting states (done 2026-10-15)

Owner: "the XML preview renders a bit slowly — can we speed it up?", then (scope extension) as smooth as possible, every
wait visible with calm motion; JVM only on a clear Android-layout signal (no always-on daemon, web-only work wastes no RAM).

## Method
- Daemon bench (scratchpad `bench.mjs`): spawns the real jar + `build/layoutlib-dist`, `initialize`, `project/load` of the
  v44 loose kit, then 3× each: loose ConstraintLayout + Material (`cl`, 11 views), framework LinearLayout (`lin`), a real
  app layout (AndroidBaseKotlin `activity_main.xml`, 187 lines, not built → rendered with the kit, `real`), then 5 edits.
- New instrumentation (kept): `initialize.timings {checksMs, setupMs, prepareMs, warmupRenderMs}`, `project/load.timings
  {aarResMs, projectResMs, classesMs}`, render `timings` already existed; desktop logs them in `layout.log`.
- In-app: E2E `e2e/layout-speed.cjs` (CDP, dev stage) records first frame / keystroke → new frame with an rAF recorder.
- Machine shared with other agents' builds: absolute numbers vary ±50 % between runs (init 3.4–8.9 s seen for the same
  jar); compare within a run. AndroidBaseKotlin has no build output, so no real project model was loaded (kit path).

## Where the time went (before)

| Stage | Before | Notes |
|---|---|---|
| JVM spawn → `initialize` | 3.7–4.2 s (no CDS) | setup 0.6 s, **prepare 2.4 s** (Paparazzi framework res + ByteBuddy), warm-up render 0.35 s |
| `project/load` kit | 0.46–0.52 s | AAR res 0.19–0.55 s + R / ClassLoader 0.3 s, only after init |
| First `cl` render | 0.66–0.86 s | inflate 0.4–0.53 s (Material class init), PNG 90–120 ms |
| Warm render 1080×2340 | cl 200–285, lin 115–166, real 210–252 ms | **PNG 40–110 ms** = 25–40 % of it |
| PNG encode | 40–110 ms | frames are `TYPE_INT_ARGB_PRE` → `getRGB()` colour-model slow path + cold JIT (same encoder hot in a microbench: 14–17 ms) |
| File write / read | 0.3–1 ms / 4–10 ms | not worth an in-memory transport |
| Edit loop before render starts | 150 ms (FilePane) + 300 ms (LayoutPreview) = **450 ms** | then render at full device px + PNG |
| Re-render UI | frame swapped on arrival; nothing-drawn result (half-typed XML) blanked the stage | compare mode dropped other cells while re-rendering |

## Changes
Daemon (`apps/layout-daemon`):
- `render.scale` (0.125–1, snapped to 1/16): `SessionSwapper` sets an `IImageFactory` with a smaller ARGB_PRE image +
  `FLAG_KEY_RESULT_IMAGE_AUTO_SCALE`, so layoutlib draws through a scaled canvas. Device dp, density bucket, resources and
  the view tree (device px) are unchanged; result adds `imageWidth/imageHeight`. Scale is part of the session `Config`.
- `PngWriter`: ARGB_PRE read straight from the raster (un-premultiply only translucent pixels), rows in up to 4 strips
  deflated in parallel (raw deflate + SYNC_FLUSH, one zlib header, `combineAdler`), JIT warm-up on a background thread
  after `initialize` (inline strips, never the shared pool).
- `AarPrefetch`: `initialize.prefetchAars` and every parsed `project/load` start AAR res parsing on a pool at once
  (overlaps layoutlib boot); unused prefetches dropped after each load.
- `progress` notifications `{stage: setup|prepare|warmup}` during `initialize`.

Desktop (`apps/desktop/src/layout`):
- `ccm:layout-render.scale` → `cleanScale` (1/8 steps, ≥ 0.95 → 1), part of `renderKey`; `RenderParams.scale`.
- `LayoutDaemon.request('project/load')` hands its `aarResDirs` to `ensure({prefetchAars})` → `initialize`; warm-up IPC
  runs `model.prepare` first so the kit / cached model AARs parse while layoutlib boots.
- Events `daemon-stage {jvm|setup|prepare|warmup}` (+ `LayoutStatus.stage`) and `loading {kit|project, active}`.

Web:
- One debounce: FilePane live text 120 ms (`LIVE_PREVIEW_MS`), LayoutPreview / DrawablePreview render at once on a
  text revision (disk revisions 120 ms).
- `renderScale(viewScale, devicePixelRatio)`: renders the pixels on screen (fit mode ≈ 0.25–0.5 of the device),
  zoom-in past the shown pixels re-renders sharp (cached lower-res frame stays meanwhile); compare cells per cell size.
- Frames decoded (`Image.decode`) before the swap, 160 ms crossfade over the previous frame, first frame fades/scales in,
  zoom changes ease via a transform FLIP, hover / selection boxes glide (transform), nothing-drawn or failed renders keep
  the last good frame dimmed with a note (`[data-layout-stale]`); compare cells keep their frames until replaced.
- Waiting states (icon + text, en/vi `layout.wait.*`): device-shaped skeleton (opacity shimmer) + card "Starting
  renderer…" with the stage line and a determinate bar (`INIT_STAGE_PROGRESS`: each stage animates to its ceiling over its
  measured duration), "Loading libraries…" / "Loading project…", "Updating project model…", "Rendering…"; re-renders
  show a 2 px indeterminate bar + pill only after 150 ms (`[data-layout-busy]`). `prefers-reduced-motion`: no shimmer,
  crossfade, slide, FLIP or box glide.
- Earlier warm-up: Explorer hover (250 ms dwell) / focus on an XML in `res/layout*|drawable*|mipmap*|color*`
  (`warmOnIntent`, once per file). Nothing starts for other files; the 10 min idle shutdown stays.

## After

| Stage | After | |
|---|---|---|
| PNG encode 1080×2340 | **6–16 ms** (was 40–110) | 0.5 scale: 2–4 ms |
| Warm render, scale 0.5 (what fit mode sends) | cl 115–190, lin 57–100, real 135–200 ms | draw −30–50 %, PNG ≈ 0; inflate unchanged |
| Warm render 1080×2340 (zoom ≥ 100 %) | cl 97–200, lin 94–150, real 184–290 ms | PNG part only |
| `project/load` kit (same session, alternating runs) | 274–404 ms, AAR 0 ms (was 499–911, AAR 182–549) | prefetch during init |
| `initialize` | unchanged (3.4 s quiet machine; −33 % with the v45 AppCDS archive) | prepare = Paparazzi internals |
| Keystroke → new frame (in app, E2E, typing 11 chars) | **266–282 ms** | before (composed from the measured stages, not run in app): 450 ms debounce + 200–285 ms render + decode ≈ 0.7–0.8 s |
| Cold open → first frame (in app, E2E, loaded machine) | 5.8–7.1 s, staged UI the whole time | init + kit + first render |
| Fit-mode image | 405 px wide at DPR 1.5 (was 1080) | |

## Tests
Daemon `gradlew test` 47 (new `PngWriterTest` ×3, `DaemonTest` scaled render), goldens unchanged. Desktop 35 files / 522
(`layout.test.ts` v46: prefetch → initialize, stages, scale param, `cleanScale` / `renderKey`; int test with the real jar).
Web 53 / 487 (`renderScale`, stage bars, `isAndroidResXml`, i18n). `npm run typecheck`. E2E (CCM_E2E_PORT 4385, DBG 9345):
`layout-speed` (new, in `run.cjs`), `loose-kit`, `drawable-preview`, `file-editor` all PASS.

## Open — needs an owner decision (measured, not done)
1. Persistent framework resource cache: `prepare` is 2.4–3.5 s of a 3.4–4 s cold start (Paparazzi re-parses
   `resources/res` and re-instruments layoutlib each start). A serialized cache would cut ~1.5–2.5 s off every cold start
   but means forking Paparazzi's internal repositories (no cache format in 2.0.0-alpha05.1). Effort: days, upgrade risk.
2. Kit warm render at kit load (Material / ConstraintLayout class init = ~0.4 s of the first render): only helps when
   there is idle time between the signal (explorer hover, Code mode) and the render; ~0.4 s CPU each daemon start.
3. Not worth it (measured): PNG over IPC / raw RGBA instead of file + preview server (file read 4–10 ms, PNG 2–16 ms now);
   keeping superseded in-flight renders for progressive updates while typing (renders only start 120 ms after typing pauses).
4. Pre-built CDS archive in the installer: impossible across JDKs (archive bound to the exact JVM build); the v45 self-built
   archive already gives −33 %.

## Found on the way (not fixed, separate bug)
Loose kit: `MaterialCheckBox` (and framework `CheckBox` under the kit's Material3 theme) fail —
`mtrl_checkbox_button_checked_unchecked.xml` (AnimatedStateListDrawable) → layoutlib NPE "parser is null"; placeholder shown.
