## WP-3b — DONE
- Da doi: TelegramToggle.vue (toggle() -> toast loi telegram.setError.*, xoa toast khi thanh cong) · SettingsMenu.vue (endResize + watch settingsOpen + onBeforeUnmount + lostpointercapture; handle focus() thay vi bi chan boi .prevent; handle size-5 + sm:mb-5 cho vung cuon de khong de len thanh cuon) · useAppToasts.ts (toasts.remove(telegram-fail) khi state moi khong con lastError) · TelegramSettings.vue (xoa token can xac nhan inline 2 buoc, tu huy sau 6s; xoa token ref + confirm khi Settings dong) · i18n/telegram-v82.ts (clearAsk/clearYes/clearNo en+vi) · stores/telegram.test.ts (moi).
- Tieu chi: 2/2
- Audit / Review: dung toasts.remove thay dismiss de khong goi onDismiss; timer confirm don khi unmount/dong; khong comment moi; chi dung token mau (text-st-error); motion ccm-swap.
- Test: npm test -w @ccm/web -> 196 files, 1688 tests passed; npm run typecheck -w @ccm/web -> sach.
- Nhin: CHUA NHIN: khong chay app (resize/handle/confirm can QA tay).
- Ngoai pham vi: khong. Chua co test cho useAppToasts/SettingsMenu (logic gan DOM/component).
- Commit: fix(web): report Telegram toggle errors, confirm token removal, harden Settings resize, auto-close recovered fail toast
