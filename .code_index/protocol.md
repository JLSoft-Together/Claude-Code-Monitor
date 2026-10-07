# protocol — packages/shared

- `src/types.ts`: `TerminalSession`, `Agent` (role main|subagent), `ActivityEvent` (kind enum, data = labels only), `MonitorSnapshot`, `MonitorEvent`, `ServerMessage {seq, events[]}`, `ClientMessage {type:'resync'}`, `Patch<T>` (null = field cleared).
- `src/status.ts`: `PROTOCOL_VERSION`, `SUPPORTED_CLAUDE_VERSION`, `mapRegistryStatus` (busy→working, waiting→waiting, shell→idle+backgroundShell, idle→idle, else unknown), `mapTaskNotificationStatus` (completed|failed→error|stopped→cancelled), `mainAgentStatus`, `normalize*Status`, `isAgentFinished`.

| Event | Emitter | Consumer |
|---|---|---|
| snapshot | server on connect + on `resync` | web connection store → hydrate all stores |
| terminal.created/updated/removed | MonitorStore.upsertTerminal/removeTerminal | terminals store |
| agent.created/updated/removed | MonitorStore.upsertAgent/removeAgent | agents store |
| activity | MonitorStore.pushActivity | activity store |
| usage.reset | MonitorStore.resetUsage (UsageIndex start + scan end) | usage store `reset` |
| usage.updated | MonitorStore.updateUsage (changed buckets) | usage store `update` |
| usage.scan | MonitorStore.setUsageScan | usage store `setScan` |

Client → server: `resync`, `terminal.alias {terminalId, alias|null}` (collector sanitizes).
`TerminalSession.alias` = dashboard name; `title` stays registry name. `UsageBucket` = day|model|project|speed key + messages/input/output/cacheWrite5m/cacheWrite1h/cacheRead. `pricing.ts` `priceOf`/`estimateCost` (API list prices, checked date `PRICING_CHECKED_AT`).

Invariants: snapshot `seq` = last flushed seq; next message seq+1; gap → client sends resync. Events batched per `batchMs` (50ms).
Tokens: input = input + cache_creation; cacheRead separate; total = input + output; dedupe per message.id.

- Sprint A: `TerminalSession.permissionMode/gitBranch/compactions`, `Agent.contextTokens/contextWindow`; activity kinds `terminal.compacted` (data trigger/preTokens/postTokens), `terminal.mode` (mode), `launch.started` / `launch.failed` (title, mode, error notFound|failed); `Favorite {dir,label,addedAt}` in snapshot `favorites` + event `favorites.updated`; ClientMessage `favorite.toggle|remove|open` (`LaunchMode` new|continue). Shared `context.ts`: `contextWindowOf`, `contextLevel` (60/80/95), `modelFamily`.
- G2/G3/G7: `TerminalSession.statusSince`; `UsageSnapshot.roots` (cwd → repo root) + event `usage.roots {roots}` (additions only).
- ClientMessage `terminal.dismiss {terminalId?}`: removes ended (stale) sessions only; no id = all ended. Live sessions ignored.
- ClientMessage `favorite.rename {dir, label: string|null}` (sanitized like aliases; null/blank → folder basename).
- Sprint E–G: `Agent.effort`, `Agent.cacheTtl ('5m'|'1h')/cacheAt`, `TerminalSession.costUsd`; activity `job.blocked`/`job.done` (data.title); snapshot `jobs` (`BackgroundJob`), `limits` (`PlanLimits` fiveHour/sevenDay {usedPct 0–100, resetsAt}), `response` (`ResponseStats`), `modelNames`, `statusLineCommand`; events `jobs.updated`, `limits.updated`, `response.updated`, `models.updated`.
- `favorite.add {dir, label?}` (client) → collector validates local abs dir; rejection event `favorite.rejected {dir, reason}` (broadcast; clients match their pending add).
- Sprint H: `LimitWindow.forecast` (`LimitForecast`), `SessionRecord`, `DayTimeline`/`TimelineLane`/`TimelineSegment` (`LaneStatus`), `FocusWindowResult`. Client: `terminal.focusWindow {terminalId}`, `history.get`, `timeline.get`. Events: `terminal.focusResult`, `history.data`, `history.added`, `timeline.data` (all broadcast).

- `folder.pick {requestId}` (client) → `folder.picked {requestId,result,dir?}` broadcast; tab khớp requestId mới dùng. Result: ok|cancelled|busy|failed|unsupported.
