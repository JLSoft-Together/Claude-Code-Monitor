# HANDOFF — Orrery / Telegram 7 gợi ý (2026-11-05 04:00)

Đọc file này là làm tiếp được. Trả lời tiếng Việt, gọi user là "chủ nhân", xưng "con". File này thay `HANDOFF-2026-11-05-0143.md`.
Nhật ký: `.planning/PROGRESS-2026-11-05-telegram-7.md` (đợt này), `.planning/PROGRESS-2026-11-05-telegram.md` (đợt trước cùng ngày).

## 1. Đang ở đâu
- `F:/work/web/Claude-Code-Monitor`, branch `master`, **đã commit hết** (HEAD `1842864`), **chưa push** (chủ nhân chỉ bảo commit).
  Không phải của phiên này, đừng đụng: `.planning/HANDOFF-2026-11-01-v76.md` (M), `bg_native_ad_cta.xml`, `git-gui.bat`, `spikes/`, `docs/qa/v79|v80/`, `apps/*/.vitest/`.
- Kiểm cuối (chạy thật): typecheck sạch; desktop telegram 110/110; web 1700/1700; collector 398 pass. Cả bộ desktop lần trước 1217/1218 — 1 lỗi chập chờn `layout-model-service` (chạy riêng pass).
- **Đang chạy**: bản dev QA (task nền) cổng 4319, CDP 9333, dữ liệu `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/{ud,data}`, receiving bật. Script CDP `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/qa.cjs` (`eval`, `shot`, `targets`; bridge `window.ccmDesktop`; mở Settings: pinia `ui.settingsPage='telegram'; ui.settingsOpen=true`).
- **Hook toàn cục trỏ bản dev**: `~/.claude/settings.json` hook-bridge = `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/data/bin/hook-bridge.mjs`; tắt bản dev xong PHẢI trả về `C:/Users/dauph/AppData/Local/ccm/bin/hook-bridge.mjs`.

## 2. Đã làm hôm nay (sau HANDOFF-0143) — chi tiết docs §11an-e/f/g, `.code_index/_meta.md` 2026-11-05
- Đợt 1 (main tự làm): menu tab "Kết nối Telegram…", reply theo Claude session qua restart, poll không chờ việc nặng + album, % file lớn, icon ✈ rail/tab, nút 🔗/📁 nối topic từ Telegram, pin theo topic session, GramJS tách `gramjs.cjs`.
- Đợt 2 (manager-work-agent, WP-A..E trong `.planning/wp/tg2/`): lệnh lúc app tắt (hỏi ▶️/🗑, `lastUpdate`), 409 dừng sau 3 lần + banner, menu "/" + `/lệnh` trần, `tail`, câu hỏi AskUserQuestion thành nút (phím số), thành viên team (read/full), gom báo xong.

## 3. Việc tiếp
1. QA tay với chủ nhân trên bản dev, ghi `docs/qa/telegram-2026-11-04/RESULT.md` (#26+):
   lệnh lúc app tắt (tắt bản dev, nhắn `@bot status`, mở lại → tin hỏi); menu "/" trong group; `@bot tail`; Claude hỏi AskUserQuestion → bấm nút (**phím số chưa xác minh trên TUI thật**, có thể cần Enter → sửa `useTelegramInbound` `keyOf`); thêm thành viên bằng tài khoản khác; bật Gom báo xong; album; reply sau restart; % file lớn (`F:/work/android/WeJoy/last-war/test-60mb.bin`); banner 409 (chạy 2 bản cùng token).
2. Tắt bản dev: PID `powershell "(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | ? { $_.CommandLine -like '*orrery-qa-tg*' -and $_.CommandLine -notlike '*--type=*' }).ProcessId"` → `taskkill //T //F //PID <pid>`; trả hook (mục 1).
3. Push khi chủ nhân bảo.
Chờ chủ nhân: (a) push — mặc định chưa; (b) xoá `test-60mb.bin` — mặc định giữ; (c) phân quyền thành viên (DECISIONS 2026-11-05) — mặc định như đã ghi.

## 4. Ràng buộc / quirk
- Commit từng gói được phép trong phiên này; không trailer. Không chạy bản dev ở 4317.
- Bot không liệt kê được topic (đừng đề xuất lại). Gợi ý đã gạt: chuyển giọng nói thành chữ (tốn API / nặng).
- **Shell này nuốt `\`**: `python -`/`printf`/heredoc biến `\b \d \n \u` thành ký tự khác (đã gây 1 bug `screen` regex, đã sửa `d925acd`). Sửa code bằng Edit/Write; script thì Write ra file .py rồi chạy, dùng `chr(92)`. Sau mỗi WP quét ký tự điều khiển + bidi.
- `grep` bị rewrite sang `rg` (ngoặc phải escape) → dùng Grep tool. `git diff` bị rtk lọc → `rtk proxy git --no-pager diff`.

## 5. File cần đọc lại
1. `.planning/PROGRESS-2026-11-05-telegram-7.md` 2. `docs/claude-code-integration.md` §11an-e/f/g 3. `.planning/DECISIONS.md` (dòng 2026-11-05) 4. `docs/qa/telegram-2026-11-04/RESULT.md`

## Cập nhật sau handoff
- Bản dev QA đã TẮT, hook toàn cục đã trả về bản cài. Dữ liệu dev còn ở `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/` (dựng lại bản dev theo mục 1 nếu QA tiếp). Đã push lên origin/master.
