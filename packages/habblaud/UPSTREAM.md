# Upstream: Habblaud 1.0.3

Source: https://github.com/marmottajr/habblaud (MIT, see `LICENSE`), copied from `src/habblaud/` of the Orrery checkout.
Files are byte-for-byte upstream except the patches and the shim listed below. Do not edit them otherwise; to update, re-copy.

## Copied paths (same relative paths)

- `client/src/world/**` except `city/`, `visit/`, `visit-social.ts`, `visit-social.css`, `visit-social.test.ts`
- `client/src/art/**` except `preview.ts`
- `client/src/audio/**`
- `client/src/net/timeline.ts` (+ test), `client/src/net/store.ts` (`client/src/world/index.ts` imports it as a type: `import type`)
- `shared/**` (all, except the local `shared/locales/vi.ts` + `vi.test.ts` below)
- `server/history/timeline.ts`, `server/http/timeline.ts`, `server/model/rooms.ts`, `server/model/names.ts`, `server/log.ts` (+ their tests)
- Test support pulled in by those tests: `server/test/fixtures.ts`, `scripts/statusline-tap.mjs` (fixtures.ts imports it)
- `LICENSE`
- Outside this package: `client/public/assets/**` -> `apps/web/public/assets/**`

Nothing under `server/world`, `client/src/ui`, `client/src/net/world*` or `client/src/world/city|visit*` is copied.

## Dropped upstream tests

- `client/src/world/seasonal-world.test.ts`: imports `server/world/theme` (Habblaud World).
- `client/src/world/visit-social.test.ts`: tests the excluded `visit-social.ts`.
- `server/http/timeline.test.ts`: boots the whole Habblaud API (`createApiHandler`, `AccountsService`, `Office`, `Hub`, ...), which are not copied.

## Local patches

- A. `shared/i18n.ts`: `Locale` gains `'vi'`; `normalizeLocale('vi' | 'vi-*')` returns `'vi'`; `intlLocale()` returns `vi-VN` for it. Reason: Orrery ships `en` + `vi`. (`setLocale(l)` already exists upstream, so it is unchanged.) Test: `shared/i18n.local.test.ts`.
- B. `client/src/world/input.ts`: no change needed. Upstream 1.0.3 `onKey` already returns early for `input`, `textarea`, `select`, contenteditable targets and for ctrl/meta/alt. Pinned by `client/src/world/input.local.test.ts` so a re-copy cannot lose it.

## Local shim (not upstream)

- `server/http/app.ts`: only `sendJson`, copied unchanged from upstream. Upstream's file is the whole Habblaud API router and pulls in sessions, pty, permissions, spawn and dictation servers; `server/http/timeline.ts` needs only `sendJson`.

## Local files (not upstream)

`package.json`, `tsconfig.json`, `tsconfig.types.json`, `vitest.config.ts`, `.gitignore`, `UPSTREAM.md`, `*.local.test.ts`, `shared/locales/vi.ts` (Vietnamese dictionary) and `shared/locales/vi.test.ts`.

## Typing

Consumers resolve `types/**/*.d.ts` (emitted by `tsc -p tsconfig.types.json`, run by `prepare` and `typecheck`; gitignored), so the upstream sources are never type-checked under Orrery's stricter `noUncheckedIndexedAccess` / `verbatimModuleSyntax`. Runtime resolves the `.ts` sources (Vite, Vitest, tsx, esbuild).

## `client/src/net/store.ts`: typing only

Vendored byte-for-byte only because `client/src/world/index.ts` imports its `OfficeStore` type (`import type`) and `client/src/world/playback.test.ts` uses it. The file contains live network code (`fetch`/`EventSource` against `/api/permissions`, `/api/messages`, `/api/demo`, ...). Orrery code must never instantiate `OfficeStore` or import `client/src/net/store` as a value; the office is fed by Orrery's own `{snapshot, on}` shim.
