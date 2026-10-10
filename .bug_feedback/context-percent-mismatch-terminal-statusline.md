---
date: 2026-10-10
project: Claude-Code-Monitor / web + collector + shared
status: fixed
---

# Context % trên dashboard lệch với status line ở terminal

## Triệu chứng
Cùng session (306,010 token, cửa sổ 1M): dashboard hiện "Context 31%", status line terminal hiện 37%. Toast/notify context ≥ 95% không bao giờ bật với cửa sổ 1M.

## Nguyên nhân
Cùng số token, khác mẫu số. Dashboard: `tokens / window`. Status line của user (`~/.claude/hooks/statusline-custom.js`, gsd-statusline math) dùng `remaining_percentage` rồi trừ 16.5 % buffer auto-compact: `used = raw / (100 − 16.5)`. Auto-compact chạy trước khi raw tới 95 % nên ngưỡng notify cũ không bao giờ đạt.

## Solution
`packages/shared/src/context.ts`: `AUTOCOMPACT_BUFFER_PCT = 16.5`, `contextUsedPct()` (dùng cho hiển thị + level + notify), `contextRawPct()` (tooltip). Áp dụng ở `ContextGauge.vue`, `useNotifications.ts`, collector `store.ts contextPct`. i18n `context.tooltip` thêm `{raw}`. Ghi ở docs/claude-code-integration.md.

## Bổ sung (cùng ngày)
Bridge ghi `contextPct` (Claude Code remaining/used %) + `bufferPct` (env CLAUDE_CODE_AUTO_COMPACT_WINDOW); collector `tracker.contextOf` dùng số reported khi không cũ hơn reply mới nhất, buffer bridge → env collector → 16.5; `Agent.contextPct` gửi xuống web. Bridge cài tại `%LOCALAPPDATA%/ccm/bin` phải chép lại (app desktop cũ sẽ ghi đè bản cũ).

## Context
Còn lệch được khi: user đặt `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (buffer khác 16.5 %), không cài statusline bridge (window đoán từ catalog/settings), vài giây trễ giữa transcript và status line, ngay sau compact (dashboard dùng `postTokens`). Status line khác (không phải gsd math) sẽ ra số khác.
