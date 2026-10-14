# Color standard (v22, 2026-10-14)

Source: color audit 2026-10-14. Apple macOS system colors as reference. Tokens live in `apps/web/src/style.css` (`--ccm-*` in CSS, `--color-*` → Tailwind utilities in templates).

## Roles

| Token | Light | Dark | Apple ref | Use for | Never for |
|---|---|---|---|---|---|
| canvas / surface / raised / control | #ececee / #fff / #f5f5f7 / #fff | #1e1e1e / #262628 / #2f2f31 / #3a3a3c | window / controlBackground / underPage / control | backgrounds | text |
| ink | #1d1d1f | #f5f5f7 | label | body text, icons | — |
| ink-muted | #5c5c61 | #a1a1a6 | secondaryLabel | secondary text, ended/quiet rows | — |
| ink-faint | #6c6c70 | #98989d | tertiaryLabel | hints, placeholders, paths | body copy, important text on fill/control |
| ink-disabled | rgb(0 0 0/.26) | rgb(255 255 255/.25) | quaternaryLabel | disabled controls only | meaningful text |
| accent (fill) | #0071e3 | #0a6cdf | controlAccent | primary button, toggle on, selected menu row, progress, caret | status, identity, decoration |
| accent-ink (text) | #0066cc | #409cff | linkColor | accent-colored text, selected list label | fills |
| link (= accent-ink) | #0066cc | #409cff | linkColor | inline links, text buttons | — |
| accent-soft | blue/.12 | blue/.22 | unemphasizedSelection | selected list row/chip bg (+ accent-ink) | — |
| on-accent | #fff | #fff | alternateSelectedControlText | text on accent fill, solid only (no /80) | — |
| focus | #0071e3 | #409cff | keyboardFocusIndicator | `:focus-visible` 2px ring, field focus, selected node | — |
| selection | #b3d7ff | #3f638b | selectedTextBackground | `::selection`, xterm selection, file viewer | — |
| fill / fill-strong | gray/.12 / .20 | gray/.24 / .36 | systemFill | hover, pressed, chips, toggle off | — |
| well / well-ink / well-line | #111113 / #e5e5ea / white/.08 | #0b0b0c / #e5e5ea / white/.08 | — | terminal + code surfaces (always dark) | — |
| st-working | #c93400 | #ff9f0a | systemOrange | running status | decoration, big numbers, brand |
| st-waiting | #8f5f00 | #ffd60a | systemYellow | needs-input status | stars, generic warnings |
| st-idle | #636366 | #98989d | systemGray | idle status | "OK" meters |
| st-done | #1f7a35 | #30d158 | systemGreen | completed status | diff, connected, running, copy ✓ |
| st-error | #d70015 | #ff6961 | systemRed | error status, destructive | diff remove, decoration |
| st-stale | #76767b | #8e8e93 | systemGray2 | stale / cancelled | — |
| *-soft (working, waiting, error, done) | /.12–.20 | /.16–.22 | — | badge/banner bg with matching ink | standalone fill |
| success | = st-done | = st-done | systemGreen | action results: copied, saved, connected, quota safe | session status |
| warning / warning-soft | #c93400 | #ff9f0a | systemOrange | context/quota warnings, bypass mode | waiting status |
| favorite | #b38600 | #ffd60a | systemYellow | favorite star (icon only) | text |
| agent-claude | #c15f3c (text #ae4a26) | #d97757 | Claude brand | Claude glyph/badge, brand art highlight (ArtImage/Lottie) | accent, status |
| agent-codex | #5e4fc0 | #a49cf0 | systemIndigo | Codex glyph/badge/edge | model slot |
| agent-shell | = ink-muted | = ink-muted | systemGray | Shell glyph | — |
| agent-browser | #0071a4 | #64d2ff | systemCyan | Browser glyph | — |
| agent-file | #7f6545 | #b59469 | systemBrown | File glyph | — |
| series-input/output/write/read | cat-1..4 | cat-1..4 | dataviz | token-type series only | models, providers |
| model-1..8 | cat rotated (5,6,8,1,2,3,4,7 → never = series/codex in same view) | | dataviz | Usage › Models | — |
| diff-add / diff-add-soft | #1f7a35 / green/.15 | #30d158 / green/.18 | systemGreen | `+N`, added lines | status |
| diff-del / diff-del-soft | #d70015 / red/.12 | #ff6961 / red/.18 | systemRed | `−N`, removed lines | status |
| diff-add-well / diff-del-well | #30d158 / #ff6961 | same | systemGreen / systemRed (dark) | diff ink on the always-dark well (DiffView, ChangesPane) | light surfaces |
| page | #fff | #fff | — | browser pane canvas behind a web page (pages without a background render white, like any browser) | UI surfaces |
| ansi-0..15 (well, one set) | black #1c1c1e · red #ff453a · green #30d158 · yellow #ffd60a · blue #0a84ff · magenta #bf5af2 · cyan #64d2ff · white #d1d1d6 · brBlack #8e8e93 · brRed #ff6961 · brGreen #4ae36d · brYellow #ffe55c · brBlue #409cff · brMagenta #da8fff · brCyan #8be3ff · brWhite #f5f5f7 | same | Terminal.app dark | xterm only | UI |
| syn-* (code on well) | keyword #ff7ab2 · string #ff8170 · number #d9c97c · comment #7f8c98 · type #6bdfff · func #67b7a4 · var well-ink | same | Xcode Default Dark | file viewer (shiki css-variables theme) | UI chrome |
| grid / flow-dot / edge / line / line-strong | unchanged | unchanged | separator | lines | text |
| scrim | unchanged | unchanged | — | dialogs, onboarding tour | ad-hoc color-mix scrims |

## Rules

1. Templates use utilities; CSS uses `--ccm-*`. No raw palette classes, `[#..]`, `rgb()` outside style.css, no `var(--color-*)` in components.
2. Status = glyph + label + color. Attention dots use status glyphs (waiting / check), never color-only dots.
3. Status colors mean session/agent lifecycle only. Other meanings → success / warning / diff-* / agent-* / favorite; decoration → ink.
4. Accent = primary action, selection, focus, progress. Accent text uses accent-ink. Identity never uses accent.
5. Agent colors only on that agent's glyph/badge. One glyph per agent everywhere (Claude Asterisk, Codex Hexagon, Shell SquareTerminal, Browser Globe, File FileText).
6. No opacity on text to carry meaning — step down ink → muted → faint. Whole-element opacity only for drag ghosts / transient loading, ≥0.85.
7. Text on accent fill = solid on-accent.
8. One selection treatment per context: lists accent-soft + accent-ink; menus accent + on-accent; cards/nodes focus ring.
9. Contrast: text ≥4.5:1 on its real background (incl. soft/fill); icons, meters, chart marks ≥3:1 or legend + value.
10. A cat-* color means one thing per screen.

## Code changes (from audit; line numbers approximate)

- style.css: new values above; add accent-ink/link/focus/selection/success/warning/favorite/done-soft/diff-*/agent-*/model-*/ansi-*/syn-*; `--color-codex` → agent-codex; `.ccm-edge-codex` → agent-codex; drop `--color-material*`; focus ring 2px solid focus; field focus ring; `::selection`; dark accent fill #0a6cdf for white text.
- `text-accent` (~45 sites) → accent-ink (remap `--color-accent` to ink form + add `--color-accent-fill`, or change sites).
- TermPane: ANSI + selection tokens, `minimumContrastRatio: 4.5`, running glyph not st-done.
- PresetIcon / LaunchPicker / WorktreeMenu: Codex → Hexagon; per-agent color classes. PlanLimits Claude glyph → agent-claude. ProviderBadge → agent-codex.
- ArtImage: art orange → agent-claude; drop dead `#1b1b19`; logo documented as fixed brand mark. AgentMap bg art: waiting → ink-faint. LottieArt recolor on theme change.
- Diff: SessionCard, SessionSummary → diff-add/del.
- Success: DiagnosticsDialog, RecapDialog, SettingsMenu, PlanLimits, AppHeader connected, CommandPalette → success.
- Warning: ContextGauge, PlanLimits, SessionCardHeader, SessionCardSignals, mode.ts, DiagnosticsDialog warn → warning.
- Favorites star → favorite. TokenCount big delta → accent-soft + accent-ink. AwaySummary loops → warning. "OK" meters unified (ContextGauge, PlanLimits, MetricsStrip).
- Opacity-as-meaning: SessionCard, SessionTabs, JobsList, WaitingQueue, CompactView, PlanLimits, AgentNode, WorktreeMenu, LaunchPicker, SplitMenu, WorkspaceSidebar → ink ladder; `on-accent/80` → on-accent (AppSelect, CommandPalette).
- Bars ≥3:1: ToolTimeline, TimelineChart idle.
- Attention dots → StatusIcon glyphs (WorkspaceSidebar, WorkspaceView).
- AgentNode ring → ring-focus; ActivityFeed `accent-accent`; OnboardingTour scrim → `--ccm-scrim`; ToolTimeline `--color-st-*` → `--ccm-*`.
- Usage models → model-* slots. Links → `text-link`.

## v25 themes
- Extra themes (`apps/web/src/themes.css`, `lib/themes.ts`) name only their palette per role above; translucent steps (line, fill, soft tints, material, grid) are derived with `color-mix` from the theme ink / accent / status colours. Same rules: status colours for lifecycle only, text ≥4.5:1 on surface and raised (status / diff / accent ink also on their soft tint), glyphs ≥3:1, syntax on the well ≥4.5:1 (comments ≥3:1). `lib/themes.test.ts` enforces it.
