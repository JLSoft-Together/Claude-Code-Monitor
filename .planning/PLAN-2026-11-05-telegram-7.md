# PLAN — Telegram đợt 7 gợi ý (2026-11-05)

Chủ nhân: "ok làm cả 7 cái đi em" (gợi ý sau commit `597a890`). Commit: **từng gói, không push** (chủ nhân đã nói "commit dần", hiệu lực cả phiên).
Build: được build để QA trên bản dev cổng 4319 (DECISIONS 2026-11-04); subagent không build, chỉ test + typecheck.
Brief: `.planning/wp/tg2/WP-<x>.md`. Nhật ký: `.planning/PROGRESS-2026-11-05-telegram-7.md`.

## Gói
| WP | Gợi ý | Model | Ghi chú |
|---|---|---|---|
| A | #1 lệnh gửi lúc app tắt (hỏi trước khi chạy) + #2 cảnh báo / tự dừng khi 2 bản dùng chung bot (409) | sonnet | vòng poll |
| B | #4 menu lệnh "/" (`setMyCommands`) + #5 lệnh `tail` (dòng cuối terminal, che bí mật) | sonnet | cần trang trả buffer terminal |
| C | #3 câu hỏi của Claude (AskUserQuestion / duyệt plan) thành nút | sonnet | khảo sát nguồn dữ liệu trước (haiku) |
| D | #6 thành viên team được ra lệnh (quyền đọc / đầy đủ) | opus | quyền truy cập = auth |
| E | #7 gom báo "xong" thành 1 tin sửa dần mỗi session/ngày (tuỳ chọn) | sonnet | |

Thứ tự: A → B → C → D → E (tuần tự: mọi gói chạm `apps/desktop/src/telegram/notifier.ts`; worktree không dùng được vì `node_modules/@ccm/*` trỏ về cây chính).

## Hot file
`apps/desktop/src/telegram/notifier.ts`, `packages/shared/src/telegram.ts`, `apps/web/src/i18n/telegram-v82.ts`, `apps/web/src/components/TelegramSettings.vue`,
`apps/desktop/src/telegram/{inbound,actions,api}.ts` — mỗi lúc chỉ 1 WP chạy nên WP đang chạy được sửa; main kiểm diff sau mỗi gói.

## Ràng buộc chung
- Zero token: bot không gọi LLM; chỉ gõ phím/prompt vào pane khi chủ nhân (hoặc thành viên được phép) yêu cầu.
- Không lộ secret: mọi text từ session qua `maskSecrets` / masker.
- i18n en + vi; màu theo token; status = icon + chữ.
- Docs §11an-f + `.code_index/_meta.md` do main viết cuối đợt.
