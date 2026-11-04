## WP-3a — DONE

### Đã đổi
- `packages/shared/src/telegram.ts` — `TelegramInbound` thêm `nested?: string[]` (mọi action) và `keys` thêm `since?` (epoch ms) + `tool?`; `parseInbound` kiểm đủ (since số dương < SINCE_MAX, tool theo regex tool, nested ≤ 20 đường dẫn hợp lệ). Thêm `TELEGRAM_NESTED_MAX`.
- `apps/desktop/src/telegram/actions.ts` — `ActionEntry` thêm `since`, `tool`; `runFailed(config, code)` bỏ tham số detail (notifier tự ghép quote).
- `apps/desktop/src/telegram/api.ts` — export `quote()` để dùng lại cho caption.
- `apps/desktop/src/telegram/notifier.ts` —
  - #1: entry ap/dn mang `since`/`tool` của episode, nút ap/dn chỉ gắn khi episode có `since`; stop mang `since` của pane; callback gửi `since` (+ `tool` trừ stop) trong `keys`.
  - nested (WP-2): `asker()` gắn `nested` = route con nằm trong project vào mọi request gửi trang (kể cả pinTick, stop dùng `panesOf`).
  - #3: caption / text build lỗi = head + `quote(detail ≤1500, room)` → cắt trước khi bọc tag, không vỡ entity, ≤1024 / ≤4096.
  - #6: `summaryDay` lưu trong `telegram.json`; mở app sau giờ tổng kết mà chưa có số đếm của ngày → bỏ qua.
  - #7: đổi token → `pollRun = 0` rồi `syncPoll()` mở vòng mới với `offset: -1`; vòng cũ dừng cả giữa batch update.
  - #8: replace bằng hàm. #13: `answer()` bỏ tag rồi unescape `&lt; &gt; &amp;`.
  - #9: `pins` lưu `{chatId, messageId}` (đọc được dạng số cũ theo chat của route); `setRoute` đổi chat/topic và `removeRoute` bỏ pin (+ `unpinChatMessage` ở chat cũ, xoá `pinText`).
  - #10: sai mã ghép 5 lần → huỷ mã. #11: broadcast `ignored` ≤ 1/s; trả lời "không có quyền" ≤ 5/phút (tổng).
  - `all` trang trả `busy` → câu "không session nào nhận được".
- `apps/desktop/src/telegram/inbound.ts` — #14: thêm câu `open`; `busy` không có pane → "Session đó đang mở rồi".
- `apps/desktop/src/telegram/host.ts` — #4: ghi `.orrery/` không neo; #5: `git diff` cả repo với pathspec loại trừ `:(exclude,glob,icase)**/<SECRET_FILE_GLOBS>`, đếm file từ `--name-only` cùng pathspec.
- `apps/desktop/src/mcpDesk.ts` + `main.ts` (dep `confirm` cho desk) + `strings.ts` (`tgReceiveAsk*` en/vi) — `telegram_receive on` (khi đang tắt) hiện hộp xác nhận native; huỷ / lỗi → `cancelled`; đang có hộp khác → `confirm-open`; `off`/`status` và `telegram_notify` không hỏi.
- `apps/desktop/src/pty/mcpTools/telegramReceive.ts` — mô tả tool nói có xác nhận; thêm câu lỗi `cancelled`, `confirm-open`.
- `apps/collector/src/transcript.ts` — #2: signal `prompt` (bản ghi user không phải tool_result, không `isMeta`) xoá `replyId/replyText/lastReply`; `assistant_end` mang `messageId`, `lastReply` chỉ lấy text của đúng message kết thúc lượt.
- `apps/web/src/stores/workspace.ts` — `telegramPanes/telegramInbound/telegramKeys` nhận `nested` (loại pane thuộc route con); `telegramKeys` trả `busy` khi pane còn phím chờ; thêm `telegramTyped(paneKey, ms)` chờ TermPane ghi xong phím, quá hạn thì xoá `typeKeys` và trả false.
- `apps/web/src/components/workspace/TermPane.vue` (chỉ watch typeKeys) — chỉ xoá `typeKeys` sau khi `conn.write` thật; PTY chưa mở thì để nguyên.
- `apps/web/src/composables/useTelegramInbound.ts` — `keysReady()` (so `statusSince` với `since`, tool đang chờ với `tool`, lệch → `state`); `keys()` async, chờ `telegramTyped` 1,5 s, không ghi được → `unavailable` (không báo ok); `all()` không ai nhận → `none`/`busy`; `resumeItems()` khử trùng id + bỏ route con; `resume()` kiểm session đang chạy ngoài Workspace → `busy`, bỏ nhánh chết; mọi action truyền `nested`.
- Test: `apps/desktop/test/telegram-review.test.ts` (mới, 21 test), `telegram-actions.test.ts` (episode có `since`, kỳ vọng keys mang since/tool), `telegram-host.test.ts` (pattern `.orrery/`), `apps/collector/test/telegram.test.ts` (+3), `apps/web/src/stores/telegramInbound.test.ts` (+4).

### Mục đã sửa
- WP-1: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14.
- WP-2: project con lồng nhau, typeKeys mất im lặng, race trạng thái phím (qua mục 1 + tool), resumeList trùng id + resume kiểm session đang chạy, all() names rỗng → none/busy.
- Chưa sửa: WP-2 "create/resume cướp focus" — store không có tuỳ chọn mở pane mà không activate (`open` → `joinProject` luôn `activate`; `openFromAgent` chỉ không activate khi có pane gọi). Theo brief để nguyên; chỉ bỏ nhánh chết `pane ? … : unavailable` trong `resume()`.

### typeKeys — cách chọn
Trang chỉ trả `ok` sau khi TermPane thật sự `conn.write` (TermPane xoá `typeKeys` sau khi ghi); không ghi được trong 1,5 s → trang tự xoá `typeKeys` và trả `unavailable`. Không giữ phím chờ PTY mở lại: gõ `1` trễ sau khi kết nối lại có thể duyệt một lần xin quyền khác. Bấm lần hai khi phím trước còn chờ → `busy`.

### Tiêu chí: 6/6 đạt
- Test tái hiện cho từng mục logic: có. Đã kiểm "fail trước, pass sau" bằng mutation (tạm gỡ từng fix rồi khôi phục): #7, #8, #9, #10, #11, #3, #4, #5 đều fail khi gỡ fix. #2: test mới fail với code cũ (lastReply cũ giữ "Answer A" / "Let me check"). Mục 1 web (`keysReady`) và desktop (keys mang since/tool) có test. #13, #14, confirm, nested, all-busy, typeKeys có test.
- Bấm "Cho phép" tin cũ sau lần xin quyền mới → `state`: `keysReady` với `since` lệch → false → `state` (test web) + notifier gửi `since` (test desktop).
- Lượt bị ngắt không end_turn → episode done không mang reply lượt trước (test collector qua Toaster + TranscriptState).
- Caption build lỗi HTML hợp lệ ≤ 1024 với detail 5000 ký tự có `&<>` (test).
- `telegram_receive on` qua MCP hiện confirm, huỷ → không bật (test confirm giả, cả confirm ném lỗi).
- `npm run typecheck` sạch; test pass (dưới).

### Audit / Review
- Không comment mới trong code; không đụng file của WP-3b; không đổi giá trị trong DECISIONS.
- Contract: `nested`/`since`/`tool` đều tuỳ chọn → request cũ vẫn parse được. `ActionEntry.since` chỉ trong bộ nhớ.
- Edge case: episode quyền không có `since` → không gắn nút Cho phép / Từ chối (an toàn hơn); session thiếu `statusSince` khi có `since` → `state`; tool chỉ so khi cả hai bên biết; `ignored` bị throttle nên số đếm trên UI có thể trễ tới lần broadcast sau; pin bản cũ (số) được gắn chat của route khi đọc.
- Phím Stop: so `since` của lần working (đổi khi agent sang chờ rồi làm tiếp → `state`), không so tool vì tool đổi liên tục.

### Test (kết quả thật)
- `npm test -w @ccm/desktop -- test/telegram` → 6 files, 56 passed.
- `npm test -w @ccm/collector -- test/telegram.test.ts` → 6 passed.
- `npm test -w @ccm/web -- src/stores/telegramInbound.test.ts` → 8 passed.
- `npm test -w @ccm/desktop -w @ccm/collector` → 106 files / 1206 passed; 29 files / 393 passed, 1 skipped. `@ccm/shared` không có script test.
- `npm test -w @ccm/web` (toàn bộ) → 196 files / 1692 passed.
- `npm run typecheck` → không lỗi.

### Ngoài phạm vi cần main xử lý
- `apps/desktop/src/pty/host.ts:492` `deskReplyMs`: `telegram_receive` đang 40 s; giờ chờ hộp xác nhận native nên cần như `free_port` (600 s), nếu không chủ nhân bấm "Bật" sau 40 s thì agent nhận timeout mà nhận lệnh vẫn bật.
- Docs §11an/§11an-b/§11an-c + `.code_index/` (desktop/web/collector/protocol): ghi confirm `telegram_receive on`, `nested`/`since`/`tool` trong `TelegramInbound`, pin `{chatId,messageId}`, `summaryDay`, signal `prompt` của transcript.
- WP-2 "create/resume cướp focus": cần thêm tuỳ chọn mở pane không activate trong `workspace.open` (ngoài hàm telegram*).

### Commit message đề xuất
fix(telegram): bind remote approve to its permission prompt, confirm telegram_receive on, fix stale replies, captions, nested topics, pins, polling and git diff

### Vòng 1 (theo WP-1-verify.md)
- #10 (regression): đếm sai mã theo `fromId` (`pairTries: Map`). Một người sai 5 lần → các lần sau của người đó bị bỏ qua, kể cả mã đúng; mã của chủ nhân vẫn còn. Tổng sai của mọi người ≥ 50 → huỷ mã, chặn đoán bằng nhiều tài khoản (cần ≥ 10 tài khoản mới làm chủ nhân phải bấm Ghép lại). Lý do: chặn theo người không cho người lạ DoS lúc ghép; mức chặn tổng giữ được giới hạn brute force. `pair()` reset cả hai bộ đếm. Sửa ở `notifier.ts` (PAIR_TRIES_TOTAL, nhánh pair).
- #14 (regression): web `keys()` khi `telegramKeys` trả `busy` thì trả `{ error: 'busy', panes: [info(pane)] }`. Notifier ở callback map `busy` → câu riêng `ACT_TEXT.keysBusy` ("Nút bấm trước của session đó còn đang được gõ…"). Sửa ở `useTelegramInbound.ts`, `actions.ts`, `notifier.ts`.
- Test mới trong `apps/desktop/test/telegram-review.test.ts`: người lạ sai 8 lần, mã vẫn còn, mã đúng do người lạ gửi bị chặn, chủ nhân ghép được; 50 lần sai từ 10 tài khoản thì huỷ mã; popup keys busy hiện đúng câu. Gỡ thử fix thì test fail, khôi phục fix thì pass.
- CHƯA KIỂM: nhánh `busy` có `panes` trong `keys()` của web không có unit test riêng (closure trong `installTelegramInbound`). Phần `telegramKeys` trả `busy` đã có test store.
- Kết quả: `npm test -w @ccm/desktop -- test/telegram` → 58/58 · `npm test -w @ccm/web -- src/stores/telegramInbound.test.ts` → 8/8 · `npm run typecheck` sạch.
