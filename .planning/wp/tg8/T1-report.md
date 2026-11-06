## T1 — DONE
**Đã đổi**: lib/paneActions.ts (`telegramTopicLink`, action `telegram-open`, dep `telegramOpen`), lib/tabMenu.ts + lib/rail/railMenu.ts (mục "Mở topic trong Telegram" ngay sau ✈, chỉ khi linked + có t.me link), composables/useTelegramLinks.ts (`openTelegramGlyph`, `useTelegramTopicUrl`), composables/usePaneActions.ts (`telegramOpenOf`), RailRow.vue (glyph thành button), WorkspaceView.vue (glyph tab role=button + Enter/Space; truyền telegramOpen), WorkspaceSidebar.vue (truyền telegramOpen), i18n/telegram-v82.ts (`telegram.connect.menuOpen`, `openTopic` vi/en), tests: paneActions/tabMenu/railMenu + mới composables/useTelegramLinks.test.ts.
**Tiêu chí 6/6**: 1 bấm glyph -> openExternal(topicUrl) (test mock) · 2 không có url/chưa nối -> hộp ✈ (test + thử trên dev) · 3 menu đúng điều kiện (test 3 menu) · 4 i18n vi/en · 5 typecheck + test pass · 6 ảnh.
**Audit**: glyph rail cũ nằm trong cha pointer-events-none và aria-hidden nên bấm không tới / không focus; glyph tab không focus được. Đã sửa.
**Review**: basic group (-4242) -> dialog; pane chưa nối -> không glyph/menu; stopPropagation + data-no-drag (không chọn/kéo); kích thước glyph 10x10 như cũ (đo trên dev); tooltip = openTopic khi mở được, linkedTo khi mở hộp; rail glyph theo roving tabindex của hàng; tab glyph Enter/Space stopPropagation (không kích onTabKey).
**Test**: `npm run typecheck` sạch; `npm test -w @ccm/web` 1751 pass (baseline 1744, +7), 204 file.
**Nhìn**: docs/qa/telegram8-2026-11-06/T1/glyph-rail-tab.png (rail 2 hàng + tab có glyph), menu-tab.png (mục mới). Chưa chụp pane zoom / tab rất hẹp (glyph shrink-0 như cũ). Click supergroup thật không stub được (contextBridge), chỉ unit test; click basic group thử trên dev -> hộp mở đúng.
**Hot file cần thêm**: không (WorkspaceSidebar.vue chỉ thêm 1 dòng truyền telegramOpen).
**Ngoài phạm vi**: không có.
**Commit message đề xuất**: Telegram: the ✈ glyph on tabs and rail rows opens the connected topic in the Telegram app, with a matching menu item
