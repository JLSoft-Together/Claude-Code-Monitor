# Office iso — character sprites (v63 P4)

Production folder for the 6 character archetypes. Spike: `../office-iso-spike/` (read only).

Status 2026-10-22: the **flat** set (illustrated cel look, iso diagonal SE / NE) was completed but its shipped copy
(`apps/web/public/assets/iso/chars/`) was deleted on the owner's request (2026-10-22, unused). The owner then switched to a **soft 3D diorama look with a front 3/4 camera**
(directions down / up / right, left = mirror). The 3D set (`--style=3d`) is shipped in
`apps/web/public/assets/iso3d/chars/` (contract `.planning/CONTRACT-v63-office3d-assets.md`): frame 192�352 @2x,
feet y 344, seat y 272, standing figure 280 px (`figure.standH`). Requests: flat 59 / 90, 3D 65 / 70
(`generation-log.json`, `style` field; `gen.mjs` budgets per style).

## Files

| File | Role |
|---|---|
| `prompts.json` / `prompts3d.json` | Style blocks, archetype designs (`who`), pose templates, plan. Flat: `style`+`char`+`chroma`(+`adult`). 3D: `style3d` (owner-approved, from the spike) + `cam` + `chroma`(+`adult`) |
| `gen.mjs` | Codex driver. `node gen.mjs [--style=3d] [--dry] [--note="…"] <arch>-<template> …`. Budget 90, concurrency ≤ 3 (`GEN_CONC`), every request in `generation-log.json` (`style` field). Raw output `.cache/raw/` (flat) or `.cache/raw3d/` |
| `chroma.py` | Spike chroma key (`min(r,b)-g` alpha, unmix, 2 px despill, magenta hue rule) |
| `layouts.json` | Per style: anim rows (`[name, anchor, ms]`), sheets (`name`, `n` columns, `scale`, `cols: [col, anim, anchor, "match"?]`, `alt` fallback sheet, `optional`), `synth` (code-made frames), `ship` / `raw` dirs |
| `process.py` | Deterministic postprocess: `py -3 process.py [--style=3d] [ids…] [<sheet>=<take>]` → atlases + `manifest.json`, `.cache/contact-sheet[3d].png`, `.cache/out[3d]/<id>-walk.gif`, `<id>-atlas.png`, `contact-<id>-a/b.png` |
| `sheets.json` / `sheets3d.json` | `takes` (`"<id>-<sheet>": "2"` = retake 2), `tune` per archetype: `off` (sheets to ignore → `alt`), `skip` (`{sheet: [anim]}`), `cm` (`{sheet: strength}` colour match to the turnaround), `k` (`{sheet: scale multiplier}`), `breathe_k` |
| `review.py` | `py -3 review.py [--style=3d] [ids]` → `.cache/walk-<id>.png` (stand + walk rows per direction) and `.cache/pose-<id>.png` (seated row + other poses), with head / seat / feet guide lines |
| `.cache/raw/` | Raw sheets (gitignored). Jin's `jin-turn.1`, `jin-walk-se.1`, `jin-sit-old.1` are copies of the spike's generated `owner-*.png` (never the owner photos). `<id>-turn.final.png` = chosen flat turnaround, used as design reference by the 3D turn |

## Archetypes

| id | look | Design |
|---|---|---|
| `jin` | m | Owner character (spike). Short textured dark-brown hair, light skin, white tee, navy rolled trousers, white sneakers, green-strap watch |
| `theo` | m | Early 30s, medium-brown skin, side-parted black hair, trimmed beard, rectangular dark glasses, dusty-blue rolled-sleeve shirt, khaki chinos, brown shoes |
| `kofi` | m | Late 20s, deep dark-brown skin, beard, charcoal knit beanie, mustard hoodie, grey jeans, white/grey sneakers, broad build |
| `mai` | f | Late 20s, light-beige skin, long straight black hair (middle part), sage blouse, cream wide-leg trousers, tan flats, gold studs |
| `rosa` | f | Early 30s, tan-brown skin, big curly dark-brown hair, terracotta cardigan over cream top, charcoal A-line skirt, dark tights, black ankle boots |
| `ava` | f | 30s, fair freckled skin, copper-red chin-length bob, light-blue denim jacket, white tee, black trousers, white sneakers, tall |

No magenta / pink / purple on any subject (chroma).

## Frame contract (both styles)

- Frame 192×320 @2x (`<id>.webp`), 96×160 @1x (`<id>@1x.webp`, 0.5 Lanczos of the @2x atlas). Atlas cols = 8.
- Standing figure 280 px tall @2x, feet line y = 312, X anchor = torso centre (median midpoint of the widest run in
  the 22–45 % height band) at x = 96.
- Scale per sheet: turnaround col 1 → 280 px; pose sheets carry a standing reference in column 1 (exact per-sheet
  scale); walk sheets: tallest frame = 0.98 × 280. Seated raise-hand B is matched to raise-hand A by body height
  (`"match"`).
- Seated anims (`anchor: "seat"`) share the standing scale and feet line; the chair seat point is the global
  `anchors.seat` (96, 240): renderer puts `seat` on the chair seat, standing anims put `feet` on the ground point.
- Sleep frame 2 is synthesised (`breathe`: body squashed to 97.5 % from the feet, head sinks ~5 px).
- Walk `ms` = 640 ms cycle / frame count (8 frames → 80, 4 → 160). Mirror for the missing direction is the
  renderer's job (flat: SW = flip SE, NW = flip NE; 3D: left = flip right).

## Manifest

```json
{"version":1,"scale":2,"frame":{"w":192,"h":320},"cols":8,
 "anchors":{"feet":[96,312],"head":[96,63],"chest":[96,133],"hand":[131,183],"seat":[96,240]},
 "archetypes":[{"id":"jin","look":"m","name":"Jin","sheet":"jin.webp","sheet1x":"jin@1x.webp",
   "anims":{"stand_se":{"row":0,"frames":1,"ms":0,"anchor":"feet"}, …}}]}
```

Frame `i` of an anim is at `(i·w, row·h)` (@1x halve). Rows only exist for anims the archetype has, so always read
`row` from the manifest. `ms` 0 = single frame. Anchors are @2x frame px, shared by all archetypes.

Flat set shipped (frames): `stand_se` 1, `stand_ne` 1, `walk_se` 8, `walk_ne` 8 (theo 4), `sit_type_ne` 1,
`sit_se` 1, `raise_hand_se` 2, `raise_hand_seated_se` 2 (kofi, mai 1), `sleep_se` 2, `talk_se` 3, `cheer_se` 2;
jin also `stand_coffee_se` 1, `drink_se` 2, `walk_coffee_se` 4. Total ≈ 3.0 MB (6 × webp @2x + @1x).

3D layout (`layouts.json` → `3d`, ships to `apps/web/public/assets/iso/chars3d/`): `stand_down/up/right`,
`walk_down` 4, `walk_up` 4, `walk_right` 8, `sit_type_up`, `sit_down`, `raise_hand_seated_down`,
`sleep_down` 2, `raise_hand_down` 2, `talk_down` 2, `cheer_down` 2; jin + `stand_coffee_down`, `drink_down` 2,
`walk_coffee_down` 4, `walk_coffee_right` 8 (sheet `walk8-coffee-right`, alt `walk-coffee-right`).

## Lessons (flat run)

- 4-frame walk sheets (contact / passing wording) keep identity and proportions; 8-frame sheets in one row drift
  (smaller heads, more realistic faces, darker trousers) unless the existing 4-frame walk is attached as second
  reference with "frames 1,3,5,7 = copies" and a "PROPORTIONS ARE CRITICAL" note; even then ~1 in 3 needs a retake
  (theo NE retake went too chibi → shipped the 4-frame NE).
- "Same scale" across sheets is only reliable with a standing reference column in the same sheet.
- Second-frame sheets (`actions2`) drift in colour / detail unless the first pose sheet is attached and the note
  asks to copy its rendering; seated poses inside a standing sheet come out at a different scale.
- Touching figures: `cut()` falls back to cutting at alpha valleys between expected column centres and drops
  stray edge fragments.

## 3D request plan

Per archetype: `turn` (3 cols: down, right, up; refs jin3d look + camera mock + flat design) · `walk-down` ·
`walk-up` · `walk-right` · `poses` (7 cols: stand ref, sit-type up, sit down, sleep, raise seated, raise, cheer) ·
`actions` (5 cols: stand ref, wave B, talk ×2, cheer B; attaches `poses`) = 6 → 36. Jin extra: `coffee`,
`walk-coffee-down`, `walk-coffee-right` = 3. Base 39. Optional `walk8-right` ×6. Retakes ~10–15 %.

## 3D run result

Shipped frames: `stand_down/up/right` 1, `walk_down` 4, `walk_up` 4, `walk_right` 8, `sit_type_up` 1,
`sit_down` 1, `raise_hand_seated_down` 1, `sleep_down` 2 (2nd synthesised), `raise_hand_down` 2, `talk_down` 2,
`cheer_down` 2; jin + `stand_coffee_down` 1, `drink_down` 2, `walk_coffee_down` 4, `walk_coffee_right` 8.
Retakes (see `sheets3d.json` takes): ava turn (realistic face), jin walk-up / poses / actions �2 / walk-coffee-down �2
(drifted to a realistic or over-chibi young man), mai walk-up (ponytail) and actions (face), kofi walk-down (slim).
8-frame side walks with the 4-frame walk attached as second reference were stable on the first take (4/4).

2026-10-22 walk pass (11 requests): rosa / ava `walk8-right` and jin `walk8-coffee-right` (refs turn + 4-frame walk).
First takes drifted (rosa bright orange + pencil skirt, ava made-up realistic face + touching feet, jin coffee neat
hair / small head); kept takes with a `--note` naming the drift (copy the 2nd image's face / head size / colours /
garment shape, feet of neighbours never touch): rosa 2, ava 3, jin 5. Attaching jin's 8-frame walk as an extra ref
gave over-tall or over-chibi results. Down / up walks stay 4 frames for all (no proven 8-frame front/back wording).
