# Plan gaps — rà soát sau commit f9aacf5 (2026-10-15)

So từng step của plan chi tiết (`docs/superpowers/plans/2026-10-15-*.md`, plan gốc ở thư mục gốc repo) với code. Chỉ liệt kê việc chưa làm / làm khác chưa ghi; deviation đã ghi xem trong từng `.planning/PLAN-v*.md`.

## Đã sửa ngay
- [x] v38: rail "Mở dự án…" (+ icon ở cột thu gọn); lăn chuột dọc cuộn ngang dải tab.
- [x] v33: SplitDiff thiếu class `ccm-code` → split không có màu cú pháp (E2E `split-diff.cjs` thêm check màu).
- [x] v33 ruling 1: collector `git diff --shortstat` thêm `--histogram`.

## v38 multi-project
- [x] Mission Control không tự đóng khi mở QuickOpen / Settings (Task 11 Step 5).
- [x] Project đã nhớ (chưa có pane) không gộp theo repo, không có tag `folder` (host từ chối `ccm:project-root` khi chưa có pane) (Task 3).
- [x] Tooltip chip "N cần bạn" vẫn là "Go to the next terminal…" trong khi click mở danh sách.
- [x] Capsule project trên strip luôn màu waiting, không đổi sang error khi có failed.
- [x] AttentionPopover không lật lên khi sát mép dưới (Task 12 Step 5).
- [x] Mission: snapshot không memo theo tab; Run pane luôn "Chưa có output".
- [x] E2E: pane exited → empty text; session `waiting` thật qua `terminals.upsert`. `STATE_RANK` không dùng.
- [x] Ghi deviation: strip theo thứ tự mở tab (bỏ `railTabOrder`), avatar 36 px, grid Mission, key i18n đổi.

## v33 / v34 diff
- [x] v34 ruling 4 bị đổi: ← / → cuộn ngang khi vùng diff tràn (`inSidewaysScroller`) — cần chốt hoặc ghi vào PLAN-v34. → chốt: ← / → luôn đổi file, Shift+← / → cuộn ngang (PLAN-v34).
- [x] Plan gốc Git Diff Viewer chưa làm, chưa ghi out-of-scope: highlight "Split changes" / "None", "Ignore imports and formatting", công tắc Align changes / Sync scrolling, Ctrl+Shift+Tab đổi bên, F4 giữ vị trí caret. → làm hết; "imports" không gồm reflow, Ctrl+Shift+Tab chỉ macOS, Ctrl+Shift+D = menu View options + Commands (PLAN-v33 Deviations).
- [x] E2E: mức Characters; split trong Log. → `split-diff.cjs` (chars/split/none, align, sync, Ctrl+Shift+D, imports, Log `<hash>^`/`<hash>` + commit gốc "(none)"), `diff.cjs` (← / → trên diff tràn ngang). Chưa chạy.

## v36 log branches
- [x] Docs vẫn ghi Log "read-only" (`docs/claude-code-integration.md` §11s, `CLAUDE.md`, `PLAN-v30`).
- [x] `selectedRef` không reset khi ẩn cây / đổi repo → toolbar có thể nhắm ref cũ.
- [x] Favorite main/master là nhánh hiện tại → icon Tag che sao.
- [x] E2E favorite chỉ kiểm storage, Compare chỉ kiểm strip hiện.
- [x] Ghi vào PLAN-v36 các thay đổi lúc review (push `refs/heads/`, update lỗi → `failed`, Compare dùng tên nhánh, Clear khôi phục filter, reveal xoá filter, busy `delete`).
- [x] v30 follow-up: cây ref Home / End, → con đầu, ← về cha.
- [x] main.ts: 6 native confirm gom vào `confirmBox`.

## v35 / v37 / v39
- [x] v35: xoá lỗi ENOTEMPTY/EEXIST hiện câu "already exists".
- [x] v39: kéo sidebar làm Split của XML layout lật stacked ↔ side-by-side ở 720 px (audit nêu, chưa xử lý / chưa ghi).
- [x] v37: summary PLAN-v37 cũ (E2E đã PASS, hàng đợi chung, erase vòng kín); version Claude Code ghi lệch 2.1.294 / 2.1.299.

## v40 Flutter Widget Preview
- [x] PLAN-v40 Status cũ: đã chạy thật trên emulator (fwp-live) + E2E 18/18.
- [x] Panel chọn device riêng (`ccm.fwp.device`), không theo device của Run pane như quyết định.
- [x] Sửa `pubspec.yaml` khi đang preview: không pub get / restart.
- [x] Lỗi runtime widget chỉ ở log, panel không báo; entry lỗi làm cả host compile lỗi.

## v31 Run (plan gốc)
- [x] Badge Android/Flutter trên Explorer (`RunProjectMark` + `useRunMarks`, "?" khi không chạy được / đoán).
- [x] Watcher detect lại khi `settings.gradle*` / `pubspec*` / manifest đổi; banner pub get tự hiện (`run/watch.ts`, `ccm:run-hold`).
- [x] Lọc device theo platform của project (không có `web/` → ẩn Chrome).
- [x] Tự `flutter pub get` trước Run; toolchain check / `flutter doctor` (`RunToolchainDialog`, chỉ khi bấm).
- [x] "Edit configuration templates…"; tự import config lần mở đầu (1 lần / project, nhớ trong app data).
- [x] Custom config có `--machine` → hot reload / restart (dùng lại runner Flutter).
- [x] Hiện framework / "guessed" / lý do không Run được (empty state, tooltip RunBar, badge).
- [x] Khoá menu config/device khi đang build; Run khi chưa có device → mở menu thiết bị (có Launch emulator).
- [x] Thanh progress (Android 3 bước, Flutter indeterminate + text `app.progress`); tô dòng lỗi trong log build.
- [x] Flutter SDK riêng từng project (ngoài FVM), dùng chung cho Flutter preview.
- [x] Log run + nội dung "Send to agent" qua `createLogMasker` (biến thể của `maskLog`).
- [x] Ghi deviation (PLAN-v31): daemon/adb dừng khi không còn pane + không phiên nào chạy; device mất → stopped + thông báo; flavor tự tạo config; Gradle args theo config.

## v32 Layout Preview (plan gốc)
- [x] Spawn sẵn / warm-up daemon (lần đầu chờ 3–4 s). — `ccm:layout-warmup` khi mở file XML (cả chế độ Code) + model cache, không Gradle.
- [x] Nhắc build lại khi .kt / .java đổi. — watch `<module>/src` khi model đang nạp, note "Code changed…", xoá sau refresh.
- [x] Chọn density / API level riêng; zoom > 100 %. — density ldpi…xxxhdpi + custom; API chỉ đọc (layoutlib 1 API = 36); zoom tới 400 %.
- [x] Golden image test, integration test daemon thật, CI chạy test + ma trận AGP. — `GoldenTest` (win), `layout-daemon.int.test.ts`, `.github/workflows/test.yml`; ma trận AGP không làm được trong CI (ghi PLAN-v32).
- [x] Preview hiện cho mọi `res/layout*/x.xml` kể cả khi không nhận ra project Android (ghi deviation). — PLAN-v32 § Gap follow-up.
- [x] (thêm, chủ nhân duyệt) Drawable Preview v41: `res/drawable*|mipmap*|color*` + XML lẻ theo root, daemon `drawable/render` — `.planning/PLAN-v41-drawable-preview.md`.
