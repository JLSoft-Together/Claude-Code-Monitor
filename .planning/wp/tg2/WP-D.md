## WP-D: thành viên team được ra lệnh
- Mục tiêu: ngoài chủ nhân (owner đã ghép), cho phép thêm **thành viên** theo Telegram user id với 2 mức:
  - `read`: chỉ `status`, `last`, `tail`, `help` (và nút `💬` last). Mọi lệnh khác → trả "Bạn chỉ có quyền xem." (rate limit như người lạ).
  - `full`: như chủ nhân, trừ: ghép/huỷ ghép, nút Cho phép/Từ chối quyền (`ap`/`dn`) — vẫn chỉ chủ nhân (quyết định an toàn, ghi DECISIONS đề xuất).
  - Cách thêm: notifier nhớ tối đa 20 người lạ gần nhất đã tag bot (id, tên, thời điểm, chat) trong bộ nhớ + state `recentStrangers`; Settings › Telegram tab Nhận lệnh có mục "Thành viên": danh sách thành viên (tên, mức, xoá) + danh sách "Người vừa tag bot" với nút "Thêm (xem)" / "Thêm (đầy đủ)". Lưu `members: {id, name, level}[]` (≤ 20) trong `telegram.json`, patch qua `TelegramPatch` có sanitizer.
  - Prompt gửi vào session từ thành viên ghi tên người gửi (đã có `from`) — kiểm `viaTelegram`/`inboundPrompt` vẫn đúng.
  - Callback (nút) cũng kiểm quyền theo người bấm, không chỉ người gửi lệnh gốc.
  - Câu người lạ vẫn giữ cho người không phải thành viên.
- Phạm vi file: `apps/desktop/src/telegram/{notifier,inbound,actions}.ts`, `packages/shared/src/telegram.ts`, `apps/web/src/components/TelegramSettings.vue`, `apps/web/src/stores/telegram.ts`, `apps/web/src/i18n/telegram-v82.ts`, tests desktop telegram + web liên quan.
- Skill: `.code_index/_meta.md`, docs §11an-d/e (quyền, người lạ), CLAUDE.md "Hard rules" (không lộ dữ liệu). UI: theo `.planning/COLOR-SYSTEM.md`, đọc skill `frontend-design:frontend-design` trước khi sửa Vue.
- Tiêu chí nghiệm thu:
  - [ ] Test: thành viên `read` gửi `status` → trả lời; gửi prompt / `stop` / `new` → bị từ chối, không gọi `askPage`.
  - [ ] Test: thành viên `full` gửi prompt → vào session với `from` = tên thành viên; bấm `ap` → bị từ chối; bấm `st` → được.
  - [ ] Test: người lạ tag bot → có trong `state().recentStrangers`; patch thêm thành viên → hết là người lạ; sanitizer chặn id sai / level sai / > 20.
  - [ ] Test: không phải owner/member bấm nút → `notOwner` như cũ.
  - [ ] typecheck sạch; test desktop telegram + web pass.
- Nhìn thấy được: có (mục Thành viên) → CHƯA NHÌN nếu không chạy app; main kiểm trên bản dev.
- Báo cáo: `.planning/wp/tg2/WP-D-report.md`

## Nhật ký
- 2026-11-05 · audit đường vào (tin, callback, album, backlog, file) → roleOf/mayPress trong notifier.ts
- 2026-11-05 · shared members + sanitizer, notifier roles, chữ readOnly/notAllowed, UI Thành viên, test telegram-members (9) · typecheck + test pass
