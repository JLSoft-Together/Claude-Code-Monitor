## WP-1 — DONE (có CHƯA KIỂM / CHƯA NHÌN, xem dưới)

- Đã đổi:
  - `apps/web/src/components/SettingsMenu.vue` — chỉ còn nút chuông + nút bánh răng (data-tour="settings", chấm update giữ nguyên) + dialog 880×620 (min(880px,92vw) × min(620px,88vh)), sidebar trái + ô tìm + 1 trang phải; < 720px (container query) sidebar thành hàng chip trên cùng. Ctrl+, / ⌘, toggle (listener document), Esc đóng (Esc trong ô tìm có chữ thì xoá chữ trước), focus trap (lọc tabindex -1 / ẩn), trả focus, nhớ trang (`localStorage ccm.settings.page`, try/catch), `ui.settingsPage` mở thẳng trang.
  - `components/settings/index.ts` (mới) — `SETTINGS_PAGES`, metadata `entries(mac)` `{page,id,labelKey,hintKey,needs}`, `searchSettings` (không phân biệt hoa thường / dấu / đ), `NOTIFY_ROWS` (ghép bảng thông báo), `loadPage/savePage`.
  - `components/settings/Settings{General,Appearance,Editor,Notify,Reminders,Integrations,Access,Data,About}.vue` (mới); trang GitHub mount thẳng `GitHubAccountsSettings` trong shell.
  - `components/settings/{InfoHint,SettingRow,SettingSection,SettingEmbed}.vue` (mới) — ⓘ (title + aria-describedby), hàng cài đặt, nhóm, wrapper cho *Settings.vue con (bỏ mt-6 thừa, gắn `data-setting-row`).
  - `components/ToggleSwitch.vue` — thêm prop `info?` (ⓘ cạnh nhãn), cộng thêm, không đổi chỗ khác.
  - `stores/ui.ts` — thêm `settingsPage` (null = trang cuối; SettingsMenu tiêu thụ rồi xoá).
  - `i18n/ui-v79-settings.ts` (mới, key `settingsV79`), `components/settings/index.test.ts` (mới).
  - E2E (10 file `apps/desktop/e2e/*.cjs`: github-accounts, tabs-cwd, v25, v27, v74, v76, v76b, v77a, v77b, whats-new) — thêm `ui.settingsPage = '<trang>'` trước `settingsOpen = true` vì trang khác không còn trong DOM.
- Đối chiếu setting cũ → trang mới:

| Cũ (SettingsMenu) | Trang mới |
|---|---|
| language, keyHints, tips, launchTerminal(mac) | Chung |
| loginItem, restoreMode, AwakeSettings | Chung |
| ThemePicker, font UI, font code, cỡ code, zoom app, file icons, dust | Giao diện |
| autoSave(+delay), minimap, dimInactive, shellIntegration | Editor & Terminal (chỉ hasTerminals) |
| toast + health + gửi thử, notifyEnable, 6 notifyX, 10 toast kinds, sound, quiet(+giờ), idle, DiskSettings, PhoneSettings | Thông báo |
| breakReminder, stuck, dailyBudget | Nhắc nhở & ngân sách |
| GitHubAccountsSettings | Tài khoản GitHub (chỉ hasGitHub) |
| status line snippet, RunSdk, Capture | Tích hợp |
| SensitiveSettings, fullAccess, forgetGrants | Quyền & bảo mật |
| AgentData, Backup | Dữ liệu & sao lưu |
| UpdateSettings, helpItems (8 mục) | Cập nhật & trợ giúp |

  Không mất setting nào. Mục không có trên nền tảng (hasTerminals/hasGitHub/hasAwake/...) ẩn khỏi trang; trang trống (editor, github) ẩn khỏi sidebar và khỏi kết quả tìm.
- Tiêu chí: 5/6 đạt bằng code + test; 1 CHƯA KIỂM.
  - [x] Mọi setting còn, đúng trang (bảng trên).
  - [x] Bảng thông báo: ô toast ghi `connection.updateNotify({kinds})`, ô trong-app ghi `settings.notifyX`; disabled như cũ (toast: `!toast||offline`; trong-app: `!notifyEnabled`; công tắc toast disabled khi offline; notifyEnable disabled khi unsupported). Sự kiện chỉ có toast (job, idle, sensitive, disk) → ô trong-app là "–". Khi `toastAvailable` false: ẩn cột toast + 4 hàng chỉ-toast.
  - [x] Tìm "sound" / "âm" / "am bao" ra dòng Âm thanh trang Thông báo (test). Bấm kết quả: đổi trang, cuộn + nháy `[data-setting-row=id]`.
  - [x] Ctrl+, mở/đóng; Esc đóng; Tab vòng trong dialog; nhớ trang (code + test loadPage/savePage). CHƯA KIỂM hành vi runtime thật (focus trap, nháy) — cần WP-8 chạy app.
  - [x] Không cuộn ngang (`overflow-x-hidden`, hàng truncate). CHƯA KIỂM: trang Thông báo ≤ ~1,3 màn ở 900px cao — chưa đo, cần WP-8 chụp.
  - [x] typecheck web: chỉ còn 1 lỗi ngoài phạm vi (SessionCard.vue:87). Vitest toàn web 588 file / 1577 pass.
- Audit / Review:
  - Diff đúng phạm vi; không debug log; không đụng en.ts/vi.ts/index.ts/AppHeader/MonitorView/workspace/changelog/.code_index.
  - Lệch brief 1: "1 công tắc chính" không gộp được vì 2 store khác nhau (`extras.toast` và `settings.notifyEnabled`) mà brief cấm đổi store → mỗi kênh có công tắc riêng ở nhóm "Kênh thông báo", bảng bên dưới là sự kiện × kênh.
  - Lệch brief 2: Phone/Disk/Sensitive/Awake... là component con có sẵn nên chỉ tìm được tới mức section (không tới từng dòng bên trong).
  - Hint tĩnh → ⓘ (title); giữ inline: breakHint (giờ động), notifyBlocked/Unsupported, healthNote, testNote, hint của FontPicker và các *Settings.vue con (không sửa), hint của nút Help và Forget grants.
  - Edge: `ui.settingsPage` set trước hoặc sau `settingsOpen` đều chạy (2 watcher); trang không khả dụng → về 'general'; localStorage lỗi → 'general'.
  - Cũ: toast/notify `onBeforeUnmount(extras.setToastTest(null))` nay chạy khi rời trang Thông báo.
- Test: `npx vitest run` (toàn apps/web, qua --reporter=json) → files 588 tests 1577 pass 1577 fail 0; `src/components/settings src/i18n` + DevicesView.test → 39/39 pass. `vue-tsc --noEmit -p tsconfig.json` → 1 lỗi duy nhất `SessionCard.vue(87,5) TS2345` (file của WP khác, không sửa). Test mới: metadata key tồn tại en+vi, tìm kiếm (en/vi/dấu/đủ từ/ẩn theo env), ghép bảng thông báo (đủ 10 kind một lần, 6 key trong-app có thật trong settings store), nhớ trang, message ui-v79 compile.
- Nhìn: CHƯA NHÌN: WP-8 chụp
- Hot file cần thêm:
  - `i18n/en.ts` / `vi.ts`: `import v79Settings from './ui-v79-settings'` + spread `...v79Settings.en` / `...v79Settings.vi` (như resources-v76). Chưa nối thì UI hiện key thô (`settingsV79.*`).
  - `lib/shortcuts.ts` (list phím tắt hiển thị): thêm Ctrl+, / ⌘, "Cài đặt" nếu muốn.
  - `ui.ts`: đã thêm `settingsPage`.
- Ngoài phạm vi cần main xử lý:
  - Nơi khác nên mở thẳng trang: `PhoneFailToast.vue:21` → `ui.settingsPage='notify'`; `DiskBadge.vue:77` → 'notify'; `workspace/log/PushDialog.vue:107` → 'github'; `devices/DevicesView.vue:64` (nút mở Settings để đặt Android SDK) → 'integrations'. Không sửa thì vẫn mở dialog ở trang cuối.
  - `style.css` còn khối `.ccm-side-*` (không còn ai dùng sau WP này; kiểm trước khi xoá).
  - `SessionCard.vue(87)` lỗi typecheck của WP khác.
  - FontPicker (`components/ui/`) còn hint inline; muốn ⓘ thì sửa trong WP/lượt khác.
- Index:
  - `components/SettingsMenu.vue` — shell (nút + dialog + sidebar + tìm); `components/settings/index.ts` — `SETTINGS_PAGES`, `entries`, `searchSettings`, `NOTIFY_ROWS`, `loadPage/savePage`.
  - `components/settings/Settings*.vue` — 9 trang; `SettingRow/SettingSection/SettingEmbed/InfoHint` — khối dựng trang; `data-setting-row="<id>"` là điểm neo tìm kiếm.
  - `stores/ui.ts` — `settingsPage` (mở thẳng trang).
- Changelog: en: Settings is now a window with a sidebar of ten pages, a search box that jumps to any setting, and one table for which events notify you by system alert or notification. / vi: Cài đặt giờ là một cửa sổ có thanh bên mười trang, ô tìm nhảy tới đúng cài đặt, và một bảng chọn sự kiện nào báo bằng cảnh báo hệ thống hay thông báo.
- Commit message đề xuất: 🪟 Settings as a sidebar window with search, ten pages and an events by channel notification table
