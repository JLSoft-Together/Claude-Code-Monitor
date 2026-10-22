# PLAN v62 — Office theme packs + Office full screen

Date: 2026-10-22. Owner request: "Đọc docs/office-theme-packs.md để làm thêm các theme khác + src/habblaud để làm
fullscreen, cho phép tách nhiều agent để làm, art gọi codex image gen".

## Scope

1. **Packs** (authoring, `docs/office-theme-packs.md` §3–§7): 4 new office theme packs, art by Codex CLI image
   generation (`codex exec`, built-in `image_generation` tool) instead of OpenRouter:
   `japandi`, `night-shift`, `forest-cabin`, `retro-80s`.
2. **Integration** (§8 contract): pack discovery (`assets/themes/index.json`), Office option "Theme pack"
   (`ccm.office.pack`, default `classic`), loader reads the chosen pack manifest (brand stays classic), rooms from
   the pack `theme.json`, switching rebuilds the world.
3. **Full screen**: the Office view can go full screen (canvas + floating Office controls), Escape / button exits.

## Generation tool

`assets-src/office-themes/generate-codex.mjs <pack> list|gen [ids] [--force] [--concurrency N] [--budget 40]`:
one `codex exec --json --ephemeral -s read-only` per asset, image read from
`~/.codex/generated_images/<thread_id>/`, copied to `.cache/takes/<id>.<n>.png` + `.cache/raw/<id>.png`, request
appended to `generation-log.json` (`chosen` map = picked take). ~35 s and ~42 k Codex input tokens per image.
Codex image model is detailed (like upstream's gpt test): prompts keep the `wallart` / `poster` "TINY, big flat
shapes" blocks; judge after reduction.

## Agent split (parallel)

| Agent | Work | Files |
|---|---|---|
| code | §8 integration + full screen + tests + index/docs | `apps/web/**`, `packages/habblaud/client/src/{world/assets.ts,art/theme.ts,world/index.ts}` (patches D/E in `UPSTREAM.md`), `apps/web/public/assets/themes/index.json` |
| pack ×4 | specs → generate → postprocess → theme.json → preview → QA → NOTES | `assets-src/office-themes/<id>/`, `apps/web/public/assets/themes/<id>/` only |

Pack agents never touch `index.json` or app code; the code agent writes `index.json` with all 4 ids (previews may
land later).

## Decisions

- Classic pack stays at `/assets/manifest.json`, implicit, first.
- Brand (reception sign, mark) always from the classic manifest.
- Full screen uses the DOM Fullscreen API on the Office host element (works in Electron without main-process
  changes unless the window is not `fullscreenable`).

## Done when

- 4 packs pass the §7 automatable QA; previews reviewed by eye.
- Office options pick a pack, world rebuilds with pack art + room colours; classic unchanged.
- Full screen toggle works, Escape exits, tests green (`npm test`, `npm run typecheck`). Owner builds.
