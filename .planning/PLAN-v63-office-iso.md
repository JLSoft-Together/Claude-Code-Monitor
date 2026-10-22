# PLAN v63 — Office style "Isometric 2.5D" (optional, AI raster art)

Date: 2026-10-22. Owner: a whole new office look, isometric 2.5D, **as an option**; the current pixel office stays
the default and unchanged. Characters as AI sprite sheets, only for the iso set.

Status: P0 + P1 implemented 2026-10-22 (patches G + H, golden draw-call test). 2026-10-22: 3D sprites wired (P3/P4 renderer side: `isoArt.ts`, `poses.ts`, `order.ts`, `IsoRenderer` sprite paths with per-item placeholder fallback) and P6 option UI done (`stores/office.ts` `style`, `OfficeOptions.vue` "Pixel / 3D (beta)", `office-v63.ts`, rebuild on change). Open: Playwright screenshots (seasonal decor, 3D head icons and label declutter done 2026-10-22, §3e). P5 polish and `docs/office-iso.md` done (3D parity wave below).

Paths relative to `packages/habblaud/client/src/` unless prefixed.

## Core idea

- Sim, layout, grid unchanged. Add a `Projection` seam + `WorldRenderer` factory to `createWorld` (vendored local
  patch G, ~60 lines in 4 files). `proj === undefined` → upstream code path verbatim (pixel style byte-for-byte).
- `IsoRenderer`, iso projection, `IsoArt` live Orrery-side: `apps/web/src/office/iso/**`, lazy chunk.
- Ground and wall faces are affine in iso → floors, rugs, light map, wall items, `drawScreen/drawBoard/drawClock/
  drawWindowView`, pack paintings all redraw via `ctx.transform`. Only furniture + characters need new sprites.

Fix wave 2026-10-22 (screenshots, front 3/4): characters sized from the chars manifest (`frame` 192×352, anchors,
`figure.standH` 280 → `CHAR_STAND_VIEW` 45 view px, under `WALL_H` 48); anims outside the sheet are skipped
(`animFits`) so seated agents keep a `seat` anim instead of the pixel billboard; corridor rugs dropped and rugs
9-sliced (no stretched borders); `office_chair*:gray` recoloured from blue (the generated warm grey read beige /
brown); `frameOps` no longer pushes a front to the end of the frame when its occupant was drawn before the base;
smooth clock hands; room name painted on the wall sign, overlay pill dropped once the sign is 11 px on screen
(patch G overlay branch). Sign shows no account dots (the pill had them).

Fix wave 2 (2026-10-22, owner screenshots): characters 1.3× (`CHAR_STAND_VIEW` 58, above `WALL_H`; seat lift capped
at 12 view px so seated agents stay on the chairs); max zoom capped per view so a character is at most ¼ of the view
height (`isoMaxZoom`, Habblaud `Camera.maxZoom` + `createWorld({ maxZoom })`); kitchen / lounge / restroom get an
iso-only north wall sign (`CORE_SIGNS`: restroom 6.1, kitchen 8, lounge 1.9 local tiles; the clock / painting under it
is hidden) with their `tr` name, reception keeps "Orrery", and core pills drop once the sign is readable; all iso canvas
text in Be Vietnam Pro 500 / 600 (bundled, loaded before the world is built, ≤ 1.5 s) with padded boxes (8 × 4 at
bubbles / pills, 6 × 2 at name tags) centred on a Vietnamese diacritics glyph box (Habblaud overlay `text` style).

3D parity wave (2026-10-22, P5 + P6 docs done): lighting (`office/iso/light.ts` light map per area prism: night tint of the
building only, dark rooms, presence-lit common areas, vignette, lamp / machine pools; glows for monitors, lamp bulbs,
machines, TVs; sunbeams), live screens at 2× in a scratch canvas (`screens.ts`), signs widen by 9-slice ≤ 1.6× within
the free wall, then shrink to a readable floor, then 2 lines, then ellipsis (`sign.ts`), cobwebs, popcorn, ping-pong,
GitHub alarm / party (beacons, floor pulse, "!", falling confetti; banner in Be Vietnam Pro via patch G
`drawFxBanner` font), smooth particles, hourglass / zzz / storm icons, mirror reflection, floor sweep + wall rise on
build, selection ring fill. Bubbles verified (8 × 4 pad, tail at the head, clear of the name tag; test in
`projection.local.test.ts`). Docs `docs/office-iso.md`. Left: seasonal decor (v1 gap), camera rotation (on hold),
Playwright screenshots, pixel icons over heads.

## 1. Places that assume screen = world px × zoom

| Area | file:line |
|---|---|
| Camera bounds / overview | `world/index.ts:102-121`; `camera.ts:21-32` |
| Focus / follow | `index.ts:154-175`, `:306-308` |
| Picking agent / room | `index.ts:184-200`, `:215-216`, `:344-350` |
| Screen pos API | `index.ts:427-433`, `:503-517` |
| Renderer frame / cull | `render/renderer.ts:332-337` |
| Base, floor, walls | `renderer.ts:175-317`, `:547-583`; `render/scene.ts:136-145`, `:212-263` |
| Wall items, signs, paintings | `renderer.ts:585-726`; `scene.ts:116-125` |
| Furniture anchor + sort | `scene.ts:266-282`; `renderer.ts:411-423`, `:467` |
| Characters, rings, shadow | `renderer.ts:824-919`, `:832-838`, `:1079-1103`; `sim/character.ts:175-177` |
| Mirror, fx, cars, props | `renderer.ts:811-822`, `:912-1180`; `layout/exterior.ts:40-94` |
| Lighting, room shade | `render/lighting.ts:203-234`, `:293-349`, `:428-449`, `:515-550`; `renderer.ts:1198-1218` |
| GitHub fx, seasonal | `render/github-fx.ts:125-126`; `render/seasonal.ts:29-169` |
| Overlay | `render/overlay.ts:276-304`, `:410-469` (heads-based parts work unchanged if heads are view space) |
| Sound | `world/sound-cues.ts:35-75` |
| Input pan/drag | screen-space, no change |
| Playback rebuild | `index.ts:372-387` (needs factory only) |

3/4 semantics baked into layout (biggest risk): two north "face" rows per room not walkable
(`constants.ts:8-9`, `builder.ts:64-66`), south door inside face rows (`room.ts:119`), south "mureta" 1 row
(`room.ts:107`), side caps 0.5 tile (`room.ts:114-115`), facing baked into kinds (`desk`/`desk_back`,
`office_chair`/`_front`, variants up/down/left/right).

## 2. Seam

### 2.1 Projection (parametric yaw θ / squash k, `office/iso/projection.ts` `makeIsoView`)
- θ = angle of world +x from screen horizontal (0 ≤ θ < 90°), k = vertical squash (pitch). Scale
  `s = 2/(cosθ + sinθ)` keeps a tile's projected bbox 32 px wide at every θ. Unit vectors
  `ax = s·(cosθ, k·sinθ)`, `ay = s·(−sinθ, k·cosθ)` (snapped to 1e-9 so θ 45 / k 0.5 is exactly the old 2:1).
- `toView(x, y, h) = x·ax + y·ay − (0, h)` (h stays in view px; WALL_H 48); `toWorld` = inverse 2×2
  (`det = s²k`); `bounds` = min/max of the 4 projected corners, raised by h; `ground = [ax, ay, 0, 0]`.
- North wall (along x at `baseY`): `[ax.x, ax.y, 0, hk, ay.x·baseY, ay.y·baseY − hk·baseY]`, `hk = WALL_H/32`.
  Side wall (along y at `baseX`): `[ay.x, ay.y, 0, hk, ax.x·baseX, ax.y·baseX − hk·baseV]`.
  `facePointAt(baseY, vx)` inverts a face point for the x-ray test (`walls.ts` `coversPoint`).
- Depth: view ray `(sinθ, cosθ, k·s)` has x, y ≥ 0 for 0 ≤ θ < 90, so `behind = A.maxX ≤ B.minX || A.maxY ≤ B.minY`
  stays valid (at θ 0 boxes apart on x never overlap on screen, y alone decides). Tie key and character order use
  `depthW = √2·(sinθ, cosθ)` (= (1, 1) at 45°).
- Classic θ 45 / k 0.5: `vx = x − y`, `vy = (x + y)/2 − h`, ground `(1, 0.5, −1, 0.5, 0, 0)` — kept as `CLASSIC_ISO`,
  parity tested.
- Dev override: `localStorage['ccm.office.isoView'] = '{"yaw":15,"k":0.6}'` (validated: yaw 0–89, k 0.3–0.9,
  else default), read once per page load (`readIsoParams` → `isoProjection`).
- **Decision (2026-10-22): default yaw 0, k 0.7** (§3d front 3/4 diorama). Screenshots of the trial angles
  (45 / 30 / 22 / 15 / 8, `D:/tmp/iso-view-*.png`): 45° left a thin diagonal strip with empty corners; lower yaw filled
  16:9 better and read rooms better; owner then picked front 3/4. k 0.7 ≈ 45° look-down as in the mock: a room's 9
  floor rows get ~200 px at zoom 1 against 48 px walls (walls hide ~24 % instead of ~28 % at k 0.6), while k 0.75+
  turns the 3/4 sprites too top-down.
- Exterior dropped in this style: no street / sidewalk / cars / trees / lamps / grass / slot gardens; only a
  theme-following background (`--ccm-canvas`) and a 1-tile pad + 2-tile halo around the building. Shell walls of
  empty slots stay (they close the corridor). Overview frames the building bbox (`buildingRect` → `proj.bounds`).
- Camera at +x+y; back walls = north (+ west at θ > 0). Characters: §3d (4 grid directions at θ 0).

### Vendored patch G
1. New `world/projection.ts`: `Projection { toView, toWorld, bounds, roomOutline? }`, `WorldRenderer` interface
   (`ctx, heads, areas, setAssets, sync, frame, pruneHeads, clock, paintingRect, signRect, signIsDark,
   hourOverride`).
2. `world/index.ts`: `CreateWorldOptions.projection?`, `renderer?` factory (lines 60, 376); branches at 102/106,
   159, 170-173, 198-200, 216, 308, 344/350.
3. `render/overlay.ts`: type `WorldRenderer`, `proj?`; branches room frame `:291-301`, pill anchor `:435-436`,
   fx banner `:463-466`, `colW` `:415`. `signRect()` null → pill fallback `:434`.
4. `world/sound-cues.ts`: project points before compare.
5. `debug.ts`: type only.
Rejected: `IsoCamera` subclass (head box vs click space mismatch at `index.ts:185-196`).

### Orrery side `apps/web/src/office/iso/`
`projection.ts`, `IsoRenderer.ts` (+ `LightScene`), `depth.ts`, `walls.ts`, `isoArt.ts`, `poses.ts`, `index.ts`
(`loadIso()` → `{ projection, createRenderer }`).
Reuse: `Sim`, layout, `render/anim.ts`, `Lighting.drawAmbient` under ground transform, `Particles`,
`screenModeFor`, `art.draw*` under plane transforms, `pickWallArt` (pack art), brand signage, `iconSprite` ×2.
Own: `frame()`, entity list + sort, furniture/char draw, room shade, building pad (no exterior, §2.1).
Heads in view space → overlay, `screenPositionOf`, confetti/coins work unchanged.

### 3/4 → iso translation
- North face → thin wall at `baseY = (r.y+2)·T`; wall items keep `cx/baseY`; face rows draw no floor; door = gap.
- Mureta → low box (~0.4 tile) on row 11. Caps → 0.5-tile boxes along y.
- Occlusion: inner walls full height with x-ray fade (α≈0.35) when covering a visible head / selected room;
  fallback cutaway.
- Feet: standing `gy = y + (T/2 − FOOT_DY)`; seated = spot tile centre + per-kind offset.
- Depth: grid AABB per entity; A behind B if `A.maxX ≤ B.minX || A.maxY ≤ B.minY`, tie `(cx+cy)`; statics
  topo-sorted per `layoutVersion`, characters inserted per frame; chair base < char < chair front.
- Lighting: ambient under ground transform; dark rooms = multiply on room prism polygon; glow/sunbeam simplified v1.
- Room picking: `toWorld` → tile → `inRect` (wall clicks fall to ground behind, acceptable v1).

## 3. Asset contract

Source at 4× view (tile 128×64), mip 2×/1×, smoothing on, magenta chroma. Pipeline `assets-src/office-iso/specs.json`
via `generate-codex.mjs` (+ reference images). Ship `apps/web/public/assets/iso/manifest.json` + atlases (webp).

| Group | Images |
|---|---|
| Floors (9 FloorKind seamless textures, carpet greyscale tinted) + 2 rugs | 11 |
| Wall textures (7 patterns + exterior) | 8 |
| Wall items (whiteboard, window, clock, tv, light switch ×2, elevator ×2, door frame, sign, mirror, shelf) | 11 |
| Furniture (kind+variant, reduced list) | ~51 |
| Exterior props 10 + cars 3×2 | 16 |
| Seasonal (optional) | 8 |
| Characters: 6 archetypes × (1 master + 18 strips) | 114 |

Furniture JSON: `{file, anchor, footprint, height, front?, rects?: {screen: {o,u,v}}}`.
Characters: 6 archetypes (3 f, 3 m, `hash(seed)%6` by look). Real poses ×2 dirs: stand 2, walk 4, sit 2, type 4,
raise_hand standing 2 / seated 2, sleep 2, talk 2, cheer 2 = 44 frames/archetype. Fallbacks: run→walk,
drink/use/groom/play/stretch/sulk→stand, read/game→sit|stand, wait→sit, laugh/rps→talk; held items dropped except
coffee/popcorn icon at `hand`. Frame 128×192 source (32×48 view), feet anchor (64,180), anchors head/chest/hand.

Total ≈ 211 core images, with retakes ≈ 320–420 Codex generations (~35 s, ~42 k tokens each → ~14–18 M tokens).
Lite: 4 archetypes, no cheer/talk ≈ 160 core.

## 3b. Art spike result (2026-10-22, `assets-src/office-iso-spike/`, 12 requests)

- Furniture: OK first take (iso 2:1, SE view, clean magenta). Extra items in the same style via `--image=<ref>`
  (pass refs as `--image=`; `-i a.png -` swallows the `-`). Key: alpha from `min(r,b)-g`, unmix + 2 px despill,
  hue rule for dark magenta pockets.
- Floor: iso diamond tiles fail (visible repeat/seams). Works: seamless top-down texture → crop one period,
  120 px cross-fade → `createPattern` + ground affine (~4 planks per 128×64 tile).
- Walls: deskew a generated segment → median column profile (cap / face / skirting) → stretch middle → skew back
  as one continuous strip. No seams, any height.
- Characters: identity across frames and directions **yes** (±1 px height). Walk needs per-frame pose wording
  (contact A / passing A / contact B / passing B) + "same head-to-body ratio, NOT younger or more chibi". Typing:
  2 frames come out identical → 1 seated frame, typing motion in code (1–2 px bob / hand layer). NE back view OK;
  mirror SE→SW, NE→NW OK. 4-direction turnaround in one request works well.
- Frame 96×160 @1x (figure ~140 px, feet line y=156), @2x 192×320. Sheets 3:2 (1536×1024), N poses in N columns,
  auto-slice by empty columns, X anchor body centre, Y anchor feet.
- ~4 requests per character (turnaround + walk SE + walk NE + sit) plus extra poses → character budget much lower
  than the 114 estimate.
- Open: no walk bob (add in code), slight style gap characters (thin brown line, flatter) vs furniture (heavier
  shading), stray pink pixels in plant gaps, thin light seam where wall meets floor in the mock (compositing).
- Prompt blocks that worked: `assets-src/office-iso-spike/prompts.json`.

## 3e. Seasonal decor, 3D head icons, label declutter (2026-10-22)

- Seasonal decor in 3D: same props and spots as pixel (shared Habblaud `seasonalFurnitureProp` / `seasonalElevatorProp`
  / `seasonalWallBat`), art `iso3d/seasonal/` (6 props), code garland / bulbs / webs / tint / window snow; missing art →
  nothing. Costumes stay pixel-only (gap).
- Head icons from `iso3d/icons/` (24 ids), vector fallback for simple ones, pixel last.
- Overlay declutter for iso (`ISO_TEXT.declutter`, patch G `render/declutter.ts`): priority greedy placement, ≤ 1 tag
  height nudge, hide + fade the rest, hysteresis 300 ms, keep previous slot; waiting agents' tag + full ✋ bubble always placed. Seasonal floor prop skipped
  when an item in front covers > 30 % of it (`seasonalCover`, screenshot: ghost on a floor lamp). Docs `docs/office-iso.md`.

## 3f. Smooth style switch (2026-10-22, owner: switching Pixel ↔ 3D froze the app)

Cause (code read + JS-only timing in the node test env, no raster): the old flow tore the world down first (blank
canvas), then on one frame built every area (`buildAreaVis` pixel canvases + iso statics / topo sort; cold first build
~280 ms JS for 11 areas, warm 7–10 ms pixel / 3–4 ms iso before raster), built it **again** when the wall-art
manifest and the 3D art arrived after the world (assets / art version bump → all areas + statics), uploaded up to six
1536×4576 character sheets (~28 MB RGBA each) on the first frame that drew them, and re-made a tinted rug canvas every
frame. Fixes: keep the old world on screen and build the new one on a hidden layer (`OfficeView` layers, `onReady`),
assets and art loaded before `createWorld` (one build), budgeted warm-up per frame (Habblaud patch I for pixel,
`IsoRenderer.warmUp` + staged progressive reveal for 3D, archetype groups staggered so sheet uploads spread over
frames), idle background preload of the 3D chunk / fonts / art (once, 4 decodes in flight, skipped on data saver / low
battery), rug tint cache, overlay pill after 150 ms, style control disabled while switching, switch back = cancel.
Follow-up (owner, same day): idle preload decodes no image unless 3D was used before (`ccm.office.isoUsed`) or intent is shown (options popover opened, pointer / focus on the style control); decoded art is released (ImageBitmap `close`) 60 s after the pixel office is back; a failed switch reverts the stored style with a short note. @1x sheets at low zoom not done (needs per-zoom sheet swap + anchor scaling). Left: pixel character / furniture sprite generation still happens on the first hidden frame of a cold pixel world;
Docs `docs/office-iso.md`.

## 3d. Final look decision (2026-10-22, supersedes the flat style and 45° iso)

- Owner reviewed `assets-src/office-iso-spike/blueprints.html` and picked **3D-3**: soft stylized 3D diorama
  render (`style3d` block in `prompts.json`), **front-facing 3/4 camera** (building long side horizontal, back wall at
  the top, looking down ~45°). Reference: `.cache/raw/mock3d-c-front.1.png`; Jin 3D: `.cache/raw/jin3d-turn.1.png`.
- Projection: yaw 0, k ≈ 0.7 in the parametric projection; no exterior (street, cars, trees) in this style.
- Characters: 4 grid directions — down (front), up (back), right (left = mirror); no diagonals.
- Furniture / floors / walls generated at this camera after the renderer screenshot is approved.
- Flat-style character frames from the first character run are dropped (pipeline scripts reused).
- Camera rotation: **ON HOLD (owner, 2026-10-22)** — planned as 4 views, 90° steps (keys Q / E + toolbar buttons, smooth transition, persisted). Projection
  rotates the grid before projecting; depth order, wall cutaway (walls facing the camera drawn low / x-ray) and
  picking follow the active view. Furniture needs front, back and side sprites (other side = mirror); characters map
  their sim direction to the camera-relative one (down / up / right / mirrored right). Map budget ≈ 300 requests.
- Defaults accepted by owner: 3D-look wall art set (~14), no seasonal decor in v1, rotating room wall colours,
  day/night by code tint + lamp glow, agent-designed 5 extra characters reviewed before full poses,
  option label "Pixel / 3D (beta)".

## 3c. Owner decisions (2026-10-22)

- Style approved: the spike look (soft cel-shaded illustrated iso, warm oak / cream / sage / dusty blue), prompt
  blocks in `assets-src/office-iso-spike/prompts.json`.
- Owner character test (from owner photos, refs local only in `.cache/refs-owner/`, never committed): turnaround,
  walk SE, sit-type / sit / raise-hand all consistent.
- Characters: **6 archetypes**, chosen at random by seed like the others; the owner character is one of them,
  named **Jin** (`id: "jin"`, look `m`). Not tied to the main agent.
- Jin personality: drinks coffee and goes to the restroom often. Habblaud persona hook (vendored patch H,
  `world/social/persona.ts`): iso style only, Jin seeds get trait `cafeina`; solo weights end at bathroom ×3 and
  coffee ×2.5 IN TOTAL vs `IDLE_WEIGHTS` (owner 2026-10-22; `soloK` compensates the trait factors, `jinPersona`). Extra Jin sprites: `drink_se`, `stand_coffee_se`, `walk_coffee_se`.

## 4. Phases

- **P0 spike** (dev flag `localStorage ccm.office.style=iso`): projection + placeholder `IsoRenderer` (pixel floor
  via ground affine, walls via temp canvas + wall affine, furniture as extruded boxes, characters as pixel
  billboards). Measure overview, depth, FPS (~40 agents), picking. Screenshot → owner go/no-go.
- **P1** patch G + golden pixel test (pixel style identical before/after) + UPSTREAM.md.
- **P2** IsoRenderer complete on placeholders: sort, walls/x-ray, build anims, lighting, rings, exterior, overlay
  parity, sound.
- **P3** assets batch 1: floors, walls, wall items, furniture; per-sprite fallback to box; contact sheet with
  diamond guide.
- **P4** characters: master, strips, postprocess (chroma, trim, feet align, height normalise, histogram match),
  sheet JSON, pose map + flip, seated layering.
- **P5** polish: steam, popcorn, ping-pong, cobweb, github fx, seasonal; gaps (mirror, sign text skew) listed. **Done 2026-10-22**; mirror reflection done; seasonal decor done 2026-10-22 (§3e), costumes stay pixel-only.
- **P6** option UI: `stores/office.ts` `style: 'pixel'|'iso'` (`ccm.office.style`), `OfficeOptions.vue` segmented
  "Pixel / Isometric (beta)", `OfficeView.vue` lazy `loadIso()` + fallback note + rebuild on change,
  `image-rendering:pixelated` only for pixel; packs (rooms, wall art) apply to iso; i18n `office-v63.ts`; docs
  `docs/office-iso.md`; index. **Done** (docs 2026-10-22).

Tests: vendored `projection/overlay/sound-cues .local.test.ts`; Orrery `iso/projection`, `depth`, `isoArt`, `poses`,
`officeView` "Office style", `readOfficeStyle`; Playwright screenshots.

Risks: R1 wide diagonal building (frame by projected bbox, open on `focusRoom`); R2 3/4 semantics (one translation
point); R3 wall occlusion; R4 character consistency; R5 asset angle drift (diamond guide, `anchorNudge`); R6
memory/perf (webp atlas, mip, cull, lazy); R7 upstream re-copy (local tests pin patch G); R8 beta gaps.
