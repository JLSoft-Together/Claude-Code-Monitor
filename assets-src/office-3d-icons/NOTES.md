# Office 3D head icons (v63)

Ships to `apps/web/public/assets/iso3d/icons/` (`manifest.json`: `file`, `size`, `anchor` = bottom-centre).
Soft glossy 3D icons with a thin navy outline, one shared palette (yellow #FFCF3F, coral #E85A5A, green #45B866,
sky blue #4F8FE6, cream #F6F2EA, oak #C48A52, slate #8D97AB). Front view (billboard, no camera tilt).

## Ids (exact, habblaud `client/src/art/api.ts` `IconName`)

| id | meaning in the pixel sim |
|---|---|
| `alert` | agent waits for the user |
| `question` | defined, never set |
| `zzz` | sleeping / nap |
| `check` | task done, delivery |
| `heart` | social |
| `coffee` | coffee machine (iso also draws it as the held cup) |
| `music` | lounging |
| `idea` | whiteboard / shelf |
| `sweat` | tool error |
| `star` | success, arcade, github party |
| `lightning` | defined, never set |
| `chat` | talking |
| `box` | carrying a delivery |
| `wave` | defined, never set |
| `hourglass` / `hourglass_flip` | waiting on a shell command (alternated) |
| `cobweb` | long shell wait (pixel draws it at the chair corner; iso draws a vector web) |
| `storm` | failure / dead process |
| `coin` | earned money |
| `sparkle` | groomed at the mirror |
| `trophy` | won a game / bet |
| `hand_rock` / `hand_paper` / `hand_scissors` | rock-paper-scissors reveal |

## Sizes

Shipped @2x, longest side 36 px (view ≈ 18 px); `chat`, `hourglass_flip`, `cobweb`, `storm` 40, `coffee`, `box`,
`zzz` 38, `sparkle` 34, `coin` 32 (`layout.json`). 2× bigger sources (72–80 px) in `hi/` (not shipped).

## Run

```
node gen.mjs i-1                  # first sheet, no refs
node gen.mjs i-2 i-3 i-4          # use .cache/raw/i-1.1.png as style ref
python process.py                 # key, split, ship, hi/, .cache/contact-sheet.png (light / beige / dark bg, @2x and view size)
```

Requests used: 4 (all kept, no retakes).
