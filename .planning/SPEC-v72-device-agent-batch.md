# SPEC v72 — 5 tính năng (chủ nhân chốt "làm hết", 2026-10-29)

Nguồn: `.planning/IDEAS-2026-10-29e.md` (chi tiết từng ý). Commit từng tính năng, không push (chủ nhân chốt). Rule subagent: `.planning/AGENT-RULES-v70.md`.

Thứ tự: 3 Chụp màn + soi view → 2 Bảng thử UI + deep link → 1 Crash runtime → agent → 4 Gợi ý luật allow → 5 Ngữ cảnh nền.

Thêm cho đợt này:
- Mỗi tính năng thêm 1–2 dòng (en + vi) vào mục **2.4.0** trong `apps/web/src/lib/changelog.ts` (dialog Có gì mới).
- Mục 4: kiểm thật Claude Code 2.1.289 có hook `PermissionRequest` không (docs/claude-code-integration.md, bundle CLI cài trên máy); không có thì chỉ thống kê theo dữ liệu đã có, ghi lệch vào docs. Ghi `settings.local.json` chỉ sau native confirm, hiện JSON sẽ ghi.
- Mục 5: không quy KB ra token, chỉ số liệu usage thật.
- Thiết bị adb: chỉ lệnh khi bấm; mọi lệnh đổi cài đặt máy phải có nút khôi phục.
