# Office theme pack `japandi`

## Direction

- **Mood**: calm, minimal, quiet afternoon studio; few objects, lots of empty space.
- **Materials**: pale oak floor boards and desks, rice-paper window panels and off-white walls, linen sofa,
  matte charcoal metal (chairs, window frames, lamps), stoneware and clay terracotta pots, moss green plants.
- **Key colours**: pale oak `#c9a77c`, rice paper `#f3eee4`, linen `#dccdb4`, moss `#7c8b5a`,
  charcoal `#3a3a3a`, clay `#b8735a`, stone grey `#a9a49a`. Outline stays `#2b3245` like classic, so the
  procedural characters and furniture match.
- **Light**: top-left; warm late-afternoon feel only through colour (peach sky, warm floor).
- `pixel` style: only the colour / material sentence changed; every technical sentence is upstream's.
  Paintings add a short "muted calm colours, four or five big flat colour areas" tail, since the Codex image
  model draws too much detail.

## Assets and picks

Generator: Codex CLI `image_generation` via `../generate-codex.mjs`, 23 requests of 40, no failures.

| Asset | Subject | Pick | Notes |
|---|---|---|---|
| painting-misty-hills | landscape | take 1 | layered moss hills, clay sun |
| painting-tea-bowl | still life | take 1 | clay bowl on oak |
| painting-ink-circle | abstract | take 1 | charcoal ring + clay seal square, strongest at 1x |
| painting-heron | animal | take 1 | white heron on peach sky |
| painting-rooftops | town | take 2 | three big gable roofs |
| painting-stones | still life | take 1 | stacked stones on moss |
| painting-bamboo | plant / pattern | take 1 | a bit busy, still reads as bamboo |
| painting-persimmons | still life | take 1 | most saturated piece of the pack (warm accent) |
| painting-sleeping-cat | animal | take 1 | grey cat curl; the weakest painting at 1x |
| painting-wide-ridges | landscape | take 1 | layered ridges with mist |
| painting-wide-moon-reeds | night | take 1 | came out navy rather than charcoal; kept as the one dark piece |
| painting-wide-maple-branch | pattern | take 1 | clay and orange leaves on paper |
| poster-code / coffee / rocket / cat / bug / ship-it | fixed subjects | code take 3, ship-it take 2, rest take 1 | |
| empty-office | illustration | take 1 | oak floor, paper windows, peach sky over hills; matches the pack well |

## Rejected

- `painting-rooftops` take 1: houses too small, reduced to a row of tree-like blobs. Prompt changed to three big
  houses filling the canvas.
- `poster-code` take 1 (square raw, cropped) and take 2 (window filled the canvas, sage bars merged with the
  sage background): replaced by a clay background with margin around the window.
- `poster-ship-it` take 1: square raw, the 3:4 crop cut the boat; prompt changed to a short compact boat in a
  tall composition.

## Rooms (`theme.json`)

8 palettes built from the dominant art colours (cream, clay red, persimmon orange, moss, sage teal,
blue-grey, night navy, charcoal): oak, moss, clay, stone blue, charcoal, sage, persimmon, indigo. Families
alternate; wall bases L ≥ 0.90; accent contrast 4.4–10.8 : 1.

## QA

`docs/office-theme-packs.md` §7 automatable checks all pass; pack 130 KB.
