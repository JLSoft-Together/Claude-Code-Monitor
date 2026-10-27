# Office theme packs — authoring guide for image generation (Codex)

Status: §8 implemented in v62 (2026-10-22, `.planning/PLAN-v62-office-packs-fullscreen.md`): Office options pick a
pack, the world rebuilds with its wall art and room palettes, classic stays the default. Packs `japandi`,
`night-shift`, `forest-cabin`, `retro-80s` are listed in `assets/themes/index.json`; §3–§7 remain the authoring spec.

## 1. What this is

The Office view (v60, `.planning/PLAN-v60-habblaud-office.md`) draws the vendored Habblaud office. Today it has
**one** look: a single set of AI-made wall art and one illustration in `apps/web/public/assets/` (manifest
`assets/manifest.json`), plus procedural rooms whose colours come from one fixed list
(`packages/habblaud/client/src/art/theme.ts`, 10 room palettes).

A **theme pack** is a complete, swappable set of those image assets plus a small palette file, so the owner can
pick between several office looks instead of one. Packs never replace code. Name them "office theme packs" to
avoid confusion with Orrery's app colour themes (`apps/web/src/themes.css`), which are unrelated.

Seasonal decorations (Christmas / Halloween, `WorldOptions.theme`) are drawn procedurally on top of whatever pack
is active; packs do not provide them.

The 3D (beta) office style (`docs/office-iso.md`) keeps a pack's room palettes but draws its own 3D wall art first
(`assets/iso3d/wallart/`); a pack's paintings and posters show there only where no 3D art fits, and seasonal decor is
not drawn in 3D yet.

## 2. What a pack can and cannot change

| Part of the office | Source | In a pack? |
|---|---|---|
| Paintings on room walls (2-tile frames) | PNG, `wallArt` kind `painting`, 26×16 | **yes, generated** |
| Wide paintings in the lounge (4-tile frames) | PNG, `wallArt` kind `painting`, 58×24 | **yes, generated** |
| Posters (1 tile), 6 fixed subjects | PNG, `wallArt` kind `poster`, 12×16 | **yes, generated** |
| Framed copies of every painting | PNG, made by the pipeline from the painting | yes, derived (§5) |
| "Empty office" illustration | PNG, 480×270 native, shipped ×2 | **yes, generated** |
| Room floor / wall / accent colours, desk and chair variants | data, `theme.json` `rooms` (§4.3) | yes, written by hand |
| Characters, furniture shapes, floors, walls (geometry) | procedural code `client/src/art/**` | **no** |
| Logo, favicon, reception sign ("Habblaud"), og-image | `assets/brand/**` | **no** — brand stays global |
| Text, UI, speech bubbles | code + i18n | **no** |

## 3. Pack layout

```
apps/web/public/assets/themes/<pack-id>/        shipped (served at /assets/themes/<pack-id>/)
  manifest.json                                  schema §4.1
  theme.json                                     schema §4.2
  preview.png                                    256×144, contact sheet of the pack (§6), NEAREST only
  art/painting-<slug>.png                        26×16   × 8 or more
  art/painting-wide-<slug>.png                   58×24   × 3 or more
  art/framed/painting-<slug>.png                 32×22   (one per painting, made by the pipeline)
  art/framed/painting-wide-<slug>.png            64×30
  art/poster-<variant>.png                       12×16   × exactly 6: code, coffee, rocket, cat, bug, ship-it
  illustrations/empty-office.png                 960×540 (480×270 native, ×2 NEAREST)

assets-src/office-themes/<pack-id>/             source, committed, never shipped
  specs.json                                     recipe in the upstream schema (§5.1)
  .cache/raw/<asset-id>.png                      chosen raw generation per asset (gitignored)
  .cache/takes/                                  every take (gitignored)
  generation-log.json                            model, exact prompt, file, cost per request
  NOTES.md                                       art direction, picks and anything rejected
```

- `.cache/` folders are scratch: add `assets-src/**/.cache/` to `.gitignore` before the first generation.
- `<pack-id>`: lowercase kebab-case, 3–24 chars, `[a-z0-9-]`. The current set is the reserved pack `classic`
  and stays where it is (`/assets/manifest.json`); do not move or regenerate it.
- File names inside a pack must be stable: once a pack ships, a changed image gets a new slug (the collector
  serves unhashed `/assets/**` with `no-cache`, but cached copies may linger in a running window).
- Total pack size: ≤ 400 KB. Every PNG optimised (palette PNG is fine).

## 4. File formats

### 4.1 `manifest.json` (same schema as the classic one, minus brand and og)

```jsonc
{
  "version": 1,
  "illustrations": { "emptyOffice": { "file": "illustrations/empty-office.png", "w": 960, "h": 540, "scale": 2 } },
  "wallArt": [
    { "id": "painting-tea-garden", "kind": "painting", "file": "art/painting-tea-garden.png", "w": 26, "h": 16,
      "tiles": 2, "title": "Tea garden", "framed": { "file": "art/framed/painting-tea-garden.png", "w": 32, "h": 22 } },
    { "id": "painting-wide-bamboo", "kind": "painting", "file": "art/painting-wide-bamboo.png", "w": 58, "h": 24,
      "tiles": 4, "title": "Bamboo grove", "framed": { "file": "art/framed/painting-wide-bamboo.png", "w": 64, "h": 30 } },
    { "id": "poster-coffee", "kind": "poster", "variant": "coffee", "file": "art/poster-coffee.png", "w": 12, "h": 16,
      "tiles": 1, "title": "Coffee" }
  ]
}
```

Rules, all checked by the QA in §7:
- Paths are relative to the pack folder. `w`/`h` are the real file size.
- `tiles`: poster 1, painting 2 (26×16), wide painting 4 (58×24). The world only puts art in a frame of the same
  width (`render/scene.ts` `pickWallArt`), so a missing size falls back to procedural art.
- Poster `variant` ∈ `code | coffee | rocket | cat | bug | ship_it` (underscore in the value, hyphen in the file
  name `poster-ship-it.png`), one poster per variant.
- `title`: short English title (the canvas does not show it today; it is for the gallery and accessibility later).

### 4.2 `theme.json`

```jsonc
{
  "id": "japandi",
  "version": 1,
  "name": { "en": "Japandi", "vi": "Japandi" },
  "description": { "en": "Calm oak, paper and moss.", "vi": "Gỗ sồi, giấy và rêu, yên tĩnh." },
  "outline": "#2b3245",
  "rooms": [ /* 6–10 RoomTheme objects, §4.3 */ ]
}
```

`name` / `description`: ≤ 24 / ≤ 80 characters, both locales required (Orrery ships `en` and `vi`).

### 4.3 Room palettes (`rooms[]`)

Exactly the `RoomTheme` shape from `packages/habblaud/client/src/art/api.ts`:

```jsonc
{ "carpet": "#c9d1dc", "carpet2": "#bdc6d3",
  "wall": { "base": "#eef1f4", "trim": "#9fb0c4", "pattern": "plain" },
  "accent": "#3f7fd8", "deskVariant": "white", "chairVariant": "blue" }
```

- `wall.pattern` ∈ `plain | stripes | tiles | wood_panel | brick | glass | marble`.
- `deskVariant` ∈ `wood | white | dark`; `chairVariant` ∈ `black | blue | red | green | gray`.
- Colours are `#rrggbb`. `carpet2` is the checker/second tone of `carpet` (ΔL ≈ 3–6 %). Wall `base` stays light
  (L ≥ 85 %) so characters and art read against it; `trim` is a darker tone of the same family.
- `accent` (room sign pill, small details) must reach 3:1 contrast against `wall.base`.
- Neighbouring rooms get consecutive entries, so alternate colour families in the list (as `theme.ts` does).
- The palettes must harmonise with the pack's art: sample the dominant colours of the generated paintings and
  posters (§6) and build the rooms from them.

## 5. Generation workflow

### 5.1 Recipe (`specs.json`)

Use the upstream schema from `src/habblaud/scripts/assets/specs.json` (read it and its `README.md` first):
`defaultModel`, `styles` (shared prompt blocks), `assets[]` with `id`, `group`, `kind`, `title`, `variant`
(posters), `aspect`, `styles`, `prompt`, `post`, `out`. Per pack:

- Copy the four shared style blocks (`pixel`, `chroma`, `wallart`, `poster`) and change **only** the colour /
  material sentence of `pixel` to the pack's direction (§5.3). Keep every technical sentence word for word
  (grid, no anti-aliasing, no dithering, no text, original artwork, light from top-left, outline colour).
- Keep the `logo-mark` entry exactly as upstream (the post-processor requires the key), but do not generate it.
- `post` values per kind — keep these unless a QA failure says otherwise:

| kind | aspect | `post` |
|---|---|---|
| painting | 16:9 | `{ "kind": "art", "w": 26, "h": 16, "colors": 10–14, "frame": "wood\|white\|black\|gold" }` |
| wide painting | 21:9 | `{ "kind": "art", "w": 58, "h": 24, "colors": 14–18, "frame": … }` |
| poster | 3:4 | `{ "kind": "poster", "w": 12, "h": 16, "colors": 7–9, "outline": "<pack outline>" }` |
| empty office | 16:9 | `{ "kind": "scene", "w": 480, "h": 270, "colors": 32, "scale": 2, "despeckle": true, "balance": 0.5 }` |

Optional `darkBias` (−1…1) and `saturation` per asset, as upstream uses for night scenes.

### 5.2 Generate

1. Generate each raw image at the asset's aspect (about 1024 px on the long side), one subject per image, with the
   full prompt = asset `prompt` + its `styles` blocks joined in order. Save the chosen take to
   `.cache/raw/<asset-id>.png`, every take to `.cache/takes/`, and append the request to `generation-log.json`.
2. Judge takes **after** reduction to native size (step 3), never on the raw image: what matters is legibility at
   26×16 / 12×16. Big flat shapes and strong contrast beat detail.
3. Reduce with the upstream post-processor, which is deterministic and free to re-run. It resolves its inputs next
   to the script, so run a copy per pack:
   ```sh
   cp src/habblaud/scripts/assets/{postprocess.py,pixelops.py,pixelart.py} assets-src/office-themes/<pack-id>/
   python3 -E assets-src/office-themes/<pack-id>/postprocess.py --out apps/web/public/assets/themes/<pack-id>
   ```
   (Windows: `py -3 -E …`; needs Pillow and numpy.) Then delete the outputs a pack must not ship: `brand/` and
   `og-image.png`, and remove `brand` and `og` from the written `manifest.json`. Delete the copied `.py` files
   afterwards; only `specs.json`, `NOTES.md` and `generation-log.json` stay in `assets-src`.
4. Write `theme.json` (§4.2) and `preview.png` (§6). Run the QA (§7).

Budget: ≤ 40 image requests per pack (≈ 18 assets + retakes). Stop and report instead of exceeding it.

### 5.3 Art direction per pack

Each pack defines, in `NOTES.md` and in the `pixel` style sentence:
- **Mood** in one line.
- **Materials** (floor, wood, metal, glass, fabric) and **5–7 key colours** as hex.
- **Light**: always from the top-left; time-of-day feel only through colour, not through cast shadows.
- **Subjects** for 8+ paintings and 3+ wide paintings: varied (landscape, still life, abstract, city, animal,
  pattern), all fitting the mood. Posters keep their six fixed subjects (code, coffee, rocket, cat, bug, ship)
  restyled for the pack.
- **Empty office illustration**: the same office as classic (top-down 3/4 view, desk islands with glowing
  monitors, lounge corner, plants, shelves, water cooler, coffee counter, windows on the back wall, nobody
  there) in the pack's materials and colours.

Hard content rules for every prompt and image:
- Original artwork only. Never name or imitate an existing game, tileset, film, artist, brand or logo; describe
  the style with generic words (upstream `README.md` "Direção de arte" explains why the first takes were thrown
  away).
- No text, letters, numbers, signatures or watermarks anywhere (they turn into noise at native size).
- No real people, no recognisable buildings or landmarks, nothing violent, political or religious.
- Paintings full-bleed (no frame, mat or wall in the image); posters one centred iconic subject on a flat
  background; transparent assets on flat `#FF00FF` (the `chroma` block).

### 5.4 Starter catalogue

Suggested first packs (pick 3–5; each needs its own `NOTES.md` direction):

| id | Mood | Key materials / colours |
|---|---|---|
| `japandi` | calm, minimal | pale oak `#c9a77c`, rice paper `#f3eee4`, moss `#7c8b5a`, charcoal `#3a3a3a`, clay `#b8735a` |
| `night-shift` | late, neon-lit studio | deep navy `#1d2240`, teal glow `#35d0c8`, magenta accent `#e0559a`, warm lamp `#f2b552` |
| `forest-cabin` | cosy timber lodge | dark pine `#5b3d2a`, wool red `#b4473a`, fern `#4f7d4a`, stone `#9a9488`, candle `#f1c46b` |
| `seaside` | bright coastal studio | sand `#e8d9b5`, sea blue `#2f7fb8`, coral `#ee7b62`, white-wash `#f7f7f2`, rope `#b99460` |
| `retro-80s` | playful memphis office | cream `#f4ecd8`, teal `#2fb5a6`, pink `#f07aa8`, yellow `#f6c945`, black squiggles `#262626` |
| `paper-mono` | ink-on-paper | off-white `#f4f1ea`, ink `#2b2b33`, one accent `#d0482f`; paintings mostly 2–3 colours |

## 6. Preview

`preview.png`, 256×144, NEAREST only: top row the 8 paintings framed, second row the wide paintings, third row the
6 posters, the illustration scaled down in the remaining space. It is what a future gallery shows; it also helps
the human reviewer approve the pack in one glance.

## 7. QA checklist (all must pass before a pack is committed)

Automatable (write a throwaway script; do not add it to the app):
- [ ] Every file in `manifest.json` exists with exactly the stated `w`×`h`; no extra files in the pack folder.
- [ ] Paintings 26×16 (≥ 8) and 58×24 (≥ 3); framed copies 32×22 / 64×30; posters 12×16 × 6 variants, one each.
- [ ] Illustration 960×540 and every 2×2 block is a single colour (true ×2 NEAREST).
- [ ] Colour counts ≤ the `post.colors` of each asset (+ frame / outline colours); no semi-transparent pixels
      (alpha only 0 or 255).
- [ ] `theme.json` validates against §4.2–4.3 (enums, hex, both locales, 6–10 rooms, accent contrast ≥ 3:1).
- [ ] Pack ≤ 400 KB; ids and slugs kebab-case; `generation-log.json` has an entry for every chosen raw.

By eye, on `preview.png` and in the running Office (once §8 exists, or by temporarily pointing a dev build at the
pack):
- [ ] Each painting and poster reads as its subject at 1× and 3× zoom; posters still recognisable as code /
      coffee / rocket / cat / bug / ship.
- [ ] No text-like squiggles, faces of real people or logos.
- [ ] The room palettes, the art and the illustration feel like one place; characters stay readable on the walls
      and carpets in both day and night lighting.

## 8. Integration contract (for the later code task, not part of authoring)

So the packs above plug in without re-authoring:
- Discovery: a static `apps/web/public/assets/themes/index.json` listing `[{ "id", "name": {en,vi}, "preview" }]`,
  updated whenever a pack is added (classic is implicit and always first).
- Selection: Office options gain "Theme pack" (`ccm.office.pack`, default `classic`), next to the existing
  seasonal "Theme" (auto / none / Christmas / Halloween); both apply together.
- Assets: the vendored loader (`client/src/world/assets.ts`) fetches `/assets/manifest.json`; the Orrery side
  either serves the chosen pack's manifest under that URL or adds an additive manifest-URL option to the loader
  (a local patch, recorded in `packages/habblaud/UPSTREAM.md`). Paths inside a pack manifest resolve against the
  pack folder.
- Rooms: `art/theme.ts` `roomTheme(seed)` reads from the active pack's `rooms` when present (also a recorded local
  patch), otherwise the classic list.
- Switching packs rebuilds the world like a locale switch does (OfficeView `build()`); brand assets never change.

As built (v62): the loader takes the additive option (`createWorld(…, { assetPack: 'themes/<id>' })`, Habblaud local
patch D); `roomTheme` reads `setRoomThemes(rooms)` (patch E, 1–32 rooms, the whole list is rejected if one entry is
invalid). Fallbacks, all silent except the note in the options popover: an id missing from `index.json` or a malformed
saved id → classic; a missing / invalid `theme.json` → classic rooms ("not installed" note); a missing or art-less pack
`manifest.json` → classic wall art. Orrery side: `apps/web/src/office/packs.ts`, `stores/office.ts` (`pack`,
`activePack`, `packMissing`), `OfficeView.vue` `build()`, `OfficeOptions.vue` (pack cards with `preview.png`, seasonal
theme segmented control).
