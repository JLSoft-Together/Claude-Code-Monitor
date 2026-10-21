// Chamadas à API do terminal interativo (server/http/pty.ts). Erros viram Error com a mensagem do servidor.
import { isDemoId } from '../../../shared/timeline';
import type { AgentInfo, PtyInfo } from '../../../shared/types';
import { providerOf } from './provider';
import { tr } from '../../../shared/i18n';

/**
 * Dá para encerrar ou assumir este agente pelo escritório? Só o agente principal de uma sessão do Claude Code: o
 * Codex não tem registro de sessões nem `--resume` aqui, e os agentes do demo não existem de verdade.
 */
export function ptyControllable(a: Pick<AgentInfo, 'id' | 'kind' | 'provider'> | null | undefined): boolean {
  return !!a && a.kind === 'main' && providerOf(a) === 'claude' && !isDemoId(a.id);
}

export async function postPty<T = unknown>(url: string, body: unknown): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  if (res.status === 204) return undefined;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? tr('erro {0}', [res.status]));
  return j as T;
}

const SIZE = { cols: 120, rows: 32 };

/** Sessão nova do Claude Code na pasta (e conta) indicada. */
export function createPty(cwd: string, account?: string): Promise<PtyInfo | undefined> {
  return postPty<PtyInfo>('/api/pty', { cwd, account, ...SIZE });
}

/** Encerra a sessão noutro terminal e continua a mesma conversa aqui. */
export function takeoverAgent(agentId: string): Promise<PtyInfo | undefined> {
  return postPty<PtyInfo>(`/api/agents/${encodeURIComponent(agentId)}/takeover`, SIZE);
}

/** Encerra o agente (aqui ou noutro terminal). */
export async function stopAgent(agentId: string): Promise<void> {
  await postPty(`/api/agents/${encodeURIComponent(agentId)}/stop`, {});
}

export async function closePty(id: string): Promise<void> {
  await postPty(`/api/pty/${encodeURIComponent(id)}/close`, {});
}
