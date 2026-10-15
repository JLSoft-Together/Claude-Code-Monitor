# v42 — File Editor (2026-10-15)

Chủ nhân duyệt: FilePane đang chỉ xem (shiki), thêm sửa file ngay trong app.

## Phạm vi
- Editor CodeMirror 6, bundle local (không mạng). Màu cú pháp theo token theme hiện tại (`--ccm-syn-*`, `.ccm-code`), font code từ Settings → Text (`lib/fonts.ts`). Undo/redo, tìm/thay (Ctrl+F / Ctrl+H, ⌘ trên mac), tự thụt lề, bracket matching.
- Mặc định vẫn mở chế độ xem như hiện tại. Nút **Edit** trên toolbar FilePane (phím `E` khi pane focus, không khi đang gõ) chuyển sang sửa; nút Done về chế độ xem: chưa lưu thì giữ buffer, chỉ đổi mode (xem hiện nội dung buffer, vẫn có ●).
- Lưu: Ctrl+S / ⌘S → IPC ghi file, chỉ trong thư mục đã được phép (cùng gate với Explorer `previewGate.resolveDir`), ghi atomic (temp + rename, giữ EOL và BOM gốc, encoding UTF-8; file không phải UTF-8 hợp lệ hoặc binary → không cho sửa, nói rõ lý do).
- Dấu ● trên tab + header khi dirty. Đóng tab / pane / project / app khi còn dirty → hỏi (Lưu / Bỏ / Huỷ); confirmQuit của desktop tính cả editor dirty.
- File đổi trên đĩa (watcher sẵn có của FilePane / Explorer): chưa sửa → tự tải lại, giữ vị trí cuộn; đang dirty → thanh báo "File đã đổi trên đĩa" với Tải lại (bỏ thay đổi) / Giữ bản của tôi / Xem diff (mở diff buffer ↔ disk bằng DiffView sẵn có nếu rẻ).
- Preview live khi gõ: Layout XML + Drawable (v32 / v41) render từ nội dung buffer (debounce ~300 ms), không cần lưu — daemon nhận `text` thay cho đọc file (giữ path để resolve resource). Flutter Widget Preview: vẫn theo lưu file (hot reload khi lưu, quyết định v40).
- File lớn: > 2 MB hoặc > 50k dòng → chỉ xem (nói rõ lý do).
- i18n en/vi, theme tokens, status icon + text, không tràn ngang (editor tự cuộn ngang bên trong).

## Ngoài phạm vi
LSP / autocomplete / chẩn đoán, format code, multi-cursor nâng cao (giữ mặc định của CodeMirror), sửa file ngoài thư mục được phép, sửa trong Diff/Changes pane, binary / hex.

## An toàn
- Ghi file chỉ khi người dùng bấm lưu; không auto-save.
- Không ghi qua symlink ra ngoài thư mục được phép (resolve realpath trước khi ghi).
- Log không chứa nội dung file.

## Test
- Unit: IPC ghi (gate, atomic, EOL/BOM, symlink ngoài root, file lớn), store dirty / conflict, phím tắt không đụng chord workspace (`lib/workspaceKeys.ts`, `preview/keys.ts`).
- E2E `apps/desktop/e2e/file-editor.cjs`: mở file → Edit → gõ → ● → Ctrl+S → nội dung trên đĩa đổi; đổi file ngoài khi đang dirty → thanh conflict; layout XML gõ → preview đổi không cần lưu; đóng tab dirty → hỏi.
- Thêm vào `e2e/run.cjs`.

## Trạng thái / lệch kế hoạch (2026-10-15)

Đã làm hết phạm vi. Ghi chú:
- **Compare** dùng `@codemirror/merge` `unifiedMergeView` ngay trong editor (bản đang sửa ↔ bản trên đĩa, Reject = lấy lại đoạn trên đĩa) thay vì DiffView: DiffView cần `DiffFile` từ `git diff`, dựng diff buffer↔disk trong trang tốn hơn.
- **Phím**: trong editor Alt+↑/↓ = chuyển dòng (CodeMirror/VS Code), không đổi pane; Alt+←/→ vẫn chuyển pane. Các chord workspace khác (Ctrl+Shift+W/T/P/E/O, Ctrl+Tab, Ctrl+Alt+số, Alt+Shift+D/±; mac ⌘D/⌘W/⌘P/⌘1–9…) vẫn thắng vì bắt ở capture trước CodeMirror (⌘D trên mac nên "chọn lần xuất hiện kế tiếp" của CodeMirror không dùng được). Ctrl+H trên Windows mở thay thế; ⌘⌥F trên mac.
- **EOL**: giữ kiểu xuống dòng chiếm đa số của file trên đĩa; file không có dòng mới → LF. Giữ BOM UTF-8.
- **Giới hạn ghi** 4 MB (dư so với 2 MB chỉ-xem để file lớn lên khi sửa vẫn lưu được). Chỉ ghi file đã tồn tại.
- **Thoát app**: hộp thoại native Lưu / Không lưu / Huỷ (trước hộp thoại terminal/run); Lưu thất bại → huỷ thoát. Reload trang (Ctrl+R) không hỏi (beforeunload trong Electron chặn thoát mà không có hộp thoại).
- **Đổi tên file đang sửa** (Explorer rename): giữ buffer, theo đường dẫn mới.
- **Preview live**: Layout + Drawable render từ `text` của buffer (IPC thêm `text` tuỳ chọn ≤ 1 MB; path vẫn qua gate, resource/model theo path); không cần sửa daemon (daemon vốn nhận nội dung XML từ main).
- **Thêm**: XML layout "lẻ" ở bất kỳ đâu (không cần `res/layout*/`) — sniff phần tử gốc 4 KB đầu (`@ccm/shared` `isLooseLayoutXml`, cần khai báo namespace Android) → Layout Preview; ví dụ `bg_native_ad_cta.xml` ở gốc repo.
- E2E `e2e/file-editor.cjs` + `drawable-preview.cjs` đã thêm vào `run.cjs` (chưa chạy).
