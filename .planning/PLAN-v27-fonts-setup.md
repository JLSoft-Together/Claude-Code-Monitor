# v27 — Fonts, code size + Ctrl+wheel zoom, animated startup screen, first-run quick setup

## Context
User feedback after v25 (2.3.0), four requests:
1. **Fonts**: more fonts for reading code clearly (Consolas, JetBrains Mono, Google Sans, about 10 more). Decision: two separate choices, a **code font** (terminal, file viewer, diff, `font-mono` labels) and a **UI font**.
2. **Font size + Ctrl+wheel**. Decision: the result depends on where the pointer is.
   - Over a terminal, file view or diff: change the code font size.
   - Anywhere else: zoom the whole app, the same as the existing Ctrl +/-.
   - Agent Map keeps its own wheel zoom.
3. **Redo the startup screen** (the Electron loading page shown while the collector starts): a text logo that animates character by character.
4. **Some features only work once enabled** (added mid-turn): show a popup so the user can enable them right away. Decisions:
   - Show it **only on the first app open**.
   - Items: desktop notifications, status line bridge, preview access to the projects folder, sound + Windows toast.
   - Only items that are currently off are shown.

Current state:
- xterm font is hard-coded in `TermPane.vue:466` (`fontFamily` stack, `fontSize: 13`).
- `--font-sans` / `--font-mono` live in the `@theme` of `style.css:7-8`. FilePane `.ccm-code` uses `13px` (`FilePane.vue:366`).
- App zoom is only Ctrl +/-/0 in `main.ts:133-135`, and it is not persisted.
- The loading page is `pages.ts` `loadingPage` (data: URL with OS-only colours), loaded from `main.ts:355`.
- CSP already allows `font-src 'self' data:` (`collector/src/server.ts:141`).

Target version 2.4.0. Copy this plan to `.planning/PLAN-v27-fonts-setup.md`. Update `.code_index/{web,desktop,_meta}.md`.

Rules that still apply:
- Before UI work, load skills `frontend-design:frontend-design` and `ui-ux-pro-max:ui-ux-pro-max`.
- i18n in en + vi for every string (new strings go in a new file `i18n/workspace-v27.ts`, spread at the root like v25).
- Colours via tokens; status = icon + text + colour.
- Write files LF only (no Python text mode).

**Shared checkout:** another session ("port-explorer-panel") has uncommitted Explorer edits, including in `TermPane.vue`, `usePaneAttachments.ts` and `promptAttachments.ts`. Edit around them and never stage their hunks.

---

## Phase A — Fonts (#1)
Packages: fontsource, all checked on npm, all OFL except Ubuntu Mono (UFL). Bundled locally; nothing loads from the network. Import only the `latin`, `latin-ext` and `vietnamese` subsets. Check the per-subset CSS file names in `node_modules` before writing the imports. Faces are only fetched when used (`@font-face` + `unicode-range`), so unused fonts cost installer size only (~3–6 MB).

`apps/web/src/lib/fonts.ts`, a pure catalogue: `{ id, name, stack, kind: 'code'|'ui', source: 'bundled'|'system', platforms? }`.
- **Code** (14 entries):
  - System default: the current stack, `id: 'system'`.
  - Consolas (system, Windows).
  - Cascadia Code (bundled `@fontsource-variable/cascadia-code`).
  - JetBrains Mono.
  - Google Sans Code.
  - Fira Code.
  - Source Code Pro.
  - IBM Plex Mono (`@fontsource/ibm-plex-mono` 400/500/600).
  - Roboto Mono.
  - Geist Mono.
  - Ubuntu Mono (400/700).
  - Inconsolata.
  - Menlo (system, macOS).
  - Courier New (system).
- **UI** (9 entries):
  - System default (Apple/Segoe stack).
  - Google Sans Flex (`@fontsource-variable/google-sans-flex`).
  - Inter.
  - Roboto.
  - IBM Plex Sans.
  - Source Sans 3.
  - Noto Sans.
  - Open Sans.
  - Be Vietnam Pro (`@fontsource/be-vietnam-pro`).
  - Every UI font must ship a `vietnamese` subset. Geist Sans is excluded for that reason.
- Every stack ends with the current system fallback stack.
- `isInstalled(family)` for system entries: compare canvas `measureText` widths against `monospace` / `serif`. The picker shows "Not installed" and disables the row. Platform-only entries are hidden on the other OS.
- `apps/web/src/fonts.css` (imported from `main.ts` after `style.css`) holds the subset imports.

`stores/settings.ts`:
- New fields:
  - `codeFont` (`ccm.font.code`, default `system`).
  - `uiFont` (`ccm.font.ui`, default `system`).
  - `codeFontSize` (`ccm.font.codeSize`, 10–24, default 13; `clampCodeSize`).
- An unknown stored id falls back to `system`.
- An immediate watch sets these on `document.documentElement.style`:
  - `--font-mono` and `--font-sans`. Tailwind v4 reads both through `var()`, so all `font-mono` / `font-sans` text follows.
  - `--ccm-code-size`.
- No pre-paint script change. Bundled fonts swap in from local disk within a frame, so the CSP hash of `index.html` stays as it is.

Consumers:
- **TermPane**: initial options read from settings. A watch on `[codeFont, codeFontSize]` runs `await document.fonts.load(`${size}px ${firstFamily}`)`, then sets `term.options.fontFamily/fontSize`, calls `term.clearTextureAtlas()` and then `refit()`. This is the same pattern as the theme watch at `TermPane.vue:554`.
- **`.ccm-code`** (`style.css:335`; FilePane, DiffView): `font-size: var(--ccm-code-size)`. Markdown inline code keeps `0.9em`.
- **Ligatures**: off everywhere (`font-variant-ligatures: none`) to match xterm, which has no ligature support without the node addon.

UI `components/ui/FontPicker.vue`:
- Listbox in a popover, one per kind. Each row is previewed in its own font, with a sample: `0O1lI {}=>` for code, `Agent Monitor · Tiếng Việt` for UI.
- Roving focus and type-to-select, using the same keyboard pattern as ThemePicker.
- Mounted in SettingsMenu **Appearance**, under the theme picker:
  - "Code font" plus a size stepper (− 13 px +, reset).
  - "Interface font".
  - "Interface zoom" (− 100% +, reset; see B).
- CommandPalette: `c:font:<id>` prefs commands, plus "Increase/Decrease code size".

Docs:
- CLAUDE.md: change the font rule to "no remote/web-loaded fonts; open-licence fonts bundled in the app, opt-in; default stays the system stack".
- `.planning/COLOR-SYSTEM.md` is not affected.
- Licence notices: fontsource packages ship `LICENSE`. Add `apps/web/public/fonts-LICENSES.txt`, generated by a small script listing each font, its licence and copyright, and link it from Settings → Help → About fonts.

## Phase B — Code size + Ctrl+wheel (#2)
`composables/useWheelZoom.ts`, installed once in `App.vue`. It is a `window` `wheel` listener with `{ capture: true, passive: false }` that acts only when `ctrlKey` is held (this also covers the macOS pinch, which arrives as ctrl+wheel):
- **Target inside `[data-code-zoom]`** (TermPane xterm host, FilePane code/markdown body, DiffView):
  - `preventDefault()` and `stopPropagation()`, so xterm does not scroll.
  - Step `codeFontSize` by ±1. The trackpad delta builds up to a step every 50 px of deltaY.
- **Target inside `.vue-flow`**: return untouched, so the map keeps its zoom.
- **Otherwise**: `preventDefault()`, then `desktop.zoomApp(+1|-1)`.

Desktop:
- `main.ts`: IPC `ccm:zoom` (isAppFrame; `'in'|'out'|'reset'`) → `setZoomLevel` in 0.5 steps, clamped to −3…+3. The existing Ctrl +/-/0 path goes through the same `applyZoom(contents, level)`.
- The zoom level is saved in `appearance.json`. Merge with `background`, because `setWindowBackground` currently overwrites the whole file.
- The level is re-applied on `did-finish-load` of app frames. Chromium does not persist it across restarts.
- `zoomApp` / `getZoom` are exposed in preload and `lib/desktop.ts`, so Settings can show the current %.

Feedback:
- `components/ZoomHud.vue`: a small pill near the bottom centre, `role=status` + `aria-live=polite`, showing "Code 15 px" or "Zoom 110%". It fades after 1.2 s; with reduced motion it appears and disappears without animation.
- Keyboard: Ctrl/⌘ + = / - / 0 stays as app zoom. While a terminal is focused, the same keys with Alt change code size.
  - Add these to `lib/shortcuts.ts` and ShortcutsDialog.
  - Tips: `codeZoom` (repeated stepper clicks suggest Ctrl+wheel).

## Phase C — Startup screen (#3)
`apps/desktop/src/pages.ts`, redesign of `loadingPage`. It stays a static data: URL with **no JS**: CSS only, which avoids CSP and preload questions.

Layout:
- Centred column:
  - App mark: inline SVG from `apps/web/public/favicon.svg` paths, 56 px, radius 14.
  - Wordmark "Agent Monitor", 30 px, semibold, letter-spacing −0.01em.
  - A 2 px indeterminate accent bar, 160 px wide.
  - `t.loading` (muted) + `t.loadingHint` (faint).
  - Version `v${app.getVersion()}` at the bottom.

Animation:
- The wordmark is split server-side into `<span aria-hidden="true" style="--i:n">` per character; the space is kept as ` `. The wrapper is `<h1 aria-label="Agent Monitor">`.
- Each character runs `opacity 0→1, translateY(8px)→0, blur(6px)→0` over 420 ms, `cubic-bezier(.2,.8,.2,1)`, delay `calc(var(--i) * 32ms)`. The whole reveal is about 0.85 s.
- After the reveal, one subtle accent "caret" blinks after the last letter twice, then the bar fades in. This keeps the decoration minimal; there are no gradients.
- With `prefers-reduced-motion`, everything is static and the bar is a solid line.

Theme:
- The web side already sends the canvas colour (`setWindowBackground`). Widen this to `setAppearance({ canvas, ink, muted, accent, mode })`. It is validated as `#RRGGBB` in main, stored in `appearance.json`, and `loadingPage(t, look)` uses it. The loading page then matches the chosen theme (for example Dracula) instead of the OS grey, with no flash into the app.
- Fallback: the current OS tokens.

Other details:
- `errorPage` gets the same mark and tokens.
- No artificial minimum display time. Startup speed wins; the reveal is short enough to read.
- Test: new `apps/desktop/test/pages.test.ts`. It checks that `loadingPage` escapes the title, splits the wordmark into N spans with increasing `--i`, includes the reduced-motion block, and uses the given colours with a fallback when they are invalid.

## Phase D — First-run quick setup (#4)
`components/QuickSetup.vue`, a modal sheet (`ccm-sheet`, focus trap, Esc = later).
- It opens once, on the first app open after install or update (`ccm.setupDone` absent), after the first snapshot. Monitor tours then auto-offer only after it closes; OnboardingTour waits on `ui.setupOpen`.
- Re-open: Settings → Help "Quick setup", or Ctrl+K `c:setup`.
- Rows (lucide icon, title, one-line why, action button). After enabling, a row shows "On" with a CircleCheck, the success colour and text.

| Item | Shown when | Enable action |
|---|---|---|
| Desktop notifications | `!settings.notifyEnabled` and permission ≠ unsupported | `settings.toggleNotifications()` (the click is the user gesture) |
| Status line bridge | main reports `statusLineState() !== 'ours'` | IPC `ccm:statusline-enable`, see below |
| Preview access to projects folder | no grants yet | IPC `ccm:grant-folder`, see below |
| Sound | `!settings.sound` | `settings.sound = true` + `playChime('waiting')` preview |
| Windows toast | `extras.toast === 'off'` (Windows only) | `connection.updateNotify({ toast: true })` |

- Footer: **Done**. "Skip for now" sets `ccm.setupDone` too, as the user chose first open only. If nothing is off, the sheet never opens.

**Status line bridge enable** (desktop `main.ts` + new `src/statusline.ts`, unit-tested):
- `statusLineState()`: reads `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json` and returns one of:
  - `'ours'`: the command contains our bridge script path.
  - `'other'`: a different command.
  - `'none'`.
  - `'unreadable'`: missing file = none; invalid JSON = unreadable.
- `ccm:statusline-enable` (isAppFrame) does the following:
  - Native `dialog.showMessageBox` confirm that shows the exact JSON that will be written. The page cannot write Claude's config by itself.
  - Writes `statusLine: { type: 'command', command: bridge.command }`. With `'other'`, the command is `bridge.command + ' --chain "<old command>"'` (escape `"`).
  - Keeps a backup at `settings.json.ccm-backup` and writes atomically (tmp + rename), preserving the other keys.
  - `'unreadable'` → returns `'unreadable'`, and the row falls back to the existing copy-snippet UI.
- The row says this takes effect in new Claude sessions.
- Document this write in `docs/claude-code-integration.md`: the only write to Claude config, user-confirmed, reversible from the backup. The monitoring rule (no prompts, no API) is unchanged.

**Preview access to projects folder**:
- `ccm:grant-folder` (isAppFrame) → native `showOpenDialog({ properties: ['openDirectory'] })`. A picked folder that is not a filesystem root goes to `grants.add`; the result is the folder path or null.
- Live pane cwds are already roots, so this covers HTML or images opened from anywhere under, for example, `D:\Code` without the per-folder "Allow access" prompt.
- It is revoked by the existing "Forget folder access".

E2E: every script that sets `ccm.tourWorkspaceDone` also sets `ccm.setupDone`. Add a helper in the E2E common setup if one exists, otherwise apply it per script.

---

## Critical files
- **web**:
  - `lib/fonts.ts`*, `fonts.css`*
  - `stores/settings.ts`, `stores/ui.ts` (`setupOpen`)
  - `components/ui/FontPicker.vue`*, `components/ZoomHud.vue`*, `components/QuickSetup.vue`*
  - `composables/useWheelZoom.ts`*
  - `components/workspace/{TermPane,FilePane,DiffView}.vue`
  - `components/{SettingsMenu,CommandPalette,OnboardingTour,ShortcutsDialog}.vue`, `App.vue`
  - `style.css`, `lib/{desktop,shortcuts,tips}.ts`
  - `i18n/workspace-v27.ts`* + `en.ts`/`vi.ts` spread
  - `public/fonts-LICENSES.txt`*
- **desktop**: `src/main.ts`, `src/preload.ts`, `src/pages.ts`, `src/statusline.ts`*, `src/preview/ipc.ts` (`ccm:grant-folder`), `test/{pages,statusline}.test.ts`*
- **docs**: CLAUDE.md (font rule), `docs/claude-code-integration.md`, `.code_index/*`, `.planning/PLAN-v27-fonts-setup.md`

(* = new)

## Reuse
- `ThemePicker.vue`: radiogroup and roving focus.
- `ccm-sheet` / `retireOverlay` / `withViewTransition` (`lib/motion.ts`).
- `BreakToast.vue`: status pill pattern for ZoomHud.
- `ToggleSwitch`, `SegmentedControl`.
- `settings.toggleNotifications`, `connection.updateNotify`, `playChime`.
- `GrantStore` (`preview/grants.ts`), `installBridge` (`bridge.ts`, `bridge.command`).
- The theme-change watch in TermPane (`term.options.*` + refit).
- `setWindowBackground` / `appearance.json` in `main.ts:166-191`.

## Verification
- `npm run typecheck`. `npm test`, with these new tests:
  - `lib/fonts.test.ts`: ids unique; every bundled family is present in `fonts.css`; every UI font has a vietnamese subset import; stacks end with the system fallback.
  - `useWheelZoom` decision function.
  - `settings` clamp / unknown id.
  - desktop `pages.test.ts` and `statusline.test.ts`: none / ours / other → chained command; unreadable is refused; backup is written; other keys are preserved.
- `npm run desktop:dev` manual pass:
  - Pick each code font: terminal re-measures and nothing is clipped; FilePane and diff follow; Vietnamese text renders in each UI font.
  - Ctrl+wheel over the terminal changes code size and shows the HUD.
  - Ctrl+wheel over the header zooms the app; the zoom survives a restart.
  - Ctrl+wheel over the map still zooms the map.
  - Startup screen in a dark theme (Dracula) and a light theme; reduced motion.
  - Fresh profile shows the quick setup once. Enable each row. The status line write shows the confirm dialog and the backup appears. Run it against a scratch `CLAUDE_CONFIG_DIR`, not the user's real `~/.claude`.
- E2E: new `apps/desktop/e2e/v27.cjs` covers these, and is added to `run.cjs`:
  - Font switch sets `--font-mono`.
  - CDP `Input.dispatchMouseEvent` type `mouseWheel` with modifiers=2 over a terminal increases `xterm` font size, and over the header changes the zoom factor.
  - Quick setup appears with `ccm.setupDone` cleared.
  - Then run the full `run.cjs` suite.
- `npm run dist` on Windows at the end; smoke-test the packaged exe (fonts load from the asar, startup screen).
