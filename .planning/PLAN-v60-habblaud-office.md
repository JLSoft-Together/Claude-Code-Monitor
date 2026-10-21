# Habblaud Office on the Monitor page — Implementation Plan (v60)

> **Status:** implemented 2026-10-21 (branch `worktree-v60-habblaud-office`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the Habblaud pixel-art office (one room per project, a character per agent, social life, sound, day timelapse) as a third center view on the Monitor page, fed by Orrery's own collector data.

**Architecture:** Copy the Habblaud office code as-is into a new workspace package `packages/habblaud` (`@ccm/habblaud`). Keep the upstream paths so its relative imports and its own tests still work. The collector turns its terminals/agents into a Habblaud `OfficeSnapshot` (`OfficeModel` + `OfficeHub`). It sends that snapshot only to WS clients that subscribed, and records it with the copied `TimelineRecorder`. The web adds an `OfficeFeed` shim (the `{snapshot, on, pushReplay}` surface `createWorld` needs), an `OfficeView.vue` that hosts the canvas, and a Vue timelapse bar.

**Tech Stack:** TypeScript, Vue 3 + Pinia + vue-i18n, Vite, Vitest, Node collector (ws), Habblaud 1.0.3 sources (MIT).

**Spec:** user request "ở page monitor, triển khai y nguyên @src/habblaud" + answers (2026-10-21): port the office canvas (not the Habblaud server, not its UI panels); a Map / Office toggle in the Monitor center; include Social life, Sound and Timelapse; leave out Habblaud World (city). Upstream reference: `src/habblaud/` (README.md, shared/types.ts, client/src/world/index.ts, server/history/timeline.ts).

**Execution step 0:** copy this plan to `.planning/PLAN-v60-habblaud-office.md` (project convention) and commit it with Task 1.

## Global Constraints

- Local-only: nothing from Habblaud World (`client/src/world/city`, `client/src/world/visit*`, `client/src/net/world*.ts`, `server/world`, `ui/world`) is copied, and no new network calls are made. The only fetches are same-origin `/assets/manifest.json`, `/assets/*.png` and `/api/timeline/*`.
- The collector never sends raw tool arguments, commands, file paths or message content. An office activity carries only the tool name, kind, icon and time (CLAUDE.md "Never expose … raw tool arguments").
- Zero token cost: no prompts, permission answers or messages are sent to agents. Habblaud's permission, composer, terminal, pty and spawn features are not ported.
- Upstream code is copied byte-for-byte. Allowed local patches are listed in `packages/habblaud/UPSTREAM.md`, each with a reason: the i18n `vi` + `setLocale`, the keyboard editable-target guard, and anything a later task names explicitly.
- Orrery chrome (toggle, toolbar, options popover, timelapse bar, empty states) uses vue-i18n `en` + `vi` and theme tokens only. Deviation, documented in `.code_index/web.md`: text inside the canvas keeps Habblaud's own `tr()` with `en` and `vi` dictionaries, and the pixel art keeps Habblaud's own palette.
- Performance: `office.snapshot` goes only to clients that sent `office.subscribe {on:true}`. The collector commits at most every 200 ms (Habblaud hub rate). With Office not visible there is no rAF loop and no subscription.
- No horizontal page scroll. The canvas fills the AgentMap center (`min-w-0 flex-1`).
- Constants copied from upstream `server/model/office.ts`: `OFFLINE_GRACE_MS = 20_000`, `DONE_GRACE_MS = 25_000`, `SLOT_COOLDOWN_MS = 30_000`, `SNAPSHOT_RECENT = 8`.
- Timeline storage `<dataDir>/timeline/YYYY-MM-DD.jsonl` (upstream `TIMELINE_DIR`, `RETENTION_DAYS = 7`, size limits unchanged). Names are persisted in `<dataDir>/office-names.json`.
- Commits use gitmoji (repo style, e.g. `✨ …`) and end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. Typing W/A/S/D, `+`, `-`, `0` in any input (session search, alias rename, settings) while Office is visible must not move the camera. Test in Task 6, patch in Task 1.
2. Leaving Office (Map/Timeline toggle, another tab, `ui.compact`) must stop the render loop and unsubscribe, so there is no CPU use and no snapshot traffic. Test in Task 6.
3. Windows paths: `C:\Code\app`, `c:\code\app\` and `C:/Code/app` are one room, and a terminal without `cwd` gets an "unknown" room instead of a crash. Test in Task 3.
4. A collector restart or WS reconnect must keep the last office visible (stale) and re-send `office.subscribe` after reconnect. Test in Task 5.
5. Switching the language en↔vi while Office is open re-creates the world and canvas text changes language. A day with no timeline file makes the timelapse show "no history", not an error. Tests in Tasks 2 and 8.

---

### Task 1: Vendor package `@ccm/habblaud`

**Files:**
- Create: `packages/habblaud/package.json`, `tsconfig.json`, `vitest.config.ts`, `LICENSE` (upstream MIT), `UPSTREAM.md` (source = Habblaud 1.0.3, repo marmottajr/habblaud; list of copied paths, dropped tests and local patches)
- Copy verbatim from `src/habblaud/`, same relative paths under `packages/habblaud/`:
  - `client/src/world/**` except `city/`, `visit/`, `visit-social.ts`, `visit-social.css`
  - `client/src/art/**` except `preview.ts`
  - `client/src/audio/**`
  - `client/src/net/timeline.ts` (+ test)
  - `shared/**` (types, i18n, locales, activity, names, appearance, hash, timeline, daystats, github, demo, world pure helpers…)
  - `server/history/timeline.ts`, `server/http/timeline.ts`, `server/model/rooms.ts`, `server/model/names.ts`, `server/log.ts` (+ their tests)
  - Any further transitive import these pull in. If one reaches `server/world`, `client/src/ui/**` or `client/src/net/world*`, stop and report.
- Copy `client/public/assets/**` → `apps/web/public/assets/**` (upstream URL `/assets/…` unchanged; Vite's hashed `assets/*.js` never collide with these names).
- Modify: `packages/habblaud/shared/i18n.ts` (patch A), `packages/habblaud/client/src/world/input.ts` (patch B)

**Interfaces:**
- Produces package `@ccm/habblaud` (`"type":"module"`). `exports`: `"./*": { "types": "./types/*.d.ts", "default": "./*.ts" }` (plus an `index` mapping for folder entries such as `client/src/world` → `client/src/world/index.ts`). Consumers import `@ccm/habblaud/shared/types`, `@ccm/habblaud/client/src/world`, etc. Vite, Vitest, tsx and esbuild bundle the `.ts` sources. `tsc` in web and collector reads the emitted `.d.ts`, so the upstream code is never checked under Orrery's stricter `noUncheckedIndexedAccess` / `verbatimModuleSyntax`.
- Scripts: `typecheck` = `tsc -p tsconfig.json` (upstream flags) and then `tsc -p tsconfig.types.json` (`emitDeclarationOnly`, `outDir: types`). `prepare` runs the types build, so `npm install` creates `types/`. `types/` is gitignored. Root `npm run typecheck` already runs `packages/*` before `apps/*`.
- Patch A: `Locale` gains `'vi'`. `normalizeLocale('vi'|'vi-VN')` returns `'vi'`. New `export function setLocale(l: Locale): void` sets the active locale (the one `getLocale()` returns and `tr()` uses).
- Patch B: `onKey` in `input.ts` returns early when `e.target` is `input`, `textarea`, `select` or `[contenteditable]`, or when `e.ctrlKey || e.metaKey || e.altKey`.
- `tsconfig.json` copies upstream flags (strict, no `noUncheckedIndexedAccess`, no `verbatimModuleSyntax`), `include: ["client/src","shared","server"]`, `types: ["vite/client","node"]`.

- [ ] **Step 1: Copy the files, write package.json / tsconfig / vitest config (happy-dom for client tests) / UPSTREAM.md.** Drop upstream tests that import removed folders and list them in UPSTREAM.md.
- [ ] **Step 2: Write failing tests for the patches** in `packages/habblaud/shared/i18n.local.test.ts`: `normalizeLocale('vi-VN') === 'vi'`, and `setLocale('vi'); registerDictionary('vi', {'Lendo arquivo':'Đang đọc tệp'}); tr('Lendo arquivo') === 'Đang đọc tệp'`. In `client/src/world/input.local.test.ts`: dispatch `keydown 'w'` with an `<input>` target and assert the camera offset is unchanged; with `document.body` as target it moves.
- [ ] **Step 3: Run** `npm install` then `npm test -w @ccm/habblaud`. Expected: the new tests FAIL and the upstream tests PASS.
- [ ] **Step 4: Apply patches A and B.**
- [ ] **Step 5: Run** `npm test -w @ccm/habblaud` and `npm run typecheck -w @ccm/habblaud`. Expected: all PASS.
- [ ] **Step 6: Commit** `➕ Vendor the Habblaud office as @ccm/habblaud`.

### Task 2: Vietnamese office dictionary + locale bridge

**Files:**
- Create: `packages/habblaud/shared/locales/vi.ts` (`export const VI: Readonly<Record<string,string>>`, keyed by the PT source text like `en.ts`)
- Create: `packages/habblaud/shared/locales/vi.test.ts`
- Create: `apps/web/src/office/i18n.ts`, `apps/web/src/office/i18n.test.ts`

**Interfaces:**
- Produces `applyOfficeLocale(locale: 'en' | 'vi'): Promise<void>` (web). It lazy-imports `EN` or `VI`, then calls `registerDictionary` + `setLocale`. It must run before the first `import('@ccm/habblaud/client/src/world')`.
- `VI` covers every `tr()` literal reachable from the copied `client/src/{world,art,audio,net/timeline.ts}`, plus `shared/activity.ts` `describeTool`, `describeWaitingFor` and `SPECIAL`. Use `EN` as the source for meaning; tone is a casual office, as upstream.

- [ ] **Step 1: Write failing tests.** `vi.test.ts` "vi covers every office string": scan those files for `tr('…')` / `` tr(`…`) `` literals (same regex as upstream `scripts/i18n-check.ts`) and expect each key to be in `VI` and in `EN`. `i18n.test.ts`: after `await applyOfficeLocale('vi')`, `describeTool('Edit', undefined).text === VI['Editando arquivo']`; after `applyOfficeLocale('en')` it equals `EN['Editando arquivo']`.
- [ ] **Step 2: Run** `npm test -w @ccm/habblaud -- shared/locales/vi.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Write `vi.ts` and `apps/web/src/office/i18n.ts`.**
- [ ] **Step 4: Run** both test files. Expected: PASS.
- [ ] **Step 5: Commit** `🌐 Add Vietnamese office strings and locale bridge`.

### Task 3: Collector `OfficeModel` (Orrery state → `OfficeSnapshot`)

**Files:**
- Create: `apps/collector/src/office/model.ts`, `apps/collector/test/office-model.test.ts`
- Modify: `apps/collector/package.json` (dependency `@ccm/habblaud`)

**Interfaces:**
- Consumes: `TerminalSession`, `Agent`, `ToolSpan` (`@ccm/shared`), `NameStore` (`@ccm/habblaud/server/model/names`), `SlotAllocator`, `roomDisplayNames` (`…/server/model/rooms`), `hash32` (`…/shared/hash`), `describeTool` (`…/shared/activity`).
- Produces `class OfficeModel { constructor(deps: { names: NameStore; platform?: NodeJS.Platform; now?: () => number }); setState(terminals: readonly TerminalSession[], agents: readonly Agent[]): void; addSpan(span: ToolSpan): void; tick(): boolean /* true = changed by grace expiry */; snapshot(): OfficeSnapshot }` and `roomKey(cwd: string | undefined, platform: NodeJS.Platform): string`.

Mapping (decided here; the test pins each row):

| OfficeSnapshot field | From |
|---|---|
| room id | `roomKey(terminal.cwd)`: backslashes → `/`, trailing `/` stripped, win32 lowercased; missing cwd → `'(unknown)'` |
| room name / slot / seed | `roomDisplayNames`, `SlotAllocator` (cooldown 30 s), `hash32(roomId)` |
| agent id / kind / parentId | Orrery `Agent.id`; `role==='main'` → `'main'`, else `'sub'`; `parentId` |
| provider / account | `provider ?? 'claude'`; account `'claude'` or `'codex'` |
| name / look | `NameStore` (persisted; same id → same name across restarts) |
| seed | `hash32(agent.id)` |
| role / title | main: `'main'` (relabelled on the web); sub: `agent.type ?? 'sub'`. Title: main `terminal.alias ?? terminal.title`, sub `agent.description` |
| status main | terminal `working`→`working`, `waiting`→`waiting`, `idle`→`backgroundShell ? 'shell' : 'idle'`, `error`/`unknown`→`idle`; terminal removed or `stale` → `offline` for 20 s, then dropped |
| status sub | `working`/`waiting`/`idle` same; `completed`/`error`/`cancelled` → `done` for 25 s, then dropped; `unknown` → `working` |
| waitingFor | raw `terminal.waitingFor` (localized on the web) |
| activity / recent | `currentTool` → `{id:`${agentId}:${at}`, tool, ...describeTool(tool, undefined), at}`; `recent` = last `SNAPSHOT_RECENT` spans per agent from `addSpan` |
| shells | `backgroundShell` → `[{id:`${terminalId}:bg`, label:'', startedAt: statusSince, background:true, kind:'shell'}]`, else `[]` |
| tasks | `[]` (no reliable data) |
| stats | `tokensIn = inputTokens + cacheReadTokens`, `tokensOut = outputTokens`, `toolCalls` = spans seen, `subagents` = child count (0 when unknown) |
| statusSince / startedAt / lastEventAt | `Date.parse` of the Orrery ISO fields, fallback `now()` |
| accounts | one per provider present: `{id, provider, short:'C'|'X', name:'Claude'|'Codex', color:'#000000', configDir:'', sessions, usageStatus:'disabled'}` (colour set on the web) |
| meta | `{demo:false, sources:[], startedAt, version: app version}`; `rev` +1 per changed snapshot; `serverTime = now()` |

- [ ] **Step 1: Write failing tests**, one `it` per table row, plus: two terminals with cwd `C:\Code\app` and `c:/code/app/` on win32 → one room; terminal without cwd → room `'(unknown)'`; removed terminal → agent `offline`, and after `tick()` at +20 001 ms it is gone; completed sub → `done`, gone after 25 s; snapshot never contains a key named `input`, `command` or `detail` (JSON scan).
- [ ] **Step 2: Run** `npm test -w @ccm/collector -- test/office-model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `OfficeModel` and `roomKey`.**
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `✨ Map collector state to a Habblaud office snapshot`.

### Task 4: Collector `OfficeHub`, protocol, timeline routes

**Files:**
- Create: `apps/collector/src/office/hub.ts`, `apps/collector/test/office-hub.test.ts`
- Modify: `packages/shared/src/types.ts` (ServerMessage / ClientMessage unions near `toolSpans.data:431` / `toolSpans.get:457`), `packages/shared/package.json` (dep `@ccm/habblaud`, type-only use)
- Modify: `apps/collector/src/server.ts` (validate `office.subscribe` like `toolSpans.get:315`; HTTP `GET /api/timeline/days` and `/api/timeline/:day` through the copied `createTimelineHandler`, behind the existing `hasAppKey`), `apps/collector/src/index.ts` (create the hub after `monitor.start()`, flush on shutdown), `apps/web/vite.config.ts` (dev proxy `/api/timeline` → `127.0.0.1:4317`; `/assets/*` is served from `public/` by Vite itself)

**Interfaces:**
- Protocol: `{ type: 'office.snapshot'; payload: OfficeSnapshot }` (server→client, direct to subscribers, never batched into `seq`); `{ type: 'office.subscribe'; on: boolean }` (client→server).
- Produces `class OfficeHub { constructor(o: { store: MonitorStore; model: OfficeModel; recorder?: TimelineRecorder; send: (clientId: string, m: ServerMessage) => void; commitMs?: number /*200*/; tickMs?: number /*1000*/ }); subscribe(clientId: string, on: boolean): void; dropClient(clientId: string): void; start(): void; stop(): void }`. It listens via `store.subscribe` and reads current terminals/agents from the store getters (add read-only `terminalList()` / `agentList()` to `MonitorStore` if missing). It feeds `tool.span` events into `model.addSpan`, commits at most once per `commitMs`, and calls `recorder.ingest(snapshot)` on each commit.

- [ ] **Step 1: Write failing tests** (fake timers): a subscriber gets the current snapshot immediately on `subscribe(id,true)`; 10 store changes inside 200 ms → one `office.snapshot`; a non-subscribed client gets nothing; `subscribe(id,false)` stops sends; `recorder.ingest` is called on each commit even with zero subscribers; `server.ts` rejects `office.subscribe` with a non-boolean `on`.
- [ ] **Step 2: Run** `npm test -w @ccm/collector -- test/office-hub.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the hub, protocol types, server wiring and timeline routes** (`TimelineRecorder({ dir: join(config.dataDir, TIMELINE_DIR) })`, `.start()` on boot, `.stop()` on shutdown).
- [ ] **Step 4: Run** `npm test -w @ccm/collector` and `npm run typecheck`. Expected: PASS. Manual: `npm run dev` with `node scripts/demo-fixture.mjs --sessions=5 --subagents=3` (env per CLAUDE.md), then `curl 127.0.0.1:4317/api/timeline/days` lists today.
- [ ] **Step 5: Commit** `✨ Stream office snapshots and record the office timeline`.

### Task 5: Web `OfficeFeed` + localization + connection routing

**Files:**
- Create: `apps/web/src/office/feed.ts`, `apps/web/src/office/localize.ts`, `apps/web/src/office/feed.test.ts`, `apps/web/src/office/localize.test.ts`
- Modify: `apps/web/src/stores/connection.ts` (`apply()` routes `office.snapshot`; new `subscribeOffice(on: boolean)`; it re-sends the last `on` after every reconnect in `connect()`)

**Interfaces:**
- Produces `class OfficeFeed { snapshot: OfficeSnapshot | null; readonly liveSnapshot: OfficeSnapshot | null; readonly replaying: boolean; on(ev: 'snapshot', cb: () => void): () => void; ingestLive(s: OfficeSnapshot): void /* ignored while replaying, still kept as liveSnapshot */; pushReplay(s: OfficeSnapshot): void; stopReplay(): void /* restores liveSnapshot and emits */ }` plus a module singleton `officeFeed`.
- Produces `localizeSnapshot(s: OfficeSnapshot, colors: { claude: string; codex: string }): OfficeSnapshot` (pure, new object). Activity text: `tool` set → `describeTool(tool, undefined).text`, otherwise the `SPECIAL` text for the kind. `waitingFor` → `describeWaitingFor(raw)`. Role `'main'` → `tr('Agente principal')`. Empty shell label → `tr('Shell em segundo plano')`. Account `color` from `colors`. Callers resolve colours from CSS vars `--ccm-agent-claude` / `--ccm-agent-codex`.
- `ingestLive` and `pushReplay` both run `localizeSnapshot` (replays come from the recorded, unlocalized snapshots).

- [ ] **Step 1: Write failing tests.** Feed: `on` fires on ingest; during replay `ingestLive` does not change `snapshot` but updates `liveSnapshot`; `stopReplay` restores live. Localize: Edit → vi text; waiting `"permission prompt"` → `describeWaitingFor` result; main role relabelled; colours applied; input not mutated. Connection: after a simulated reconnect, `office.subscribe {on:true}` is sent again; on disconnect `officeFeed.snapshot` is kept.
- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/office`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w @ccm/web`. Expected: PASS.
- [ ] **Step 5: Commit** `✨ Feed office snapshots to the web`.

### Task 6: `OfficeView.vue` + Map / Office toggle

**Files:**
- Create: `apps/web/src/components/office/OfficeView.vue`, `apps/web/src/components/office/OfficeOptions.vue` (popover), `apps/web/src/components/office/officeView.test.ts`, `apps/web/src/i18n/office-v60.ts` (`{ en, vi }` module pattern like `monitor-v53.ts`, spread into `en.ts` / `vi.ts`)
- Modify: `apps/web/src/stores/ui.ts:25` (`MapView = 'map' | 'timeline' | 'office'`, `initialMapView` accepts it), `apps/web/src/components/AgentMap.vue` (`views` at :1408 gains `office`; render `<OfficeView :terminal-id>` beside `ToolTimeline` at :1426; the `ui.mapView !== 'map'` guards also cover office)

**Interfaces:**
- Consumes `officeFeed`, `connection.subscribeOffice`, `applyOfficeLocale`, `createWorld(canvas, store)` / `WorldApi` (`@ccm/habblaud/client/src/world`), `ui.selectAgent`, `ui.selectedAgentId`, `terminals.byId`, `roomKey` mirror for the web (`officeRoomOf(terminal)`: the room whose agents include the terminal's main agent).
- `OfficeView` props `{ terminalId?: string | null }`. Mount: `await applyOfficeLocale(locale)`, dynamic import world, `createWorld(canvas, officeFeed)`, `subscribeOffice(true)`, `world.setOptions(saved)`. `world.onSelect(sel => sel?.type==='agent' && ui.selectAgent(sel.id))`; watch `ui.selectedAgentId` → `world.select({type:'agent', id}, {focus:true})`; `terminalId` set → `world.focusRoom(room)`. Locale change → destroy + recreate. Unmount → `world.destroy()`, `subscribeOffice(false)`.
- Options persisted in `localStorage['ccm.office.options']` (try/catch): `showNames`, `bubbles`, `liveliness`, `dayNight`, `followSelected` (defaults `DEFAULT_WORLD_OPTIONS`). Toolbar buttons: zoom in/out (`zoomBy(1.25|0.8)`), overview, options, sound (Task 7), timelapse (Task 8). Lucide icons, tokens, aria-labels.

- [ ] **Step 1: Write failing tests** (happy-dom, `createWorld` mocked): mount subscribes and creates the world once; unmount calls `destroy` and `subscribeOffice(false)`; a world `onSelect` agent calls `ui.selectAgent`; changing `ui.selectedAgentId` calls `world.select`; switching locale recreates the world; `ui.mapView='office'` persists across store re-creation; the i18n keys exist in en and vi.
- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/components/office`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before the UI work, load skills `frontend-design:frontend-design` and `ui-ux-pro-max:ui-ux-pro-max` (CLAUDE.md).
- [ ] **Step 4: Run** `npm test -w @ccm/web` and `npm run typecheck`. Expected: PASS. Manual (`npm run dev` + demo fixture): rooms appear per project, characters type or raise a hand, clicking a character selects it in the Sessions panel, typing in the session search does not pan the camera, and switching back to Map stops the loop (DevTools Performance shows no rAF).
- [ ] **Step 5: Commit** `✨ Add the Office view to the Monitor center`.

### Task 7: Office sound

**Files:**
- Create: `apps/web/src/office/sound.ts`, `apps/web/src/office/sound.test.ts`
- Modify: `OfficeView.vue` (sound toggle)

**Interfaces:**
- Produces `createOfficeSound(world: WorldApi, opts: { enabled: () => boolean }): { dispose(): void }`. It is a port of upstream `client/src/ui/sound.ts` `SoundControl`: `world.onSound` → `audio/scheduler`, the AudioContext unlocks on the first pointer or key gesture, and nothing plays while disabled or `document.hidden`. Setting `localStorage['ccm.office.sound']`, default off.

- [ ] **Step 1: Write failing tests:** a cue while disabled schedules nothing; a cue while enabled after a gesture calls the scheduler; `dispose` unsubscribes.
- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/office/sound.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement + toggle.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `🔊 Play office sound cues`.

### Task 8: Timelapse bar

**Files:**
- Create: `apps/web/src/components/office/OfficeTimelapse.vue`, `apps/web/src/components/office/officeTimelapse.test.ts`
- Modify: `OfficeView.vue` (button + key `L` while Office is visible and no editable target is focused; REPLAY badge; the canvas gets CSS `filter: sepia(0.3) saturate(0.9) contrast(1.03)` during replay), `apps/web/src/i18n/office-v60.ts`

**Interfaces:**
- Consumes `fetchTimelineDays`, `fetchTimelineDay`, `TimelineReplay`, `BUCKET_MS` (`@ccm/habblaud/client/src/net/timeline`), `animScale` (`…/world/playback`), `world.setPlayback`, `officeFeed.pushReplay` / `stopReplay`.
- Behaviour mirrors upstream `client/src/ui/timelapse.ts`: `SPEEDS = [60, 180, 600]` (default 180), push at most every 200 ms, seek re-start at most every 120 ms, arrow keys step 60 s, day picker (Today / Yesterday / weekday date), a present/working chart from buckets with peak marks, "Back to live". Strings go through vue-i18n.

- [ ] **Step 1: Write failing tests** (fetch mocked): days listed with today first; play pushes replay snapshots and sets playback; "Back to live" calls `stopReplay` + `setPlayback(null)`; a 404 or empty day shows the "no history" text and no error; the speed buttons are 60×/180×/600×.
- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/components/office/officeTimelapse.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` (all workspaces) and `npm run typecheck`. Expected: PASS. Manual: after ~10 min of demo-fixture activity, the timelapse replays the day in sepia and Back to live returns.
- [ ] **Step 5: Commit** `✨ Replay the office day as a timelapse`.

### Task 9: Desktop build, licences, docs

**Files:**
- Modify: `apps/desktop/build.mjs` only if the esbuild collector bundle fails to resolve `@ccm/habblaud` (it should resolve like `@ccm/shared`)
- Modify: the third-party notice used for the Atom Material icons (find it via `scripts/gen-file-icons.mjs`) to add Habblaud MIT
- Modify: `.code_index/{_meta,collector,web,protocol,desktop}.md`, `CLAUDE.md` ("What this is": a one-line v60 sentence), `.planning/PLAN-v60-habblaud-office.md` (status)

- [ ] **Step 1: Run** `npm run desktop`. Expected: the app starts, Monitor → Office renders with live sessions, and `collector.log` has no errors. Then run `npm run e2e -w @ccm/desktop`. Expected: PASS.
- [ ] **Step 2: Update licences, code index and CLAUDE.md.** The index records the i18n/palette deviation, the copied paths and the local patches.
- [ ] **Step 3: Commit** `📝 Document the v60 Habblaud office`.

## Execution

Recommended: **Subagent-driven** (superpowers:subagent-driven-development). There are 9 tasks that pass exact interfaces along a chain (vendor → model → hub → feed → view → sound and timelapse). A mistake in privacy (raw tool args) or performance (traffic to clients that did not subscribe) would be costly, so a review after each task is worth it. Alternative: Native (superpowers:executing-plans) with one review of the whole branch at the end.

## Verification (end-to-end)

- `npm test`, `npm run typecheck` (all workspaces, including `@ccm/habblaud` with its upstream tests).
- `node scripts/demo-fixture.mjs --sessions=5 --subagents=3` + `CLAUDE_CONFIG_DIR=<root> CCM_VERIFY_PROCESSES=0 npm run desktop`. On Monitor, switch to Office and check: one room per project, subagents arrive by elevator and leave after done, a waiting agent raises a hand, idle agents socialise, sound plays only when enabled, the timelapse works, en↔vi switches canvas text, and nothing goes out on the network (DevTools Network: only `127.0.0.1`).
