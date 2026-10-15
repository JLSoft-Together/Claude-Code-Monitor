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

## Out of scope
Sửa trực tiếp bên phải, `<<`, ignore chunk, soft wrap trong split.

## Tests
`apps/web/src/lib/splitDiff.test.ts`, `diffOpts.test.ts`, `diffBlocks.test.ts` (modes), `reviewTools.test.ts`; `apps/desktop/test/changes.test.ts` (args); E2E `apps/desktop/e2e/split-diff.cjs` (có ảnh well sáng xcode-light), `diff.cjs` (split revert qua gutter).

Plan gốc: `docs/superpowers/plans/2026-10-15-jetbrains-split-diff.md`. Không bump version theo plan.
