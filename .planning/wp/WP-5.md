## WP-5: Thanh trên cùng gọn + onboarding không chồng
- Mục tiêu:
  1. Góc phải AppHeader (186-247) từ ~13 thứ còn: [update pill nếu có] · nút "Hạn mức NN%" · Tìm (palette) · Inbox/Thông báo · Cài đặt.
     Nút Hạn mức hiện % cao nhất đáng lo của PlanLimits (Claude 5h / tuần, Codex 5h / tuần); ≥ 90% chữ màu error + icon (status = icon + chữ).
     Bấm → popover opaque (`ccm-menu`) liệt kê: từng hạn mức với thanh + giờ reset (dữ liệu PlanLimits có sẵn), dòng "Giữ máy thức: N agent"
     (KeepAwakeBadge, kèm hành động bật/tắt nếu badge có), dòng ổ đĩa (DiskBadge, chỉ khi cảnh báo), nút Tài nguyên (mở ResourcesDialog như
     ResourcesButton), trạng thái collector. Không có dữ liệu hạn mức → nút hiện icon + "Hạn mức" không số (không bịa số).
  2. Chấm kết nối chỉ hiện khi KHÔNG kết nối / stale (khi đó kèm chữ "Mất kết nối"); khi kết nối OK chỉ nằm trong popover.
  3. Nút Compact (thu nhỏ map) → vào menu ⋯ cạnh tab view (moreEntries AppHeader) + palette (đã có). Không bỏ phím tắt.
  4. KeepAwakeBadge / DiskBadge / ResourcesButton không còn đứng riêng trên header (vào popover); DiskBadge đang cảnh báo đỏ thì nút Hạn mức
     có chấm cảnh báo nhỏ để không mất tín hiệu.
  5. Lần đầu mở: OnboardingTour và WhatsNewDialog đang bật chồng nhau. Chỉ hiện Tour; WhatsNew đợi lần mở sau (hoặc tới khi tour đóng xong
     ≥ 1 lần khởi động sau). Xem logic hiện có trong App.vue / stores tips / changelog seen key.
- Thêm (từ WP-1): DiskBadge.vue:77 mở Settings → đặt `ui.settingsPage = 'notify'` trước `ui.settingsOpen = true`.
- Phạm vi file: components/AppHeader.vue, PlanLimits*.vue, KeepAwakeBadge.vue, DiskBadge.vue, ResourcesButton.vue (thêm biến thể dòng trong
  popover nếu cần), components/HeaderStatusPopover.vue (mới, tên tuỳ), App.vue (chỉ gating Tour/WhatsNew), OnboardingTour/WhatsNewDialog
  nếu gating nằm trong đó, i18n/ui-v79-header.ts (mới), e2e/unit selector bị đổi.
  Cấm: workspace/**, SettingsMenu + settings/**, MonitorView/Session*, en.ts/vi.ts/index.ts, stores/ui.ts (cần → "Hot file cần thêm").
- Phụ thuộc: không | Song song: WP-4, WP-6 | Worktree: không
- Skill: frontend-design, ui-ux-pro-max. Model: sonnet.
- Tiêu chí nghiệm thu:
  - [ ] Header phải ≤ 5 control khi không có update; không mất tín hiệu nào (giữ máy thức, ổ đĩa, tài nguyên, kết nối, hạn mức).
  - [ ] Số % đúng nguồn PlanLimits, không bịa; ≥ 90% có icon + màu.
  - [ ] Popover đóng bằng Esc / bấm ngoài, focus trả về nút; bàn phím đi được.
  - [ ] Profile mới: chỉ Tour hiện; lần sau WhatsNew hiện như cũ.
  - [ ] typecheck web sạch; vitest + src/i18n pass; e2e selector (KeepAwakeBadge, DiskBadge, resources, plan limits, compact) đã sửa theo.
- Lệnh test: `npm run typecheck -w @ccm/web`; vitest liên quan.
- Nhìn thấy được: có (Monitor header xem được ở dev CCM_PORT=4318 như brief WP-2; chụp docs/qa/v79/WP-5/ nếu chạy được, không thì CHƯA NHÌN).
- Báo cáo: `.planning/wp/WP-5-report.md`

## Nhật ký
- WP-5: audit xong; tạo lib/headerStatus.ts, lib/onboardingGate.ts (+test), HeaderStatusPopover.vue, i18n/ui-v79-header.ts.
- WP-5: sửa AppHeader (còn status/inbox/search/settings + ⋯ có Compact), PlanLimits list, KeepAwake/Resources row, DiskBadge renderless, gating Tour/WhatsNew, e2e v76/v77a/whats-new.
- WP-5: typecheck sạch; vitest headerStatus + i18n pass; full web vitest chỉ fail ngoài phạm vi (DevicesView, useProjectRoots). Chưa chạy dev để chụp ảnh.
