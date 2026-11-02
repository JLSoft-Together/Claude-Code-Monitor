## WP-1: Settings thành cửa sổ có sidebar (phương án A)
- Mục tiêu: Settings không còn là sheet 420px cuộn ~9 màn. Thành dialog lớn (≈ 880×620, tối đa 92vw × 88vh; dưới 720px rộng thì
  sidebar thành hàng chip/segmented trên cùng) có sidebar trái + 1 trang bên phải; mỗi trang ≤ ~1 màn hình ở 1440×900.
- Sidebar (thứ tự, icon lucide + nhãn + không cần số đếm):
  1. Chung: ngôn ngữ, mở khi đăng nhập, khi mở lại app (restore mode), giữ máy thức (AwakeSettings), mẹo, gợi ý phím tắt, terminal mở session (macOS).
  2. Giao diện: ThemePicker, font giao diện, font code, cỡ code, zoom app (steppers), icon file, hiệu ứng bụi.
  3. Editor & Terminal: tự lưu (+ delay), minimap, làm mờ pane không hoạt động, shell integration. (chỉ khi hasTerminals)
  4. Thông báo: 1 công tắc chính + BẢNG sự kiện × kênh + giờ yên lặng + rảnh sau (idle) + gửi thử + DiskSettings + PhoneSettings.
     Bảng: hàng = sự kiện, cột = kênh mà dữ liệu hiện có hỗ trợ theo từng sự kiện (toast = `extras.notify.kinds[k]` theo TOAST_KINDS;
     trong app = `settings[ev.key]` theo `events`). Ghép hàng theo sự kiện tương ứng; sự kiện chỉ có 1 kênh thì ô kênh kia trống/không có
     checkbox. Âm thanh + điện thoại vẫn là công tắc chung (dữ liệu không có theo từng sự kiện) đặt dưới bảng. Không đổi store/protocol.
  5. Nhắc nhở & ngân sách: nghỉ giải lao, agent kẹt, ngân sách/ngày.
  6. Tài khoản GitHub (GitHubAccountsSettings) — chỉ khi hasGitHub.
  7. Tích hợp: status line snippet, RunSdkSettings, CaptureSettings.
  8. Quyền & bảo mật: SensitiveSettings, toàn quyền, quên thư mục đã cho phép.
  9. Dữ liệu & backup: AgentDataSettings, BackupSettings.
  10. Cập nhật & trợ giúp: UpdateSettings + helpItems.
  Mục không có nội dung trên nền tảng hiện tại (vd hasGitHub false) thì ẩn khỏi sidebar.
- Ô tìm ở đầu sidebar: lọc theo label + hint của mọi dòng; kết quả là danh sách "Trang › nhãn", bấm → mở trang và cuộn + nháy dòng đó.
  Cách làm gợi ý: mảng metadata `{ page, id, labelKey, hintKey }` trong `components/settings/index.ts`; dòng đánh `data-setting-row="<id>"`.
- Hint: dòng thường hiện hint ngắn qua nút ⓘ (tooltip/title + aria-describedby); giữ hint inline chỉ khi nó chứa trạng thái động
  (vd healthNote, testNote, số repo của tài khoản, kết quả quên grants).
- Mở / đóng: nút bánh răng như cũ (data-tour="settings", chấm update giữ nguyên), Ctrl+, / ⌘, , Esc đóng, focus trap, trả focus.
  Nhớ trang gần nhất (localStorage key `ccm.settings.page`, try/catch). `ui.settingsOpen` giữ nguyên; thêm `ui.settingsPage` để chỗ khác
  mở thẳng 1 trang (vd toast "bật thông báo" → 'notify'). Các component con đang dùng `ui.settingsOpen` (DevicesView watch) phải còn chạy.
- Tách file: `components/SettingsMenu.vue` chỉ còn nút + dialog shell; trang ở `components/settings/Settings<Page>.vue`. Các *Settings.vue
  con có sẵn giữ nguyên, chỉ đổi chỗ mount (bỏ `mt-6` thừa nếu cần qua prop/class).
- Spec item: wireframe Settings A.
- Phạm vi file: components/SettingsMenu.vue, components/settings/** (mới), stores/ui.ts (thêm settingsPage), các *Settings.vue con (chỉ
  chỉnh spacing/heading nếu cần), apps/desktop/e2e/*.cjs có selector settings bị đổi, i18n/ui-v79-settings.ts (mới).
  Cấm đụng: en.ts / vi.ts / index.ts, AppHeader.vue, MonitorView, workspace/**.
- Phụ thuộc: không | Song song: WP-2, WP-3 | Worktree: không
- Skill: frontend-design, ui-ux-pro-max. Model: sonnet.
- Tiêu chí nghiệm thu:
  - [ ] Mọi setting có trong SettingsMenu.vue bản cũ đều còn, ở đúng trang trên (liệt kê đối chiếu trong report).
  - [ ] Bảng thông báo bật/tắt đúng store cũ; disabled đúng như cũ (toast tắt / offline / notify tắt).
  - [ ] Tìm "âm" / "sound" ra dòng Âm thanh; bấm kết quả mở đúng trang.
  - [ ] Ctrl+, mở; Esc đóng; Tab không thoát khỏi dialog; nhớ trang.
  - [ ] Không cuộn ngang; trang dài nhất (Thông báo) ≤ ~1,3 màn ở 900px cao.
  - [ ] typecheck web sạch; vitest liên quan + src/i18n pass; E2E selector bị đổi đã sửa theo.
- Lệnh test: `npm run typecheck -w @ccm/web`; vitest `src/i18n` + test có sẵn của settings/ui store.
- Nhìn thấy được: có (WP-8 chụp; WP này ghi CHƯA NHÌN).
- Báo cáo: `.planning/wp/WP-1-report.md`

## Nhật ký
- [WP-1] Audit/REVIEW xong: shell + 9 trang + index.ts metadata + ui.settingsPage; typecheck web chỉ lỗi SessionCard.vue (WP khác).
- [WP-1] Test: vitest toàn web 588 file / 1577 pass; thêm settings/index.test.ts; E2E đã gắn ui.settingsPage theo trang (10 file). Chưa nhìn (WP-8).
