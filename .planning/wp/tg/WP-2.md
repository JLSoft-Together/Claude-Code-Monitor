## WP-2: Review web Telegram + Settings resize

- Mục tiêu: danh sách lỗi thật trong phần web chưa commit, mỗi lỗi `file:line`, kịch bản, mức, cách sửa gợi ý. KHÔNG sửa code.
- Phạm vi đọc: `apps/web/src/components/TelegramSettings.vue`, `TelegramToggle.vue`, `AppHeader.vue` (phần telegram), `stores/telegram.ts`, `lib/telegram.ts`, `composables/useTelegramInbound.ts`, `stores/workspace.ts` (`telegramPanes` / `telegramInbound` / `telegramKeys`, `typeKeys`), `components/workspace/TermPane.vue` (watch `typeKeys`), `components/SettingsMenu.vue` + `lib/dialogSize.ts` (resize), `composables/useAppToasts.ts` (telegram), `i18n/telegram-v82.ts`. Contract: `packages/shared/src/telegram.ts`. Diff: `git diff` + file mới.
- Cấm: sửa bất kỳ file nào trừ báo cáo.
- Model: sonnet.
- Soát theo rule repo (CLAUDE.md project + `.planning/COLOR-SYSTEM.md`): mọi chuỗi qua i18n en+vi (ký tự đặc biệt vue-i18n `@ | { }`), màu theme token, status = icon+text+màu, motion khi đổi trạng thái, không comment trong code, không cuộn ngang, perf (không timer/animation khi ẩn; memory rule IDE performance first), a11y (label, phím).
- Logic: `useTelegramInbound` chọn pane đúng (project con lồng nhau, path Windows/`/`), không ghi đè prefill/compact, `typeKeys` ghi khi pane chưa kết nối (mất phím? ghi muộn sai lúc?), `resume` mở trùng session, `new` khi tab project chưa có; Settings: token không bao giờ hiện lại, lỗi hiển thị đúng mã, đếm ngược pair, resize clamp khi cửa sổ nhỏ / màn hình đổi.
- Lệnh test: `npm test -w @ccm/web -- src/lib/telegram.test.ts src/stores/telegramInbound.test.ts src/lib/dialogSize.test.ts` · `npm run typecheck -w @ccm/web`.
- Nhìn thấy được: không (review)
- Báo cáo: `.planning/wp/tg/WP-2-report.md`

## Nhật ký
