# protocol — packages/shared

- `src/types.ts`: `TerminalSession`, `Agent` (role main|subagent), `ActivityEvent` (kind enum, data = labels only), `MonitorSnapshot`, `MonitorEvent`, `ServerMessage {seq, events[]}`, `ClientMessage {type:'resync'}`, `Patch<T>` (null = field cleared).
- `src/status.ts`: `PROTOCOL_VERSION`, `SUPPORTED_CLAUDE_VERSION`, `mapRegistryStatus` (busy→working, waiting→waiting, shell→idle+backgroundShell, idle→idle, else unknown), `mapTaskNotificationStatus` (completed|failed→error|stopped→cancelled), `mainAgentStatus`, `normalize*Status`, `isAgentFinished`.

| Event | Emitter | Consumer |
|---|---|---|
| snapshot | server on connect + on `resync` | web connection store → hydrate all stores |
| terminal.created/updated/removed | MonitorStore.upsertTerminal/removeTerminal | terminals store |
| agent.created/updated/removed | MonitorStore.upsertAgent/removeAgent | agents store |
| activity | MonitorStore.pushActivity | activity store |

Invariants: snapshot `seq` = last flushed seq; next message seq+1; gap → client sends resync. Events batched per `batchMs` (50ms).
Tokens: input = input + cache_creation; cacheRead separate; total = input + output; dedupe per message.id.
