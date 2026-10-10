# PLAN v15 — Motion polish (sau layout E)

Nguyên tắc: transform/opacity, 150–300 ms, `--ease-out-quint`, exit ngắn hơn enter, tắt hết dưới reduced motion, không animate width của canvas Vue Flow.

## Đã có
ccm-pop (node mount), ccm-flash (đổi status), ccm-breathe (node working), edge dash chạy, ccm-tick (số), ccm-list (enter/leave/move), ccm-view (đổi view), view transition khi đổi theme, quota flash/delta/shine, count-up KPI Usage.

## Thiếu (chủ yếu do layout E mới)

P1 — làm trước
1. Panel nổi Sessions/Activity: trượt vào từ mép + fade (v-show đang bật/tắt cụt). Panel ghim: fade, map refit như cũ.
2. Thanh session thu gọn/mở: hàng tóm tắt co giãn mượt (grid-rows 0fr↔1fr), chevron xoay.
3. Tab session: pill nền trượt theo tab đang chọn (giống tab Monitor/Usage), nội dung tóm tắt crossfade khi đổi tab.
4. Popover agent: scale + fade từ phía mũi tên (transform-origin theo side).
5. Phím tắt có phản hồi: bấm phím → nhãn KeyHint tương ứng lún xuống + nút sáng nhẹ 1 nhịp.
6. Thanh thu gọn có session chờ: viền/nền vàng "thở" chậm, tắt khi mở thanh hoặc hết chờ.
7. Edge mới: vẽ dần từ cha sang con (stroke-dashoffset) khi subagent spawn.
8. Phản hồi nhấn nút: scale 0.96 khi :active cho nút công cụ.

P2
9. Đổi vị trí thanh (⇧B): View Transition — thanh trượt từ trên xuống đáy và ngược lại.
10. Mở app: 1 chuỗi duy nhất — header → thanh → node xuất hiện stagger 30 ms.
11. Đổi tab session: camera map bay vào cây (fitView có duration) thay vì nhảy.
12. Số trong thanh tóm tắt dùng count-up (useCountUp) thay vì tick.
13. Bật/tắt gợi ý phím (H): nhãn pop vào lần lượt.

Bỏ qua: animate width panel ghim (resize canvas mỗi frame), hiệu ứng trang trí không gắn hành động.

## Đã làm
- Số token (yêu cầu riêng): TokenCount — đếm lên, sáng 1 nhịp, badge +N cộng dồn trong 1.5 s, ≥ 50K đổi màu cam.
