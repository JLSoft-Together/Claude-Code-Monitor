# PLAN v44 — Loose layout XML: ConstraintLayout (library views) without a project

Owner report 2026-10-15: a loose layout XML (outside any Android project, e.g. `bg_native_ad_cta.xml` at a repo root)
renders with a `LinearLayout` / `RelativeLayout` root but not with a `ConstraintLayout` root.

## Cause

`LinearLayout` / `RelativeLayout` are framework classes inside layoutlib. `androidx.constraintlayout.widget.ConstraintLayout`
is a library: with no Gradle project model there is no classpath, no AAR res (`app:layout_constraint*` attrs) and no
`R` class (`androidx.constraintlayout.widget.R$styleable`), so the daemon shows a placeholder / fails.
Inside a real project with a loaded model it already works (PLAN-v32 smoke: ConstraintLayout 2.2 renders).

## Fix — bundled "loose kit"

1. `apps/layout-daemon` Gradle: new configuration pulling `androidx.constraintlayout:constraintlayout` (pinned 2.x)
   + its runtime deps that the widget actually needs (`constraintlayout-core`; add others only on NoClassDefFoundError).
   Task `stageLooseKit` → `build/loose-kit/{classes/*.jar, res/<lib>/…, R.jar}`:
   - extract each AAR's `classes.jar` and `res/`;
   - generate the library `R` classes from each AAR's `R.txt` (non-final static ints / int[] styleables, package from
     the AAR manifest) and compile to `R.jar` — AAR classes.jar never contains R.
2. Ship the kit next to the daemon jar (same place / packaging path the daemon jar uses; check `electron-builder.yml`
   extraResources + desktop `layout/daemon.ts` path resolution, dev + packaged).
3. When rendering a loose XML with no project model, the desktop loads the kit as the project
   (`ProjectSpec`: aarRes = kit res, classpath = kit jars, rJar = kit R.jar, packageName/namespace neutral, theme
   DayNight/Material-less default). A real project model always wins; switching back to a project reloads its model.
   Keep the kit model cached in the daemon (no reload per render).
4. Tests: daemon unit/golden test rendering a ConstraintLayout root with constrained children (positions not all 0,0);
   desktop unit test for the loose → kit path; E2E (`drawable-preview.cjs` / `file-editor.cjs` style) rendering a loose
   ConstraintLayout XML without diagnostics `Class not found`.

## Out of scope (later, same mechanism)

Material Components / AppCompat / RecyclerView in loose files (Material needs AppCompat theme chain — bigger kit).

## Status (2026-10-15) — done

Scope extended by the owner: Material Components + AppCompat in the same kit (no longer out of scope).

- Kit: `apps/layout-daemon` `looseKit` = constraintlayout 2.2.1 + appcompat 1.6.1 + material 1.12.0 (transitive, pruned: Kotlin/coroutines, profileinstaller, startup, lifecycle-process, core-ktx, documentfile, print, localbroadcastmanager, legacy-support-core-utils, concurrent-futures, tracing, errorprone/guava). `stageLooseKit` → `build/loose-kit/` ~14 MB (39 jars, 23 res dirs, R.jar 246 KB, 5174 R ids). R: AAR `R.txt` ids are all `0x0`, so `src/kitgen` assigns one shared id space (attr ids identical in every library R), styleable children from the `X_child i` lines, android attrs keep framework ids.
- Desktop: kit used whenever there is no usable project model (loose XML, or a Gradle project not built yet / failed load); a real model always wins. Result stays `frameworkOnly: true` plus `builtinLibs: true`; the model chip reads "Built-in libraries" / "Thư viện có sẵn".
- Theme: kit default `Theme.Material3.DayNight.NoActionBar`; new root `tools:theme` support (render `theme` param > `tools:theme` > `tools:context` activity > app theme).
- Found on the way: `@id/x` to an id declared in the same buffer never resolved for loose / unsaved files (RelativeLayout `layout_below`, ConstraintLayout `toBottomOf`) — `LayoutParser` maps it to `@+id/x`. Golden `relative_rules` re-recorded (old golden captured the bug).
- Tests: `LooseKitTest` (ConstraintLayout bounds, Material/AppCompat widgets, tools:theme, night), `GoldenTest`; desktop `layout-model.test.ts` (`parseLooseKit`), `layout-model-service.test.ts` (kit selection, model wins, failure not retried), `layout-daemon.int.test.ts` (real jar + kit); E2E `e2e/loose-kit.cjs` (in `run.cjs`).
- Not done: RecyclerView / ViewPager2 list previews in loose files untested beyond class loading.
- Fix 2026-10-15: CheckBox (Material3 inflater → `MaterialCheckBox`), `MaterialCheckBox`, `MaterialSwitch` showed placeholders — `Failed to parse file …/mtrl_checkbox_button_checked_unchecked.xml — NullPointerException: … "parser" is null`. AAR res are uncompiled, so their `<aapt:attr>` inline animators reach layoutlib as `@aapt:_aapt/<id>` values; `ProjectCallback.getParser` returned `null` for `ResourceType.AAPT`. Now it keeps the inline tags of every parsed file (like `PaparazziCallback`) and serves them. `LooseKitTest` checks CheckBox / MaterialCheckBox (checked + unchecked), MaterialRadioButton, MaterialSwitch, SwitchMaterial, checkable Chip, MaterialButtonToggleGroup, Slider in light + night; E2E `loose-kit.cjs` adds a CheckBox. Still open: inline `<aapt:attr>` inside the *edited buffer* itself (layout / drawable preview parse it with `LayoutParser`, no aapt support).
