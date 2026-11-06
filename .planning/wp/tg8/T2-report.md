## T2 — DONE
**Đã đổi**: shared/telegram.ts (key `esc`, inbound compact/close/focus), shared/orreryApi.ts (session.compact, session.closeOwner, session.focus; chỉ nguồn telegram); desktop actions.ts (kind es/cp/cl/fc/pj + chữ vi/en), inbound.ts (lệnh compact/close/focus, COMMAND_MENU, help, ghi rõ `/compact ghi chú` và `/clear` vẫn gõ nguyên), notifier.ts (hàng nút Esc + "20 dòng cuối" dưới tin waiting/question/permission, confirm compact/close, focus, picker /new, `deps.focusApp`), main.ts (`focusApp: showMain`); web useTelegramInbound.ts (handler compact/close/focus), useSessionActions.ts (phím `esc`). Test: telegram-t2.test.ts mới; sửa 5 test desktop cũ + useSessionActions.test.ts.
**Tiêu chí 5/5**: (1) nút đúng tin/quyền/hết hạn `since`; (2) 3 lệnh vi/en có trong menu + help + hash menu tự đổi, close/compact có nút xác nhận; (3) /new picker ở General và topic ≥2 project; (4) role/rate limit giữ; (5) test từng điểm.
**Audit**: Esc = phím riêng `esc` (ready khi status waiting + khớp `since`; ap/dn/stop không đổi). Permission/question/waiting đều có tail; Esc chỉ khi có `since`. Compact dùng useCompact().start (chỉ pane idle claude/codex, prompt handoff cố định, đã là ngoại lệ §11x). Close = workspace.requestClose không busy-sheet (đã xác nhận ở Telegram), có undo. Focus = setView('workspace') + activate + showMain.
**Review**: nhiều pane -> nút chọn theo tên (bấm = thực hiện; close/compact mỗi nút nêu rõ pane); pane gone/đổi trạng thái -> answerCallback lỗi, nút giữ; nút cũ sau restart -> "không còn hiệu lực" (map RAM); read bấm es/cl/cp/fc/pj bị chặn (chỉ tl/lt/df); `cl` và lệnh `close` chỉ owner (full bị từ chối); nested routes đi qua `asker()` + targetOf như stop; General không route -> picker (owner/full), read không thấy picker; nút mở lại không đưa prompt/nội dung vào callback_data (prompt nằm trong action map). Rate limit inbound tách thành takeInbound, dùng cho picker.
**Test**: typecheck sạch; desktop 1329/1329 (baseline 1312, +17); web 1754/1754 (baseline 1744 + việc của T1 + 3 của T2).
**Nhìn**: CHƯA KIỂM (bot thật: tin Telegram, nút bấm, focus cửa sổ, compact/close trên app thật).
**Hot file cần thêm**: không có chữ UI web mới (toast compact dùng `workspace.compact.said.*` sẵn có).
**Ngoài phạm vi / lưu ý**: không đụng file của T1. Docs §11an/.code_index chưa cập nhật (T5): thêm lệnh compact/close/focus, key `esc`, nút Esc/20 dòng cuối, picker /new, `focusApp`. Hành vi đổi: `/compact` trần giờ là Compact flow của Orrery (cần xác nhận), `/compact <ghi chú>` vẫn gõ nguyên.
**Commit message đề xuất**: Telegram: Esc / tail buttons under waiting messages, /compact /close /focus commands, project picker for /new

## Vòng 2 — DONE (6/6 điểm review)
1 HIGH: entry cp/cl lưu `since` (status của pane lúc hỏi) + `at`; TTL 5 phút (`CONFIRM_TTL_MS`, quá hạn -> "không còn hiệu lực"); `since` đi theo inbound compact/close (shared parse) và page từ chối `state` nếu statusSince đổi / session mới (`sinceOk`). Close pane đang working từ đầu vẫn được (chủ nhân chọn rõ); đổi trạng thái sau đó thì bị từ chối.
2 MED: target không resolve ra terminal (vd `pane`) -> `gone`, không rơi về pane duy nhất (chỉ sửa compact/close/focus; `stop` cũ giữ nguyên).
3 MED: entry có `by` (id người hỏi) + `group`; nút pj/nw/np/cp/cl/fc chỉ tác giả hoặc owner bấm (người khác -> notAllowed); retire theo `group` (1 tin), không theo text prompt.
4 LOW: picker chỉ ở General (threadId null) hoặc topic có >=2 route; topic chưa nối giữ link flow.
5 LOW: `retire()` chỉ gỡ nút cùng tin, không giết confirm của tin/pane khác.
6 LOW: `since` của pickMarkup giờ được forward lên page.
Test: typecheck sạch; desktop 1353/1353, web 1757/1757 (+7 test round 2 ở telegram-t2.test.ts, +1 web). Không revert phần T3. CHƯA KIỂM bot thật.
