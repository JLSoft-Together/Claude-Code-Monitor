# retro-80s — office theme pack notes

## Direction

- **Mood**: a playful, bright eighties-style office full of bold geometric shapes, squiggles and confetti dots.
- **Materials**: light speckled terrazzo floor, cream walls with big triangles / circles / zigzags, teal desks,
  pink chairs, curvy yellow sofa, glass block partitions, cacti and palms in pink and yellow pots.
- **Key colours**: cream `#f4ecd8`, teal `#2fb5a6`, bubblegum pink `#f07aa8`, sunny yellow `#f6c945`,
  squiggle black `#262626`, lavender `#a593e0`, coral `#ef8354`.
- **Light**: top-left, daytime; no cast shadows.
- Style words are generic only (shapes, squiggles, confetti); no design group, brand or artist is named.
- Poster outline and `theme.json` `outline`: `#262626`. Painting frames use the upstream frame colours.
- No transparent assets in this pack (paintings and posters are full-bleed), so the `#FF00FF` chroma key never
  meets the pink.

## Generation

Codex CLI `image_generation` via `generate-codex.mjs`, 23 requests of 40 (18 first takes + 5 retakes), no
failures. Every asset prompt ends with "very few elements, big flat shapes" to fight the model's detail.

## Picks

| Asset | Take | Note |
|---|---|---|
| empty-office | 1 | clean, matches the classic layout in pack colours |
| painting-memphis-shapes, palm-sunset, pastel-city, fruit-bowl, cactus, ice-cream | 1 | read well at 26×16 |
| painting-confetti | 2 | take 1 had too many small shapes (noise at 26×16); prompt cut to ~10 big shapes |
| painting-flamingo | 1, `colors` 10 → 7 | take 2 (chunky flamingo) melted into a pink blob when reduced; take 1 with 7 colours keeps a clear silhouette and beak. `specs.json` holds take 1's prompt |
| painting-wide-* (3) | 1 | strong at 58×24 |
| poster-coffee, rocket, code, bug | 1 | readable |
| poster-cat | 2 | take 1 head was cropped (ears cut by the 3:4 crop) |
| poster-ship-it | 3 | takes 1–2 drew the ship too small / too busy; take 3 is a simple toy ship |

## Rejects / weak spots

- `poster-ship-it` is the weakest asset: at 12×16 it reads as a pink boat on water, containers are a hint only.
- `painting-flamingo` reads as a pink bird on a yellow sun rather than a detailed flamingo.
- `painting-memphis-shapes` and `painting-confetti` are intentionally busy patterns.

## Rooms

8 palettes built from the art's dominant colours (teal, pink, yellow, lavender, coral, cream/black, sky, deep
teal), alternating families; wall bases L ≥ 85 %, accents darkened to reach ≥ 3:1 on the wall base.
