# v33 — Split diff kiểu Android Studio (JetBrains)

Goal: thay split diff kiểu GitHub (dòng đệm) bằng kiểu JetBrains: mỗi bên chỉ giữ dòng thật, gutter cong nối các đoạn đổi, hai bên cuộn đồng bộ phi tuyến, tô từ / ký tự trong khối Modified.

## Pieces
- Desktop: `diffArgs` thêm `--histogram` (viewer, gutter, Log diff); numstat của status và `diff-tree --numstat` trong `preview/log.ts` cũng `--histogram` để số +/− khớp diff hiển thị (audit 2026-10-15).
- `lib/splitDiff.ts`: `splitModel` (rows mỗi bên + `Fragment` nửa mở), `mapRow`, `connectorPath`, `visibleFragments`, `midRow`, `scrollTopFor`. Bỏ `sideBySide`.
- `composables/useDiffDecor.ts`: token shiki + word marks dùng chung inline / split.
- `DiffOpts.highlight` lines / words / chars (đọc `words:false` cũ → lines); `wordDiff(…, 'chars')`.
- `SplitDiff.vue`: hai pane, gutter SVG vẽ lại theo rAF, chỉ fragment đang thấy, `»` revert ở đầu fragment (chỉ Changes), row height đo bằng probe (zoom an toàn), cờ `syncing` xóa ở frame sau.
- `DiffView` = inline + uỷ quyền split (`html` trả '' khi split, không tokenize hai lần); host đổi scroller sang `overflow-hidden` khi split; Log truyền `sides` `<hash>^` / `<hash>`.

## Rulings
1. Engine diff vẫn là git (v29), không thêm package `diff`.
2. Read-only: không sửa trực tiếp, không `<<`, không "ignore chunk"; `»` = revert từng block hiện có (Changes).
3. Xám cho deleted chỉ ở split; inline giữ đỏ/xanh; gutter Explorer / file viewer không đổi.
4. Giữ collapse (gập cả hai bên), F7/Shift+F7, whitespace; thêm Highlight "Ký tự".
5. Row cao cố định 1.5em, không soft wrap; mỗi pane cuộn ngang trong nó, bên kia theo.

Well không phải lúc nào cũng tối (xcode / solarized / github / islands light): mọi màu split là `color-mix` của token well (`diff-mod-well`, `diff-add-well`, `well-ink`, `well`, `well-line`, `focus`), deleted xám = 60% `well-ink`; loại thay đổi còn có hình gutter / vạch mảnh / tooltip số dòng (`workspace.gutter.kind.*`).

## Bổ sung theo plan gốc Git Diff Viewer (gaps 2026-10-15)
- Highlight đủ 5 mức `lines / words / split / chars / none` (`HIGHLIGHTS`). `split` = "Split changes": `splitModified` (`lib/diffBlocks.ts`, qua `viewBlocks`) tách mỗi khối Modified thành Deleted + Inserted (F7 / revert từng phần), vẫn tô từ giữa hai phần; run git không in dạng "toàn `-` rồi toàn `+`" giữ Modified. `none` = không tô nền dòng, không tô từ; vẫn còn cột số dòng tô màu, dấu +/− (inline), gutter / connector (split).
- Whitespace thêm `imports` — nhãn "Ignore whitespace, empty lines and imports" (không gọi "formatting" vì không bỏ qua đổi xuống dòng / reflow): git chạy `-w --ignore-blank-lines` (như `all-blank`), rồi `lib/diffImports.ts` `hideImportChanges` bỏ các khối chỉ gồm dòng import (TS/JS/Vue/Svelte, Kotlin, Java, Dart, Python; tên trong danh sách import nhiều dòng tính là import khi khối nằm trong `import {` / `from x import (`), cắt hunk quanh khối nên hàng gap "⋯" đánh dấu chỗ ẩn + dòng báo `[data-diff-imports-hidden]` đếm số khối. Không dùng `git -I<regex>`: với `-U1000000` mọi thay đổi nằm giữa một hunk nên git vẫn in. File mới / xoá và ngôn ngữ khác giữ nguyên. Revert bị chặn như mọi mức whitespace ≠ none.
- `DiffOpts.align` (mặc định tắt, giữ kiểu JetBrains không dòng đệm) / `sync` (mặc định bật), lưu cùng `ccm.workspace.diffOpts`, nhóm "Side-by-side" trong menu (`[data-diff-toggle]`, disabled ở inline). Align: `splitModel({ align })` thêm hàng `pad` dưới bên ngắn hơn của mỗi fragment.
- F4 (`DiffView.sourceLine` / `SplitDiff.sourceLine`): caret / vùng chọn trong diff → dòng đó; không có thì change hiện tại nếu đang thấy; không nữa thì dòng đầu vùng nhìn thấy của bên có caret (split) / của diff (inline). F7 xoá caret cũ trong diff để không thắng change vừa nhảy tới. Dòng ở bên trái map sang số dòng mới (hàng không đổi mang `data-new` cả hai bên; dòng xoá → dòng sau chỗ xoá).
- Log split: bên trái commit gốc (không parent) ghi "(none)" (`workspace.diff.side.none`), không còn `<hash>^` không tồn tại. Header `[data-split-head=left|right]`.

## Deviations
- **Ctrl+Shift+Tab đổi bên**: chỉ macOS (⌃⇧Tab). Windows / Linux phím này là "tab trước" của workspace (v18, Windows Terminal), `WorkspaceView` bắt ở capture phase trước pane → giữ v18; ở đó đổi bên bằng Tab / Shift+Tab (thứ tự focus trái → nút » → phải) hoặc lệnh "Switch side" trong popup Ctrl+Shift+D.
- **Ctrl+Shift+D** (⌃⇧D trên macOS, vì ⌘⇧D là split pane v18): không trùng v18 (Windows split = Alt+Shift+D) → mở menu View options, có nhóm Commands (`[data-diff-cmd]`: change trước/kế, file trước/kế, F4, đổi bên) thay vì popup riêng. Chỉ ở Changes pane; Log diff không có menu nên chưa có.

## Out of scope
Sửa trực tiếp bên phải, `<<`, ignore chunk, soft wrap trong split, bỏ qua đổi xuống dòng (formatting thật).

## Tests
`apps/web/src/lib/splitDiff.test.ts`, `diffOpts.test.ts`, `diffBlocks.test.ts` (modes), `diffImports.test.ts` (imports, split changes, align), `reviewTools.test.ts`; `apps/desktop/test/changes.test.ts` (args); E2E `apps/desktop/e2e/split-diff.cjs` (có ảnh well sáng xcode-light), `diff.cjs` (split revert qua gutter).

Plan gốc: `docs/superpowers/plans/2026-10-15-jetbrains-split-diff.md`. Không bump version theo plan.
