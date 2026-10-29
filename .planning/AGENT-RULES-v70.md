# Rules for v70 feature subagents (Orrery, F:/work/web/Claude-Code-Monitor)

READ FIRST: CLAUDE.md (repo root), .planning/SPEC-v70-tools-batch.md (your items + owner decisions), .code_index/web.md and .code_index/desktop.md (incl. section `## v70`). Look at recent v70 commits (`git log --oneline -12`, `git show <hash> --stat`) as style references.

- All UI strings via vue-i18n in BOTH en and vi (Vietnamese with full diacritics). New blocks in apps/web/src/i18n/workspace-commit.ts (en block first, vi second) or en.ts/vi.ts; desktop native strings in apps/desktop/src/strings.ts. i18n parity test under apps/web/src/i18n must pass.
- All colours via theme tokens (var(--ccm-*), tailwind token classes text-ink, bg-fill, border-line, text-accent-ink…). Follow .planning/COLOR-SYSTEM.md. Popovers/menus/dialogs opaque (`ccm-menu`). Status = icon + text + colour.
- Minimal comments: only "why" comments, ~1 per 30–40 lines max. No decorative headers, no step numbering.
- Match surrounding code style (no semicolons, single quotes, 2 spaces). Many files use CRLF: preserve line endings.
- Never polling; work only on user action (or on existing event edges). Never send/submit prompts to agents (prefill only via existing `insertInto`). Never log or expose secrets / file contents unnecessarily; validate all IPC inputs (paths inside project, no traversal).
- Vue gotcha: a template mustache must not contain `}}`.
- Files like FilePane.vue, TermPane.vue, WorkspaceView.vue, i18n change often: read fresh before editing.
- Tooling quirks: Bash `grep` output is mangled by an rtk hook → use the Grep tool. Vitest output through rtk is empty → run from apps/web or apps/desktop: `npx vitest run <files> --reporter=json --outputFile=C:/Users/dauph/AppData/Local/Temp/claude/F--work-web-Claude-Code-Monitor/6cff3b12-0467-4336-af09-12777f00ae8e/scratchpad/<name>.json` then `python -I C:/Users/dauph/AppData/Local/Temp/claude/F--work-web-Claude-Code-Monitor/6cff3b12-0467-4336-af09-12777f00ae8e/scratchpad/vres.py <that json>`. Bash heredocs break; write scripts with the Write tool into that scratchpad and run `python -I file`.
- Gate per feature: `npm run typecheck -w @ccm/web` clean and `npm run typecheck -w @ccm/desktop` if desktop touched; related vitest pass (+ apps/web src/i18n tests). Do NOT run builds or E2E.
- COMMIT after each feature passes (owner authorized commits, NOT push). `git add <explicit paths>` only, never `-A` / `.`. Never add: spikes/, bg_native_ad_cta.xml, git-gui.bat, apps/*/.vitest/, apps/desktop/test/__snapshots__/fwp-host.test.ts.snap, .planning/PROGRESS-2026-10-29.md, .planning/HANDOFF-*. Message style: emoji + English sentence, optional 1–2 line body. ABSOLUTELY NO Co-Authored-By or any attribution trailer. Never push.
- After each feature append one Vietnamese line at the end of .planning/PROGRESS-2026-10-29.md (like existing `- [x] Mục N ...` lines: files, symbols, tests, deviations, commit hash) — do not commit it. Add entries under `## v70 (2026-10-29)` in .code_index/web.md / desktop.md and one line in .code_index/_meta.md, included in the feature commit.
- If something is impossible/unsafe, choose a sensible default, note the deviation in PROGRESS, continue.
- FINAL REPORT (≤ 25 lines, Vietnamese, call the user "chủ nhân"): per feature: commit hash, key files, test counts, deviations, unfinished bits.
