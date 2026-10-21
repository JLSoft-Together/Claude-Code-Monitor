// Anexos do "Novo agente" (imagens e arquivos que o celular manda junto com o pedido). O link do app do Claude só leva
// texto, então os arquivos são gravados no computador do app, em ~/.habblaud/attachments/<data>-<id>/, e o pedido ganha
// a lista dos caminhos para o agente ler. Quem grava é quem abre o link: o servidor no modo Node, o auxiliar do host
// (scripts/codex-bridge.ts) no Docker. Os arquivos chegam como JSON base64 (o guard exige JSON em todo POST: CSRF).
// Node puro e sem dependências: também é importado pelo auxiliar do host (via tsx).
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tr } from '../../shared/i18n';

export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const ATTACHMENTS_PER_SPAWN = 8;
/** Corpo de POST /api/spawn/attachments: o arquivo em base64 (4/3) e um pouco de folga para o JSON. */
export const ATTACHMENT_BODY_MAX = Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 64 * 1024;
/** Anexos enviados e ainda não usados expiram; o total guardado em memória tem teto. */
export const ATTACHMENT_TTL_MS = 30 * 60_000;
/** Teto da memória dos anexos: os esperando o pedido e os já tirados por pedidos que ainda não abriram (`held`). */
export const STORE_MAX_BYTES = 120 * 1024 * 1024;
const NAME_MAX = 120;

export interface Attachment {
  name: string;
  type: string;
  data: Buffer;
}

/** Nome seguro para gravar: só a última parte, sem controles nem separadores, sem começar com ponto. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  let name = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '');
  if (!name) name = 'arquivo';
  if (name.length > NAME_MAX) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, NAME_MAX - ext.length) + ext;
  }
  return name;
}

/** Confere o corpo de POST /api/spawn/attachments: {name, type?, data (base64)}. */
export function parseAttachment(raw: unknown): Attachment | { error: string } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const name = typeof r.name === 'string' ? safeFileName(r.name) : 'arquivo';
  const type = typeof r.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(r.type) ? r.type : 'application/octet-stream';
  if (typeof r.data !== 'string' || !r.data) return { error: tr('arquivo vazio') };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)) return { error: tr('arquivo ilegível (base64)') };
  const data = Buffer.from(r.data, 'base64');
  if (!data.length) return { error: tr('arquivo vazio') };
  if (data.length > ATTACHMENT_MAX_BYTES) return { error: tr('o arquivo passa de {0} MB', [ATTACHMENT_MAX_BYTES / 1024 / 1024]) };
  return { name, type, data };
}

/** Anexos enviados, esperando o pedido do agente novo (em memória; o id volta para o navegador). */
export class AttachmentStore {
  private readonly items = new Map<string, Attachment & { at: number }>();
  /** Bytes tirados por take() e ainda em memória (pedido na fila); quem tirou devolve com release(). */
  private held = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
    private readonly maxBytes: number = STORE_MAX_BYTES,
  ) {}

  put(a: Attachment): { id: string } | { error: string } {
    this.prune();
    let total = a.data.length + this.held;
    for (const it of this.items.values()) total += it.data.length;
    if (total > this.maxBytes) return { error: tr('anexos demais esperando: envie o pedido ou tente de novo daqui a pouco') };
    const id = this.newId();
    this.items.set(id, { ...a, at: this.now() });
    return { id };
  }

  /** Tira os anexos do depósito (cada um só serve a um pedido). Ids desconhecidos ou vencidos = erro. */
  take(ids: unknown): Attachment[] | { error: string } {
    this.prune();
    if (ids === undefined) return [];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return { error: tr('anexos inválidos') };
    if (ids.length > ATTACHMENTS_PER_SPAWN) return { error: tr('no máximo {0} anexos por pedido', [ATTACHMENTS_PER_SPAWN]) };
    const out: Attachment[] = [];
    for (const id of ids as string[]) {
      const it = this.items.get(id);
      if (!it) return { error: tr('um anexo expirou: anexe de novo') };
      out.push({ name: it.name, type: it.type, data: it.data });
    }
    for (const id of ids as string[]) this.items.delete(id);
    this.held += out.reduce((n, f) => n + f.data.length, 0);
    return out;
  }

  /** Os anexos tirados por take() saíram da memória (gravados, entregues ao auxiliar ou descartados). */
  release(bytes: number): void {
    this.held = Math.max(0, this.held - bytes);
  }

  private prune(): void {
    const now = this.now();
    for (const [id, it] of this.items) if (now - it.at > ATTACHMENT_TTL_MS) this.items.delete(id);
  }
}

export function attachmentsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.HABBLAUD_ATTACHMENTS_DIR?.trim() || join(env.HOME || homedir(), '.habblaud', 'attachments');
}

function stamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

/** Grava os anexos numa pasta nova (700; arquivos 600), com nomes únicos. Devolve os caminhos, na ordem. */
export function writeAttachments(root: string, spawnId: string, files: readonly Attachment[], at = new Date()): string[] {
  if (!files.length) return [];
  const dir = join(root, `${stamp(at)}-${spawnId.replace(/[^\w-]/g, '').slice(0, 8) || 'pedido'}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const used = new Set<string>();
  return files.map((f) => {
    let name = safeFileName(f.name);
    if (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let n = 2;
      while (used.has(`${stem}-${n}${ext}`.toLowerCase())) n++;
      name = `${stem}-${n}${ext}`;
    }
    used.add(name.toLowerCase());
    const path = join(dir, name);
    writeFileSync(path, f.data, { mode: 0o600, flag: 'wx' });
    return path;
  });
}

/** O pedido com a lista dos anexos no fim (o agente lê os arquivos pelos caminhos). */
export function promptWithAttachments(prompt: string, paths: readonly string[]): string {
  if (!paths.length) return prompt;
  const list = paths.map((p) => `- ${p}`).join('\n');
  const head = paths.length === 1 ? tr('Anexo enviado pelo Habblaud (leia antes de começar):') : tr('Anexos enviados pelo Habblaud (leia antes de começar):');
  return `${prompt.trim() ? `${prompt.trimEnd()}\n\n` : ''}${head}\n${list}`;
}
