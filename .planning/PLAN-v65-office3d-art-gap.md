# PLAN v65 — Office 3D: walk 8 frame trước/sau + trang phục mùa (2026-10-28)

**TẠM DỪNG** (chủ nhân 2026-10-28: "tạm dừng phát triển phần office"). Chưa gửi request Codex, chưa sửa code.

Chủ nhân: "3 (a) trước đi" (gap art 3D cần Codex, handoff 2026-10-27-1835 §3).

## Bối cảnh

- 3D chars (`apps/web/public/assets/iso3d/chars/`): `walk_down` / `walk_up` chỉ 4 frame (160 ms), `walk_right` 8 frame.
- Trang phục mùa (santa / witch / pumpkin / vampire) chỉ có ở Pixel (`habblaud art/character/render.ts` `drawCostume`:
  3 kiểu mũ + cổ áo/áo choàng vampire). 3D không có.
- Raw cache Codex (`assets-src/office-iso/.cache/raw3d/`, gitignored) không còn trên máy này → lấy ảnh tham chiếu từ
  atlas đã ship (`refs.py`), vá atlas theo từng hàng (`patch.py`) thay vì build lại từ raw.

## Bước

1. Walk 8 frame down / up (6 nhân vật × 2 = 12 request + retake). Spike Jin trước (2 request), duyệt gif rồi mới làm 5 người còn lại.
   - `prompts3d.json`: template `walk8-down`, `walk8-up` (ref turn + walk 4 frame cũ; frame 1/3/5/7 = copy 4 frame cũ).
   - `refs.py`: atlas → `.cache/raw3d/<id>-turn.<take>.png`, `<id>-walk-down/up.<take>.png` (nền magenta).
   - `patch.py <id>-<sheet> …`: cắt sheet mới, scale walk, thay hàng anim trong atlas, lưu webp @2x/@1x, sửa manifest, gif.
   - Renderer đọc frames/ms từ manifest → không cần sửa code.
2. Trang phục mùa 3D bằng overlay (không vẽ lại cả bộ nhân vật: 6 × 4 trang phục × 9 sheet ≈ 200 request).
   - Codex: 1 sheet mũ (santa / witch / pumpkin × down / right / up) + 1 sheet áo choàng vampire (down / right / up).
   - Manifest chars thêm vị trí đầu mỗi frame (`heads`), renderer vẽ mũ theo đầu, áo choàng sau thân.
   - Ngủ (`sleep_down`): bỏ mũ.

## Ngân sách

`gen.mjs` 3D budget 70 → 100 (đã dùng 65).
