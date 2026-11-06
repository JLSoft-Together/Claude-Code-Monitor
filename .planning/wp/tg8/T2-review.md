# T2 review (opus, 2026-11-06) — phải sửa trước khi ĐẠT (vòng 2, chờ T3 xong vì cùng notifier.ts)
1. HIGH useTelegramInbound close + notifier runPaneCommand ~:1078: nút xác nhận close/compact không kiểm stale (không lưu `since`, không TTL, bỏ qua busy) → bấm muộn đóng pane đang working hoặc session claude mới cùng terminal. Sửa: lưu `since`+status trong entry cl/cp, page kiểm lại như stop (`state` nếu working/since đổi), TTL ~5 phút.
2. MED notifier ~:1019 pick: target `{kind:'pane'}` không ra terminal → rơi về "pane duy nhất" → sai pane. Sửa: có target mà không resolve → `gone`.
3. MED notifier :1248-1256 pj/nw/np: prompt picker không gắn người gửi; member full bấm picker của người khác; retire sibling theo text prompt. Sửa: lưu id tác giả, chỉ tác giả/owner bấm; retire theo message id/picker group.
4. LOW notifier :254-259 projectChoices: topic chưa nối (không phải General) cũng hiện picker toàn chat → bỏ qua link flow. Sửa: chỉ General (threadId null).
5. LOW runPaneCommand ~:1091: xoá mọi action cùng kind trong topic → giết confirm của pane khác. Sửa: chỉ retire entry cùng message/picker.
6. LOW :1247 cp/cl từ pickMarkup không truyền `since` → sau sửa 1, truyền `entry.since`.
