# Attachments Removal (Backspace + any order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The terminal pane's Attachments tray follows Backspace in the prompt (no leftover or ghost rows), and its × removes any attachment, not only the last one.

**Architecture:** Two pure helpers in `lib/promptAttachments.ts` read the screen: `eraseKeys` (← presses, Backspaces, → presses that erase a token before the cursor on the cursor's row) replaces `eraseCount`, and `cursorToken` names the mention still being typed or erased at the cursor. The store's `reconcile` skips that mention (no ghost rows); `usePaneAttachments.remove` types the keys one per write from a fresh screen read, queued so quick clicks never use stale positions.

**Tech Stack:** Vue 3 + Pinia + vue-i18n (apps/web), xterm 6 (`modes.applicationCursorKeysMode`), Vitest (happy-dom), CDP E2E on a real Claude Code pane (`apps/desktop/e2e/v25.cjs`).

**Spec:** User request 2026-10-15, item 6: "tính năng Attachments, khi mình xoá bằng nút backspace thì Attachments không bị mất, click vào xoá thì show toast: Not at the end of the prompt: remove it in the terminal; ví dụ như có 3 Attachments thì chỉ cho xoá cái Attachments thứ 3 -> Attachments 2 -> Attachments 1, tôi muốn xoá Attachments 2 thì không xoá được" (deleting with Backspace does not remove the attachment from the tray; clicking × shows "Not at the end of the prompt: remove it in the terminal"; with 3 attachments only #3 → #2 → #1 can be removed in order; removing #2 directly must work). Prior: v25 attachments tray, `docs/claude-code-integration.md` 11p (verified Claude Code prompt behaviour). Siblings split from the same request: `2026-10-15-sidebar-width.md`, `2026-10-15-jetbrains-split-diff.md`, `2026-10-15-diff-arrow-files.md`, `2026-10-15-explorer-context-menu.md`, `2026-10-15-log-branches-toolbar.md`.

## Rulings (decided while planning — confirm or overrule before execution)

1. **Ghost rows are the Backspace bug** (found by reading the code; Task 2's E2E confirms it on a real Claude pane): each Backspace on `@package.json` leaves `@package.jso`, `@package.js` … which the scan adds as new "terminal" rows, so the tray never empties. Fix: a mention that ends exactly at the cursor is being typed or erased and gets no row until a space follows it.
2. **Removal moves the cursor with arrow keys.** × on any item whose token sits before the cursor **on the cursor's row** types ← to just after it (and its trailing space), Backspace(s), then → back — only on the user's click, never Enter (same consent model as today's Backspace erase).
3. **Limits kept on purpose:** tokens on another row (screen text cannot tell a soft wrap from a typed newline) or after the cursor keep the "remove it in the terminal" notice (reworded); rows with wide (CJK / emoji) characters before the cursor are refused (cells ≠ characters).
4. Keys go out one per PTY write with a 12 ms gap, ← / → as `ESC [ D` / `ESC [ C`, or `ESC O D` / `ESC O C` when the app turned on application cursor keys.

## Global Constraints

- Monitoring never sends prompts: the tray only types editing keys (←, →, Backspace, a pasted mention) into the user's own input box on the user's click, never Enter.
- Session contents stay local: screen rows are read in the renderer only, never logged or sent anywhere.
- All UI strings via vue-i18n, `en` and `vi` with key parity (the parity test in `apps/web/src/stores/workspace.test.ts` must stay green).
- Claude Code behaviour relied on must be verified on the installed version and recorded in `docs/claude-code-integration.md` 11p (CLAUDE.md: do not guess undocumented formats).
- No new npm dependency.
- Commits: gitmoji style, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop`, then `node apps/desktop/e2e/v25.cjs` (starts `claude` in this repo; no prompt is sent, no Enter is pressed).
- After each task, add 1–2 lines per change to `.code_index/web.md` / `_meta.md`; Task 3 does the final pass.

## Review Focus

1. **Middle item of three on one row** (`[Image #1] [Image #2] [Image #3] `) → × on #2 erases exactly #2 and its space, the cursor returns to the end. Pinned in Task 1 (`eraseKeys` item 2 of 3 test) and Task 2 (E2E removes the first row each time).
2. **Mention erased one Backspace at a time** → no ghost rows at any step, tray empty at the end. Pinned in Task 2 (store test + E2E).
3. **Token on an earlier prompt row, or after the cursor** → refused (notice), nothing typed. Pinned in Task 1 (`eraseKeys` refusal test).
4. **Wide characters before the cursor** (`画像 @a.ts`) → refused rather than off-by-one keys. Pinned in Task 1.
5. **A mention that is a prefix of another** (`@src/a.ts` vs `@src/a.tsx`) → no partial match, nothing erased. Pinned in Task 1.

---

### Task 1: `eraseKeys` and `cursorToken` (pure)

**Files:**
- Modify: `apps/web/src/lib/promptAttachments.ts` (add after `eraseCount`, line 54), `apps/web/src/lib/promptAttachments.test.ts:2` + append

**Interfaces:**
- Produces:

```ts
export interface EraseKeys { left: number; back: number; right: number }
export function eraseKeys(rows: string[], cursor: { x: number; y: number }, token: string): EraseKeys | null
export function cursorToken(rows: string[], cursor: { x: number; y: number }): string | null
```

`eraseCount` stays until Task 2 moves its only caller (`usePaneAttachments.eraseFor`) to `eraseKeys` and deletes it with its test. `{ left: 0, right: 0 }` is exactly the old "last in the prompt" case.

- [ ] **Step 1: Write the failing tests** — in `promptAttachments.test.ts` add `cursorToken, eraseKeys` to the import from `./promptAttachments` and append inside `describe('prompt attachments', …)`:

```ts
  it('erases the last token in place, like before', () => {
    const rows = screen(['❯ [Image #1] [Image #2]'])
    const y = 5
    // Observed: one backspace drops a whole [Image #N].
    expect(eraseKeys(rows, { x: 23, y }, '[Image #2]')).toEqual({ left: 0, back: 1, right: 0 })
    // Cursor one past the space typed after a mention (translateToString trims it; the cursor cell says it is there).
    expect(eraseKeys(screen(['❯ @package.json']), { x: 16, y }, '@package.json')).toEqual({ left: 0, back: '@package.json'.length + 1, right: 0 })
  })

  it('erases an earlier token on the cursor row by moving the cursor (item 2 of 3)', () => {
    const rows = screen(['❯ [Image #1] [Image #2] [Image #3]'])
    // "[Image #2] " ends at 24; the cursor is at 35 (after "[Image #3] ").
    expect(eraseKeys(rows, { x: 35, y: 5 }, '[Image #2]')).toEqual({ left: 11, back: 2, right: 11 })
    expect(eraseKeys(screen(['❯ @a.ts @b.ts look']), { x: 18, y: 5 }, '@a.ts')).toEqual({ left: 10, back: 6, right: 10 })
  })

  it('refuses tokens off the cursor row, after the cursor, partial matches and wide characters', () => {
    const two = screen(['❯ [Image #1] first line', '  second line'])
    expect(eraseKeys(two, { x: 13, y: 6 }, '[Image #1]')).toBeNull()
    expect(eraseKeys(screen(['❯ [Image #1] [Image #2]']), { x: 10, y: 5 }, '[Image #2]')).toBeNull()
    expect(eraseKeys(screen(['❯ @src/a.tsx ']), { x: 14, y: 5 }, '@src/a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ 画像 @a.ts ']), { x: 14, y: 5 }, '@a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ [Image #2]']), { x: 13, y: 4 }, '[Image #2]')).toBeNull()
  })

  it('names the mention being typed or erased at the cursor', () => {
    expect(cursorToken(screen(['❯ look @package.js']), { x: 18, y: 5 })).toBe('@package.js')
    expect(cursorToken(screen(['❯ look @package.js']), { x: 19, y: 5 })).toBeNull()
    expect(cursorToken(screen(['❯ [Image #1]']), { x: 12, y: 5 })).toBeNull()
  })
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/promptAttachments.test.ts` — Expected: FAIL (`eraseKeys` is not exported).

- [ ] **Step 3: Implement** — add after `eraseCount` (line 54):

```ts
/** East Asian wide characters and emoji take two cells: cursor cells stop matching string indices. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u

export interface EraseKeys {
  /** ← presses from the cursor to just after the token (and the space typed after it). */
  left: number
  /** Backspaces: one per character of a mention, one for a whole `[Image #N]`, plus that space. */
  back: number
  /** → presses back to where the cursor was. */
  right: number
}

/**
 * Keys that erase `token` when it sits before the cursor on the cursor's row of the prompt. Claude Code drops a
 * whole `[Image #N]` on one Backspace (11p). null = not safe: another row (soft wrap and typed newline look the
 * same on screen), after the cursor, only a partial match, or wide characters before the cursor.
 */
export function eraseKeys(rows: string[], cursor: { x: number; y: number }, token: string): EraseKeys | null {
  const range = findPromptRange(rows)
  if (!range || cursor.y < range[0] || cursor.y >= range[1]) return null
  // translateToString(true) trims trailing spaces; the cursor cell says how many were typed.
  const head = (rows[cursor.y] ?? '').padEnd(cursor.x).slice(0, cursor.x)
  if (WIDE.test(head)) return null
  const image = token.startsWith('[Image #')
  let at = head.lastIndexOf(token)
  while (at >= 0) {
    const before = head[at - 1]
    const after = head[at + token.length]
    // An image placeholder may touch text (the agent types it without a space); a mention starts a word.
    if ((image || at === 0 || /\s/.test(before!)) && (after === undefined || /\s/.test(after))) break
    at = at > 0 ? head.lastIndexOf(token, at - 1) : -1
  }
  if (at < 0) return null
  const end = at + token.length + (head[at + token.length] === ' ' ? 1 : 0)
  const left = cursor.x - end
  return { left, back: end - at - token.length + (image ? 1 : token.length), right: left }
}

/** The `@mention` ending exactly at the cursor (still being typed, or being erased), else null. */
export function cursorToken(rows: string[], cursor: { x: number; y: number }): string | null {
  const head = (rows[cursor.y] ?? '').padEnd(cursor.x).slice(0, cursor.x)
  return /(?:^|\s)(@(?:"[^"\n]+"|[^\s"@]+))$/.exec(head)?.[1] ?? null
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/promptAttachments.test.ts && npm run typecheck` — Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/promptAttachments.ts apps/web/src/lib/promptAttachments.test.ts
git commit -m "✨ Erase any prompt token on the cursor row; name the mention at the cursor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Tray follows Backspace and removes any item

**Files:**
- Modify: `apps/web/src/stores/attachments.ts:121-157` (`reconcile`), `apps/web/src/stores/attachments.test.ts` (append), `apps/web/src/composables/usePaneAttachments.ts:1-25,52-72,151-171`, `apps/web/src/components/workspace/TermPane.vue:268-280`, `apps/web/src/components/workspace/AttachmentsPanel.vue:12-17`, `apps/web/src/i18n/workspace-v25.ts:63,143`, `docs/claude-code-integration.md` 11p item 4, `apps/desktop/e2e/v25.cjs:148-160`

**Interfaces:**
- Consumes: Task 1 `eraseKeys`, `cursorToken`, `EraseKeys`.
- Produces: `reconcile(pane, scan, submitted, pendingPaste, editing: string | null = null)`; `usePaneAttachments` option `appCursorKeys: () => boolean`; `eraseFor(a): EraseKeys | null`; `remove(a): boolean` (true = erase queued / staged item dropped).

- [ ] **Step 1: Write the failing store test** — append to `apps/web/src/stores/attachments.test.ts` inside the `describe`:

```ts
  it('a mention being erased at the cursor leaves no ghost rows', () => {
    const s = useAttachmentsStore()
    s.reconcile(P, scan([], ['@package.json']), false, null)
    expect(s.list(P)).toHaveLength(1)
    s.reconcile(P, scan([], ['@package.jso']), false, null, '@package.jso')
    s.reconcile(P, scan([], ['@package.js']), false, null, '@package.js')
    expect(s.list(P)).toEqual([])
    // Finished (a space typed after it): the mention gets its row.
    s.reconcile(P, scan([], ['@src/b.ts']), false, null, null)
    expect(s.list(P).map((a) => a.token)).toEqual(['@src/b.ts'])
  })
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/stores/attachments.test.ts` — Expected: FAIL (ghost rows `@package.jso`, `@package.js` remain).

- [ ] **Step 3: Implement**

`stores/attachments.ts` — signature and the file loop:

```ts
  /**
   * Fold one screen read into the tray. `submitted` = Enter was pressed since the previous read: tokens that left
   * the prompt were sent, not removed. Tokens nobody put there (typed / pasted in the terminal) get a row too,
   * except `editing`: the mention ending at the cursor, still being typed or erased one Backspace at a time.
   */
  function reconcile(pane: string, scan: PromptScan, submitted: boolean, pendingPaste: NewAttachment | null, editing: string | null = null): { boundPaste: boolean } {
```

```ts
    for (const f of scan.files) {
      if (!tokens.has(f) && f !== editing) items.push({ id: `att-${++seq}`, kind: 'file', name: baseName(f.slice(1).replace(/^"|"$/g, '')), source: 'terminal', token: f, state: 'inserted', seen: true, at: Date.now() })
    }
```

`promptAttachments.ts` — delete `eraseCount` and its doc comment; in `promptAttachments.test.ts` delete the test `'erase only when the token ends the prompt at the cursor'` and `eraseCount` from the import (Task 1's `'erases the last token in place, like before'` covers it).

`usePaneAttachments.ts`:
- Import `cursorToken, eraseKeys, type EraseKeys` (drop `eraseCount`).
- `Options` add: `/** xterm DECCKM: the app asked for application cursor keys (ESC O D) instead of ESC [ D. */ appCursorKeys: () => boolean`.
- In `scan()`: `const { boundPaste } = store.reconcile(o.paneKey(), result, submitted, pendingPaste?.item ?? null, cursorToken(s.rows, s.cursor))`.
- Replace `eraseFor` and `remove`:

```ts
  /** Keys that erase an inserted item right now (it sits before the cursor on the cursor's row), or null. */
  function eraseFor(a: Attachment): EraseKeys | null {
    const s = lastScreen.value
    if (!s || a.state !== 'inserted' || !a.token) return null
    return eraseKeys(s.rows, s.cursor, a.token)
  }

  const KEY_GAP_MS = 12
  const REDRAW_MS = 80
  const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))
  /** Erases run one after another, each from a fresh screen read, so two quick clicks never use stale positions. */
  let erasing: Promise<void> = Promise.resolve()

  function remove(a: Attachment): boolean {
    if (a.state !== 'inserted') {
      store.remove(o.paneKey(), a.id)
      return true
    }
    if (!eraseFor(a)) return false
    erasing = erasing.then(async () => {
      const s = o.screen()
      const k = s && a.token ? eraseKeys(s.rows, s.cursor, a.token) : null
      // Moved since the click (or already gone): type nothing; the next scan keeps the tray honest.
      if (!k) return
      const [left, right] = o.appCursorKeys() ? ['\x1bOD', '\x1bOC'] : ['\x1b[D', '\x1b[C']
      // One key per write: the agent's input parser sees separate presses.
      for (const key of [...Array<string>(k.left).fill(left), ...Array<string>(k.back).fill('\x7f'), ...Array<string>(k.right).fill(right)]) {
        o.write(key)
        await sleep(KEY_GAP_MS)
      }
      await sleep(REDRAW_MS)
      schedule()
    })
    return true
  }
```

`TermPane.vue` — in the `usePaneAttachments({ … })` options add `appCursorKeys: () => !!term?.modes.applicationCursorKeysMode,`.

`AttachmentsPanel.vue` — import `type EraseKeys` from `../../lib/promptAttachments`; prop doc + type: `/** Keys that erase an inserted item, null = not before the cursor on its row (usePaneAttachments). */ eraseFor: (a: Attachment) => EraseKeys | null`. (`removable` already compares with `null`.)

i18n `workspace-v25.ts`: en `removeInTerminal: 'Not on the cursor’s line in the prompt: remove it in the terminal'`, vi `removeInTerminal: 'Không nằm trên dòng có con trỏ trong prompt: hãy xoá trong terminal'`.

`docs/claude-code-integration.md` 11p item 4 → replace its last sentence with: `The tray erases an item that sits before the cursor on the cursor's row: ← to just after it (ESC [ D, or ESC O D in application-cursor mode), Backspace (one for a placeholder, one per character for a mention, plus the space after it), then → back; one key per write. Items on other rows (a soft wrap and a typed newline look the same on screen) or after the cursor are left to the user ("remove it in the terminal"). While a mention is erased one Backspace at a time, the shortened mention at the cursor gets no tray row. Verified on Claude Code <version from \`claude --version\` when you run e2e/v25.cjs> by e2e/v25.cjs.` — write the actual version printed by `claude --version` on the machine that runs the E2E.

- [ ] **Step 4: E2E on a real Claude pane** — in `apps/desktop/e2e/v25.cjs` replace the removal block (lines 148-159) with:

```js
    // Backspace in the terminal (cursor after the last "[Image #N] "): the row leaves the tray.
    const before = await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length`)
    await evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    await key('Backspace', 'Backspace', 8, 0)
    await key('Backspace', 'Backspace', 8, 0)
    const afterBs = await waitFor(`${A}.live(${JSON.stringify(claudeKey)}).length === ${before - 1}`, 5000, 'backspace removed').catch(() => false)
    check('Backspace in the terminal removes the tray row', afterBs, String(await evaluate(`JSON.stringify(${A}.live(${JSON.stringify(claudeKey)}).map((a) => a.token))`)))

    // Remove from the panel in any order: always the FIRST row (not at the end of the prompt).
    let removed = 0
    for (let i = 0; i < 6; i++) {
      const first = await evaluate(`${A}.list(${JSON.stringify(claudeKey)}).find(a => a.state === 'inserted')?.id ?? null`)
      if (!first) break
      await evaluate(`document.querySelector('${pane} [data-attachments] li[data-attachment=inserted] button').click()`)
      const gone = await waitFor(`!${A}.list(${JSON.stringify(claudeKey)}).some(a => a.id === ${JSON.stringify(first)})`, 6000, 'removed').catch(() => false)
      if (!gone) break
      removed++
    }
    check('remove from panel works in any order (first row each time)', removed >= 3 && (await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length === 0`)), `removed ${removed}`)
    await shot('v25-10-attach-removed')

    // Erasing a mention one Backspace at a time leaves no ghost rows.
    await evaluate(`${A}.add(${JSON.stringify(claudeKey)}, [{ kind: 'file', name: 'CLAUDE.md', source: 'pick', path: ${JSON.stringify(path.join(REPO, 'CLAUDE.md'))} }], true)`)
    await waitFor(`${A}.live(${JSON.stringify(claudeKey)}).some(a => a.token === '@CLAUDE.md' && a.seen)`, 10000, 'mention in').catch(() => {})
    await evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    for (let i = 0; i < '@CLAUDE.md '.length; i++) {
      await key('Backspace', 'Backspace', 8, 0)
      await sleep(60)
    }
    await sleep(600)
    check('no ghost rows while a mention is erased', await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length === 0`), String(await evaluate(`JSON.stringify(${A}.live(${JSON.stringify(claudeKey)}).map((a) => a.token))`)))
```

(Check the helper names at the top of `run()` in `v25.cjs` — it destructures `key` and `sleep` from `app` like `explorer.cjs`; add them to the destructuring if missing, and `const path = require('node:path')` if absent. No Enter is pressed anywhere.)

- [ ] **Step 5: Verify** — `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/v25.cjs` — Expected: clean; PASS; the three new v25 checks PASS. If "any order" fails because Claude Code mis-reads the arrow keys, look at `v25-10-attach-removed.png` and the pane buffer, raise `KEY_GAP_MS` to 30 and re-run before changing anything else.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/promptAttachments.ts apps/web/src/lib/promptAttachments.test.ts apps/web/src/stores/attachments.ts apps/web/src/stores/attachments.test.ts apps/web/src/composables/usePaneAttachments.ts apps/web/src/components/workspace/TermPane.vue apps/web/src/components/workspace/AttachmentsPanel.vue apps/web/src/i18n/workspace-v25.ts docs/claude-code-integration.md apps/desktop/e2e/v25.cjs
git commit -m "🐛 Attachments follow Backspace and can be removed in any order

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


### Task 3: Index, plan note, version

**Files:**
- Create: `.planning/PLAN-v37-attachments-removal.md`
- Modify: `.code_index/web.md`, `.code_index/_meta.md`, `apps/desktop/package.json`

- [ ] **Step 1:** `.planning/PLAN-v37-attachments-removal.md` — 8–12 lines: Goal, the ghost-row cause, `eraseKeys` / `cursorToken`, `reconcile(…, editing)`, queued arrow-key erase, the 4 Rulings above, tests (`promptAttachments.test.ts`, `attachments.test.ts`, `e2e/v25.cjs`), link to this plan.
- [ ] **Step 2:** `.code_index/web.md` — next to the v25 attachments lines: `- v37: lib/promptAttachments.ts eraseKeys (← to after the token on the cursor row, Backspaces, → back; null off-row / after cursor / wide chars) replaces eraseCount; cursorToken (mention at the cursor) → attachments.reconcile(…, editing) skips it (no ghost rows); usePaneAttachments.remove queues one-key-per-write erases from a fresh screen read (appCursorKeys from TermPane).` `_meta.md`: one line with the paths.
- [ ] **Step 3:** bump `apps/desktop/package.json` `version` one minor above `master`'s at merge time.
- [ ] **Step 4: Verify** — `npm run typecheck && npm test && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/v25.cjs` — Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add .planning/PLAN-v37-attachments-removal.md .code_index apps/desktop/package.json
git commit -m "📝 Attachments removal plan note, code index and version

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
