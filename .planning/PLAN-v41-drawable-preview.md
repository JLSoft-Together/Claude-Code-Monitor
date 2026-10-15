# PLAN v41 — Drawable Preview (2026-10-15)

Yêu cầu chủ nhân (2026-10-15, qua coordinator): xem trước drawable XML trong khung file, dùng chung renderer với v32.

## Phạm vi
- File: `res/drawable*/`, `res/mipmap*/` (xml), `res/color*/` (color state list), và XML lẻ bất kỳ đâu có root là drawable (`shape`, `selector`, `layer-list`, `vector`, `animated-vector`, `animated-selector`, `ripple`, `inset`, `clip`, `scale`, `rotate`, `level-list`, `transition`, `bitmap`, `nine-patch`, `adaptive-icon`, `animation-list`, `color`). Root sniff chỉ đọc 4 KB đầu (`@ccm/shared` `drawableKind`). `res/layout*` / `res/values*` không bao giờ là drawable. Selector chỉ gồm item `android:color` (không drawable con) = color state list kể cả ngoài `res/color`.
- Render: daemon `drawable/render {requestId, path, xmlContent, device{width,height,density}, night, states[], colorList}` → `Drawable.createFromXml` / `ColorStateList.createFromXml` qua `BridgeXmlBlockParser` trên session hiện tại (resource + theme của project nếu model đã nạp, không thì framework). Ảnh qua `sdk.snapshot` của một `DrawableView` (nền windowBackground của session được gỡ tạm → PNG giữ trong suốt, trả lại sau vì session dùng chung với layout). Color list → swatches theo state (default, pressed, focused, selected, checked, activated, disabled), không PNG.
- Ref không giải được (`@color/x` khi chưa có model) → diagnostic từ layoutlib, không đoán giá trị.
- UI (`DrawablePreview.vue`, trong ô Design của FilePane, cùng Code | Split | Design): size 24/48/96/custom dp (render ở 480 dpi), chip state, sáng/tối, zoom fit (≤ ×8) / 100–800 %, nền caro bằng token `well` / `well-line`, swatch có viền accent cho state đang chọn, status icon + text, diagnostics.
- IPC `ccm:drawable-render {file, width, height (dp), density, night, states}` (gate explorer `resolveDir`, `.xml`, ≤ 1 MB, `drawableKind` lại ở main), `ccm:layout-warmup` nhận mọi `.xml`.

## Không làm
- PNG / 9-patch / webp trong `drawable*` (đã có image viewer), animation (vẽ frame đầu), chọn API level (layoutlib chỉ 1 API).

## Test
- Daemon `GoldenTest`: shape gradient + corners (góc trong suốt), vector, selector theo chip (màu tâm), color list swatches, `@color` thiếu → diagnostic.
- Desktop `test/drawable.test.ts` (detection, dp→px, swatches, IPC gate), `layout-daemon.int.test.ts` (drawable + color list với jar thật). Web `lib/drawablePreview.test.ts`. E2E stub `apps/desktop/e2e/drawable-preview.cjs` (chưa thêm vào `run.cjs`).
