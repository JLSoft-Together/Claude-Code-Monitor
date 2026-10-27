# CONTRACT v63 — Office 3D asset formats (shared by art agents and the renderer)

Date 2026-10-22. Look: `style3d` block in `assets-src/office-iso-spike/prompts.json`, reference
`assets-src/office-iso-spike/.cache/raw/mock3d-c-front.1.png`. Camera: front 3/4 (yaw 0, k 0.7): building long side
horizontal, back (north) wall at the top, looking down ~45°. Only the FRONT view is needed (camera rotation on hold).

## Units

- View px (renderer, zoom 1): 1 tile = **32 px wide**, **22.4 px deep** on screen (32 × k), wall height
  `WALL_H` = 48 view px. Sim TILE = 16 world px.
- Every shipped image is **@2x of view px** (`"scale": 2`): 1 tile = 64 px wide, 44.8 px deep, wall 96 px.
  Renderer draws with smoothing on. Optional `@1x` copies may be added later.
- PNG or WebP with real alpha (chroma-keyed from #FF00FF, despilled, no magenta fringe).

## Root

All under `apps/web/public/assets/iso3d/`:

```
iso3d/manifest.json          { version: 1, scale: 2, chars: "chars/manifest.json", furniture: "furniture/manifest.json",
                               surfaces: "surfaces/manifest.json", wallArt: "wallart/manifest.json" }
iso3d/chars/…                characters (format: assets-src/office-iso/NOTES.md, layout "3d", dirs down/up/right)
iso3d/furniture/…
iso3d/surfaces/…
iso3d/wallart/…
```

Each sub-manifest may be missing; the renderer falls back to placeholders per item.

## Furniture (`furniture/manifest.json`)

```jsonc
{ "version": 1, "scale": 2,
  "items": {
    "desk":            { "file": "desk.webp", "footprint": [2, 1], "anchor": [x, y], "height": 1.1,
                         "front": "desk.front.webp", "rects": { "screen": [x, y, w, h] } },
    "plant_tall:palm": { "file": "plant_tall-palm.webp", "footprint": [1, 1], "anchor": [x, y], "height": 2.0 }
  } }
```

- Key = `FurnitureKind` from `packages/habblaud/client/src/art/api.ts`, plus `:variant` when the kind has variants
  (renderer looks up `kind:variant`, then `kind`, then placeholder box).
- `anchor` = image px of the **front-left corner of the footprint on the floor** (where the footprint's south edge
  meets its west edge). Footprint on screen: width `w × 64` px, depth `h × 44.8` px going UP from the anchor.
- `height` in tiles (for depth / x-ray), informational.
- `front` (optional): a second image, same size and anchor, holding only the parts that must cover a seated or
  standing character (chair backrest seen from behind, desk front panel, toilet stall door). Base drawn behind the
  character, `front` after.
- `rects.screen` (desk, arcade, tv): screen area in image px, renderer paints live screen content there (the image
  should show a dark/off screen in that rect).
- Facing semantics from the pixel set stay (`art/api.ts`): `desk` = monitor screen faces the camera, worker sits
  SOUTH of it on an `office_chair`, back to the camera; `desk_back` = we see the BACK of the monitor, worker sits
  NORTH of it on an `office_chair_front`, face visible;
- States as variant keys: `toilet_stall:1` (door closed; base key = door ajar), `wall:elevator:0..4` (0 closed,
  4 fully open), `wall:light_switch:off`. Extra rects: `door` (elevator), `opening` (door frame, transparent),
  `glow` (floor lamp), `board`, `glass`, `face`, `sign`, `tv`.
  `office_chair` = backrest to the south (to the camera); `office_chair_front` = backrest to the north;
  variants `up/down/left/right` = direction the seat faces.

## Surfaces (`surfaces/manifest.json`)

```jsonc
{ "version": 1, "scale": 2,
  "floors": { "wood": { "file": "floor-wood.webp", "tile": [64, 64], "tint": false }, "carpet": { …, "tint": true } },
  "walls":  { "plain": { "file": "wall-plain.webp", "tile": [64, 96], "tint": true, "cap": "#e9e2d6" } },
  "rugs":   { "a": { "file": "rug-a.webp", "tint": true } } }
```

- Floors: seamless **top-down** square textures, one texture repeat = `tile` px = 1×1 tile (may cover 2×2 tiles if
  `"tiles": 2`). Renderer squashes vertically by k. `tint: true` = greyscale-ish texture multiplied by the room
  theme colour (carpets, rugs).
- Floor kinds: `carpet, wood, tile_check, tile_white, concrete, marble` (+ `grass, sidewalk, street` not needed).
- Walls: front-facing seamless strip, `tile` = one tile wide × full wall height (96 px @2x), skirting at the bottom,
  top edge clean (renderer draws the cap). Patterns: `plain, stripes, tiles, wood_panel, brick, glass, marble`.
- Wall items (window, whiteboard, clock face, tv, light switch, elevator, door frame, mirror, wall shelf, sign) go in
  `furniture/manifest.json` with key `wall:<kind>`, `anchor` = bottom-centre on the wall base line, `rects` for live
  content (board, tv, glass, face).

## Wall art (`wallart/manifest.json`)

Same schema as `docs/office-theme-packs.md` §4.1 (`wallArt[]`), but 3D-look images, sizes @2x: painting 2 tiles
(≈ 104×64 incl. frame), wide painting 4 tiles (≈ 232×88 incl. frame), poster 1 tile (≈ 48×64).
