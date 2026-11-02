## WP-10 — XONG (3 lỗi đạt)

### Đã đổi
- components/SettingsMenu.vue: bọc `@container` ra 1 div cha, `flex-row` ở div con (container query giờ áp được); `flash()` tự mở khối "Ổ đĩa & điện thoại" khi hit tìm kiếm là disk/phone.
- components/settings/index.ts `searchSettings`: query có dấu so khớp có dấu trước (chỉ fallback bỏ dấu khi 0 kết quả); query không dấu bỏ dấu như cũ; xếp hạng: đầu từ trong label > trong label > chỉ hint.
- components/settings/SettingsNotify.vue: giờ yên lặng gộp 1 dòng (nhãn + Từ/Đến + công tắc); "Coi là bỏ quên sau" thành `<select data-idle-select>` 1 dòng; Ổ đĩa + Điện thoại thu vào 1 dòng "Cảnh báo ổ đĩa và điện thoại" + nút "Cài đặt…" (`data-notify-more`, v-show nên component vẫn mount). Không bỏ setting nào.
- SettingSection.vue / SettingEmbed.vue: khoảng cách nhóm mt-6 -> mt-4.
- i18n/ui-v79-settings.ts: moreAlerts, moreAlertsHint, moreOpen, moreClose (en + vi).
- e2e: v79-shots.cjs bỏ forceLayout, thêm check sidebar cạnh nội dung + nội dung >= 400px mỗi trang, Notify <= 1170px; run.cjs thêm 'v79-shots'; v76.cjs sửa theo UI mới (idle dùng select; mở disclosure trước khi thao tác phone).

### Lỗi 1-3
1. ĐẠT: 10 trang đều sidebar cạnh nội dung (sideRight 504 = contentLeft 504), nội dung cao 571px.
2. ĐẠT: trang Thông báo scrollHeight 607px (trước 1527px), ~0,67 màn.
3. ĐẠT: "âm" -> chỉ "Phát âm báo", "Giờ yên lặng" (không còn "Làm mờ", "Mẹo phím tắt"); "am", "sound", "thông báo" có test.

### Test số thật
- typecheck web: sạch. vitest settings + i18n: 6 file, 17 test, 17 pass (thêm 2 test search).
- build web + desktop OK. v79-shots.cjs: 0 FAIL (toàn bộ PASS, gồm 10 check layout + Notify 607).
- CHƯA chạy lại v76.cjs / v77a.cjs sau khi sửa (v76 cần mock lớn); v77a chỉ dùng evaluate-click nên vẫn chạy được trên disclosure đóng. Main nên chạy v76 (idle select + phone).

### Ảnh
docs/qa/v79/10-settings-*.png, 11, 12, 13 chụp lại 02:58, đã Read 10-notify và 11-search: layout 2 cột đúng, Notify gọn, search "âm" 2 kết quả.

### Ngoài phạm vi
Không đụng workspace/**, AppHeader, en.ts/vi.ts. Nhãn disclosure dùng hint trùng ý với tiêu đề (có thể rút gọn sau).

### Changelog bổ sung
- en: Settings dialog shows the page list beside the settings again, Notifications is much shorter, and search respects Vietnamese accents.
- vi: Hộp Cài đặt lại hiện danh sách trang bên cạnh nội dung, trang Thông báo gọn hơn nhiều, và tìm kiếm phân biệt dấu tiếng Việt.

### Index (.code_index)
- SettingsMenu.vue: container/row wrapper; flash() mở `[data-notify-more]`.
- settings/index.ts `searchSettings`: exact-accent pass + rank (wordStart).
- SettingsNotify.vue: quiet row, `data-idle-select`, `data-notify-more` disclosure.
