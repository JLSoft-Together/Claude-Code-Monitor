# WP-10 report: Ctrl+K chung + dòng thời gian tool của subagent

## Đã đổi
- `components/CommandPalette.vue` (giữ CRLF): một ô tìm session (đang chạy + đã kết thúc), dự án (nguồn Go to project: `projectEntries` + `filterProjects` fuzzy, MRU), file dự án đang mở (`listFiles` + `fuzzyFilter` như Quick open, tải lười khi gõ ≥2 ký tự hoặc `#`), cài đặt (`searchSettings` v79, `:` rỗng liệt kê hết), hành động/prefs/help (sẵn có). Nhóm theo loại, mỗi nhóm ≤5 + dòng "Xem thêm N" (role=option, Enter/click mở rộng). Tiền tố `>` `@` `#` `:` ép tab tương ứng; tab thanh lọc: Tất cả / Session / Dự án / Lệnh / File / Cài đặt (thay tab Favorites); footer có chip tiền tố bấm được. Xếp hạng trong nhóm: label bắt đầu từ > label chứa > chỉ ở sub; câu gõ có dấu khớp đúng dấu trước ("âm" không dính "làm").
- Session đã kết thúc: Enter = focus thẻ (như cũ); Shift+Enter = Tiếp tục (`useRevealInWorkspace.reopen`, --resume trong pane Workspace, không gửi gì cho agent). Session đang chạy: Shift+Enter = nhảy cửa sổ (như cũ).
- Dự án: Enter = tab focus gần nhất hoặc mở mới (đúng ProjectSwitcher.choose), Shift+Enter = tab mới. Cài đặt: mở đúng trang rồi nháy dòng (`lib/settingsFlash.ts`, dùng `ui.settingsPage` + DOM `data-setting-row`, không sửa SettingsMenu).
- `lib/paletteSearch.ts` (mới, thuần): `parsePrefix`, `matchText`, `cap`, `listSettings`, `matchFiles`, `joinPath`. `lib/settingsFlash.ts`, `composables/useSettingsEnv.ts` (cùng cờ env với SettingsMenu; SettingsMenu chưa refactor để dùng chung, tránh đụng file ngoài phạm vi).
- `components/AgentDetails.vue`: node subagent -> panel có mục "Lệnh gọi tool": 30 call mới nhất (tool, giờ, thời lượng, ok/lỗi/bị ngắt/đang chạy = icon + chữ + màu), "N lệnh cũ hơn không hiển thị". Dữ liệu từ `toolSpans` store (đã có, `tool.span` live + `toolSpans.get` backfill 2h, lấy từ bộ nhớ collector, KHÔNG đọc transcript). Chỉ tên tool + thời gian, không tham số (test khẳng định). Span chưa đóng trên agent đã xong hiện "bị ngắt", không "đang chạy" mãi.
- `lib/agentTools.ts` (mới, thuần), `i18n/ui-v80-palette.ts` (mới, key top-level `paletteV80`; dùng lại `tools.outcome.*`, `palette.*`, `workspace.quickOpen.hints.split`, `settingsV79.pages.*`).

## Tiêu chí (brief)
1. Ctrl+K 1 ô: hành động / session / dự án / file / cài đặt, nhóm ≤5 + Xem thêm, tiền tố > @ # :, xếp hạng dấu: ĐẠT. Palette cũ, Quick open (Ctrl+P), Go to project (Ctrl+Alt+P) không đổi; mục `c:projects` trong palette vẫn còn.
2. Panel subagent hiện dòng thời gian tool: ĐẠT (dữ liệu có sẵn, không bịa).

## Edge case đã review
- Không dự án mở: tab/tiền tố `#` hiện "Mở một dự án trong Workspace…"; mixed view không hiện nhóm file, không lỗi. Mở app web-only (không terminals): nhóm Dự án ẩn, giữ nhóm Favorites cũ nguyên hành vi.
- Offline: palette dùng store sẵn có + IPC cục bộ; `loadToolSpans` trả false thì không đánh dấu đã hỏi, thử lại lần chọn sau; panel báo "chưa ghi nhận".
- Rất nhiều file: danh sách tải 1 lần mỗi lần mở palette (huỷ khi đóng, giải phóng), fuzzy giới hạn 50, ≥2 ký tự mới tìm trong mixed view; `truncated` có ghi chú ở tab File.
- Tiền tố rỗng: `>`, `@`, `#`, `:` một mình liệt kê hết loại đó (file: danh sách chưa lọc, cắt 50; settings: toàn bộ hàng đang hiện). Tiền tố không ở đầu thì coi là chữ thường.
- Hàng env ẩn (không có terminals/github/toast…) không lọt vào kết quả cài đặt (test).
- i18n: `@` trong chuỗi phải viết `{'@'}` (vue-i18n linked syntax), đã test compile en + vi.

## Mục bị bỏ / đổi chỗ (không mất tính năng)
- Tab/nhóm Favorites trong palette (desktop) gộp vào nhóm Dự án; việc "mở bằng terminal ngoài (new/continue)" của favorites không còn trong palette desktop mà thay bằng mở trong Workspace (cùng cách Go to project). Vẫn còn ở thanh Monitor/sidebar favorites. Web-only vẫn nguyên.
- Quick open `recent` (localStorage) chưa dùng cho `#` rỗng (key nằm trong script setup của QuickOpen.vue); chọn file từ palette không cập nhật recent đó.
- Session "đã kết thúc gần đây" = terminal `stale` còn trong store (chưa dismiss); không nạp thêm từ History.

## Test
- Mới: `lib/paletteSearch.test.ts` (prefix, ranking có dấu, cap, files, settings env, i18n en/vi, flash helper), `lib/agentTools.test.ts`.
- `npm run typecheck -w @ccm/web` sạch; vitest web toàn bộ: 616 file / 1646 test pass. Không chạy build/E2E (WP-8).
- E2E cũ gõ nhãn rồi click `[role=option]` chứa nhãn: vẫn hợp lệ (xếp hạng đưa nhãn khớp lên đầu nhóm). Hook mới: `[data-palette-more]`, `[data-palette-mode]`, `[data-agent-tools]`, `[data-agent-tool]`.

## Hot file cần thêm (main nối)
- `apps/web/src/i18n/en.ts` + `vi.ts`: `import uiV80Palette from './ui-v80-palette'` và spread `...uiV80Palette.en` / `...uiV80Palette.vi` (key `paletteV80`).

## Index (.code_index/web.md)
- `lib/paletteSearch.ts` (`parsePrefix`/`matchText`/`cap`/`matchFiles`/`listSettings`) + `components/CommandPalette.vue` (groups sessions/projects/files/settings, cap 5 + more row, `scopeNow`), `lib/settingsFlash.ts` `flashSettingRow`, `composables/useSettingsEnv.ts`.
- `components/AgentDetails.vue` mục tool calls <- `lib/agentTools.ts` `toolRows` <- `stores/toolSpans`.

## Changelog
- en: Ctrl+K now searches sessions, projects, files and settings in one box (prefix with > @ # : to narrow), and a sub-agent's panel in the Agent Map lists its recent tool calls with time and result.
- vi: Ctrl+K tìm session, dự án, file và cài đặt trong một ô (gõ > @ # : để thu hẹp), và panel sub-agent trong Agent Map hiện các lệnh gọi tool gần đây kèm thời gian và kết quả.

## Commit đề xuất
✨ v80 WP-10: Ctrl+K tìm chung session/dự án/file/cài đặt, tiền tố > @ # :, tool timeline trong panel subagent
Files: apps/web/src/components/CommandPalette.vue, AgentDetails.vue, lib/paletteSearch(.test).ts, lib/settingsFlash.ts, lib/agentTools(.test).ts, composables/useSettingsEnv.ts, i18n/ui-v80-palette.ts

## Nhật ký
- AUDIT: palette cũ 4 nhóm + favorites; sources: projectSwitcher.ts, QuickOpen listFiles, settings/index.ts, toolSpans store.
- REVIEW: sửa lỗi `@` trong vue-i18n; loadToolSpans offline; flash dòng cài đặt chờ render.
- TEST: typecheck + vitest toàn web xanh.

## Sửa sau e2e whats-new (main báo)
- Nguyên nhân: e2e gõ "What's new" rồi click option ĐẦU TIÊN chứa chữ đó. Mục cài đặt `help-whatsNew` (nhóm Cài đặt) khớp cùng nhãn và đứng trước nhóm Help trong GROUP_ORDER, nên click mở Settings thay vì dialog. Hồi quy của app (thứ tự nhóm), không sửa e2e: `GROUP_ORDER` đổi thành ... prefs, help, settings (hành động luôn trước cài đặt). v72/v75 e2e cùng kiểu cũng được lợi.
- Chunk cpp/typescript/jsx trùng: CommandPalette/paletteSearch/AgentDetails không import highlight/shiki/highlightCore (đã grep), nên không phải do WP-10; nhiều khả năng bản main + bản worker ES (`worker.format: 'es'`) cùng gói grammar, có từ trước. Cần WP-8 so sánh build trước/sau nếu nghi ngờ.
- Chưa build/chạy e2e: `.planning/wp/build.lock` đang do WP80-1 giữ.
