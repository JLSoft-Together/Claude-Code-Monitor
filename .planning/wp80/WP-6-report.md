# WP-6 report: review queue, History resume, Run auto reload

## Đã đổi
- `apps/web/src/lib/reviewQueue.ts` (mới): mốc "đã xem" theo project trong localStorage `ccm.review.seen.v1` (try/catch, cap 40 project / 400 file). Chữ ký file = kind + XY + added/removed (git status không có mtime). `splitUnseen`, `markAllSeen`, `markSeen`, `unseenCounts` (ref theo root, để rail/thẻ session dùng sau).
- `components/workspace/ChangesPane.vue`: nhóm "Chưa xem" lên đầu (chỉ tách khi đã có file được xem; chưa xem gì thì giữ nhóm cũ), chip "N mới" ở header, thanh "N file đã đổi… [Đánh dấu đã xem]" dưới toolbar, mục "Đánh dấu đã xem" trong menu ⋯. Chọn file (click / phím) tự ghi file đó là đã xem; nhóm chỉ xếp lại ở lần load status kế (không nhảy dưới con trỏ).
- History → Tiếp tục: `components/history/HistoryView.vue` thêm cột nút "Tiếp tục" (hoặc "Hiện" nếu pane đang mở) cho danh sách đã kết thúc, gọi `workspace.resumeSession('claude', cwd, sessionId)`. Kết quả tìm session (`PromptSearchCard`) đã có sẵn nút Tiếp tục từ v75, giữ nguyên.
- Cần id session cho dòng lịch sử: thêm `sessionId?` vào `SessionRecord` (`packages/shared/src/types.ts`), ghi ở `apps/collector/src/monitor.ts recordOf` (terminal.claudeSessionId) và đọc ở `apps/collector/src/history.ts parseRecord`. Bản ghi cũ không có id thì nút tắt kèm tooltip.
- Run tự reload (mặc định tắt): `lib/runAutoReload.ts` (agentsFinished working→idle, autoReloadAction), `stores/run.ts` (autoReload theo project lưu `ccm.run.autoReload`, watch trạng thái terminal, debounce 2s, tối thiểu 8s giữa hai lần, bỏ qua nếu còn agent đang working), công tắc trong menu config của `RunBar.vue` (menuitemcheckbox `data-run-auto-reload`).
- `i18n/ui-v80-links.ts` (mới, key `linksV80`).
- Tests mới: `lib/reviewQueue.test.ts`, `lib/runAutoReload.test.ts`.

## Tiêu chí
1. Hàng chờ review: có (Changes pane). Badge ở thẻ session / rail dự án: CHƯA, vì cần Changes pane mở để biết; `unseenCounts` đã sẵn cho việc nối sau, không poll mới.
2. History → Tiếp tục: có. Không gửi prompt (resumeSession chỉ mở pane `--resume`).
3. Agent xong → Run reload: có, tắt mặc định. Flutter debug / custom có appId → hot reload; Android → chạy lại (như nút Run khi đang live, chỉ khi config đang chọn trùng session); release/profile bỏ qua; agent error/waiting không kích hoạt.
- Edge: không phải repo git → Changes báo lỗi như cũ, không có hàng chờ. Nhiều agent cùng dự án → mốc theo repo root, chữ ký đổi khi agent nào sửa tiếp; reload gộp qua debounce + khoảng cách tối thiểu. Run không chạy / pane khác → không làm gì. Session resume mất file transcript → pane mở ra, claude tự báo "No conversation found" (không chặn trước được vì không kiểm file). Thư mục dự án đã xoá: History không biết (khác kết quả tìm có `cwdExists`), pane sẽ báo lỗi khi spawn.
- Hạn chế: hàng chờ dùng chữ ký (đếm dòng) chứ không phải thời điểm sửa; sửa file mà số dòng thêm/xoá không đổi và kind không đổi thì không hiện lại là "chưa xem".

## Test
- `npm run typecheck -w @ccm/web`, `-w @ccm/collector`: sạch.
- vitest web (reviewQueue, runAutoReload, run.test, i18n, history): 35/35. Collector (history, monitor): 23/23.
- Chưa chạy build / e2e.

## Hot file cần thêm
- `apps/web/src/i18n/en.ts` + `vi.ts` (hoặc index.ts): import `linksV80 from './ui-v80-links'` (`export default { en, vi }`) rồi spread `...linksV80.en` / `...linksV80.vi` như `resources-v76`. Chưa nối thì UI hiện key.

## Index
- `.code_index/web.md`: `lib/reviewQueue.ts` (seen map per repo root, splitUnseen, unseenCounts) dùng bởi `ChangesPane.vue` nhóm "Chưa xem".
- `.code_index/web.md`: `lib/runAutoReload.ts` + `stores/run.ts` autoReload/watchAgents/fireAutoReload; `HistoryView.vue` nút Tiếp tục.
- `.code_index/protocol.md`: `SessionRecord.sessionId?` (collector monitor.recordOf → history.json).

## Changelog
- en: Changes remembers what you reviewed and lists unreviewed files first; History can continue an ended session; Run can reload when the agent finishes (off by default).
- vi: Changes nhớ file đã xem và đưa file chưa xem lên đầu; History có nút Tiếp tục cho session đã kết thúc; Run có thể tự reload khi agent xong (mặc định tắt).

## Commit đề xuất
✨ v80 WP-6: review queue in Changes, Continue from History, optional Run reload after the agent finishes
