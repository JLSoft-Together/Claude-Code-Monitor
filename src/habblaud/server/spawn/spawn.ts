// Novo agente pelo escritório. Do jeito que roda sozinho: uma sessão em segundo plano do Claude Code
// (`claude --bg -n <nome> -- <pedido>`, na pasta escolhida), que começa na hora, aparece no escritório como qualquer
// sessão e recebe mensagens e pedidos de permissão pelo Habblaud (`claude attach <id>` abre no terminal do Mac).
// O Claude Code só faz isso numa pasta que já é confiável para ele (o aviso de confiança foi aceito no terminal); se
// a pasta não é, ou o `claude` não está aqui, cai no link `claude://code/new?folder=<pasta>&q=<pedido>` (o do "New
// Claude Code Session Here" do Finder), que abre a tela de sessão nova do app preenchida: aí ela começa quando a
// pessoa aperta Enter lá. Quem roda precisa estar no computador do app:
// - modo Node: o próprio servidor;
// - Docker: o auxiliar do host (scripts/codex-bridge.ts, npm run codex:bridge) busca os pedidos em
//   POST /api/host/spawn/poll, confere a pasta, roda e confirma em POST /api/host/spawn/ack.
// Anexos (spawn/attachments.ts): quem roda grava os arquivos em ~/.habblaud/attachments/ e põe os caminhos no fim
// do pedido. Sem shell (execFile), com prazo, e o pedido vai depois de `--` (nunca vira opção nem subcomando).
// Node puro e sem dependências: também é importado pelo auxiliar do host (via tsx).
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { tr } from '../../shared/i18n';
import { attachmentsRoot, promptWithAttachments, writeAttachments, type Attachment, type AttachmentStore } from './attachments';

/** Tamanho máximo do pedido (o link inteiro vai pela linha de comando do `open`). */
export const PROMPT_MAX = 8_000;
export const FOLDER_MAX = 1_024;
/** Prazo do `open`. */
export const OPEN_TIMEOUT_MS = 10_000;
/** Prazo do `claude --bg` (ele sobe o serviço de segundo plano na primeira vez e volta). */
export const CLI_TIMEOUT_MS = 30_000;
const NAME_MAX = 48;
/** O auxiliar conta como presente até este tempo depois da última rodada. */
export const HOST_PRESENCE_MS = 10_000;
/**
 * Pedido buscado e não confirmado vira falha; pedido que ninguém buscou também. Quem roda pode levar o `claude --bg`
 * mais o `open` (CLI_TIMEOUT_MS + OPEN_TIMEOUT_MS): o prazo de "buscado" cobre os dois com folga, e a página espera
 * mais que a soma dos dois prazos (client/src/ui/spawn.ts), para nunca dizer "não confirmou" de algo que ainda abre.
 */
export const SENT_TIMEOUT_MS = CLI_TIMEOUT_MS + OPEN_TIMEOUT_MS + 10_000;
export const QUEUED_TIMEOUT_MS = 30_000;
/** Pedidos resolvidos ficam este tempo para o GET. */
export const KEEP_MS = 10 * 60_000;
const MAX_OPEN = 5;
const ERROR_MAX = 300;

export interface SpawnRequest {
  folder: string;
  prompt: string;
}

export type SpawnStatus = 'queued' | 'sent' | 'opened' | 'failed';

/** Como abriu: `cli` = já está rodando em segundo plano; `app` = tela do app preenchida, esperando o Enter no Mac. */
export type SpawnHow = 'cli' | 'app';

export interface SpawnInfo {
  id: string;
  folder: string;
  status: SpawnStatus;
  error?: string;
  how?: SpawnHow;
  /** Com how `app` depois de tentar o `claude --bg`: por que não rodou sozinho. */
  note?: string;
}

export type OpenResult = { ok: true } | { ok: false; error: string };
export type Opener = (url: string) => Promise<OpenResult>;
export type CliResult = { ok: true; id: string } | { ok: false; error: string };
/** Roda o pedido como sessão em segundo plano do Claude Code. */
export type CliRunner = (req: SpawnRequest) => Promise<CliResult>;
export type LaunchResult = { ok: true; how: SpawnHow; note?: string } | { ok: false; error: string };

/** Confere o corpo de POST /api/spawn; devolve o pedido ou o motivo da recusa. */
export function parseSpawn(raw: unknown): SpawnRequest | { error: string } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const folder = typeof r.folder === 'string' ? r.folder.trim() : '';
  const prompt = typeof r.prompt === 'string' ? r.prompt.replace(/\s+$/, '') : '';
  if (!folder || folder.length > FOLDER_MAX || folder.includes('\0') || !(isAbsolute(folder) || /^[A-Za-z]:[\\/]/.test(folder))) {
    return { error: tr('escolha uma pasta (caminho absoluto, ex.: /Users/voce/projeto)') };
  }
  if (prompt.length > PROMPT_MAX || prompt.includes('\0')) return { error: tr('o pedido passa de {0} caracteres', [PROMPT_MAX]) };
  return { folder, prompt };
}

/** O link que o app do Claude entende (claude://code/new; `q` = pedido já escrito). */
export function spawnUrl(req: SpawnRequest): string {
  const q = new URLSearchParams();
  q.set('folder', req.folder);
  if (req.prompt.trim()) q.set('q', req.prompt);
  q.set('source', 'habblaud');
  return `claude://code/new?${q.toString().replace(/\+/g, '%20')}`;
}

/** Nome da sessão em segundo plano: "Habblaud: " + começo da 1ª linha do pedido. */
export function sessionName(prompt: string): string {
  const line = prompt.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const cut = line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1)}…` : line;
  return cut ? `Habblaud: ${cut}` : 'Habblaud';
}

/** Argumentos do `claude`: o pedido depois de `--` (um pedido "doctor" ou "-x" continua sendo pedido). */
export function cliArgs(req: SpawnRequest): string[] {
  const args = ['--bg', '-n', sessionName(req.prompt)];
  return req.prompt.trim() ? [...args, '--', req.prompt] : args;
}

/** `claude --bg` na pasta do pedido; devolve o id curto que ele imprime ("backgrounded · 7eacc670 · nome"). */
export function createCliRunner(bin: string, timeoutMs = CLI_TIMEOUT_MS): CliRunner {
  return (req) =>
    new Promise((ok) => {
      const child = execFile(bin, cliArgs(req), { cwd: req.folder, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, out, stderr) => {
        const id = /backgrounded\s*·\s*([\w-]+)/.exec(out ?? '')?.[1];
        if (!err && id) return ok({ ok: true, id });
        const line = [stderr, out, err?.message].map((t) => (t ?? '').split('\n').map((l) => l.trim()).find(Boolean)).find(Boolean);
        ok({ ok: false, error: (line ?? tr('o claude não começou a sessão')).slice(0, ERROR_MAX) });
      });
      child.stdin?.end();
    });
}

/** Frase para a tela quando o `claude --bg` não rodou. */
export function cliNote(error: string): string {
  return /not trusted/i.test(error)
    ? tr('a pasta ainda não é confiável para o Claude Code: rode `claude` nela uma vez no computador e aceite o aviso')
    : error;
}

/** Roda em segundo plano; se não der, abre a tela do app preenchida (e diz por quê). */
export async function launch(req: SpawnRequest, open: Opener, cli?: CliRunner): Promise<LaunchResult> {
  let note: string | undefined;
  if (cli) {
    const r = await cli(req).catch((err: unknown) => ({ ok: false as const, error: String((err as Error)?.message ?? err) }));
    if (r.ok) return { ok: true, how: 'cli' };
    note = cliNote(r.error);
  }
  const o = await open(spawnUrl(req)).catch(() => ({ ok: false as const, error: tr('falhou ao abrir o app') }));
  if (!o.ok) return note ? { ok: false, error: tr('{0}; e o app não abriu ({1})', [note, o.error]).slice(0, ERROR_MAX) } : o;
  return note ? { ok: true, how: 'app', note } : { ok: true, how: 'app' };
}

/** A pasta existe neste computador (o auxiliar confere antes de abrir; o Docker não enxerga as pastas do host). */
export function folderProblem(folder: string, stat: (p: string) => { isDirectory(): boolean } = statSync): string | undefined {
  try {
    return stat(folder).isDirectory() ? undefined : tr('não é uma pasta');
  } catch {
    return tr('pasta não encontrada neste computador');
  }
}

/** `open`/`xdg-open`/`start` sem shell. */
export function createOpener(platform: NodeJS.Platform = process.platform, timeoutMs = OPEN_TIMEOUT_MS): Opener {
  const [bin, pre] = platform === 'darwin' ? ['open', []] : platform === 'win32' ? ['cmd', ['/c', 'start', '""']] : ['xdg-open', []];
  return (url) =>
    new Promise((ok) => {
      execFile(bin, [...pre, url], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, _out, stderr) => {
        if (!err) return ok({ ok: true });
        const line = (stderr || err.message || '').split('\n').find((l) => l.trim()) ?? tr('falhou');
        ok({ ok: false, error: `${bin}: ${line.trim()}`.slice(0, ERROR_MAX) });
      });
    });
}

interface Entry {
  info: SpawnInfo;
  req: SpawnRequest;
  files: Attachment[];
  at: number;
}

/** Um pedido para o auxiliar do host, com os anexos em base64. */
export interface PolledSpawn extends SpawnRequest {
  id: string;
  files: Array<{ name: string; type: string; data: string }>;
}

export interface SpawnServiceOptions {
  /** Modo Node: abre aqui mesmo. Ausente (Docker): fica na fila para o auxiliar do host. */
  opener?: Opener;
  /** Modo Node: roda em segundo plano antes de cair no app (ausente = só o app). */
  cli?: CliRunner;
  /** Confere a pasta antes de abrir no modo direto (padrão: statSync). */
  folderProblem?: (folder: string) => string | undefined;
  /** Anexos enviados antes do pedido (POST /api/spawn/attachments); ausente = pedidos sem anexos. */
  attachments?: AttachmentStore;
  /** Modo direto: grava os anexos e devolve os caminhos (padrão: ~/.habblaud/attachments/). */
  writeFiles?: (spawnId: string, files: readonly Attachment[]) => string[];
  now?: () => number;
  newId?: () => string;
}

export type SpawnSubmit = { spawn: SpawnInfo } | { error: 'invalid' | 'unavailable' | 'too-many'; reason: string };

export class SpawnService {
  private readonly entries = new Map<string, Entry>();
  private hostSeenAt = -Infinity;
  private readonly now: () => number;

  constructor(private readonly opts: SpawnServiceOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  /** Dá para abrir agora: modo direto, ou o auxiliar do host passou há pouco. */
  available(): boolean {
    return !!this.opts.opener || this.now() - this.hostSeenAt <= HOST_PRESENCE_MS;
  }

  mode(): 'direct' | 'host' {
    return this.opts.opener ? 'direct' : 'host';
  }

  submit(raw: unknown): SpawnSubmit {
    this.prune();
    const req = parseSpawn(raw);
    if ('error' in req) return { error: 'invalid', reason: req.error };
    if (!this.available()) {
      return { error: 'unavailable', reason: tr('o auxiliar do computador não está rodando: deixe npm run codex:bridge no ar (o Habblaud está no Docker)') };
    }
    let open = 0;
    for (const e of this.entries.values()) if (e.info.status === 'queued' || e.info.status === 'sent') open++;
    if (open >= MAX_OPEN) return { error: 'too-many', reason: tr('já há {0} agentes novos esperando para abrir', [MAX_OPEN]) };
    const ids = raw && typeof raw === 'object' ? (raw as { attachments?: unknown }).attachments : undefined;
    let files: Attachment[] = [];
    if (ids !== undefined && !(Array.isArray(ids) && !ids.length)) {
      if (!this.opts.attachments) return { error: 'invalid', reason: tr('anexos desligados') };
      const taken = this.opts.attachments.take(ids);
      if ('error' in taken) return { error: 'invalid', reason: taken.error };
      files = taken;
    }
    const info: SpawnInfo = { id: this.opts.newId?.() ?? randomUUID(), folder: req.folder, status: 'queued' };
    const entry: Entry = { info, req, files, at: this.now() };
    this.entries.set(info.id, entry);
    if (this.opts.opener) void this.openDirect(entry, this.opts.opener);
    return { spawn: { ...info } };
  }

  get(id: string): SpawnInfo | undefined {
    this.prune();
    const e = this.entries.get(id);
    return e && { ...e.info };
  }

  /** Rodada do auxiliar: marca presença e entrega os pedidos na fila (ele monta o link: não abre um vindo de fora). */
  poll(): PolledSpawn[] {
    this.hostSeenAt = this.now();
    this.prune();
    const out: PolledSpawn[] = [];
    for (const e of this.entries.values()) {
      if (e.info.status !== 'queued') continue;
      e.info.status = 'sent';
      e.at = this.now();
      const files = e.files.map((f) => ({ name: f.name, type: f.type, data: f.data.toString('base64') }));
      this.dropFiles(e);
      out.push({ id: e.info.id, folder: e.req.folder, prompt: e.req.prompt, files });
    }
    return out;
  }

  ack(raw: unknown): void {
    this.hostSeenAt = this.now();
    const list = raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : [];
    for (const r of list) {
      const x = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
      const e = typeof x.id === 'string' ? this.entries.get(x.id) : undefined;
      if (!e || e.info.status !== 'sent') continue;
      const how: SpawnHow = x.how === 'cli' ? 'cli' : 'app';
      const note = typeof x.note === 'string' && x.note ? x.note.slice(0, ERROR_MAX) : undefined;
      this.resolve(
        e,
        x.ok === true ? { ok: true, how, ...(note ? { note } : {}) } : { ok: false, error: typeof x.error === 'string' && x.error ? x.error.slice(0, ERROR_MAX) : tr('o auxiliar não abriu o app') },
      );
    }
  }

  private async openDirect(e: Entry, opener: Opener): Promise<void> {
    e.info.status = 'sent';
    const problem = (this.opts.folderProblem ?? folderProblem)(e.req.folder);
    if (problem) return this.resolve(e, { ok: false, error: problem });
    let paths: string[];
    try {
      paths = (this.opts.writeFiles ?? ((id, files) => writeAttachments(attachmentsRoot(), id, files)))(e.info.id, e.files);
    } catch (err) {
      return this.resolve(e, { ok: false, error: tr('não deu para gravar os anexos ({0})', [(err as Error).message]).slice(0, ERROR_MAX) });
    } finally {
      this.dropFiles(e);
    }
    const req = { folder: e.req.folder, prompt: promptWithAttachments(e.req.prompt, paths) };
    this.resolve(e, await launch(req, opener, this.opts.cli));
  }

  /** Os anexos do pedido saem da memória (e do teto do AttachmentStore). */
  private dropFiles(e: Entry): void {
    this.opts.attachments?.release(e.files.reduce((n, f) => n + f.data.length, 0));
    e.files = [];
  }

  private resolve(e: Entry, r: OpenResult | LaunchResult): void {
    this.dropFiles(e);
    e.info.status = r.ok ? 'opened' : 'failed';
    if (!r.ok) e.info.error = r.error;
    else if ('how' in r) {
      e.info.how = r.how;
      if (r.note) e.info.note = r.note;
    }
    e.at = this.now();
  }

  private prune(): void {
    const now = this.now();
    for (const [id, e] of this.entries) {
      const age = now - e.at;
      if (e.info.status === 'queued' && age > QUEUED_TIMEOUT_MS) this.resolve(e, { ok: false, error: tr('o auxiliar do computador não buscou o pedido') });
      else if (e.info.status === 'sent' && age > SENT_TIMEOUT_MS) this.resolve(e, { ok: false, error: tr('o auxiliar do computador não confirmou') });
      else if ((e.info.status === 'opened' || e.info.status === 'failed') && age > KEEP_MS) this.entries.delete(id);
    }
  }
}
