# PLAN v71 — Dialog "Có gì mới" (2026-10-29)

Chủ nhân chốt:
- Dialog liệt kê update của **mọi version đã release** (tag `v1.0.1` … `v2.3.0`) + bản mới **2.4.0** (gồm v66–v70 + v71), dạng list, mỗi version một item **expand / collapse**, nội dung gạch đầu dòng ngắn.
- **Bump luôn 2.4.0** (`apps/desktop/package.json` + `package-lock.json`).
- Hiện tự động khi version app khác version đã xem lần trước, **kể cả lần cài mới** (chưa từng chạy).
- Mở lại được trong **Settings** (mục "Có gì mới" / What's new); thêm cả mục Ctrl+K.

Thiết kế:
- Dữ liệu: `apps/web/src/lib/changelog.ts` — mảng `{ version, date, items: { en, vi }[] }` mới nhất trước; nội dung tóm từ `git log v<a>..v<b>` + `.planning/PLAN-*` (không bịa, chỉ điều đã có trong lịch sử). Text đa ngữ nằm trong data (en + vi), UI chrome qua i18n.
- Version đã xem: `localStorage` `ccm.whatsNew.seen` (try/catch). Version app lấy từ nguồn sẵn có (desktop bridge / build define).
- Item version hiện tại mở sẵn, các bản cũ thu gọn; nút "Mở hết / Thu hết".
- Dialog opaque (`ccm-menu`/dialog chuẩn), token màu, i18n en + vi, a11y (button `aria-expanded`, Esc đóng, focus trap như dialog khác).
- Không hiện chồng onboarding tour lần cài mới: tour trước, dialog sau (hoặc ngược lại — chọn một, ghi lại).
- Test: `changelog.test.ts` (thứ tự, semver, version hiện tại có trong list, mỗi item đủ en + vi), logic `shouldShow(seen, current)`.
