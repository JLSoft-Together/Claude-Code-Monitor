# Audit 8 plan mới (HoiCham, commit c170b97 · d776d99 · fcb2dff) vs code sau a630dde — 2026-10-15

a630dde = Run pane (v31) + XML Layout Preview (v32). Kết luận chung: không plan nào vỡ; code các plan đụng phần lớn chưa đổi, chỉ lệch số dòng (1–50). Vấn đề thật là các chỗ plan chưa biết tới pane `run` / RunBadge / Layout Preview, vài giả định sai có từ trước, và đụng số version.

## Thứ tự triển khai đề xuất
1. diff-arrow-files → jetbrains-split-diff → log-branches-toolbar (cùng đụng `LogPane.vue`, `ChangesPane.vue`; plan sau neo theo text, không theo số dòng).
2. explorer-context-menu (song song được với nhóm 1; chỉ đụng `preview/ipc.ts` CHANNELS — explorer thêm ở dòng cuối, log-branches thêm vào dòng `ccm:log-*`).
3. sidebar-width → multi-project (cùng đụng aside / `WorkspaceSidebar`; multi-project to nhất, làm sau).
4. attachments-removal (độc lập).
5. Flutter Widget Preview: cần file audit `.planning/PLAN-vNN-flutter-widget-preview.md` + spike GĐ0 trước.
- Version app: mọi plan "bump một minor trên master" → conflict mỗi lần; multi-project hard-code 2.6.0.
- `e2e/run.cjs:8` bị 4 plan cùng append; `.code_index/*`, `_meta.md` mọi plan cùng thêm.

## Theo plan

### diff-arrow-files
- E2E bước collapse thư mục sẽ fail: `onTreeKey` dùng `cursor`, không dùng focus → bấm ← hai lần.
- ← / → trên toolbar / radiogroup (Inline|Split) đang bị bắt thành đổi file → guard `[role=toolbar],[role=radiogroup]`.
- LogPane guard chỉ loại `[role=tree]` → thêm `[role=toolbar],[role=menu],[role=dialog]` (vì log-branches thêm toolbar + menu).

### jetbrains-split-diff
- "Diff well luôn tối" sai với 4 theme sáng (xcode-light, solarized-light, github-light, islands-light) → màu deleted xám / word mark chưa được kiểm trên nền sáng; cần screenshot kiểm.
- `--histogram` thiếu ở `preview/log.ts:173` (`diff-tree --numstat`) → số +/− ở Log lệch với diff hiển thị.
- DiffView vẫn build HTML inline khi ở split → `if (layout === 'split') return ''`.

### log-branches-toolbar
- Anchor `main.ts:597-620` lệch ~50 dòng (nay `registerPreviewIpc` ở 649-672).
- `execGit` kill bằng `child.kill()` → `git fetch` trên Windows để lại `git-remote-https` → nên dùng `killTree`; spawn error đang báo `timeout`.
- Confirm native lặp 6 lần trong main.ts → có thể gom `nativeConfirm` (tuỳ chọn).

### explorer-context-menu
- `explorerRoot` nay là `PreviewIpc.resolveDir`, Run + Layout dùng chung → không đổi/thu hẹp nó.
- Windows: rename/trash thư mục đang bị giữ handle (watcher Layout, `flutter run`/gradle cwd, build/) → EPERM/EBUSY → thêm lỗi `busy` riêng.
- Rename thư mục: pane `run`/`changes`/`log` có `cwd` bên trong bị stale → remap cwd.
- Rename/trash dưới `.agent-monitor/run/` làm config biến mất / cwd hỏng.
- Cơ hội: mục "Run…" trong menu (pubspec / build.gradle / settings.gradle / thư mục).

### sidebar-width
- `SIDE_MIN = 200` quá hẹp khi header có RunBadge ("Đang build"/"Run failed") → RunBadge thu gọn icon khi hẹp, hoặc nâng min ~232.
- Kéo sidebar làm FilePane Split của layout XML lật stacked/side-by-side giữa chừng (720 px) — chỉ là giật UI.

### multi-project (v31 của HoiCham)
- Viết lại `WorkspaceSidebar` sẽ làm mất RunBadge ở header và mục "Run…" (`@run` → `openRun`) → giữ lại.
- Row pane `run` hiện state "Ready" dù đang build/fail; lỗi run không vào "needs you" → cần `runOf(pane)` map Building/Running → working, failed → failed.
- Row / Mission Control dùng `PresetIcon` → pane run/file/log hiện icon shell → dùng `PaneIcon`.
- `cluster.root = main checkout` → worktree gọi Run/scripts/layouts bằng thư mục chưa được allow → dùng `checkout.path`.
- Close project đóng Run pane không hỏi, run vẫn chạy nền.
- Preview slot Explorer dùng chung mọi tab → với Spaces, preview project B thay pane trong tab project A.
- `captureLayout` chọn tab theo pane chính, không theo `Tab.project`.
- Sai từ trước: Alt+↑/↓ trong sidebar bị `onGlobalKey` (capture) nuốt khi tab chia pane; test dùng `{ kind: 'mission' }` nhưng union dùng `t`; plan tưởng aside/tablist nằm trong `WorkspaceSidebar` (thật ra ở `WorkspaceView`); i18n nên dùng `export default { en, vi }`; `rail.cjs` chưa thêm vào `run.cjs`.
- Xung đột với sidebar-width: aside đang `v-if sidebarOpen`, còn multi-project cần aside 52 px khi đóng (RailColumn).

### attachments-removal
- "Send to agent" (Run) paste `@lib/main.dart:12:5 <msg>` → bị nhận là attachment `main.dart:12:5`; × chỉ xoá token, để lại message; dạng có ngoặc kép thì không xoá được.
- `insertInto` paste thẳng, ngoài hàng đợi xoá mới → có thể paste giữa lúc đang gõ ← / Backspace → nên chờ hàng đợi rảnh.
- i18n vi dùng "xóa" (chuỗi cũ), plan viết "xoá".

### Flutter Widget Preview (file ở gốc repo)
- Viết mới `FlutterSession` trùng `run/flutter/runner.ts` → tách client machine-protocol dùng chung; SDK qua `findFlutterSdk` (FVM, trust gate `fvm-local-unverified`), detect qua `detectFlutter`.
- Không chạy qua `RunManager` (sẽ hiện trong Run pane, RunBadge, confirmQuit) → service riêng, vòng đời như `LayoutDaemon`.
- UI: mode Design/Split cho `lib/**/*.dart` trong FilePane + `<webview>` partition preview; `PreviewServer.urlFor` không serve được URL live.
- "Hot reload khi lưu" trái quyết định v31 (reload chỉ bấm tay) → chỉ áp cho preview host.
- Mở file .dart sẽ build + chạy code project → cần hỏi theo project, không tự chạy (như v32 không chạy Gradle khi mở).
- Mạng: pub get, `precache --web`, CanvasKit + font từ gstatic → trái luật "không tải font từ mạng" / local-only → `pub get --offline`, consent, `--no-web-resources-cdn`, webview chỉ localhost.
- Ghi file vào project (`.idea-preview/`, `preview_overrides/`) → đặt host ở `<dataDir>` hoặc `.dart_tool`, override ở `.agent-monitor/preview/`, đổi `ext.idea.*` → `ext.ccm.*`.
- Dart indexer cần build/CI/packaging riêng như `apps/layout-daemon`.

## Đụng số version
v31 / v32 đã dùng cho Run / Layout Preview (tên file plan, `i18n/run-v31.ts`, `i18n/layout-v32.ts`, `.code_index`). Plan HoiCham: multi-project = v31, sidebar-width = v32 (trùng), split-diff v33, diff-arrow v34, explorer v35, log-branches v36, attachments v37.

## Quyết định của chủ nhân (2026-10-15)
- Version: giữ v31/v32 cho Run/Layout. Plan HoiCham: split-diff v33, diff-arrow v34, explorer-menu v35, log-branches v36, attachments v37, multi-project **v38** (đổi tên `.planning/PLAN-v31-multi-project.md` → `PLAN-v38-multi-project.md`), sidebar-width **v39**, Flutter Widget Preview **v40**.
- App version: không bump theo từng plan; bump một lần khi xong cả đợt (2.5.0 → 2.6.0).
- Multi-project: run fail = "needs you" (vào danh sách attention); Close project khi còn run đang chạy → hỏi xác nhận, đồng ý thì stop run rồi đóng.
- Attachments: mention có đuôi `:dòng:cột` (do "Send to agent" tạo) không đưa vào tray.
- Flutter Widget Preview: chạy trên mobile (Android/iOS, device đang chọn ở Run pane), KHÔNG web. App sinh host `.dart_tool/ccm_preview/main.dart`, `flutter run --machine -t <host> -d <device>`; panel trong app chỉ là danh sách widget, chọn widget → máy chuyển widget qua service extension (`ext.ccm.*`) không build lại, lưu file → hot reload (chỉ preview host). Danh sách widget chỉ từ hàm `@Preview` (quét, không Dart indexer). Không tự chạy khi mở file. Dùng lại `src/run/flutter/*` (SDK/FVM, runner machine protocol, devices), service riêng ngoài `RunManager`.
- Các điều chỉnh khác trong audit này áp dụng mặc định (không cần hỏi lại).
