# Office 3D seasonal decor (v63, front 3/4 camera)

Ships to `apps/web/public/assets/iso3d/seasonal/` (`manifest.json`, schema in the task / CONTRACT-v63: `file`, `anchor`,
`footprint`, `wall`). Same look and pipeline as `../office-3d-furniture/` (style3d / cam / wallcam / chroma blocks,
`chroma.key`, `despill`, `place_floor`, `place_wall`).

## Ids (exact, from habblaud `client/src/art/seasonal.ts` `SeasonalProp`)

| id | season | mount | footprint | pixel use (`world/render/seasonal.ts`) |
|---|---|---|---|---|
| `tree` | christmas | floor | 1×1 | replaces the room's first `plant_tall` |
| `gift` | christmas | floor | 1×1 | replaces every `plant_small` |
| `pumpkin` | halloween | floor | 1×1 | replaces every `plant_small`, and the first `plant_tall` when `seed % 3 !== 0` |
| `ghost` | halloween | floor | 1×1 | replaces the first `plant_tall` when `seed % 3 === 0` |
| `wreath` | christmas | wall | `[1, 0]` | on elevator frames |
| `bat` | halloween | wall | `[1, 0]` | on elevator frames, centre of face walls wider than 90 px |

Season pick: `world/api.ts` `seasonalThemeFor` (auto: Oct = halloween, Nov 1 – Dec 26 = christmas). Not props, so no
art here: costumes (santa / witch / pumpkin / vampire), rug recolour + motifs, wall tint, garland, lights, window snow,
cobweb strokes.

## Units

@2x, 1 tile = 64 px wide, 44.8 px deep, wall 96 px. Floor anchor = front-left floor corner of the footprint; wall
anchor = bottom-centre on the wall base line (image includes the empty wall below the item: wreath hangs 40 px,
bat 50 px above the base line, like `wall:clock`). Sizes in `layout.json` (`fill` = width share of the tile,
`sy` = how far the object stands back from the front edge, `box` + `elev` for wall items).

## Run

```
node gen.mjs s-floor s-wall        # GEN_BUDGET env caps requests (log: generation-log.json)
python process.py                  # cut, place, ship, .cache/contact-sheet.png
```

Refs (local, `.cache/refs/`): furniture raws `m-plant`, `b-plants-t`, `b-plants-s`, `w-1`, `ref-room.png`.
Requests used: 2 (both kept, no retakes).
