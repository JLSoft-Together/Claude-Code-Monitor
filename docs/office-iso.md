# Office 3D mode (iso, beta)

The Office view (Monitor → Office) has two looks: the default **Pixel** office (Habblaud, unchanged) and **3D (beta)**,
a soft 3D diorama of the same office seen from the front at about 45°. Same simulation, layout, agents, rooms,
timelapse and theme packs; only the renderer and the art differ. Plan and decisions: `.planning/PLAN-v63-office-iso.md`.

## Option

- Stored in `localStorage['ccm.office.style']`: `'pixel'` (default) or `'iso'`. UI: Office options popover →
  "Pixel / 3D (beta)" (`OfficeOptions.vue`, strings `i18n/office-v63.ts`). Changing it rebuilds the world.
- The 3D code is a lazy chunk: `apps/web/src/office/iso/index.ts` `loadIso()` returns the projection, the renderer
  factory, the zoom cap, the overlay text style and the persona hook. If the 3D art is missing the options popover
  says so and every item falls back to a placeholder (boxes, pixel billboards).

## Switching style

- The shown office stays on screen while the other one builds on a hidden canvas layer; it fades in when its world
  reports ready (`world.onReady`, Habblaud patch I), then the old world is destroyed. A pill "Loading the 3D office…" /
  "Đang tải văn phòng 3D…" appears only if the switch takes more than 150 ms; the style control is disabled meanwhile.
  Changing back before it is ready drops the half-built world (nothing else to do: the shown one is still there).
- Builds are spread over frames: at most ~8 ms of new area builds per frame (`warmUpMs`). The pixel office appears
  when every area is built; the 3D office appears once the corridor and the first room are ready and then reveals the
  rest: rooms one by one (visible / nearest first, 40–80 ms apart, fade + 8 px drop, 280 ms each), characters last by
  archetype. With reduced motion there is no reveal, only one short crossfade once everything is built.
- Wall art (`/assets/manifest.json`) and the 3D art are loaded before the world is created, so the world is built once.
- After the pixel office is ready and the app is idle, the 3D chunk, fonts and manifests preload once per session in
  the background (`office/iso/preload.ts`; skipped while hidden, on data saver or on a low battery not charging). The
  images (~230 MB decoded) are decoded only when 3D was used before (`ccm.office.isoUsed`) or when the owner shows
  intent (opens the Office options, points at the style control): 4 decodes at a time with `createImageBitmap`, off the
  main thread. 60 s after the pixel office is back (or after the last intent) the decoded art is released.
- A failed switch keeps the shown office, puts the style control back and shows "Could not load the 3D office, back to
  pixel" / "Không tải được văn phòng 3D, quay lại pixel" for 4 s.

## Projection

- `office/iso/projection.ts` `makeIsoView({ yaw, k })`: yaw = angle of world +x from the screen horizontal, k =
  vertical squash. Default **yaw 0, k 0.7** (front 3/4, back wall at the top). A tile is 32 view px wide and
  22.4 deep; walls are `WALL_H` 48 view px.
- Dev override, read once per page load: `localStorage['ccm.office.isoView'] = '{"yaw":15,"k":0.6}'`
  (yaw 0–89, k 0.3–0.9, anything else = default).
- Camera rotation is **on hold** (owner, 2026-10-22). Only the front view exists.

## Renderer

`office/iso/IsoRenderer.ts` implements Habblaud's `WorldRenderer` (patch G). It draws floors and walls as textures
under affine transforms, furniture and characters as sprites sorted by depth (`depth.ts`, `order.ts`), and wall items
in the wall plane. Helpers:

| File | Role |
|---|---|
| `light.ts` | Day / night: a cached light map (multiply) per area prism: lamp-warm rooms at night, dim empty kitchen / lounge / restrooms (presence light), dark rooms with the light off, floor-lamp and machine pools, night vignette; same hour as the pixel office (`Lighting`, `hourOverride`, timelapse clock) |
| `screens.ts` | Live content (desk, arcade, TV screens, whiteboard, window view) painted at 2× view resolution into a scratch canvas, then drawn smoothed into the art's `rects` with a glass sheen |
| `sign.ts` | Wall sign names: widen the sign (9-slice, up to 1.6×, never past a neighbour), then shrink to a readable floor, then two lines (taller sign), then ellipsis |
| `effects.ts` | Vector cobwebs, alarm beacon, CI "!" balloon, popcorn bucket, ping-pong ball, soft glows |
| `particles.ts` | Smooth view-space particles (confetti, popcorn, coins, sparkles, rain) |
| `fonts.ts` | Be Vietnam Pro 500 / 600 (bundled) for all canvas text, padded 8 × 4 |

Glows at night: monitors, floor-lamp bulbs, vending / arcade machines, wall TVs; sunbeams through north windows by day.
GitHub effects: red floor pulse, beacons on the back wall and the "!" balloon for a failing CI, falling confetti for a
merged PR; the banner text uses the 3D font (overlay `text` style). Rooms being built sweep their floor in and raise
their walls; signs slide down.

## Assets

Contract: `.planning/CONTRACT-v63-office3d-assets.md` (units, anchors, `front` images, `rects`, variants). Root:
`apps/web/public/assets/iso3d/manifest.json` → `chars/`, `furniture/`, `surfaces/`, `wallart/` sub-manifests, all @2x
of view px. Loader `office/iso/isoArt.ts` validates every item and drops only the failing ones.

Pipelines (Codex image generation, then a deterministic Python postprocess; raw output in each folder's `.cache/`):

| Folder | Generates | Commands |
|---|---|---|
| `assets-src/office-iso/` | Characters (format: `NOTES.md`) | `node gen.mjs --style=3d <arch>-<template> …` → `py -3 process.py --style=3d [ids]`; review `py -3 review.py --style=3d` |
| `assets-src/office-3d-furniture/` | Furniture and wall items | `node gen.mjs <sheet> …` (prompts `prompts.json`, layout `layout.json`) → `py -3 process.py` (contact sheet `.cache/contact-sheet.png`) |
| `assets-src/office-3d-surfaces/` | Floors, walls, rugs, wall art | `node gen.mjs <id> …` → `py -3 process.py [surfaces|art|room|all]` |

Every generator accepts `--dry` (print the prompts) and `--note="…"`; every request is logged in
`generation-log.json`. Style blocks come from `assets-src/office-iso-spike/prompts.json` (`style3d`).

## Seasonal decor

Same option as the pixel office (Office options → Seasonal decorations; `auto` follows the calendar) and the same spots:
the first tall plant of an area becomes the Christmas tree (Halloween: ghost or pumpkin), small plants become gifts
(pumpkins), never in restrooms; the elevator gets a wreath (bat), long face walls a bat at Halloween. Placement comes
from Habblaud `render/seasonal.ts` (`seasonalFurnitureProp`, `seasonalElevatorProp`, `seasonalWallBat`), shared with the
pixel renderer. Art: `iso3d/seasonal/manifest.json` (`{ version, scale, items: { <prop>: { file, anchor, footprint,
wall } } }`, `<prop>:<theme>` wins over `<prop>`); floor items replace the plant's sprite (anchor = front-left floor
corner, centred on the plant footprint, depth-sorted and lit like furniture; skipped, plant kept, when an item standing
in front would cover more than `SEASONAL_COVER_MAX` 30 % of it, e.g. a floor lamp two tiles south: `seasonalCover`), wall items (`"wall": true`) hang from the
wall base line like wall items. A missing manifest, item or image draws nothing for that item (the plant stays).
Drawn in code: the garland with ornaments along face walls, Halloween corner cobwebs, glowing bulbs after the light map
(dimmed with the room light), seasonal rug and wall tint, snow on Christmas windows. Costumes are pixel-only.

## Head icons

Status / emote icons over heads (alert, hourglass, zzz, storm, coin, …) come from `iso3d/icons/manifest.json`
(`{ version, scale, items: { <IconName>: { file, size, anchor } } }`, anchor = bottom-centre), drawn smoothed with the
longest side at `HEAD_ICON_VIEW` 18 view px on the head anchor, with the same bounce / pop. Missing id → a vector
version (`office/iso/icons.ts`: alert, question, check, heart, star, coin, zzz, hourglass) → the pixel sprite. The coffee
cup held without a coffee anim uses the `coffee` icon at 9 view px. Bubbles and tags sit `ISO_ICON_LIFT` 6 px higher
than in the pixel office to clear the larger icon.

## Name tags and bubbles

In 3D the overlay declutters tags and bubbles every frame (`ISO_TEXT.declutter`, Habblaud patch G,
`render/declutter.ts`): greedy placement in screen space by priority (selected / hovered > waiting > main agents >
working > idle sub-agents; a bubble before the same agent tier's tag), a tag may move up or down by at most one tag
height, a bubble may lift one step or shrink to its icon; what still collides is hidden (fade 160 ms) and comes back on
hover / selection, when zoomed in enough, or once its spot is free for 300 ms. A tag that is shown keeps its slot while
it is still free (no flicker). Selected / hovered agents and waiting agents (✋ / permission) always show: their tag and
their full ✋ bubble are never hidden or shrunk to the icon, everyone else makes room. Uniform grid, O(n log n) for ~100 items.

## Characters

Six archetypes from `chars/manifest.json`: Jin, Theo, Kofi (look m), Mai, Rosa, Ava (look f), picked by
`hash(seed)` within the agent's look (`archetypes.ts`). Directions down / up / right (left = mirror). Height
`CHAR_STAND_VIEW` 58 view px; the zoom is capped so a character is at most a quarter of the view height.

Jin (the owner character) drinks a lot of coffee and goes to the restroom often: in the 3D style only, Habblaud's
persona hook (patch H) gives Jin seeds solo-outing weights of **coffee × 2.5 and bathroom × 3 in total**
(`personas.ts`, `JIN_TOTAL_K`).

## Vendored patches

- **G** (`packages/habblaud/UPSTREAM.md`): `Projection` + renderer factory seam, overlay / sound / picking through the
  projection, zoom cap, overlay text style (also used for the GitHub banner font). Without it every path is upstream's
  (golden draw-call test `client/src/world/golden.local.test.ts`).
- **H**: persona override hook (Jin).
- **I**: warm-up + ready (`createWorld({ warmUpMs, assets })`, `WorldApi.onReady`, `WorldRenderer.warmUp?` /
  `settled?`, pixel `Renderer.warmUp` budget). Without the options every path is upstream's (golden unchanged).

## Known gaps

- Camera rotation (on hold).
- Seasonal costumes stay pixel-only (the 3D sheets have no costume frames).
- No exterior (street, cars, trees, fireflies) in this style by design; the building stands on a pad.
- Mirror reflections need the 3D character art (no reflection on placeholders).
