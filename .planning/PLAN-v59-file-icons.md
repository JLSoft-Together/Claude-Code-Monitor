# v59 — Atom Material file icons in the Explorer

## Why
Owner (2026-10-18) uses the JetBrains plugin **Atom Material Icons** (publisher AtomMaterial, Elior "Mallowigi"
Boukhobza) and wants the Workspace Explorer to look **exactly like IntelliJ with that plugin**: each file type and
well-known folder with its own coloured icon. Today `ExplorerTree.vue` shows five monochrome lucide glyphs
(`FileGlyph`: code / json / image / text / file) and folders only get a chevron.

## Goals
- Explorer tree rows show the Atom Material icon for files and folders, with the plugin's own colours, picked by the
  plugin's own rules, so a project looks the same as in IntelliJ.
- Folder rows show the `foldersOpen/` variant when they hold a file open in a viewer (any depth), as the plugin's
  Hollow Folders (on by default, `HollowFoldersDecorator` + `OpenFileDirectoryTracker`) do. Expanding a row does not
  change its icon.
- Under a dark theme a file icon with a `<name>_dark.svg` twin uses the twin (IntelliJ's IconLoader does this; 48
  icons, e.g. readme, github, css).
- Parts marked `data-themed="true"` (plain folder, ~40 `*ignore` files) take the tree text colour, as IntelliJ's
  `ThemeColorPatcher` paints them with `Tree.foreground`.
- Settings → Appearance gets a choice **File icons: Atom Material / Simple**. Simple = today's lucide glyphs,
  unchanged. Default: Atom Material (builder's call, owner asked for the feature).
- Icons are bundled in the app (no network at runtime, CLAUDE.md rule) with the MIT notice shipped alongside.

## Non-goals
- Other places that show file names (file tabs / pane headers, Git Changes list, Quick Open, Command palette,
  diff / log file lists). Explorer tree only for now.
- The plugin's UI / PSI icons (`assets/icons/ui`), arrows style, monochrome mode, saturation, custom associations,
  per-icon-pack toggles.

## Anti-goals
- Theme-tinted or re-coloured icons: owner wants IntelliJ's exact look. This is a **deliberate exception** to
  "all colours via theme tokens" (`.planning/COLOR-SYSTEM.md`): file-type icon colours are brand colours of the
  file type, not UI roles. Record the exception in COLOR-SYSTEM.md. Git status colour on the file **name** and the
  git letter stay as they are; the active-row accent styling of the name stays.
- Slowing the tree: no per-row regex scan on every render, no eager load of ~2,500 SVGs at startup.
- Fetching anything from GitHub at runtime or during `npm install` / build. Only the owner-run generator touches the
  network.

## Source (verified 2026-10-18)
- Icons + rules live in **`AtomMaterialUI/iconGenerator`** (git submodule of `mallowigi/a-file-icon-idea`),
  MIT, © Elior "Mallowigi" Boukhobza. `assets/icons/files/*.svg` (1,809), `assets/icons/folders/*.svg` (356),
  `assets/icons/foldersOpen/*.svg` (356). Each SVG starts with an MIT comment block; colours are hard-coded fills
  (e.g. `vue.svg` `#41B883`; `folders/src.svg` folder `#5C6BC0` + glyph `#89ddff`; `folders/folder.svg` `#78909C`).
- Rules: `icon_associations.json` → `associations.associations.regex[].value` (1,792 entries: `name`, `pattern`,
  `priority`, `icon` like `/icons/files/vue.svg`, `iconColor`, optional `iconPack`, `defaultState`) plus 4 `type`
  entries (IDE file-type based: Database, Images, SVG, SVG Dark — ignored, regex rules cover those files).
  `folder_associations.json` → 351 regex entries (`icon` like `/src.svg`, resolved in `folders/` and
  `foldersOpen/`).
- Matching in the plugin (`RegexAssociation.matches`): `Pattern.compile(pattern, CASE_INSENSITIVE)`, **full match**
  (`matcher().matches()`) against the file name, or against the path when the pattern contains `/`. Among matches
  the association with the highest `priority` wins — **builder: confirm the order in
  `DefaultAssociations.findMatchingAssociation` (a-file-icon-idea, `common/.../icons/associations/`) and mirror it,
  including the tie-break.**
- `iconPack` entries (Angular, Nest, Redux, Next.js, NgRx, CSS, Rails, Recoil, Tests) are on or off per the
  plugin's settings — **builder: read the defaults in `AtomSettingsConfig` and keep exactly the packs that are on
  by default**. `defaultState` is editor-table metadata, not an enable flag (539 entries without it include
  TypeScript / Vue, which are on).

## Shape
- `scripts/gen-file-icons.mjs` (owner-run, like `gen-fonts.mjs`): downloads `AtomMaterialUI/iconGenerator` at a
  **pinned commit SHA** (constant in the script; tarball via codeload), then
  - drops the MIT comment from each used SVG, minifies (svgo is already a sensible choice; keep `fill`s), writes
    `apps/web/public/file-icons/{files,folders,foldersOpen}/<name>.svg` — only icons referenced by an enabled rule
    plus the defaults (`file.svg` or the plugin's fallback file icon, `folders/folder.svg`,
    `foldersOpen/folder.svg`);
  - converts each pattern to a JS `RegExp` source (full match = wrap as `^(?:…)$`, flag `i`), fails loudly on any
    pattern JS cannot compile or that behaves differently (Java-only syntax); 2026-10-18 scan found no lookbehind /
    possessive / `\Q\E\A\Z` patterns;
  - writes `apps/web/src/lib/explorer/fileIconRules.ts` (generated, do-not-edit header): two arrays already sorted
    by match order, `{ re, icon, path? }` with `path` set when the pattern contains `/`;
  - writes `apps/web/public/file-icons-LICENSE.txt` (MIT text + copyright + source repo + SHA).
- `lib/explorer/fileIcons.ts`: `fileIconFor(name, relPath)` / `folderIconFor(name, relPath, open)` → URL under
  `file-icons/`; first match in sorted rules wins; memoised per (kind, name, path-if-needed) in a `Map`. Path rules
  match the path relative to the Explorer root with `/` separators (same form the plugin sees for project files —
  builder: check how `file.path` looks in the plugin and match the tail sensibly).
- `ExplorerTree.vue`: when the setting is Atom Material, the row renders `<img :src width=16 height=16 alt=""
  draggable="false" decoding="async">` in the glyph slot for files, and for folders next to the chevron (IntelliJ
  shows chevron + folder icon). Root row and out-of-root rows: builder's call, keep consistent with IntelliJ (root
  shows a folder). Simple keeps today's markup exactly. Row height (22px), indent and windowing unchanged.
- Settings store: `fileIcons: 'atom' | 'simple'` persisted under a `ccm.*` localStorage key like the other
  appearance settings; control in Settings → Appearance next to the fonts; i18n `en` + `vi`.
- CSP / packaging: confirm `img-src` allows `'self'` for the packaged app and `npm run dev`; the files ship through
  Vite's `public/` copy like the fonts.

## Size budget
Builder measures after minifying and reports the total in `.code_index/_meta.md`. If the folder exceeds ~6 MB,
prefer dropping unused-by-any-enabled-rule icons over a sprite rewrite.

## Tests
- `fileIcons.test.ts`: a table of names → expected icon, from the plugin's own behaviour: `package.json`,
  `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `setup.vitest.ts`, `README.md`, `LICENSE.txt`,
  `eleventy.config.js`, `foo.vue`, `foo.ts`, `foo.test.ts`, `Dockerfile`, `.env`, `.gitignore`,
  `.github/workflows/ci.yml` (path rule), unknown `foo.xyz` → default; folders `src`, `test`, `tests`, `.github`,
  `node_modules`, `docs`, unknown → default, open variant when `open`.
  (Done: `lib/explorer/fileIcons.test.ts`.)
- Generator sanity: every `icon` in the rules file exists on disk; every pattern compiles.
- E2E (`apps/desktop/e2e/explorer.cjs`): rows show an `img` whose `src` ends in the expected icon for a known file
  in Atom mode, and the lucide svg in Simple mode.

## Docs / index
`.code_index/web.md` (Explorer section), `_meta.md`, `.planning/COLOR-SYSTEM.md` (exception), CLAUDE.md one line
(since v59 Explorer file icons), credits in the About / licences place where fonts-LICENSES is linked, if any.

## Decisions after the builder check (2026-10-18)
- The three behaviours above (dark twins, themed parts, hollow folders) follow IntelliJ because the owner asked for
  "exactly like IntelliJ"; the first draft had them wrong.
- Themed icons are single-fill, so they render as a CSS mask (`bg-current`) in the row's text colour; the rest are
  `<img>`. `textlintignore` has a second, unthemed `#808080` fill that the mask also paints in the text colour.
- Open files = the Workspace's file viewer panes (`kind: 'file'`) across all tabs; read only, file tabs unchanged.
- Root row keeps its uppercase header style without an icon; out-of-root (symlink) rows keep the link glyph.
- The plugin hides its own Kotlin / Java / (with the PHP plugin) PHP icons in favour of IntelliJ's PSI icons; Orrery
  has no PSI icons, so those rules stay on.
- Pinned source: the `iconGenerator` commit the plugin repo pins as its submodule (`3efb727`, 1,720 file rules).
  `main.ts` / `app.ts` / `server.ts` get the Node icon (plugin rule "Node", priority 100, above TypeScript).
- Size: 4.6 MiB of SVG (1,691 file + 650 folder files), loaded per visible row; rules module ~98 KB, compiled lazily.

## Left to the builder
Exact Settings control style (segmented vs select), image loading details, fallback icon names, how to present the
licence file, test fixtures, commit split.
