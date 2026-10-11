---
date: 2026-10-11
project: Agent Monitor / apps/web (AppHeader, PlanLimits)
status: fixed
---

# Header: chip quota đè lên tab khi cửa sổ hẹp (~1280–1700px)

## Triệu chứng
Header ở độ rộng ~1440px CSS: nhóm tab "Giám sát / Thống kê / Lịch sử" bị bóp, chữ chồng lên nhau, chip quota Claude đè lên tab ("layout bị chèn sang trái"). Xuất hiện sau khi thêm chip quota thứ hai (Codex).

## Nguyên nhân
- Hàng header có `xl:flex-nowrap`: từ 1280px mọi thứ ép trên 1 dòng, tổng nội dung (~1700px) vượt độ rộng.
- Tablist là flex item `flex-shrink: 1` với `grid-cols-3` = `repeat(3, minmax(0, 1fr))` → min-content gần 0 → trình duyệt co tablist về gần 0, nút tab (min-w 120px) tràn ra ngoài và bị chip đè.

## Solution
- `AppHeader.vue`: bỏ `xl:flex-nowrap`; brand + tablist `shrink-0`.
- Nhóm phải `flex flex-1 flex-wrap-reverse justify-end` chứa [cụm quota, cụm điều khiển]. Không đặt `min-w-0` để min-content của nhóm = cụm rộng nhất → hàng ngoài tự xuống dòng khi không đủ chỗ; `wrap-reverse` đẩy cụm quota xuống dưới cụm điều khiển thay vì đè.
- Gộp 2 `PlanLimits` vào 1 khung chung (nút trong không viền, hover `bg-raised`, bỏ chevron) để tiết kiệm chỗ.
- Ẩn mục phụ theo độ rộng: < 2xl nút ngôn ngữ/theme + gợi ý Ctrl K (vẫn có trong Settings); < 3xl (`--breakpoint-3xl: 110rem` trong `style.css` `@theme`) ngày ở `FlipClock`, tên provider, chữ trạng thái kết nối khi đang kết nối (`sr-only 3xl:not-sr-only`, tooltip `connectionTitle`).

## Context
Vue 3 + Tailwind v4. Bài học: flex item chứa grid `minmax(0,1fr)` có thể bị co về 0 — item nào không được co phải `shrink-0`; tránh `flex-nowrap` theo breakpoint cố định khi nội dung header thay đổi (thêm chip, đổi ngôn ngữ) — để wrap theo nội dung.
