// Carteiras dos personagens (moedinhas fictícias 🪙). Quem chega ao escritório já entra com um
// saldo; ganha mais a cada tarefa concluída e perde ou ganha nas apostas com os colegas.
//
// Fica no navegador (localStorage), por agente: cada navegador tem a sua economia (as apostas são
// sorteadas na simulação local). Sem localStorage (testes, aba anônima bloqueada), só em memória.
// Os agentes de um prédio do mundo visitado (ids `world:`, shared/world/office-from-world.ts) ficam numa chave à
// parte (WORLD_STORAGE_KEY), apagada ao sair da visita: a visita não mexe na economia do escritório local.
import { tr } from '../../../../shared/i18n';
import { isWorldId } from '../../../../shared/world/office-from-world';

/** Saldo de quem chega ao escritório. */
export const START_COINS: Readonly<Record<'main' | 'sub', number>> = { main: 100, sub: 30 };
/** Item da lista de tarefas concluído. */
export const TASK_REWARD = 10;
/** Subagente entregou o resultado ao agente que o chamou (a tarefa dele). */
export const DELIVERY_REWARD = 15;
/** Pedido do usuário atendido (fim de turno). */
export const TURN_REWARD = 5;

const STORAGE_KEY = 'habblaud.wallets.v1';
/** Carteiras da visita a um prédio do mundo (ids `world:`). */
export const WORLD_STORAGE_KEY = 'habblaud:world-wallet';
const LEDGER_MAX = 12;
const PAID_MAX = 300;
/** Carteiras de agentes que não aparecem há mais que isso são esquecidas. */
const FORGET_MS = 3 * 24 * 3_600_000;
const MAX_WALLETS = 400;

export interface LedgerEntry {
  at: number;
  delta: number;
  icon: string;
  text: string;
}

export interface WalletEntry {
  name: string;
  coins: number;
  /** Total ganho trabalhando (saldo inicial, tarefas, entregas, pedidos). */
  earned: number;
  wins: number;
  losses: number;
  /** Retrospecto por adversário (id): [vitórias, derrotas]. */
  vs: Record<string, [number, number]>;
  /** Tarefas já pagas ("id|título"). */
  paid: string[];
  /** Extrato: movimentações mais recentes primeiro. */
  ledger: LedgerEntry[];
  createdAt: number;
  seenAt: number;
}

/** O mínimo de AgentInfo que a carteira usa. */
export interface WalletAgent {
  id: string;
  name: string;
  kind: 'main' | 'sub';
  tasks: readonly { id: string; title: string; status: string }[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** De que economia é a carteira: a do escritório local ou a da visita a um prédio do mundo. */
type Part = 'office' | 'world';
const PARTS: readonly Part[] = ['office', 'world'];
const KEYS: Readonly<Record<Part, string>> = { office: STORAGE_KEY, world: WORLD_STORAGE_KEY };
const partOf = (id: string): Part => (isWorldId(id) ? 'world' : 'office');

/**
 * Apaga as carteiras da visita guardadas no navegador (ao sair do prédio). Chame depois de descartar o `Sim` da
 * visita: ele grava as carteiras ao ser trocado.
 */
export function clearWorldWallets(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    if (storage.removeItem) storage.removeItem(WORLD_STORAGE_KEY);
    else storage.setItem(WORLD_STORAGE_KEY, '');
  } catch {
    // bloqueado: o que ficou é esquecido pelo prune (FORGET_MS)
  }
}

/** localStorage, se existir e funcionar (aba anônima/bloqueada lança ao acessar). */
export function browserStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!s) return null;
    s.getItem(STORAGE_KEY);
    return s;
  } catch {
    return null;
  }
}

function taskKey(t: { id: string; title: string }): string {
  return `${t.id}|${t.title}`;
}

export class Wallets {
  private map = new Map<string, WalletEntry>();
  /** O que mudou desde a última gravação, por economia: cada uma só regrava a própria chave. */
  private dirty: Record<Part, boolean> = { office: false, world: false };

  constructor(private readonly storage: StorageLike | null) {
    this.load();
  }

  get(id: string): WalletEntry | undefined {
    return this.map.get(id);
  }

  coins(id: string): number {
    return this.map.get(id)?.coins ?? 0;
  }

  /**
   * Garante a carteira do agente. Na primeira vez: saldo inicial e as tarefas que já estavam
   * concluídas pagas em silêncio (quem já trabalhou antes de a página abrir não perde o que fez).
   */
  ensure(a: WalletAgent, now: number): { entry: WalletEntry; created: boolean } {
    let w = this.map.get(a.id);
    if (w) {
      if (w.name !== a.name) w.name = a.name;
      if (now - w.seenAt > 60_000) {
        w.seenAt = now;
        this.touch(a.id);
      }
      return { entry: w, created: false };
    }
    const start = START_COINS[a.kind] ?? START_COINS.main;
    w = { name: a.name, coins: start, earned: start, wins: 0, losses: 0, vs: {}, paid: [], ledger: [], createdAt: now, seenAt: now };
    this.map.set(a.id, w);
    this.log(w, { at: now, delta: start, icon: '🏢', text: tr('Chegou ao escritório') });
    const done = a.tasks.filter((t) => t.status === 'completed');
    if (done.length) {
      for (const t of done) w.paid.push(taskKey(t));
      const v = done.length * TASK_REWARD;
      w.coins += v;
      w.earned += v;
      this.log(w, { at: now, delta: v, icon: '✅', text: done.length === 1 ? tr('1 tarefa já concluída') : tr('{0} tarefas já concluídas', [done.length]) });
    }
    this.touch(a.id);
    return { entry: w, created: true };
  }

  /** Paga as tarefas concluídas que ainda não foram pagas. Retorna quanto pagou agora. */
  payTasks(a: WalletAgent, now: number): number {
    const w = this.map.get(a.id);
    if (!w) return 0;
    let total = 0;
    for (const t of a.tasks) {
      if (t.status !== 'completed') continue;
      const k = taskKey(t);
      if (w.paid.includes(k)) continue;
      w.paid.push(k);
      if (w.paid.length > PAID_MAX) w.paid.splice(0, w.paid.length - PAID_MAX);
      w.coins += TASK_REWARD;
      w.earned += TASK_REWARD;
      total += TASK_REWARD;
      this.log(w, { at: now, delta: TASK_REWARD, icon: '✅', text: tr('Tarefa concluída: {0}', [t.title]) });
    }
    if (total) this.touch(a.id);
    return total;
  }

  /** Crédito por trabalho (pedido atendido, entrega de subagente). */
  credit(id: string, amount: number, icon: string, text: string, now: number): number {
    const w = this.map.get(id);
    if (!w || amount <= 0) return 0;
    w.coins += amount;
    w.earned += amount;
    this.log(w, { at: now, delta: amount, icon, text });
    this.touch(id);
    return amount;
  }

  /**
   * Aposta paga: tira até `amount` de quem perdeu (nunca deixa negativo) e dá a quem ganhou.
   * Retorna o valor que de fato mudou de mãos.
   */
  transfer(fromId: string, toId: string, amount: number, icon: string, what: string, now: number): number {
    const from = this.map.get(fromId);
    const to = this.map.get(toId);
    if (!from || !to || fromId === toId) return 0;
    const v = Math.max(0, Math.min(Math.floor(amount), from.coins));
    if (!v) return 0;
    from.coins -= v;
    to.coins += v;
    this.log(from, { at: now, delta: -v, icon, text: tr('Perdeu {0} para {1}', [what, to.name]) });
    this.log(to, { at: now, delta: v, icon, text: tr('Ganhou {0} de {1}', [what, from.name]) });
    this.touch(fromId);
    this.touch(toId);
    return v;
  }

  /** Placar de uma partida/aposta (vale também sem dinheiro em jogo). */
  recordMatch(winnerId: string, loserId: string): void {
    const w = this.map.get(winnerId);
    const l = this.map.get(loserId);
    if (!w || !l) return;
    w.wins++;
    l.losses++;
    (w.vs[loserId] ??= [0, 0])[0]++;
    (l.vs[winnerId] ??= [0, 0])[1]++;
    this.touch(winnerId);
    this.touch(loserId);
  }

  /**
   * Grava no navegador o que mudou (chamado com baixa frequência), cada economia na sua chave: a visita a um prédio
   * do mundo nunca regrava a do escritório (nem com uma cópia velha dela) e vice-versa.
   */
  save(now: number): void {
    for (const part of PARTS) {
      if (!this.dirty[part]) continue;
      this.dirty[part] = false;
      this.prune(now, part);
      if (!this.storage) continue;
      const wallets = Object.fromEntries([...this.map].filter(([id]) => partOf(id) === part));
      try {
        this.storage.setItem(KEYS[part], JSON.stringify({ v: 1, wallets }));
      } catch {
        // cota cheia/bloqueado: segue só em memória
      }
    }
  }

  /** Esquece carteiras de quem não aparece há dias (e limita o total de cada economia). */
  prune(now: number, only?: Part): void {
    for (const part of only ? [only] : PARTS) {
      const entries = [...this.map].filter(([id]) => partOf(id) === part);
      for (const [id, w] of entries) if (now - w.seenAt > FORGET_MS) this.map.delete(id);
      const left = entries.filter(([id]) => this.map.has(id));
      if (left.length <= MAX_WALLETS) continue;
      const old = left.sort((a, b) => a[1].seenAt - b[1].seenAt);
      for (const [id] of old.slice(0, left.length - MAX_WALLETS)) this.map.delete(id);
    }
  }

  private touch(id: string): void {
    this.dirty[partOf(id)] = true;
  }

  private log(w: WalletEntry, e: LedgerEntry): void {
    w.ledger.unshift(e);
    if (w.ledger.length > LEDGER_MAX) w.ledger.length = LEDGER_MAX;
  }

  private load(): void {
    for (const part of PARTS) this.loadPart(part);
  }

  private loadPart(part: Part): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEYS[part]);
      if (!raw) return;
      const j = JSON.parse(raw) as { v?: number; wallets?: Record<string, Partial<WalletEntry>> };
      for (const [id, w] of Object.entries(j.wallets ?? {})) {
        if (partOf(id) !== part) continue; // cada chave só com a sua economia
        if (!w || typeof w.coins !== 'number' || !Number.isFinite(w.coins)) continue;
        this.map.set(id, {
          name: typeof w.name === 'string' ? w.name : id,
          coins: Math.max(0, Math.floor(w.coins)),
          earned: typeof w.earned === 'number' ? w.earned : w.coins,
          wins: typeof w.wins === 'number' ? w.wins : 0,
          losses: typeof w.losses === 'number' ? w.losses : 0,
          vs: w.vs && typeof w.vs === 'object' ? w.vs : {},
          paid: Array.isArray(w.paid) ? w.paid.filter((p): p is string => typeof p === 'string') : [],
          ledger: Array.isArray(w.ledger) ? w.ledger.slice(0, LEDGER_MAX) : [],
          createdAt: typeof w.createdAt === 'number' ? w.createdAt : 0,
          seenAt: typeof w.seenAt === 'number' ? w.seenAt : 0,
        });
      }
    } catch {
      // ilegível: começa do zero
    }
  }
}
