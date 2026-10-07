# Claude Code Local Agent Monitor — Implementation Plan

## 1. Project Goal

Build a **local-only web dashboard** running on the user's Windows PC to monitor currently active Claude Code CLI sessions across multiple terminals.

The dashboard must:

- Discover and track Claude Code CLI terminal sessions on the local machine.
- Detect terminal title/name changes and update the dashboard in realtime.
- Display the hierarchy of main agents and sub-agents as an interactive **Agent Map**.
- Show realtime agent/session state without requiring manual refresh.
- Support multiple simultaneously running terminals/sessions.
- Use **Vue** for the frontend.
- Use **Tailwind CSS** for styling.
- Apply the installed `/front-end-design` and `/ui-ux-promax` skills when implementing the UI.
- Support **English and Vietnamese**.
- Support **Dark and Light** themes.
- Never require horizontal scrolling at normal dashboard sizes.
- Use **Google Sans** as the primary UI font.
- Run locally; no cloud backend and no Claude API are required for monitoring.
- Avoid spawning an additional Claude monitoring agent, so monitoring itself consumes **zero additional Claude tokens**.

Target Claude Code version:

```text
Claude Code 2.1.289
```

---

# 2. Core Product Concept

Architecture:

```text
┌──────────────────────────────────────────────────────────┐
│                    Claude Code CLI                       │
│                                                          │
│  Terminal A          Terminal B          Terminal C      │
│  Claude session      Claude session      Claude session  │
│       │                   │                   │          │
└───────┼───────────────────┼───────────────────┼──────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                 ┌─────────────────────┐
                 │   Local Collector    │
                 │      Node.js         │
                 └──────────┬──────────┘
                            │
                     normalized events
                            │
                            ▼
                 ┌─────────────────────┐
                 │      WebSocket      │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │    Vue Dashboard    │
                 │                     │
                 │ Terminal Sessions   │
                 │ Agent Map           │
                 │ Agent State         │
                 │ Activity            │
                 └─────────────────────┘
```

The monitoring pipeline must be **observation-only**. It must not send prompts to Claude Code or invoke another LLM just to interpret monitoring data.

---

# 3. Mandatory Skill Usage

Before implementing the frontend:

1. Load and follow `/front-end-design`.
2. Load and follow `/ui-ux-promax`.

These skills are mandatory for the UI implementation.

Use them to determine:

- Dashboard visual hierarchy.
- Layout structure.
- Component composition.
- Spacing system.
- Typography.
- Color/token strategy.
- Dark/light theme behavior.
- Empty/loading/error states.
- Responsive behavior.
- Accessibility.
- Interaction patterns.
- Agent Map presentation.

Do not bypass these skills with an ad-hoc UI.

---

# 4. Technology Stack

## Frontend

- Vue 3
- TypeScript
- Vite
- Tailwind CSS
- Vue Router if multiple views become necessary
- Pinia for global realtime application state
- VueUse where useful
- React Flow is NOT allowed; use a Vue-compatible graph library.

Preferred Agent Map options:

1. Vue Flow — preferred first choice.
2. Cytoscape.js — fallback if Vue Flow does not satisfy performance/interaction requirements.

The Agent Map must support:

- Pan
- Zoom
- Fit-to-view
- Node selection
- Parent → child edges
- Status visualization
- Multiple agent trees
- Realtime node state updates
- Highlight active agent
- Clear completed/error states

## Backend / Local Collector

- Node.js
- TypeScript
- WebSocket server
- Windows process inspection
- Claude Code session/event inspection
- File-system watchers where applicable

Do not add a database in MVP.

Optional later:

- SQLite for historical session data.

---

# 5. Local Runtime Architecture

Recommended structure:

```text
claude-agent-monitor/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   └── ...
│   │
│   └── collector/
│       ├── src/
│       └── ...
│
├── packages/
│   ├── shared/
│   │   ├── types/
│   │   └── protocol/
│   │
│   └── config/
│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

A monorepo is preferred so that frontend and collector share the same TypeScript event/state definitions.

If a monorepo creates unnecessary complexity for the existing project, use a simpler single-package structure while preserving clear separation between `web`, `collector`, and `shared` modules.

---

# 6. Claude Code Integration Investigation

This is the most important technical discovery phase.

Before implementing assumptions about Claude Code internals, inspect Claude Code `2.1.289` and determine what official/local data is available.

Investigate:

- Claude Code process tree.
- Session identifiers.
- Session files.
- Agent/sub-agent information.
- Parent/child relationships.
- Hook/event mechanisms.
- Tool execution events.
- Todo/task state.
- Current working directory.
- Start/end timestamps.
- Session status.
- Token usage if available.
- Model information if available.
- Terminal/process information.
- Any supported local API or event stream.

Prefer official Claude Code hooks/events/session data over scraping rendered terminal text.

Do not depend exclusively on ANSI terminal output if a structured source exists.

If a structured source does not expose all required state, combine sources:

```text
Claude Code structured data
        +
Windows process tree
        +
Terminal metadata
        +
File watchers
```

Document the discovered integration points in:

```text
docs/claude-code-integration.md
```

---

# 6A. Pre-Discovery Findings & Confirmed Decisions (2026-10-07)

Quick inspection of the installed Claude Code `2.1.289` (field names only, no content read) found these sources. Phase 1 must verify and complete them.

## Discovered sources

| Source | Fields / content | Use |
|---|---|---|
| `~/.claude/sessions/<pid>.json` | `pid`, `sessionId`, `cwd`, `startedAt`, `procStart`, `version`, `kind`, `entrypoint`, `name`, `nameSource`, `status`, `updatedAt`, `statusUpdatedAt` | Session registry: discovery, title, status. Watch one directory instead of scanning processes |
| `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` | Main agent transcript | Current tool, activity, token usage (verify) |
| `~/.claude/projects/<cwd-slug>/<sessionId>/subagents/agent-<id>.jsonl` | Subagent transcript | Subagent tool/activity/completion |
| `~/.claude/projects/<cwd-slug>/<sessionId>/subagents/agent-<id>.meta.json` | `agentType`, `description`, `toolUseId`, `spawnDepth`, `requestShape` | Hierarchy: `toolUseId` links to the parent tool call; `spawnDepth` gives nesting |
| Hooks in `settings.json` | Realtime lifecycle events | Optional, not in MVP (see Decision 4) |

Root directory must honor the `CLAUDE_CONFIG_DIR` env override, defaulting to `~/.claude`.

## Confirmed decisions

1. **Title = Claude session `name`** (from `sessions/<pid>.json`, changed via `/rename`; `nameSource` tells derived vs user-set). Windows Terminal tab title is V2.
2. **Status mapping table** from raw Claude status to display status, maintained in `packages/shared`. Phase 1 lists every raw value observed.

   | Raw `status` | Display status |
   |---|---|
   | `busy` | `working` |
   | `waiting` | `waiting` (+ `waitingFor` reason) |
   | `shell` | `idle` + "background shell" label |
   | `idle` | `idle` |
   | anything else | `unknown` |

   Verified in Phase 1 — see `docs/claude-code-integration.md` §3.

3. **Ended sessions stay visible as `stale` for 120 minutes** (configurable), then are removed. A session is ended when its PID is no longer alive, or the PID is alive but `procStart` does not match (PID reuse).
4. **Hooks are not used in MVP.** MVP is file-based only, so it needs zero configuration of the user's Claude Code. Hooks may be added later as an opt-in with explicit install/uninstall commands that back up and merge `settings.json` without touching existing hooks.
5. **One main agent per session + its subagents** (nested by `spawnDepth`). Summary metrics: Sessions · Subagents (running/total) · Working · Waiting · Error. There is no separate "Agents" count.
6. **Content exposure policy:** show `agentType`, subagent `description`, and tool **names** only. Never send tool arguments, prompts, or message bodies to the frontend. Never read `sessions/*.key` files and never expose `messagingSocketPath`.

## Collector ingestion rules

- Transcripts can exceed 1 MB: tail incrementally by byte offset per file, never re-read whole files. Tolerate a partial last line.
- `fs.watch` on Windows can drop events: combine watchers with a low-frequency reconcile scan (~5 s) of `sessions/` and PID liveness.
- Version drift: Claude Code auto-updates. Read `version` from each session file; on mismatch with the verified version, keep running with defensive parsing and surface a warning in the UI.
- Token usage: transcripts likely contain `usage` per assistant message. Phase 1 verifies; if reliable, show it in MVP, otherwise hide.

## Run / launch

- Dev: `pnpm dev` runs collector + Vite web concurrently.
- Build: collector also serves the built web as static files — one process, one port on `127.0.0.1` (port configurable).

## Testing

- Collector tests with Vitest against fixture directories (fake `sessions/` + `projects/` trees, including partial lines, malformed JSON, dead PIDs, unknown statuses). No real Claude session needed.
- The same fixtures can be replayed to drive the UI during Phase 7.

---

# 7. Terminal Discovery

The collector must discover Claude Code processes currently running on Windows.

For every detected Claude Code terminal/session, track:

```ts
interface TerminalSession {
  id: string
  processId?: number
  parentProcessId?: number

  title: string
  shell?: string

  cwd?: string

  claudeSessionId?: string
  claudeVersion?: string

  nameSource?: string
  rawStatus?: string

  status:
    | 'working'
    | 'idle'
    | 'waiting'
    | 'stale'
    | 'error'
    | 'unknown'

  startedAt?: string
  lastActivityAt?: string
  endedAt?: string
}
```

Agents are not nested in `TerminalSession`; they are stored separately and reference `terminalId` (avoids duplicate state between snapshot and `agent.*` events). `status` is derived from `rawStatus` via the mapping table in §6A.

Do not assume terminal title is the unique identity.

Use a stable internal terminal/session ID based on process/session identity.

Verified: terminal ID = `${pid}:${procStart}`. `claudeSessionId` changes on `/clear` while the PID stays, so it is a tracked field, not the identity.

---

# 8. Terminal Title Realtime Tracking

Terminal title changes are a first-class feature.

Example:

```text
Before:
Claude Code

After user changes terminal title:
Android Ads
```

Dashboard must update without refresh.

Collector should detect title changes using the most reliable Windows-compatible mechanism available.

MVP: title = Claude session `name` from `sessions/<pid>.json`, detected by file watcher. Windows Terminal tab title is deferred to V2 (Win32 cannot reliably read per-tab titles).

Event:

```ts
type TerminalUpdatedEvent = {
  type: 'terminal.updated'
  terminalId: string
  changes: {
    title?: string
    cwd?: string
    status?: TerminalStatus
  }
}
```

Frontend should update the corresponding card/node immediately.

No polling-only implementation if an event-driven mechanism is available.

If polling is required, use a low-frequency lightweight poll only for metadata that cannot be subscribed to.

---

# 9. Agent Data Model

Normalize all discovered agent/sub-agent data into a shared model.

Example:

```ts
type AgentStatus =
  | 'working'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'unknown'

interface Agent {
  id: string
  parentId?: string
  terminalId: string

  role: 'main' | 'subagent'
  name?: string
  type?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number

  status: AgentStatus

  currentTask?: string
  currentTool?: string

  startedAt?: string
  updatedAt?: string
  completedAt?: string

  inputTokens?: number
  outputTokens?: number
  totalTokens?: number

  metadata?: Record<string, unknown>
}
```

Token fields must only be displayed when reliable data is actually available.

Never invent token values.

---

# 10. Realtime Event Protocol

Use a small typed event protocol over WebSocket.

Example:

```ts
type MonitorEvent =
  | {
      type: 'snapshot'
      payload: MonitorSnapshot
    }
  | {
      type: 'terminal.created'
      payload: TerminalSession
    }
  | {
      type: 'terminal.updated'
      payload: Partial<TerminalSession> & {
        id: string
      }
    }
  | {
      type: 'terminal.removed'
      payload: {
        id: string
      }
    }
  | {
      type: 'agent.created'
      payload: Agent
    }
  | {
      type: 'agent.updated'
      payload: Partial<Agent> & {
        id: string
      }
    }
  | {
      type: 'agent.removed'
      payload: {
        id: string
      }
    }
  | {
      type: 'activity'
      payload: ActivityEvent
    }
```

On initial WebSocket connection:

```text
server → snapshot
```

Then send incremental events only.

Every message carries a monotonically increasing `seq`. The `snapshot` also carries `protocolVersion`. If the client detects a `seq` gap, it requests a fresh snapshot.

This avoids repeatedly transmitting the entire application state.

---

# 11. Frontend State Architecture

Use Pinia.

Suggested stores:

```text
stores/
├── connection.store.ts
├── terminals.store.ts
├── agents.store.ts
├── activity.store.ts
├── settings.store.ts
└── ui.store.ts
```

Responsibilities:

### connection.store

- WebSocket state
- Connected/disconnected/reconnecting
- Last event timestamp
- Reconnection logic

### terminals.store

- Terminal/session collection
- Terminal ordering
- Title updates
- Terminal status

### agents.store

- Agent collection
- Parent-child relationship
- Status changes
- Agent Map state

### activity.store

- Recent activity
- Tool events
- Errors
- Important state transitions

### settings.store

- Theme
- Language
- UI preferences

---

# 12. Main Dashboard Layout

Primary view:

```text
┌──────────────────────────────────────────────────────────────┐
│ Claude Agent Monitor                         ● Connected      │
│                                                              │
│  3 Sessions   4/12 Subagents   2 Working   1 Waiting  1 Error│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Sessions                         Agent Map                  │
│  ┌──────────────────────┐       ┌─────────────────────────┐ │
│  │ Android Ads          │       │                         │ │
│  │ ● Working            │       │       Main Agent        │ │
│  │ PID 1234             │       │        /    \           │ │
│  │ ~/projects/game      │       │       /      \          │ │
│  └──────────────────────┘       │   Android   Testing     │ │
│                                 │                         │ │
│  ┌──────────────────────┐       └─────────────────────────┘ │
│  │ iOS Game             │                                    │
│  │ ● Waiting            │                                    │
│  └──────────────────────┘                                    │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Recent Activity                                               │
│ 16:25 Agent Android started                                  │
│ 16:24 Tool Edit completed                                    │
│ 16:23 Terminal renamed to Android Ads                         │
└──────────────────────────────────────────────────────────────┘
```

This is conceptual only. Follow `/front-end-design` and `/ui-ux-promax` for the final visual design.

---

# 13. Responsive / No Horizontal Scroll Rule

The dashboard must never require horizontal scrolling.

Rules:

- `overflow-x-hidden` at application level.
- Use CSS Grid/Flex layouts that collapse at narrower widths.
- Agent Map gets an internal pan/zoom canvas rather than page-level horizontal scrolling.
- Session cards wrap or stack.
- Tables must use responsive card/list presentation when necessary.
- Long paths, process names and task names must truncate safely.
- Use tooltips/details for truncated content.
- Minimum supported desktop width should be defined during implementation.
- At smaller widths, prioritize:
  1. Connection state
  2. Session overview
  3. Agent state
  4. Agent Map
  5. Activity

---

# 14. Design System

## Typography

Primary font:

```text
Google Sans
```

Preferred stack:

```css
font-family:
  "Google Sans",
  "Google Sans Text",
  system-ui,
  sans-serif;
```

If Google Sans cannot be loaded from the network, provide a robust local/system fallback.

Do not use arbitrary font families per component.

## Visual Style

Target:

- Clean
- Technical
- Modern
- Calm
- High information density without feeling crowded
- Clear hierarchy
- Minimal decoration
- No unnecessary gradients
- No excessive glassmorphism
- No excessive rounded cards
- No visual noise

The dashboard is a developer tool, not a marketing landing page.

---

# 15. Dark / Light Theme

Implement theme tokens instead of hardcoding colors.

Requirements:

- Dark mode
- Light mode
- Manual theme toggle
- Persist user preference locally
- Optional system preference detection on first launch
- All components must work in both themes

Status colors must remain distinguishable in both themes.

Do not communicate state using color alone.

Example:

```text
● Working
◐ Waiting
○ Idle
✓ Completed
! Error
```

Combine icon + text + color where practical.

---

# 16. i18n

Support:

```text
en
vi
```

Default language can follow browser/system preference, with manual override.

Use structured translation keys:

```text
dashboard.title
dashboard.sessions
dashboard.agents
dashboard.subagents
dashboard.working
dashboard.waiting
dashboard.completed
dashboard.errors

terminal.status
terminal.process
terminal.directory
terminal.lastActivity

agent.status
agent.currentTask
agent.currentTool

activity.title
activity.empty

settings.language
settings.theme
```

Do not hardcode user-facing strings inside Vue components.

Use a Vue-compatible i18n solution such as `vue-i18n`.

---

# 17. Agent Map UX

The Agent Map is a primary feature.

Requirements:

- Main agent visually distinct from sub-agents.
- Parent-child connections are obvious.
- Working agents visually stand out.
- Completed agents become visually quieter.
- Error agents remain prominent.
- Clicking a node opens/selects its details.
- Selecting an agent highlights its ancestors/children.
- Fit-to-view button.
- Zoom controls.
- Reset layout.
- Realtime state transitions.
- New agents appear without destroying the current map unnecessarily.

Avoid excessive animation.

Use subtle transitions for:

- Node state changes
- Agent creation
- Agent completion
- Connection changes

Animations must not make the dashboard feel busy.

---

# 18. Session Cards

Each terminal/session should have a compact but informative card.

Show:

```text
Terminal title
Claude Code status
Working directory
PID
Session duration
Agent count
Current activity
```

Example:

```text
┌──────────────────────────────┐
│ Android Ads             ●    │
│ Claude Code · Working        │
│                              │
│ ~/projects/android-game      │
│ PID 1234                     │
│ 3 agents · 2 working         │
│                              │
│ Editing NativeAdView...      │
└──────────────────────────────┘
```

Clicking a session should focus the Agent Map on that session.

---

# 19. Connection State

The header must clearly show monitor connection state:

```text
● Connected
◐ Reconnecting
○ Disconnected
```

When disconnected:

- Keep the last known state visible.
- Clearly indicate stale data.
- Automatically reconnect.
- Do not clear the dashboard immediately.

Show:

```text
Last update: 2s ago
```

or equivalent.

---

# 20. Activity Timeline

Provide a compact realtime activity stream.

Examples:

```text
16:25:12  Agent "Android Ads" started
16:25:08  Tool "Edit" completed
16:24:51  Terminal renamed → "Android Ads"
16:24:32  Subagent "Testing" created
16:24:10  Agent completed
```

Activity should be virtualized or capped to prevent unbounded memory growth.

MVP can keep the latest 200–500 events in memory.

---

# 21. Performance Requirements

The monitor itself must be lightweight.

Target:

- Minimal CPU when idle.
- No constant high-frequency polling.
- No unnecessary WebSocket broadcasts.
- Frontend should update only affected components.
- Agent Map should not fully rebuild on every event.
- Activity list should be bounded.
- Avoid deep reactive objects where unnecessary.
- Batch bursts of events if Claude Code produces high-frequency activity.

The collector must not interfere with Claude Code execution.

---

# 22. Security / Local-Only Requirements

MVP is local-only.

WebSocket server should bind to:

```text
127.0.0.1
```

not:

```text
0.0.0.0
```

unless remote access is explicitly implemented later.

Do not expose:

- Claude session contents
- Environment variables
- API keys
- Secrets
- Arbitrary filesystem contents

to the frontend unless explicitly required.

Be careful when displaying command/tool arguments because they may contain sensitive values.

Concrete policy (§6A Decision 6): tool names only, never tool arguments or message bodies. Never read `sessions/*.key`; never expose `messagingSocketPath`.

---

# 23. Error Handling

Collector errors must not crash the dashboard.

Cases:

- Claude Code process disappears.
- Session file changes unexpectedly.
- Malformed event.
- Permission denied.
- WebSocket disconnect.
- Unsupported Claude Code event.
- Unknown agent status.
- Terminal title unavailable.

Use defensive parsing.

Unknown fields/events should be ignored safely.

Unknown states should map to:

```text
unknown
```

rather than causing runtime errors.

---

# 24. MVP Scope

Implement in this order.

## Phase 1 — Discovery

- Inspect Claude Code 2.1.289.
- Identify process/session/event sources.
- Verify terminal title detection.
- Verify agent/subagent relationship detection.
- Document findings.

Deliverable:

```text
docs/claude-code-integration.md
```

## Phase 2 — Collector

Implement:

- Process discovery.
- Session discovery.
- Terminal title tracking.
- Event normalization.
- Internal state store.
- WebSocket server.
- Initial snapshot.
- Incremental events.
- Reconnection-safe behavior.

## Phase 3 — Frontend Foundation

Implement:

- Vue 3 + TypeScript + Vite.
- Tailwind CSS.
- Google Sans.
- vue-i18n.
- Pinia.
- Dark/light theme.
- Basic layout.
- WebSocket client.

## Phase 4 — Dashboard

Implement:

- Header/status.
- Summary metrics.
- Session cards.
- Activity timeline.
- Empty/loading/error states.

## Phase 5 — Agent Map

Implement:

- Vue Flow or selected Vue-compatible graph library.
- Agent hierarchy.
- Realtime updates.
- Node status.
- Selection.
- Fit-to-view.
- Zoom/pan.
- Focus session.

## Phase 6 — Polish

Use `/front-end-design` and `/ui-ux-promax` to review and refine:

- Spacing.
- Typography.
- Visual hierarchy.
- Accessibility.
- Dark/light consistency.
- Responsive behavior.
- No horizontal scrolling.
- Interaction states.
- Loading/error/empty states.

## Phase 7 — Validation

Test:

- 1 terminal.
- 3+ terminals.
- Multiple Claude Code sessions.
- Multiple subagents.
- Terminal rename.
- Terminal close.
- Claude Code crash.
- Collector restart.
- Web refresh.
- WebSocket reconnect.
- Dark/light switch.
- EN/VI switch.
- Narrow desktop window.
- Large Agent Map.
- High event volume.

---

# 25. Non-Goals for MVP

Do NOT implement initially:

- Cloud synchronization.
- User accounts.
- Remote monitoring.
- Claude API integration.
- AI-generated summaries.
- AI monitoring agent.
- Persistent analytics database.
- Historical analytics.
- Cost forecasting.
- Mobile app.
- Authentication.
- Multi-PC support.

These can be considered later.

---

# 26. Future Features

Potential V2:

- Opt-in Claude Code hooks (install/uninstall with `settings.json` backup + merge) for exact tool/subagent lifecycle and `waiting` state.
- Windows Terminal tab title tracking.
- Historical sessions.
- Token/cost charts.
- Search/filter agents.
- Session replay.
- Agent event timeline.
- Tool execution statistics.
- CPU/RAM monitoring.
- Multiple PC monitoring.
- Remote browser access.
- Notifications.
- Session labels/tags.
- Saved dashboard layouts.
- Export session diagnostics.

Potential AI features should be opt-in and clearly separated from the zero-token monitoring core.

---

# 27. Development Rules

1. Do not guess Claude Code internal formats.
2. Inspect the actual installed Claude Code `2.1.289` environment first.
3. Prefer official/structured event sources.
4. Keep monitoring local.
5. Do not invoke an LLM for basic monitoring.
6. Keep frontend and collector loosely coupled through typed events.
7. Do not hardcode UI strings.
8. Do not hardcode theme colors throughout components.
9. Do not introduce horizontal page scrolling.
10. Keep the Agent Map performant.
11. Preserve state during WebSocket reconnects.
12. Handle unknown/future events gracefully.
13. Do not expose secrets in UI or logs.
14. Use TypeScript strictly.
15. Keep components small and composable.
16. Follow `/front-end-design` and `/ui-ux-promax` before finalizing UI implementation.
17. Prefer simple architecture over premature abstractions.

---

# 28. Definition of Done

The MVP is complete when:

- [ ] Claude Code 2.1.289 sessions are discovered automatically.
- [ ] Multiple active terminals are displayed.
- [ ] Terminal names are displayed correctly.
- [ ] Renaming a terminal updates the dashboard realtime.
- [ ] Terminal closing marks the session `stale`; it is removed after 120 minutes (configurable).
- [ ] Main agents are displayed.
- [ ] Subagents are displayed.
- [ ] Parent-child relationships are visualized.
- [ ] Agent state updates realtime.
- [ ] Dashboard reconnects automatically after WebSocket interruption.
- [ ] No manual page refresh is required for normal state changes.
- [ ] Dark mode works.
- [ ] Light mode works.
- [ ] English works.
- [ ] Vietnamese works.
- [ ] Google Sans is used.
- [ ] No horizontal page scrolling occurs.
- [ ] Dashboard remains usable with multiple sessions and agents.
- [ ] Monitoring adds zero additional Claude token usage.
- [ ] No cloud service is required.
- [ ] No secrets are exposed to the frontend.
- [ ] Collector failures do not crash the UI.
- [ ] Project documentation explains the Claude Code integration.

---

# 29. Recommended First Claude Code Prompt

After creating the project, ask Claude Code to execute this plan in stages rather than attempting the whole application in one pass:

```text
Read PLAN.md completely.

Before writing implementation code:

1. Inspect the installed Claude Code version: 2.1.289.
2. Investigate all available local/official session, hook, event, process, and agent/subagent information.
3. Determine the most reliable way to detect:
   - Claude Code sessions
   - terminal/process identity
   - terminal title changes
   - main agents
   - subagents
   - agent parent/child relationships
   - agent state
   - current activity/tool
4. Do not guess undocumented formats.
5. Document the findings in docs/claude-code-integration.md.

Then propose the concrete implementation architecture.

Do not start large-scale UI implementation until the integration discovery is complete.

For frontend work, you MUST use the installed /front-end-design and /ui-ux-promax skills.

Follow PLAN.md as the source of truth unless a discovered Claude Code 2.1.289 limitation requires a documented deviation.
```

---

# 30. Key Principle

The product should behave like a **local observability dashboard for Claude Code**, not another AI assistant.

The monitoring loop is:

```text
Observe
  ↓
Normalize
  ↓
Broadcast
  ↓
Render
```

not:

```text
Observe
  ↓
Ask another AI what happened
  ↓
Interpret
  ↓
Render
```

The first architecture keeps the dashboard realtime, lightweight, deterministic, private, and at **zero additional Claude token cost**.

---

# 31. Implementation Status (2026-10-07)

| Phase | Status | Notes |
|---|---|---|
| 1 Discovery | Done | `docs/claude-code-integration.md` |
| 2 Collector | Done | `apps/collector` — registry watch + transcript tail, 17 tests |
| 3 Frontend foundation | Done | `apps/web` — Vue 3, Tailwind v4, Pinia, vue-i18n, theme tokens |
| 4 Dashboard | Done | Header/metrics, session cards, activity, empty/offline/stale states |
| 5 Agent Map | Done | Vue Flow, incremental nodes, wrapped grid layout, selection lineage, focus session |
| 6 Polish | Done | Screenshot review at 375/768/1024/1440, dark/light, EN/VI |
| 7 Validation | Done (automated + live) | See integration doc §11; open items in §12 |

Tooling deviation: npm workspaces instead of pnpm (pnpm not installed; no global install made).

Follow-up (2026-10-07):

| Item | Status | Notes |
|---|---|---|
| Nested subagents (depth ≥ 2) | Done | Verified on real data: flat `subagents/` dir + `meta.parentAgentId`; map shows real tree (indent capped at depth 2) |
| Hide finished subagents | Done | Agent Map toggle, persisted (`ccm.hideFinished`); hides `completed`/`cancelled`, keeps `error` and ancestors of running agents; shows hidden count |
| Foreground agent / crash | Covered by tests | Not reproducible safely; see integration doc §12 |
