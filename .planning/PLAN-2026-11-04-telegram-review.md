# PLAN 2026-11-04 — soát + chốt Telegram (v82–v84)

Nguồn: `.planning/PLAN-v82-telegram.md`, `PLAN-v83-telegram-actions.md`, `PLAN-v84-telegram-more.md`; code chưa commit
trên `master`. Commit: **từng phần, cả phiên** (chủ nhân 2026-11-04), branch `master`, không push.
Build: **không** build để verify (CLAUDE.md global). Được typecheck + Vitest. E2E cần build → viết script, không chạy.

## Hot file (chủ = main)

`packages/shared/src/telegram.ts`, `packages/shared/src/mcpDesk.ts`, `apps/desktop/src/main.ts`,
`apps/desktop/src/preload.ts`, `apps/web/src/i18n/telegram-v82.ts`, `apps/web/src/stores/workspace.ts`,
`docs/claude-code-integration.md`, `.code_index/*`.

## Gói (brief + báo cáo ở `.planning/wp/tg/`)

| WP | Việc | Model | Song song |
|----|------|-------|-----------|
| WP-1 | Review độc lập desktop + shared + collector Telegram (bảo mật: chỉ owner, gửi phím vào PTY, file tải về, path, secret, token; logic poll / rate / quiet / pin) — chỉ đọc, ra danh sách lỗi `file:line` | opus (nhận input từ xa, ghi vào PTY) | WP-2 |
| WP-2 | Review độc lập web: `TelegramSettings.vue`, `TelegramToggle.vue`, `stores/telegram.ts`, `lib/telegram.ts`, `useTelegramInbound.ts`, `TermPane.vue` typeKeys, `SettingsMenu.vue` resize + `lib/dialogSize.ts` (rule repo: i18n, theme token, motion, không comment, perf) — chỉ đọc | sonnet | WP-1 |
| WP-3 | Sửa lỗi WP-1 / WP-2 đã main lọc (chia theo vùng file nếu nhiều) + test tái hiện | sonnet (opus nếu lỗi bảo mật khó) | sau WP-1/2 |
| WP-4 | Viết E2E `apps/desktop/e2e/v82-telegram.cjs` với Bot API giả loopback (`CCM_TELEGRAM_URL_OVERRIDE`), không thêm vào `run.cjs` tới khi chủ nhân chạy được | sonnet | sau WP-3 |
| WP-5 | Commit từng phần theo vùng (shared+collector · desktop · web UI · Settings resize · docs/planning) | main | cuối |

Tiêu chí đợt: typecheck tổng + Vitest tổng pass; không còn lỗi review mức cao; commit không trailer.
