## WP-C: câu hỏi của Claude thành nút Telegram
Khảo sát (haiku, 2026-11-05): app chưa có options. Hook bridge bỏ tool_input (`scripts/hook-bridge.mjs:87-99`); transcript chỉ giữ name/id (`apps/collector/src/transcript.ts:170-176`); episode `question` không có nút (`apps/desktop/src/telegram/notifier.ts` `handle`); phím: `apps/web/src/composables/useTelegramInbound.ts:14` `KEYS = { approve: '1', deny: '\x1b', stop: '\x1b' }`, `keysReady` chỉ cho permission; docs §9 cấm đưa tool input ra frontend (`docs/claude-code-integration.md:221-225`).

- Mục tiêu:
  1. Collector: khi transcript có `tool_use` `AskUserQuestion` chưa có `tool_result`, giữ **chỉ** câu hỏi đầu tiên: `question` (≤ 200 ký tự) + `options[].label` (≤ 6 nhãn, mỗi nhãn ≤ 60 ký tự) + `multiSelect`. Không giữ description/preview/các field khác. Không đưa vào snapshot WebSocket cho frontend (giữ đúng §9) — chỉ đi theo episode Telegram (`toast.ts` `telegram()` → `TelegramEpisodeMessage` thêm field tuỳ chọn `ask?: { question: string; options: string[]; multi: boolean }`, có parse/validate trong `packages/shared/src/telegram.ts`).
  2. Notifier: episode `question` có `ask` (single-select, ≤ 6 options) và đang nhận lệnh → tin có câu hỏi (escape + masker) + mỗi option 1 nút (kind mới `qa`, `extra` = số thứ tự 1-based) + nút `✍️ Trả lời khác` thì không cần (chủ nhân reply bằng chữ như thường). multiSelect hoặc > 6 options → chỉ hiện câu hỏi + danh sách, không nút.
     Episode `permission` của `ExitPlanMode` (tool === 'ExitPlanMode') → nút riêng: `✅ Duyệt plan` (phím '1') / `✏️ Giữ plan, góp ý` (phím '3'? — CHƯA XÁC MINH; chỉ làm nút Duyệt + Từ chối Esc như ap/dn hiện có, ghi rõ trong báo cáo).
  3. Bấm nút `qa` n → `askPage` action `keys` mới `key: 'option'` + `option: n` → trang gõ chữ số `String(n)` vào pane (thêm vào contract `TelegramKey` / parse; `keysReady` cho phép khi status waiting và waitReason là câu hỏi (xem `wait.ts` / `waitingFor` 'input needed'), kiểm `since` như approve). Sau khi gõ: xoá nút, post "Đã chọn: <nhãn>".
- Phạm vi file: `apps/collector/src/{transcript,tracker,toast}.ts` (+ file collector khác nếu cần, ghi rõ), `packages/shared/src/telegram.ts`, `apps/desktop/src/telegram/{notifier,actions,api}.ts`, `apps/web/src/composables/useTelegramInbound.ts`, tests collector/desktop/web liên quan, `docs/claude-code-integration.md` (thêm 1 đoạn §11an-f: ngoại lệ §9 — nhãn câu hỏi chỉ đi Telegram của chủ nhân, đã che bí mật, phím số chưa xác minh trên TUI thật).
- Không sửa: `scripts/hook-bridge.mjs` (không thêm hook mới).
- Tiêu chí nghiệm thu:
  - [ ] Test collector: transcript có AskUserQuestion chờ → episode `question` có `ask` đúng question/options; có tool_result → hết `ask`; description/preview KHÔNG có trong dữ liệu giữ lại.
  - [ ] Test shared: parse `ask` cắt độ dài, bỏ field lạ, sai kiểu → bỏ `ask`.
  - [ ] Test notifier: episode question + ask → tin có câu hỏi + N nút `qa`; bấm nút 2 → askPage `keys` `option: 2`; multiSelect → không nút; secret trong câu hỏi bị che.
  - [ ] Test web: `keys` option 2 khi pane đang chờ câu hỏi → gõ '2'; pane không chờ → lỗi `state`.
  - [ ] Snapshot WebSocket / store frontend không có `ask` (grep + test nếu có chỗ test snapshot).
  - [ ] `npm run typecheck` sạch; `npm test -w @ccm/collector`, desktop telegram, web pass.
- Nhìn thấy được: không (Telegram) — main QA tay trên bản dev với pane Claude thật (gõ phím số có đúng chọn option không).
- Báo cáo: `.planning/wp/tg2/WP-C-report.md`

## Nhật ký
- 2026-11-05 WP-C: shared ask/option, collector askOf, notifier qa, web keyOf, docs 11an-f, tests; typecheck + 3 bộ test pass.
