## WP-2: Monitor gọn (cột Session + Agent Map)
- Mục tiêu:
  1. Bỏ banner WaitingQueue phía trên khi cột Session đang mở. Khi cột đóng: 1 dòng mỏng (h ≤ 28px) "Cần chủ nhân · N" + session chờ lâu
     nhất, bấm mở cột. CompactView vẫn dùng WaitingQueue như cũ (không đổi).
  2. Cột Session chia nhóm theo việc: "Cần chủ nhân · N" → "Đang chạy · N" → "Rảnh · N" (→ "Đã đóng" nếu đang hiện). Nhóm đầu nền
     vàng nhạt bằng token (vd `bg-st-waiting/10` hay token tương đương có sẵn; xem COLOR-SYSTEM) = điểm nhấn duy nhất của màn. Sắp xếp
     hiện có (Hoạt động gần nhất…) áp trong từng nhóm.
  3. Thẻ session 2–3 dòng: (a) chấm/StatusIcon + tên + thời gian; (b) việc đang chờ hoặc tool đang chạy (vd "Cần duyệt: Bash npm test",
     dùng key permissionTool có sẵn) hoặc dự án · số subagent; (c) thanh subagent 3 đoạn xong/chạy/lỗi (role=img + aria-label đọc số) +
     token nếu có. Trạng thái chỉ hiện 1 lần (bỏ pill trạng thái lặp với dòng "Cần duyệt"). Viền trái màu bỏ.
     Chuyển vào menu chuột phải + nút ⋯ hiện khi hover/focus thẻ: Nhắc sau 15/60 phút, RAM/CPU (xem trong menu hoặc tooltip), mở thư
     mục, mở editor, và các nút khác đang nằm trên thẻ. Bấm thẻ hành vi như cũ.
  4. Trên danh sách: chip dự án gộp thành 1 menu lọc "Tất cả dự án ▾" (giữ số đang chờ trong menu); hộp gợi ý Yêu thích chỉ hiện khi chưa
     có favorite VÀ có nút tắt (nhớ localStorage `ccm.favHintDismissed`, try/catch); "Thêm" thành nút + nhỏ ở header Yêu thích.
  5. Agent Map: viền node trung tính (`border-line`), màu chỉ ở StatusIcon/chấm; node chờ chủ nhân giữ vòng nhấn (ring token waiting);
     subagent lỗi/chạy không tô viền màu. Toolbar trên chỉ còn Sơ đồ/Văn phòng + bộ lọc ẩn (Đang ẩn N); zoom +/−/fit/F/grid dời xuống
     cụm dọc góc dưới phải canvas. Không đổi logic layout/incremental update.
- Phạm vi file: components/MonitorView.vue, SessionList.vue, SessionCard.vue, SessionCardHeader.vue, SessionCardSignals.vue,
  SessionSummary.vue, SessionTabs.vue, WaitingQueue.vue (chỉ thêm biến thể mỏng nếu cần, CompactView không đổi), AgentMap.vue và các
  component map/node nó dùng, i18n/ui-v79-monitor.ts (mới), e2e/unit bị đổi selector. Cấm: en.ts / vi.ts / index.ts, stores/ui.ts,
  stores/settings.ts, workspace/**, SettingsMenu, AppHeader.
  Cần state mới trong store → dùng ref cục bộ / localStorage trong component, hoặc ghi vào "Hot file cần thêm".
- Phụ thuộc: không | Song song: WP-1, WP-3 | Worktree: không
- Skill: frontend-design, ui-ux-pro-max. Model: sonnet.
- Tiêu chí nghiệm thu:
  - [ ] Cột mở: không còn banner vàng; cột đóng: dòng mỏng có N đúng, bấm mở cột.
  - [ ] Nhóm đúng trạng thái; số trong tiêu đề nhóm đúng; sort áp trong nhóm.
  - [ ] Thẻ ≤ 3 dòng ở trạng thái thường; mọi hành động cũ của thẻ còn (liệt kê đi đâu); bàn phím mở được menu (Shift+F10 / nút ⋯ focus).
  - [ ] Map: chỉ node chờ chủ nhân có ring màu; zoom controls ở góc dưới phải; map/office toggle vẫn chạy.
  - [ ] typecheck web sạch; vitest liên quan (SessionCard/AgentMap/lib) + src/i18n pass; e2e selector đổi đã sửa.
- Lệnh test: `npm run typecheck -w @ccm/web`; vitest các test có sẵn quanh session list / map.
- Nhìn thấy được: có (WP-8 chụp; WP này ghi CHƯA NHÌN). Được chạy `npm run dev` với demo fixture trên CCM_PORT=4318 để tự xem nếu cần
  (cổng 4317 là app thật của chủ nhân — không đụng): `node scripts/demo-fixture.mjs --sessions=5 --subagents=3` rồi
  `CCM_PORT=4318 CLAUDE_CONFIG_DIR=<root in ra> CCM_VERIFY_PROCESSES=0 CCM_TOAST=0 CCM_CODEX=0 CCM_DATA_DIR=<tmp> npm run dev`; tắt khi xong.
- Báo cáo: `.planning/wp/WP-2-report.md`

## Nhật ký
- 2026-11-03: audit xong; lib sessionGroups/subagentBar/cardMenu/waitingStrip + test; WaitingStrip thay banner; SessionList nhóm; SessionCard 3 dòng + menu ⋯; ProjectStrip dropdown; Favorites hint dismiss; Map viền trung tính + zoom góc dưới phải.
- 2026-11-03: typecheck web sạch; vitest toàn web 588 file / 1577 test pass; CHƯA NHÌN.
