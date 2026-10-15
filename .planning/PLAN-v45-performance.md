# PLAN v45 — Performance (from AUDIT-2026-10-15-performance.md)

Verdict of the audit: no Go/Rust rewrite. Fix algorithms, process spawning and main-thread work in the current stack.
Every phase ends with the audit's own measurement re-run (scratchpad harness: `/health` time, boot CPU, RSS peak,
heavy demo CPU, shiki freeze) so the gain is measured, not assumed. Numbers go into the "Results" section below.

## Phase A — quick wins (≈ 1.5 days)

| # | Change | Files | Expected | Test |
|---|---|---|---|---|
| A1 | `ToolSpanLog`: prune once per sync / `list()` (and when size > limit), store `endMs` as a number | `collector/src/tool-spans.ts`, `tracker.ts` | `/health` 1.39 → ~0.76 s | `tool-spans` unit (limit, order, expiry unchanged) |
| A2 | Merge `agent.updated` / `terminal.updated` patches by id inside the 50 ms batch; `JSON.stringify` once per broadcast | `collector/src/store.ts`, `server.ts` | −30–50 % events under load | store test: merge keeps last value per field, created→updated→removed order kept |
| A3 | Changes pane refreshes only while visible (stale flag, refresh on show); `RootWatcher` ignores `build`, `.gradle`, `.dart_tool`, `dist`, `.vitest`, `out`, `.idea` | `web/ChangesPane.vue`, `desktop/src/preview/watch.ts` | no git spawns from hidden panes / build output | unit + E2E `diff.cjs` |
| A4 | 1 s clock pauses while the document is hidden; `Intl.RelativeTimeFormat` cached per locale | `web/src/lib/format.ts` | idle renderer work ≈ 0 in tray | format test |
| A5 | Layout daemon AppCDS: `-XX:+AutoCreateSharedArchive -XX:SharedArchiveFile=<cache>/daemon-<jdk>-<layoutlib>-<jar hash>.jsa` when JDK ≥ 19; stale archives removed | `desktop/src/layout/daemon.ts` | init 3.2–5.3 s → est. −20–40 % (measure via `initialized … in N ms`) | daemon args unit; int test |

## Phase B — boot path (≈ 1–2 days)

B1. Collector listens first: `startServer` before `monitor.start()`; `verifyNew`, `codex.start()` and usage run after
listen. Trackers discovered later emit `terminal.created` / `agent.created` as today. A `snapshot.loading` flag (protocol,
optional, unknown-field safe) lets the web show "Loading sessions…" instead of an empty dashboard until the first pass ends.
B2. Desktop no longer gates the dashboard on full catch-up (`/health` answers as soon as the server listens).
Expected: warm boot fits inside the 2.3 s intro. Tests: `monitor.test.ts` ordering, snapshot-then-incremental contract.

## Phase C — collector load (≈ 4–7 days)

C1. Targeted sync: `routeProjectChange` passes the changed file to `tracker.sync({ files })`, only that file is tailed;
reconcile (5 s) skips resolved subagents. Expected heavy-load CPU 65 → ~45 %.
C2. Tail-only catch-up for finished subagents (status from main transcript + meta) and for huge main transcripts
(keyword pre-scan for links / notifications before `JSON.parse`). Expected boot RSS peak 300 → ~100 MB.
Riskiest item (status / spans correctness): extend `tracker.test.ts` with real-shaped fixtures before changing it.

## Phase D — Windows process table (≈ 2–4 days)

One `listProcesses()` for `process.ts`, `codex/processes.ts`, `pty/owners.ts`, toast/focus/Android stop.
Implementation per owner decision (see "Decisions"). PowerShell CIM stays as fallback; parity test against
`parseProcessQueryOutput` output shape. Expected 1.1 s / 1.5 CPU-s per query → ≤ 60 ms / ≈ 0.

## Phase E — renderer freezes (≈ 3–5 days)

E1. shiki tokenize + `wordDiff` in a Web Worker (Vite `?worker`, same-origin, CSP `script-src 'self'` OK, JS regex engine,
no WASM). Plain text shown first, colours swap in.
E2. FilePane / DiffView / SplitDiff render a window of rows above ~3 000 lines (scroll sync / fold / connectors kept).
Expected: 0.2–0.9 s freezes gone. E2E `split-diff.cjs`, `file-editor.cjs`, `diff.cjs` must stay green.

## Phase F — optional

F1. Toast host kept alive (one PowerShell for toasts, AUMID unchanged per docs §11i) or Electron `Notification({toastXml})`
for the installed build. F2. Shared JSONL reader for UsageIndex + tracker (1–2 weeks) — only if C is not enough.
Rust sidecar: not planned.

F1 choice (2026-10-15): **long-lived PowerShell host** (`collector/src/ps-host.ts`), not Electron `Notification({toastXml})`.
Electron would show under the app AUMID (portable build has no Start Menu shortcut → no toast / no activation), could not
`History.Remove(tag, 'ccm')` a toast left by an earlier collector run, and has no registry health check. The host keeps
docs §11i behaviour byte for byte (same AUMID, XML, protocol actions, `CCM_TOAST_LINK` URLs).

D notes: `folder-pick.ts` never read the process table (the audit listed it by mistake); it stays a PowerShell dialog.
`focus.ts` still needs PowerShell for the window calls, but its parent walk now comes from the native table
(`CCM_FOCUS_CHAIN`), so the script runs no CIM query. `QueryFullProcessImageNameW` was not needed (Toolhelp's exe name
matches CIM `Name`).

## Decisions (owner)

Owner answers, 2026-10-15:
- Windows process table via **koffi FFI** (Toolhelp32 + OpenProcess/GetProcessTimes in-process; Codex command line via
  NtQueryInformationProcess / PEB read, or CIM kept only for that field when a `codex.exe` is present). PowerShell CIM stays as fallback.
- Boot: **UI first, sessions load progressively** ("Loading sessions…" line until the first pass ends).
- Scope: **all phases A–F** (F1 toast host included; F2 shared reader only if C is not enough).

Work split (parallel agents): collector = A1 A2 B C · process/toast = D F1 · web/desktop = A3 A4 A5 E.

## Results

_Measured numbers per phase._

### D — Windows process table (koffi 3.3.2), measured 2026-10-15 on this machine (≈ 325 processes, Node 24)

| Query | Before (PowerShell CIM spawn) | After (koffi, in-process) |
|---|---|---|
| Full table (`owners`, codex) | 1 141–1 420 ms wall, 1 828–2 062 ms CPU | 15–17 ms wall, ≤ 16 ms CPU (median of 11; 16 ms = Windows CPU accounting tick) |
| Filtered by pid (`queryProcesses`) | 1 302–1 450 ms wall, 1 953–2 062 ms CPU | 16 ms wall, ≤ 16 ms CPU |
| `listCodexProcesses` (table + command lines) | same CIM cost | 17 ms wall, 15 ms CPU |
| koffi load + first table | — | 28–33 ms once per process |

- Fallback: a queried pid / `codex.exe` without a readable start time (elevated, other user) sends that one query to CIM;
  koffi load failure → CIM for the process lifetime (warning in `collector.log` / `pty.log`, checked by E2E with
  `CCM_KOFFI` pointing nowhere: `p2` owners + Claude link still pass).
- Package: + 1.07 MB unpacked in `resources/koffi` (Windows only; `koffi.node` 1.02 MB); macOS unchanged.
- Tests: `collector/test/win-procs.test.ts` (loader throws → CIM, table → `ProcessInfo` shape, codex walk, focus chain,
  koffi vs CIM parity for the current process tree: pid / ppid / name equal, FILETIME ± 1 µs; `PsHost` id matching,
  crash respawn, hang kill), `desktop/test/proc-table.test.ts`; collector 219 + desktop suites green. E2E (dev stage,
  CCM_E2E_PORT 4382): `p2`, `p5`, `desktop-only`, `tier2`, `rail` all PASS; packaged `--dir` build loads koffi from
  `resources/koffi` under Electron 44.4.5.

### F1 — toast host

| Call | Before (spawn per call) | After (one host) |
|---|---|---|
| First request after start / idle | ≈ 1.0–1.4 s (PowerShell + WinRT load) | 1 378 ms (host start) |
| health / show / hide afterwards | same ≈ 1.0–1.4 s each, 60–80 MB transient process | 14 / 43 / 4 ms |

Host stays resident (~60–80 MB) only while toasts flow; exits after 10 min idle.

### A3 / A4 / A5 / E — web + desktop (2026-10-15)

- A3: `ChangesPane` hidden → `stale` flag, one refresh when shown again (no refresh on show when nothing changed);
  `RootWatcher` ignores `build .gradle .dart_tool dist .vitest out .idea` segments below the watched root (a pane whose
  own root is inside such a folder still sees its changes: the check is on the relative path).
- A4: clock stops on `visibilitychange` hidden (tray), ticks at once on visible; `Intl.RelativeTimeFormat` cached per locale.
- A5 AppCDS. `AutoCreateSharedArchive` (JDK ≥ 19) is refused by the Android Studio JBR 21.0.10 ("unsupported when base
  CDS archive is not loaded": the JBR ships no `classes.jsa`), so the daemon uses **static AppCDS** instead (any JDK ≥ 17):
  first start records `-XX:DumpLoadedClassList`, 30 s after ready a short `java -Xshare:dump` JVM builds
  `daemon-<JAVA_VERSION>-<layoutlib>-<jar key>.jsa` (66 MB) in the background, next starts use `-XX:SharedArchiveFile -Xshare:auto`.
  JVM log → stderr (stdout is the RPC stream). Measured with the daemon's `initialized layoutlib … in N ms` (scratch run,
  real jar, framework-only render):

  | | init (log) | `ensure()` ready |
  |---|---|---|
  | Cold, no archive (3 runs) | 3 377–3 696 ms | 3 610–3 961 ms |
  | With archive (3 runs) | 2 299–2 403 ms | 2 471–2 579 ms (−33 %) |
  | Archive dump (one-off, background) | 4.3–4.9 s, ~1 core | — |
  | Corrupt archive | falls back to cold start, one stderr warning | — |

- E1/E2 measured in the dev app (CDP `longtask` observer, scratch `perf.cjs`; "before" = same build with the worker and
  the row window switched off, i.e. shiki + `wordDiff` on the main thread and every row in the DOM):

  | Case | Before: longest task / sum | After: longest / sum | Rows in DOM before → after |
  |---|---|---|---|
  | Open 33 k chars `.ts` (769 lines) | 297 / 423 ms | 151 / 151 ms (pane chunk + first render, no tokenize) | 769 → 769 |
  | Open 400 k chars `.ts` (9 026 lines) | **1 651 / 3 119 ms**, colours at 3.8 s | **0 / 0 ms**, colours at 1.5 s | 9 026 → 128 |
  | Scroll it, 20 jumps of 9 000 px | 114 / 1 463 ms | 74 / 779 ms | — |
  | Changes, inline full-context diff of it (75 changes) | **1 437 / 5 198 ms**, ready at 6.0 s | **0 / 0 ms**, ready at 2.7 s | 9 054 → 128 |
  | Changes, split | **1 666 / 3 949 ms**, ready at 6.7 s | **0 / 0 ms**, ready at 2.7 s | 18 049 → 257 |

  Window kicks in above 3 000 rows (`lib/rowWindow.ts`), so small files / diffs and their E2E are unchanged. E2E green
  (CCM_E2E_PORT 4383): split-diff, diff, file-editor, minimap, log, explorer, loose-kit, drawable-preview.

### A1 / A2 / B / C — collector (2026-10-15)

Method: collector bundled with esbuild from the working tree before ("base", HEAD tracker/tailer/tool-spans/store/index)
and after, run `--dev` in the scratchpad (own `CCM_DATA_DIR`, warm usage cache, `CCM_TOAST=0`), `-r` preload sampling
`process.cpuUsage()` + RSS every 50 ms, `/health` polled every 20 ms, a WS client for snapshot / `sessions.loading`.
Real data = `~/.claude` with 2 live sessions (46 agents, incl. one 27 MB main + 41 subagents). Machine shared with
other agents' builds, so absolute times are noisy; runs alternate base / after.

| Real data, warm | Base | After |
|---|---|---|
| `/health`, verify off (2 runs each ×2) | 3 206–4 051 ms | **101–128 ms** |
| Sessions complete (base = `/health`; after = `sessions.loading` false), verify off | 3 206–4 065 ms | **806–865 ms** |
| `/health`, verify on (PowerShell / koffi in the path) | 5 770–6 411 ms | **81–102 ms** |
| Sessions complete, verify on | 5 779–6 418 ms | 1 903–2 883 ms |
| CPU until sessions complete | 3.4–4.2 s | **0.87–1.0 s** |
| CPU first 10 s (incl. usage start) | 3.7–4.4 s | 1.1–1.3 s |
| RSS peak | 251–318 MB | **81–93 MB** |

Real-data parity (both collectors side by side, same instant): 42 finished subagents field-for-field equal
(status, tokens, model, context, completedAt, updatedAt, parent), terminal branch / mode / compactions equal,
658 closed tool spans equal.

| Heavy demo (30 sessions × 6+ subagents, tick 250 ms, 60 s) | Base | After |
|---|---|---|
| Collector CPU | 64.1–64.5 % | **38.4–46.8 %** |
| RSS peak | 182 MB | 182–184 MB |
| Events received / 60 s | 45 005–48 256 | 48 298–51 099 (demo is random; after processed more agents: 1 157–1 182 vs 1 101–1 134) |

- A2 merge rarely fires on this load: each session sync publishes once per 150 ms debounce, so two patches for one id
  inside a 50 ms batch are uncommon (agent.updated per agent per minute ≈ 12.4 base / 13.3 after). The −30–50 %
  estimate of the audit does not hold; the single `JSON.stringify` per batch is the part that saves work (×2 with the
  compact window).
- C2 RSS gain comes mostly from handing records over per line (no whole-file record array) and from skipping
  signal-free record types (`attachment` alone = 37 % of the bytes of a 177 MB main transcript here).
- Bug found by the real-data parity check and fixed before landing: a lite subagent first recorded spans without their
  results; ~2 000 open spans then pushed every closed span of the live session out of the 2 000 cap. Lite catch-up now
  records no spans (they would all be pruned); test `keeps live spans when an old finished subagent ran more tools…`.
- Tests: collector 19 files / 227 (new: real-shaped catch-up snapshots generated with the HEAD tracker then passed
  unchanged by the new one, parse-skip spy, targeted / skip-resolved sync, span cap, store merge, listen-first boot
  contract over a real socket), web 52 / 473, typecheck all workspaces. E2E (stage, CCM_E2E_PORT 4381): desktop-only,
  csp, p2, p6, sidebar, tier2, rail all PASS.
