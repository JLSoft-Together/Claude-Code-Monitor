// Eventos dos hooks do Codex (a parte "ao vivo" da fonte do Codex): o script de hook manda o stdin do evento para
// POST /api/codex/events e a rota repassa aqui. A fonte do Codex (sources/codex/source.ts) implementa.

export interface CodexLive {
  /**
   * Aplica um evento de hook do Codex (o stdin dele: `hook_event_name`, `session_id`, `agent_id`, `cwd`,
   * `tool_name`, `tool_use_id`, `tool_input`, `transcript_path`...) ao escritório. `account` = conta do Codex de
   * quem mandou (id da conta ou a pasta CODEX_HOME; ausente = deduzida do `transcript_path` ou do thread). Devolve
   * false para evento desconhecido ou sessão que não casa com nenhuma conta do Codex.
   */
  applyHookEvent(account: string | undefined, input: Record<string, unknown>): boolean;
}
