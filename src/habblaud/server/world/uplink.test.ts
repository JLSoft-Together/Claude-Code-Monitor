// O uplink do prédio (server/world/uplink.ts) contra o servidor do mundo de mentira (server/test/fake-world.ts, com o
// WebSocket feito à mão): quando conecta, o `hello`, o pacote inteiro a cada `welcome`, a espera entre remessas, o
// `ping`, a reconexão, cada `goodbye`, a pausa que fecha antes de responder e a última remessa em disco (600).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hash32 } from '../../shared/hash';
import { SPECIAL } from '../../shared/activity';
import type { Activity, AgentInfo } from '../../shared/types';
import { VISIBILITY_DEFAULTS, type GoodbyeReason, type Player, type WorldUplink } from '../../shared/world/protocol';
import schemaJson from '../../shared/world/schema.json';
import { compileValidator } from '../../shared/world/schema-validator';
import { worldSocketUrl } from '../config';
import { setQuiet } from '../log';
import { startFakeWorld, type FakeWorld } from '../test/fake-world';
import { tempDir } from '../test/fixtures';
import { WorldSettingsStore } from './settings';
import { backoffDelay, BuildingUplink, type UplinkTimers, type UplinkTiming } from './uplink';

setQuiet(true);

const validate = compileValidator(schemaJson as unknown as { [k: string]: unknown });
const EMAIL = 'ana@exemplo.com';
const FAST: Partial<UplinkTiming> = {
  debounceMs: 40,
  minGapMs: 150,
  pingMs: 120,
  refreshMs: 60_000,
  backoffMinMs: 20,
  backoffMaxMs: 80,
  welcomeTimeoutMs: 400,
  closeWaitMs: 500,
  observeMs: 20,
};
const PLAYER: Player = {
  name: 'Ana Pixel',
  look: 'f',
  parts: {},
  traits: ['games', 'cafeina'],
  intro: 'coffee',
  visibility: { ...VISIBILITY_DEFAULTS },
  updatedAt: '2026-10-15T12:00:00Z',
};

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

function agent(id: string, roomId: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id, kind: 'main', roomId, name: 'Marina', look: 'f', role: 'Agente principal', sessionId: `s-${id}`, account: '.claude',
    status: 'working', recent: [], tasks: [], startedAt: 1, lastEventAt: 1, statusSince: 1,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: hash32(id), ...extra,
  };
}

async function waitFor(cond: () => boolean, what: string, ms = 3_000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`esperando: ${what}`);
    await new Promise((ok) => setTimeout(ok, 5));
  }
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Uma volta do laço de eventos (o que o WebSocket de verdade já recebeu é processado). */
const turn = () => new Promise((ok) => setImmediate(ok));

/**
 * Relógio manual para o uplink (`now` e `timers`): o tempo só anda com `advance`, que dispara na ordem cada timer
 * vencido, no instante dele. A conexão continua de verdade (o WebSocket do mundo de mentira); só as esperas do uplink
 * (remessa, welcome, ping, reconexão, fechamento) ficam no tempo controlado, e o teste não depende da máquina estar lenta.
 */
class ManualClock {
  t = 1_000_000;
  private seq = 0;
  private readonly pending = new Map<number, { at: number; fn: () => void; every?: number }>();
  readonly now = () => this.t;
  readonly timers: UplinkTimers = {
    setTimeout: (fn, ms) => this.add(fn, ms),
    clearTimeout: (h) => void this.pending.delete(h as number),
    setInterval: (fn, ms) => this.add(fn, ms, Math.max(1, ms)),
    clearInterval: (h) => void this.pending.delete(h as number),
  };

  private add(fn: () => void, ms: number, every?: number): number {
    const id = ++this.seq;
    this.pending.set(id, { at: this.t + Math.max(0, ms), fn, every });
    return id;
  }

  /** Avança `ms`: cada timer vencido dispara no seu instante (`now()` vale o instante dele), na ordem. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void; every?: number }] | undefined;
      for (const e of this.pending) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      const [id, timer] = next;
      this.t = Math.max(this.t, timer.at);
      if (timer.every) timer.at += timer.every;
      else this.pending.delete(id);
      timer.fn();
    }
    this.t = end;
  }
}

interface Harness {
  world: FakeWorld;
  store: WorldSettingsStore;
  uplink: BuildingUplink;
  token: string;
  file: string;
  lastFile: string;
  agents: AgentInfo[];
  change(): void;
  goodbyes: GoodbyeReason[];
  changes: { n: number };
  /** meta() a cada aviso de mudança. */
  metas: unknown[];
  canAct: { v: boolean };
  make(): BuildingUplink;
}

async function start(
  opts: {
    session?: 'approved' | 'waiting' | 'no-player' | 'none';
    start?: boolean;
    tokensVisible?: boolean;
    compactions?: boolean;
    booting?: { v: boolean };
    /** O tempo do uplink num relógio manual (com `timing` por cima do FAST). */
    clock?: ManualClock;
    timing?: Partial<UplinkTiming>;
  } = {},
): Promise<Harness> {
  const world = await startFakeWorld();
  closers.push(world.close);
  const tmp = tempDir();
  closers.push(tmp.cleanup);
  const token = randomBytes(32).toString('base64url');
  world.accounts.set(EMAIL, { email: EMAIL, password: 'x', verified: true, access: 'approved', code: '123456', player: PLAYER, locale: 'pt-BR' });
  world.devices.set(token, { email: EMAIL, deviceId: 'dev_1' });
  const file = join(tmp.dir, 'world.json');
  const lastFile = join(tmp.dir, 'world-last-uplink.json');
  const store = new WorldSettingsStore(file);
  const mode = opts.session ?? 'approved';
  const player = { ...PLAYER, visibility: { ...PLAYER.visibility, tokensVisible: opts.tokensVisible ?? true, compactions: opts.compactions ?? false } };
  if (mode !== 'none') {
    store.save({ deviceId: 'dev_1', token, email: EMAIL, access: mode === 'waiting' ? 'waiting' : 'approved', ...(mode === 'no-player' ? {} : { player }) });
  }
  const listeners = new Set<() => void>();
  const h = {
    world,
    store,
    token,
    file,
    lastFile,
    agents: [
      agent('.claude:101', '/Users/ana/projeto-secreto'),
      agent('s-101:agent-1', '/Users/ana/projeto-secreto', { kind: 'sub', parentId: '.claude:101', look: 'm' }),
      agent('.codex:thr-9', '/Users/ana/outro', { provider: 'codex', status: 'idle' }),
      agent('demo:agente-1', 'demo:/sala', { status: 'working' }),
    ],
    goodbyes: [] as GoodbyeReason[],
    changes: { n: 0 },
    metas: [] as unknown[],
    canAct: { v: true },
    change: () => listeners.forEach((cb) => cb()),
  } as Omit<Harness, 'uplink' | 'make'> as Harness;
  h.make = () => {
    const u = new BuildingUplink({
      url: worldSocketUrl(world.base),
      version: '0.11.0',
      build: () => ({ commit: 'a'.repeat(40), dirty: true, builtAt: '2026-10-15T00:00:00Z' }) as never,
      locale: () => 'es',
      store,
      canAct: () => h.canAct.v,
      agents: () => h.agents,
      subscribe: (cb) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      },
      tokens: () => ({ day: 12_345, week: 678_901 }),
      ...(opts.booting ? { booting: () => opts.booting!.v } : {}),
      lastFile,
      onGoodbye: (r) => h.goodbyes.push(r),
      onChange: () => {
        h.changes.n++;
        h.metas.push(h.uplink?.meta());
      },
      timing: { ...FAST, ...opts.timing },
      ...(opts.clock ? { now: opts.clock.now, timers: opts.clock.timers } : {}),
      random: () => 0.5,
    });
    closers.push(() => u.stop());
    return u;
  };
  h.uplink = h.make();
  if (opts.start !== false) h.uplink.start();
  return h;
}

const agentsOf = (u: WorldUplink) => u.floors.flatMap((f) => f.agents);

describe('BuildingUplink: conexão e remessas', () => {
  it('hello só com token, versão, build e idioma; com o welcome, o pacote inteiro (válido, sem demo)', async () => {
    const h = await start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira remessa');
    const conn = h.world.ws.connections[0];
    expect(conn.url).toBe('/v1/socket');
    expect(JSON.stringify(conn.headers)).not.toContain(h.token);
    expect(h.world.ws.hellos[0]).toEqual({ t: 'hello', v: 1, version: '0.11.0', build: { commit: 'a'.repeat(40), dirty: true }, locale: 'es', token: h.token });
    expect(conn.messages[0].t).toBe('hello');
    const { uplink, bytes } = h.world.ws.uplinks[0];
    expect(validate(uplink)).toEqual([]);
    expect(uplink.floors).toHaveLength(2);
    expect(agentsOf(uplink)).toHaveLength(3);
    expect(uplink.tokens).toEqual({ day: 12_000, week: 680_000 });
    for (const leak of ['demo', '/Users', 'projeto-secreto', 'outro', '.claude', '.codex', 'thr-9', 's-101']) {
      expect(JSON.stringify(uplink), leak).not.toContain(leak);
    }
    const sub = agentsOf(uplink).find((a) => a.kind === 'sub')!;
    expect(agentsOf(uplink).map((a) => a.id)).toContain(sub.parentId);
    // Status e última remessa: o mesmo objeto que foi para o fio.
    await waitFor(() => !!h.uplink.status().lastAck, 'ack');
    expect(h.uplink.status()).toMatchObject({ connected: true, paused: false, floors: 2, agents: 3, lastAck: { ok: true } });
    const last = h.uplink.lastUplink()!;
    expect(last.uplink).toEqual(uplink);
    expect(last.bytes).toBe(bytes);
    expect(last.ack).toMatchObject({ ok: true, bytes });
    expect(last.ack!.at).toEqual(expect.any(Number));
    expect(h.uplink.meta()).toEqual({ connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: last.at });
    expect(h.changes.n).toBeGreaterThan(0);
  });

  it('última remessa em disco: modo 600, sem token, relida só na mesma sessão', async () => {
    const h = await start();
    await waitFor(() => !!h.uplink.lastUplink()?.ack, 'ack');
    expect(statSync(h.lastFile).mode & 0o777).toBe(0o600);
    const text = readFileSync(h.lastFile, 'utf8');
    expect(text).not.toContain(h.token);
    expect(JSON.parse(text).uplink).toEqual(h.uplink.lastUplink()!.uplink);
    h.uplink.stop();
    // Outro processo, mesma sessão: mostra a última remessa antes de conectar.
    h.canAct.v = false;
    const again = h.make();
    again.start();
    expect(again.lastUplink()).toEqual(h.uplink.lastUplink());
    // Saiu da conta: some da memória e do disco.
    h.store.clear();
    again.sync();
    expect(again.lastUplink()).toBeUndefined();
    expect(existsSync(h.lastFile)).toBe(false);
  });

  it('só conecta com a conta aprovada, o personagem, a trava do terminal e sem pausa', async () => {
    const h = await start({ session: 'waiting' });
    await sleep(80);
    expect(h.world.ws.connections).toHaveLength(0);
    h.store.update({ access: 'approved', player: undefined });
    h.uplink.sync();
    await sleep(80);
    expect(h.world.ws.connections).toHaveLength(0); // sem personagem
    h.store.update({ player: PLAYER });
    h.canAct.v = false;
    h.uplink.sync();
    h.store.update({ paused: true });
    h.canAct.v = true;
    h.uplink.sync();
    await sleep(80);
    expect(h.world.ws.connections).toHaveLength(0);
    h.store.update({ paused: undefined });
    h.uplink.sync();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'remessa');
    // Sem a trava do terminal, desconecta.
    h.canAct.v = false;
    h.uplink.sync();
    await waitFor(() => h.world.ws.open.length === 0, 'fechou');
  });

  it('manda ao mudar: espera desde a primeira mudança, uma remessa a cada minGap e nada se o pacote não mudou', async () => {
    // Tempo do uplink controlado (sem o ping, que tem o caso dele): cada remessa é anotada no instante em que saiu.
    const clock = new ManualClock();
    const h = await start({ clock, timing: { pingMs: 3_600_000 } });
    const sent: number[] = [];
    let lastAt = -1;
    const run = async (ms: number) => {
      for (let left = ms; left > 0; left -= 5) {
        clock.advance(Math.min(5, left));
        const at = h.uplink.lastUplink()?.at;
        if (at !== undefined && at !== lastAt) {
          sent.push(at);
          lastAt = at;
        }
        await turn();
      }
    };
    await waitFor(() => h.uplink.status().connected, 'welcome');
    await run(5);
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    expect(sent).toEqual([clock.t - 5]);
    sent.length = 0;
    // Mudanças sem efeito no pacote (o escritório muda a toda hora: atividade, balões...).
    for (let i = 0; i < 10; i++) {
      h.change();
      await run(15);
    }
    await run(250);
    expect(sent).toEqual([]);
    // Agora muda de verdade, sem parar, por 600 ms.
    const t0 = clock.t;
    for (let i = 0; i < 40; i++) {
      h.agents = [...h.agents, agent(`.claude:${200 + i}`, '/Users/ana/projeto-secreto')];
      h.change();
      await run(15);
    }
    await run(300);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil((clock.t - t0) / FAST.minGapMs!) + 1);
    // a primeira sai `debounceMs` depois da primeira mudança (sem reiniciar a espera a cada mudança)
    expect(sent[0] - t0).toBe(FAST.debounceMs);
    for (let i = 1; i < sent.length; i++) expect(sent[i] - sent[i - 1]).toBeGreaterThanOrEqual(FAST.minGapMs!);
    // o que saiu chegou ao mundo, na ordem, e a última remessa tem todos os agentes
    await waitFor(() => h.world.ws.uplinks.length === 1 + sent.length, 'todas as remessas no mundo');
    expect(agentsOf(h.world.ws.uplinks[sent.length].uplink)).toHaveLength(43);
  });

  it('ping a cada pingMs', async () => {
    const clock = new ManualClock();
    const h = await start({ clock });
    await waitFor(() => h.uplink.status().connected, 'welcome');
    clock.advance(0);
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    clock.advance(FAST.pingMs! - 1);
    await sleep(30);
    expect(h.world.ws.pings).toBe(0);
    clock.advance(1);
    await waitFor(() => h.world.ws.pings === 1, 'primeiro ping');
    clock.advance(FAST.pingMs!);
    await waitFor(() => h.world.ws.pings === 2, 'segundo ping');
  });

  it('sem resposta ao ping, fecha e reconecta', async () => {
    const clock = new ManualClock();
    const h = await start({ clock });
    h.world.ws.options.pong = false;
    await waitFor(() => h.uplink.status().connected, 'welcome');
    clock.advance(0);
    await waitFor(() => h.world.ws.uplinks.length === 1 && !!h.uplink.status().lastAck, 'primeira e o ack');
    // Silêncio: os pings de 1 e 2 × pingMs saem; o de 3 × pingMs (mais de 2,5 pings sem nada) fecha a conexão.
    clock.advance(2 * FAST.pingMs!);
    await waitFor(() => h.world.ws.pings === 2, 'dois pings sem resposta');
    expect(h.world.ws.open).toHaveLength(1);
    clock.advance(FAST.pingMs!);
    await waitFor(() => h.world.ws.open.length === 0, 'fechou pelo silêncio');
    expect(h.world.ws.pings).toBe(2);
    clock.advance(FAST.backoffMaxMs!);
    await waitFor(() => h.world.ws.connections.length === 2, 'reconectou');
  });

  it('caiu: reconecta com espera e manda o pacote inteiro de novo, mesmo igual', async () => {
    const h = await start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    h.world.ws.connections[0].drop();
    await waitFor(() => h.world.ws.uplinks.length === 2, 'reenvio');
    expect(h.world.ws.connections).toHaveLength(2);
    expect(h.world.ws.uplinks[1].uplink).toEqual(h.world.ws.uplinks[0].uplink);
    expect(h.world.ws.uplinks[1].conn).toBe(2);
  });

  it('sem welcome no prazo: fecha e tenta de novo', async () => {
    const clock = new ManualClock();
    const h = await start({ start: false, clock });
    h.world.ws.options.hello = 'silent';
    h.uplink.start();
    await waitFor(() => h.world.ws.open.length === 1, 'conectou');
    clock.advance(FAST.welcomeTimeoutMs! - 1);
    await sleep(30);
    expect(h.world.ws.open).toHaveLength(1);
    clock.advance(1);
    await waitFor(() => h.world.ws.open.length === 0, 'fechou no prazo do welcome');
    expect(h.world.ws.connections).toHaveLength(1);
    clock.advance(FAST.backoffMaxMs!);
    await waitFor(() => h.world.ws.connections.length === 2, 'segunda tentativa');
    expect(h.world.ws.uplinks).toHaveLength(0);
  });

  it('ack com erro: lastAck com o código; código desconhecido vira internal', async () => {
    const h = await start({ start: false });
    h.world.ws.options.ack = 'name_pool';
    h.uplink.start();
    await waitFor(() => !!h.uplink.status().lastAck, 'ack');
    expect(h.uplink.status().lastAck).toEqual({ ok: false, error: 'name_pool' });
    expect(h.uplink.lastUplink()!.ack).toEqual({ ok: false, error: 'name_pool', at: expect.any(Number) });
    h.world.ws.options.ack = 'algo_novo';
    h.agents = h.agents.slice(1);
    h.change();
    await waitFor(() => h.world.ws.uplinks.length === 2 && h.uplink.status().lastAck?.error === 'internal', 'ack novo');
  });

  it('o tema e as opções do jogador: tema trocado manda de novo; tokens só com tokensVisible', async () => {
    const h = await start({ tokensVisible: false });
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    expect(h.world.ws.uplinks[0].uplink.tokens).toBeUndefined();
    h.store.setTheme('christmas');
    h.uplink.themeChanged();
    await waitFor(() => h.world.ws.uplinks.length === 2, 'tema');
    expect(h.world.ws.uplinks[1].uplink.theme).toBe('christmas');
  });

  it('welcome.building: andares e agentes do mundo até a primeira remessa daqui', async () => {
    const h = await start({ start: false });
    h.world.ws.options.building = { id: 'acc_1', floors: 7, agents: { total: 12, working: 5, waiting: 1, idle: 6 }, state: 'away' };
    h.uplink.start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    // No aviso do welcome (antes da remessa sair), o resumo é o do mundo; depois, o daqui.
    expect(h.metas).toContainEqual({ connected: true, paused: false, floors: 7, agents: 12 });
    await waitFor(() => h.uplink.meta().floors === 2, 'remessa');
    expect(h.uplink.meta()).toMatchObject({ floors: 2, agents: 3 });
  });
});

describe('BuildingUplink: visitantes (Fase 4)', () => {
  it('visitors {count} na conexão do prédio vira meta.visitors (com aviso de mudança); some quando a conexão cai', async () => {
    const h = await start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira remessa');
    expect(h.uplink.meta()).not.toHaveProperty('visitors');
    const city: unknown[] = [];
    h.uplink.attachCity({ opened() {}, closed() {}, message: (m) => city.push(m), wantsCity: false });
    const conn = h.world.ws.connections[0]!;
    const before = h.changes.n;
    conn.send({ t: 'visitors', count: 3 });
    await waitFor(() => h.uplink.meta().visitors === 3, 'contagem');
    expect(h.changes.n).toBeGreaterThan(before);
    expect(h.uplink.status().visitors).toBe(3);
    expect(city).toEqual([{ t: 'visitors', count: 3 }]);
    conn.send({ t: 'visitors', count: -2 });
    conn.send({ t: 'visitors', count: 0 });
    await waitFor(() => h.uplink.meta().visitors === 0, 'zero');
    conn.send({ t: 'visitors', count: 1 });
    await waitFor(() => h.uplink.meta().visitors === 1, 'um');
    // a conexão caiu: a contagem é de outra conexão, esquecida
    conn.drop();
    await waitFor(() => !h.uplink.connected, 'queda');
    expect(h.uplink.meta()).not.toHaveProperty('visitors');
  });

  it('fechado a visitas: nenhuma contagem (o servidor não manda nem o 0)', async () => {
    const h = await start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira remessa');
    h.world.ws.connections[0]!.send({ t: 'visitors', count: 2 });
    await waitFor(() => h.uplink.meta().visitors === 2, 'contagem');
    const s = h.store.get()!;
    h.store.save({ ...s, player: { ...s.player!, visibility: { ...s.player!.visibility, closed: true } } });
    expect(h.uplink.meta()).not.toHaveProperty('visitors');
    // reaberto: a contagem velha não volta (quem estava foi posto para fora; o servidor só manda quando alguém entra)
    h.store.save({ ...s, player: { ...s.player!, visibility: { ...s.player!.visibility, closed: false } } });
    expect(h.uplink.meta()).not.toHaveProperty('visitors');
    expect(h.uplink.status()).not.toHaveProperty('visitors');
    h.world.ws.connections[0]!.send({ t: 'visitors', count: 1 });
    await waitFor(() => h.uplink.meta().visitors === 1, 'nova contagem');
  });
});

describe('BuildingUplink: tarefas e compactações sem conexão', () => {
  const tasks = (done: number, pending: number) => [
    ...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, title: 'feito', status: 'completed' as const })),
    ...Array.from({ length: pending }, (_, i) => ({ id: `p${i}`, title: 'falta', status: 'pending' as const })),
  ];
  const compaction: Activity = { id: 'c-1', at: 2, ...SPECIAL.compact() };
  const claudeMain = (u: WorldUplink) => agentsOf(u).find((a) => a.kind === 'main' && a.provider === 'claude')!;

  it('pausado: o gancho do escritório conta as tarefas (mesmo com a lista trocada) e a compactação que já saiu de recent', async () => {
    const h = await start({ compactions: true });
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    expect(claudeMain(h.world.ws.uplinks[0].uplink).tasksDone).toBe(0);
    h.store.update({ paused: true });
    await h.uplink.pause();
    const main = h.agents[0];
    // Duas concluídas; depois o TodoWrite troca a lista (o que já foi feito some dela).
    main.tasks = tasks(2, 1);
    h.change();
    await sleep(60);
    main.tasks = tasks(0, 3);
    h.change();
    await sleep(60);
    // Uma compactação que sai de `recent` antes da próxima remessa.
    main.recent = [compaction];
    h.change();
    await sleep(60);
    main.recent = [];
    h.change();
    await sleep(60);
    expect(h.world.ws.uplinks).toHaveLength(1);
    h.store.update({ paused: undefined });
    h.uplink.resume();
    await waitFor(() => h.world.ws.uplinks.length === 2, 'retomou');
    const a = claudeMain(h.world.ws.uplinks[1].uplink);
    expect(a.tasksDone).toBe(1); // faixa 1–2
    expect(a.compacted).toBe(true);
  });

  it('durante o boot do escritório nada é observado nem enviado; o fim do boot destrava', async () => {
    const booting = { v: true };
    const h = await start({ booting });
    await waitFor(() => h.world.ws.connections.length === 1 && h.world.ws.hellos.length === 1, 'conectou');
    await sleep(120);
    expect(h.world.ws.uplinks).toHaveLength(0);
    booting.v = false;
    h.change();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira depois do boot');
  });
});

describe('BuildingUplink: goodbye, pausa e retomada', () => {
  it('deploy: reconecta sozinho', async () => {
    const h = await start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    h.world.ws.connections[0].goodbye('deploy');
    await waitFor(() => h.world.ws.uplinks.length === 2, 'de volta');
    expect(h.goodbyes).toEqual([]);
  });

  it('deploy a cada hello (manutenção do mundo): tenta de novo com a espera crescendo até o teto, e o welcome zera', async () => {
    const h = await start({ start: false });
    h.world.ws.options.hello = 'deploy';
    h.uplink.start();
    await waitFor(() => h.world.ws.connections.length >= 5, 'cinco tentativas', 3_000);
    const at = h.world.ws.connections.map((c) => c.openedAt);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    // Espera de 20, 40, 80, 80 ms (random 0,5: sem sorteio), mais o tempo da conexão.
    expect(gaps[0]).toBeGreaterThanOrEqual(18);
    expect(gaps[1]).toBeGreaterThanOrEqual(38);
    expect(gaps[2]).toBeGreaterThanOrEqual(78);
    expect(gaps[3]).toBeGreaterThanOrEqual(78);
    expect(h.goodbyes).toEqual([]);
    expect(h.uplink.status().stopped).toBeUndefined();
    h.world.ws.options.hello = 'auto';
    await waitFor(() => h.world.ws.uplinks.length === 1, 'de volta');
    // Depois do welcome, a próxima queda começa de novo da espera mínima.
    const n = h.world.ws.connections.length;
    h.world.ws.open[0].drop();
    await waitFor(() => h.world.ws.connections.length === n + 1, 'reconectou');
    const last = h.world.ws.connections.at(-1)!.openedAt - h.world.ws.connections.at(-2)!.openedAt;
    expect(last).toBeLessThan(400);
  });

  for (const reason of ['banned', 'suspended', 'update', 'other-device', 'deleted'] as const) {
    it(`${reason}: para, avisa a conta e mostra no status; só volta com retomar`, async () => {
      const h = await start();
      await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
      h.world.ws.connections[0].goodbye(reason);
      await waitFor(() => h.uplink.status().stopped === reason, 'parou');
      await sleep(150);
      expect(h.world.ws.connections).toHaveLength(1);
      expect(h.goodbyes).toEqual([reason]);
      expect(h.uplink.status().connected).toBe(false);
      // No snapshot (que também vai ao celular), só "parou", sem o motivo.
      expect(h.uplink.meta().stopped).toBe(true);
      expect(JSON.stringify(h.uplink.meta())).not.toContain(reason);
      h.uplink.sync();
      await sleep(80);
      expect(h.world.ws.connections).toHaveLength(1);
      h.uplink.resume();
      await waitFor(() => h.world.ws.uplinks.length === 2, 'retomou');
      expect(h.uplink.status().stopped).toBeUndefined();
      expect(h.uplink.meta().stopped).toBeUndefined();
    });
  }

  for (const reason of ['waiting', 'no_player', 'unauthorized'] as const) {
    it(`${reason} no hello: para sem insistir até a sessão mudar`, async () => {
      const h = await start({ start: false });
      h.world.ws.options.hello = reason;
      h.uplink.start();
      await waitFor(() => h.goodbyes.length === 1, 'goodbye');
      expect(h.goodbyes).toEqual([reason]);
      await sleep(200);
      expect(h.world.ws.connections).toHaveLength(1);
      // A sessão mudou (personagem salvo de novo, por exemplo): tenta outra vez.
      h.world.ws.options.hello = 'auto';
      h.store.update({ player: { ...PLAYER, updatedAt: '2026-10-16T00:00:00Z' } });
      h.uplink.sync();
      await waitFor(() => h.world.ws.uplinks.length === 1, 'voltou');
    });
  }

  it('lista de espera de novo e depois aprovada: volta sozinho', async () => {
    const h = await start({ start: false });
    h.world.ws.options.hello = 'waiting';
    h.uplink.start();
    await waitFor(() => h.goodbyes.length === 1, 'goodbye');
    h.store.update({ access: 'waiting' });
    h.uplink.sync();
    h.world.ws.options.hello = 'auto';
    h.store.update({ access: 'approved' });
    h.uplink.sync();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'voltou');
  });

  it('pausa fecha a conexão antes de responder; retomar reabre e manda o pacote inteiro', async () => {
    const h = await start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    h.store.update({ paused: true });
    await h.uplink.pause();
    // Assim que a pausa responde, o servidor já viu a conexão fechar.
    expect(h.world.ws.open).toHaveLength(0);
    expect(h.world.ws.connections[0].closedCleanly).toBe(true);
    expect(h.uplink.status()).toMatchObject({ connected: false, paused: true });
    h.change();
    await sleep(150);
    expect(h.world.ws.connections).toHaveLength(1);
    h.store.update({ paused: undefined });
    h.uplink.resume();
    await waitFor(() => h.world.ws.uplinks.length === 2, 'retomou');
    expect(h.uplink.status()).toMatchObject({ connected: true, paused: false });
  });

  it('pausa com o servidor mudo: responde no prazo (closeWaitMs) mesmo sem o close de volta', async () => {
    const clock = new ManualClock();
    const h = await start({ clock });
    await waitFor(() => h.uplink.status().connected, 'welcome');
    clock.advance(0);
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    h.world.ws.options.answerClose = false;
    h.store.update({ paused: true });
    let answered = false;
    const paused = h.uplink.pause().then(() => void (answered = true));
    clock.advance(FAST.closeWaitMs! - 1);
    await sleep(30);
    expect(answered).toBe(false);
    clock.advance(1);
    await paused;
    expect(h.uplink.status().connected).toBe(false);
    // Nada mais sai pela conexão pendurada.
    const before = h.world.ws.connections[0].messages.length;
    h.change();
    clock.advance(FAST.debounceMs! + FAST.minGapMs!);
    await sleep(50);
    expect(h.world.ws.connections[0].messages.length).toBe(before);
  });

  it('sair da conta fecha na hora e esquece os ids', async () => {
    const h = await start();
    await waitFor(() => h.world.ws.uplinks.length === 1, 'primeira');
    const first = h.world.ws.uplinks[0].uplink;
    h.store.clear();
    h.uplink.sync();
    await waitFor(() => h.world.ws.open.length === 0, 'fechou');
    h.store.save({ deviceId: 'dev_1', token: h.token, email: EMAIL, access: 'approved', player: PLAYER });
    h.uplink.sync();
    await waitFor(() => h.world.ws.uplinks.length === 2, 'de volta');
    // Outra sessão: ids novos.
    expect(h.world.ws.uplinks[1].uplink.floors.map((f) => f.id)).not.toEqual(first.floors.map((f) => f.id));
  });
});

describe('backoffDelay', () => {
  it('dobra de 2 s até 60 s, com ±25 %, nunca acima do teto', () => {
    const mid = [0, 1, 2, 3, 4, 5, 6, 10].map((n) => backoffDelay(n, () => 0.5));
    expect(mid).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    expect(backoffDelay(0, () => 0)).toBe(1_500);
    expect(backoffDelay(0, () => 1)).toBe(2_500);
    expect(backoffDelay(9, () => 1)).toBe(60_000);
    expect(backoffDelay(9, () => 0)).toBe(45_000);
  });
});
