// Pedido respondido no próprio terminal: o Claude Code mostra o diálogo de permissão ao mesmo tempo em
// que roda o hook e, quando você responde lá, NÃO encerra o hook (ele seguiria esperando até o tempo
// limite). Para tirar o pedido do escritório, o registro procura no fim do transcript a chamada de
// ferramenta do pedido (o hook não recebe o id do tool_use, então a busca é por nome + assinatura dos
// argumentos) e espera o tool_result dela: aprovou (a ferramenta rodou) ou recusou (resultado de erro).
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Quanto do fim do transcript é lido a cada conferência. */
export const SCAN_TAIL_BYTES = 512 * 1024;
/** Chamadas mais antigas que isto (antes do pedido) não são candidatas: são de turnos anteriores. */
export const MAX_CALL_AGE_MS = 10 * 60_000;
/** Corte dos textos na assinatura (o hook também corta argumentos longos antes de mandar). */
const SIG_TEXT_MAX = 2_000;

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function cut(v: unknown): unknown {
  if (typeof v === 'string') return v.length > SIG_TEXT_MAX ? v.slice(0, SIG_TEXT_MAX) : v;
  if (Array.isArray(v)) return v.map(cut);
  const r = rec(v);
  if (!r) return v;
  const out: Rec = {};
  for (const k of Object.keys(r).sort()) out[k] = cut(r[k]);
  return out;
}

/**
 * Assinatura de uma chamada de ferramenta, igual para o `tool_input` do hook e o `input` do tool_use
 * no transcript. Ferramentas conhecidas usam só o argumento principal (o Claude Code pode completar
 * campos opcionais antes de chamar o hook); as demais, todos os argumentos (chaves ordenadas, textos
 * cortados).
 */
export function callSignature(tool: string, input: unknown): string {
  const r = rec(input) ?? {};
  const s = (k: string) => (typeof r[k] === 'string' ? (cut(r[k]) as string) : '');
  switch (tool) {
    case 'Bash':
      return `Bash|${s('command')}`;
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
    case 'LS':
      return `${tool}|${s('file_path') || s('notebook_path') || s('path')}`;
    case 'WebFetch':
      return `WebFetch|${s('url')}`;
    case 'WebSearch':
      return `WebSearch|${s('query')}`;
    case 'Glob':
    case 'Grep':
      return `${tool}|${s('pattern')}|${s('path')}`;
    default:
      return `${tool}|${JSON.stringify(cut(r))}`;
  }
}

/** Lê os últimos `bytes` do arquivo (a primeira linha, possivelmente cortada, é descartada). */
function readTail(path: string, bytes: number): string[] {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const len = size - start;
    if (len <= 0) return [];
    const buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) {
      const n = readSync(fd, buf, read, len - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    const lines = buf.subarray(0, read).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines;
  } finally {
    closeSync(fd);
  }
}

export interface CallScan {
  /** Chamada do pedido encontrada no transcript (a mais recente que casa e ainda não tinha resultado). */
  toolUseId?: string;
  /** A chamada já tem tool_result: o pedido foi respondido (no terminal, ou a sessão seguiu sem ele). */
  answered: boolean;
}

/**
 * Procura a chamada do pedido no fim do transcript. Com `knownId` (já achada antes), só confere se o
 * resultado chegou. Sem ele, escolhe a chamada mais recente com o mesmo nome e assinatura que ainda não
 * tinha resultado e não é de muito antes do pedido. Arquivo ilegível: lança (quem chama ignora).
 */
export function scanToolCall(
  path: string,
  q: { tool: string; signature: string; knownId?: string; createdAt: number },
  tailBytes = SCAN_TAIL_BYTES,
): CallScan {
  const calls: Array<{ id: string; at: number }> = [];
  const results = new Set<string>();
  for (const line of readTail(path, tailBytes)) {
    // Filtro barato antes do JSON.parse: só interessam linhas com tool_use ou tool_result.
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    let j: Rec | undefined;
    try {
      j = rec(JSON.parse(line));
    } catch {
      continue;
    }
    const content = rec(j?.message)?.content;
    if (!Array.isArray(content)) continue;
    const at = typeof j?.timestamp === 'string' ? Date.parse(j.timestamp) : Number.NaN;
    for (const raw of content) {
      const b = rec(raw);
      if (!b) continue;
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') results.add(b.tool_use_id);
      else if (b.type === 'tool_use' && typeof b.id === 'string' && !q.knownId && b.name === q.tool && callSignature(q.tool, b.input) === q.signature) {
        calls.push({ id: b.id, at });
      }
    }
  }
  if (q.knownId) return { toolUseId: q.knownId, answered: results.has(q.knownId) };
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (results.has(c.id)) continue;
    if (Number.isFinite(c.at) && c.at < q.createdAt - MAX_CALL_AGE_MS) break;
    return { toolUseId: c.id, answered: false };
  }
  return { answered: false };
}
