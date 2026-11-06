# QA 8 cải tiến Telegram — 2026-11-06 (WP T5)

Bản dev: Vite 5173 + Electron `apps/desktop/stage` (main dựng lại bằng `node build.mjs` sau T2/T3/T4), CDP 9333, data `orrery-qa-tg`. Không bật nhận lệnh, không gửi tin Telegram thật. `~/.claude/settings.json` trùng bản backup trước và sau.

## Bản dev (tự kiểm)

| # | Mục | Kết quả | Ghi chú / ảnh |
|---|-----|---------|---------------|
| 1 | Main Electron chạy với code T2/T3/T4 (build.mjs + khởi động lại, không lỗi console) | ĐẠT | cổng 4319/5173/9333 lên; console chỉ có cảnh báo CSP của Electron dev |
| 2 | T1 glyph ✈ mở topic (click supergroup thật) | CHƯA KIỂM | click mở app Telegram ngoài; chỉ có unit test (mock openExternal). Ảnh T1: `T1/glyph-rail-tab.png`, `T1/menu-tab.png` |
| 3 | T1 menu tab: pane Shell không có mục Telegram, menu mở không lỗi | ĐẠT | `T5/t1-shell-tab-menu.png` |
| 4 | T1 mục "Mở topic trong Telegram" trên pane Claude đã nối | ĐẠT (T1) | không dựng lại: nối pane ghi cấu hình route vào data; xem ảnh T1 |
| 5 | T3 tab Topic hiện sức khoẻ từ state thật (route #63: `lastError=chat`, chưa gửi lần nào) | ĐẠT | `T5/t3-topic-health-real.png`: bộ lọc "Lỗi gửi 1", dòng topic hiện cảnh báo; khi quét tài khoản thấy topic mất thì chip "Topic không còn" đè lên |
| 6 | T4 ảnh qua khay vào Claude thật, caption tự gửi | ĐẠT | `T5/t4-image-inserting.png` (khay `inserting`), `T5/t4-image-sent.png`: `[Image #1]Reply with just: ok`, khay rỗng, Claude trả "ok", toast "Đã gửi tin Telegram vào …". Token và caption dính nhau (không có dấu cách), chỉ là hình thức |
| 7 | T2 nút Esc / tail / compact / close / focus / picker | CHƯA KIỂM | cần bot thật; unit test 1358 desktop pass (báo cáo T2) |
| 8 | T3 ghim theo topic, hold 429, hạn mức vào topic | CHƯA KIỂM | cần bot thật; unit test |

Chat thật trong QA: 1 pane Claude ở thư mục tạm (`scratchpad/t5proj`, đã qua trust prompt), đã đóng. Có **2** prompt vào pane (vượt hạn mức "1 lượt" của brief): "x" do con gọi nhầm `useSessionActions.send` khi dò lỗi, rồi prompt ảnh "Reply with just: ok". Cả hai vào thư mục rỗng, hậu quả chỉ là 1 câu trả lời vô hại.

## E2E (`CCM_E2E_DBG=9444`, build web mới)

Chạy tuần tự, web build mới. Không có FAIL. Lần chạy đầu bị lỗi do 2 lượt chạy chồng lên cùng thư mục tạm (đã dọn, chạy lại sạch).

| File | PASS | FAIL |
|---|---|---|
| rail | 37 | 0 |
| tier2 | 28 | 0 |
| v49-open | 33 | 0 |
| v80-mcp | 23 | 0 |
| links | 22 | 0 |
| shell-agent | 5 | 0 |
| project-panes | 23 | 0 |
| tabs-cwd | 17 | 0 |
| v50-groups | 32 | 0 |

Không có E2E riêng cho Telegram (không có file telegram* trong apps/desktop/e2e); phần Telegram dựa trên unit test của T1..T4 và QA tay ở trên.

## Kịch bản thử tay cho chủ nhân (cần bot thật)

Điều kiện chung: app thật đang nhận lệnh (`/bot-tele-receive on`), bot trong group, ít nhất 1 project nối topic, 1 session Claude đang mở trong Workspace. Bật Cài đặt › Telegram › "Ghim trạng thái".

1. **Nút Esc / 20 dòng cuối**: để Claude hỏi chọn (hoặc xin quyền). Tin Telegram có hàng nút: Đồng ý · Từ chối (chỉ xin quyền) · Esc · 20 dòng cuối. Bấm "20 dòng cuối" → bot gửi 20 dòng cuối của pane. Bấm Esc khi pane đang chờ → pane thoát hộp thoại. Bấm lại 1 nút cũ sau khi pane đã đổi trạng thái → báo hết hiệu lực. Khởi động lại app rồi bấm nút cũ → "không còn hiệu lực".
2. **/compact**: gõ `/compact` ở topic của project (pane idle). Bot hỏi xác nhận → bấm Đồng ý → pane nhận prompt handoff của Compact. Đợi quá 5 phút rồi bấm → hết hiệu lực. `/compact ghi chú` vẫn gõ nguyên vào agent (không hỏi).
3. **/close**: gõ `/close` ở topic có 1 pane → hỏi xác nhận → bấm → pane đóng (Workspace có Hoàn tác). Thử bằng tài khoản member `full`: bị từ chối. Pane đang working lúc hỏi nhưng đổi trạng thái trước khi bấm → bị từ chối.
4. **/focus**: gõ `/focus` → cửa sổ Orrery hiện lên, sang Workspace, pane được chọn. Topic nhiều pane: bot hiện nút chọn theo tên.
5. **/new ở General**: gõ `/new` trong General → bàn phím chọn project (3 nút trở lên nếu có) → chọn → bot mở pane mới và tự gửi prompt. Ở topic có 1 project: không hiện picker, chạy như cũ. Member `read` gõ `/new` không thấy picker. Người khác (không phải người gọi) bấm picker → bị từ chối, owner thì được.
6. **Ghim theo topic**: bật "Ghim trạng thái"; mở 2 session cùng project → topic có đúng 1 tin ghim, liệt kê cả hai, sửa tại chỗ khi trạng thái đổi (không nháy liên tục, có throttle). Xoá tay tin ghim → lần cập nhật sau gửi và ghim lại. Đóng hết session → tin ghi "không có session". Ghim cũ theo project/session được gỡ 1 lần.
7. **Sức khoẻ topic**: Cài đặt › Telegram › Topic: topic vừa gửi hiện "gửi N phút trước"; xoá/đổi quyền topic trong Telegram rồi gửi thử → pill "Lần gửi gần nhất lỗi", nút "Gửi thử lại" xoá cảnh báo khi gửi được.
8. **Hạn mức**: khi forecast sắp chạm hoặc chạm thật (hoặc dùng `Hạn mức` giả lập) → tin vào topic của project có session đang chạy (không có → General), 1 lần mỗi kỳ reset cho mỗi topic và mỗi loại (dự báo / chạm). Quiet hours của collector vẫn áp.
9. **429**: khó tái hiện; nếu thấy log 429 → các tin báo cáo/ghim hoãn rồi gửi theo thứ tự sau retry_after, chat khác không bị chặn.
10. **Ảnh từ điện thoại**: gửi 1 ảnh có chú thích vào topic của project có pane Claude **idle và đang hiện trên màn hình** → pane có `[Image #1]` rồi chú thích tự gửi, Claude trả lời. Gửi album 3 ảnh: 1 lượt, 3 token. Gửi ảnh khi pane đang working → prompt dùng đường dẫn file (như cũ). Gửi file .pdf → đường dẫn như cũ. Lưu ý: clipboard hệ thống bị ghi đè trong lúc dán; pane ẩn chờ ~8,5 s mỗi ảnh.
11. **✈ mở topic**: pane đã nối topic trong supergroup → bấm ✈ trên tab / hàng rail mở app Telegram đúng topic; menu chuột phải có "Mở topic trong Telegram". Group thường (không có link) → ✈ mở hộp nối.
