// Integração da vida social com a simulação (sem DOM): rodas que se formam sozinhas, quem é chamado
// de volta ao trabalho, apostas, moedinhas pelo trabalho e quem espera shell.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { Sim } from '../sim/sim';
import { active, KINDS } from './gathering';
import { CALLED } from './lines';
import { SHELL_SOCIAL_MIN_MS } from './social';
import { START_COINS, TASK_REWARD, TURN_REWARD } from './wallet';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

const appearance: Appearance = {
  skin: '#f0c8a0',
  hair: '#3a2a20',
  hairStyle: 'short',
  eyes: '#222',
  top: '#3f7fd8',
  topAccent: '#fff',
  topStyle: 'tshirt',
  bottom: '#333',
  shoes: '#111',
  accessory: 'none',
  accessoryColor: '#000',
  lanyard: null,
  look: 'm',
};

const art = { appearanceFromSeed: () => appearance, roomTheme: () => theme } as unknown as ArtModule;
const T0 = 1_700_000_000_000;

function room(id: string, slot: number): RoomInfo {
  return { id, name: id.replace('/', ''), path: id, slot, seed: slot * 99 + 7, createdAt: T0 };
}

function agent(id: string, roomId: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo {
  let seed = 0;
  for (const c of id) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  return {
    id,
    kind: 'main',
    roomId,
    name: id[0].toUpperCase() + id.slice(1),
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status,
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: seed * 2654435761,
    ...extra,
  };
}

function snap(rooms: RoomInfo[], agents: AgentInfo[], rev = 1): OfficeSnapshot {
  return {
    rev,
    serverTime: T0,
    rooms,
    agents,
    accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
    meta: { demo: true, sources: [], startedAt: T0, version: 't' },
  };
}

function run(sim: Sim, clock: { now: number }, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (until?.()) return;
  }
}

function newSim(): Sim {
  return new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }));
}

const ROOMS = [room('/a', 0), room('/b', 1)];

describe('vida social', () => {
  it('dois ociosos se juntam numa roda sozinhos, sem ninguém forçar', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    let grouped = false;
    run(sim, clock, 240, () => (grouped = [...sim.social.gatherings].some((g) => g.phase === 'run' && active(g).length >= 2)));
    expect(grouped).toBe(true);
    const g = [...sim.social.gatherings].find((x) => x.phase === 'run')!;
    for (const m of active(g)) expect(sim.chars.get(m.id)!.gathering).toBe(g);
  });

  it('sozinho no escritório, ninguém começa uma roda de grupo (só o espelho, que vale sozinho)', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'working')]), clock.now);
    for (let i = 0; i < 120; i++) {
      run(sim, clock, 1);
      for (const g of sim.social.gatherings) {
        expect(g.kind).toBe('mirror');
        expect(g.members).toHaveLength(1);
      }
    }
  });

  it('chamado para trabalhar no meio da TV: avisa a turma, sai correndo e os outros continuam', () => {
    const sim = newSim();
    const clock = { now: T0 };
    const ids = ['ana', 'caio', 'davi'];
    const agents = (s: Record<string, AgentInfo['status']> = {}) => ids.map((id, i) => agent(id, i ? '/b' : '/a', s[id] ?? 'idle'));
    sim.applySnapshot(snap(ROOMS, agents()), clock.now);
    run(sim, clock, 0.3);
    expect(sim.social.force('tv', clock.now, ids)).toHaveLength(3);
    const g = [...sim.social.gatherings][0];
    run(sim, clock, 60, () => g.phase === 'run');
    expect(g.phase).toBe('run');
    sim.applySnapshot(snap(ROOMS, agents({ caio: 'working' }), 2), clock.now);
    const caio = sim.chars.get('caio')!;
    expect(CALLED).toContain(caio.sayText);
    expect(caio.gathering).toBeNull();
    expect(g.members.find((m) => m.id === 'caio')!.left).toBe(true);
    expect(g.phase).toBe('run');
    run(sim, clock, 30, () => caio.atSpot === caio.homeSpot && !caio.step && !caio.queue.length);
    expect(caio.atSpot).toBe(caio.homeSpot);
    expect(sim.chars.get('ana')!.gathering).toBe(g);
  });

  it('jokenpô valendo: o dinheiro só muda de mãos (soma igual) e o placar fecha', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    expect(sim.social.force('rps', clock.now, ['ana', 'caio'])).toHaveLength(2);
    const g = [...sim.social.gatherings][0];
    expect(g.bet).toBeGreaterThan(0);
    run(sim, clock, 120, () => g.phase === 'ended');
    expect(g.phase).toBe('ended');
    const w = sim.social.wallets;
    expect(w.coins('ana') + w.coins('caio')).toBe(2 * START_COINS.main);
    const a = w.get('ana')!;
    const c = w.get('caio')!;
    expect(a.wins + a.losses).toBe(c.wins + c.losses);
    expect(a.wins).toBe(c.losses);
    if (a.wins + a.losses > 0) {
      expect(w.coins('ana')).not.toBe(START_COINS.main);
      expect(sim.social.events.at(-1)?.text).toMatch(/jokenpô/);
      expect(['Recepção', 'Copa', 'Lounge']).toContain(sim.social.events.at(-1)?.place);
    }
    // a roda acabou: nenhum lugar fica preso a ela
    for (const s of sim.spots.all()) expect(sim.spots.ownerOf(s.id)?.startsWith('g:') ?? false).toBe(false);
  });

  it('ping-pong até 5: um vence, o placar e o feed registram', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    sim.social.force('pingpong', clock.now, ['ana', 'caio']);
    const g = [...sim.social.gatherings][0];
    run(sim, clock, 180, () => g.phase === 'ended');
    expect(g.phase).toBe('ended');
    expect(Math.max(...g.score)).toBe(5);
    expect(g.winner).toBeTruthy();
    expect(sim.social.wallets.get(g.winner!)!.wins).toBe(1);
    expect(sim.social.events.some((e) => e.agentId === g.winner && /pingue-pongue \(5 a \d\)/.test(e.text))).toBe(true);
  });

  it('moedinhas pelo trabalho: tarefa concluída (+10) e pedido atendido (+5), com "+🪙" sobre a cabeça', () => {
    const sim = newSim();
    const clock = { now: T0 };
    const tasks = [{ id: '1', title: 'Login', status: 'in_progress' as const }];
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'working', { tasks, activity: { id: 'a1', kind: 'edit', icon: '✏️', text: 'Editando', at: T0 } })]), clock.now);
    expect(sim.social.wallets.coins('ana')).toBe(START_COINS.main);
    run(sim, clock, 1);
    sim.applySnapshot(
      snap(ROOMS, [agent('ana', '/a', 'idle', { tasks: [{ ...tasks[0], status: 'completed' }], activity: { id: 'a2', kind: 'done', icon: '✅', text: 'Concluiu', at: clock.now } })], 2),
      clock.now,
    );
    expect(sim.social.wallets.coins('ana')).toBe(START_COINS.main + TASK_REWARD + TURN_REWARD);
    expect(sim.social.floaters.filter((f) => f.charId === 'ana').map((f) => f.text).sort()).toEqual([`+🪙${TASK_REWARD}`, `+🪙${TURN_REWARD}`].sort());
  });

  it(`quem espera shell só entra numa roda depois de ${SHELL_SOCIAL_MIN_MS / 1000} s (antes, pipoca na mesa)`, () => {
    const sim = newSim();
    const clock = { now: T0 };
    const shells = [{ id: 'b1', label: 'Testes', startedAt: T0, background: true, kind: 'shell' as const }];
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'shell', { shells }), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    const ana = sim.chars.get('ana')!;
    expect(ana.mode).toBe('shell');
    expect(sim.social.canJoin(ana, clock.now)).toBe(false);
    clock.now = T0 + SHELL_SOCIAL_MIN_MS + 1000;
    sim.update(1 / 30, clock.now);
    if (!ana.step && !ana.queue.length) expect(sim.social.canJoin(ana, clock.now)).toBe(true);
  });

  it('aba volta do segundo plano: rodas encerradas e lugares devolvidos', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle'), agent('davi', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    sim.social.force('kitchen', clock.now, ['ana', 'caio', 'davi']);
    run(sim, clock, 3);
    sim.fastForward(clock.now);
    expect(sim.social.gatherings.size).toBe(0);
    for (const c of sim.chars.values()) {
      expect(c.gathering).toBeNull();
      expect(c.atSpot).toBe(c.homeSpot);
    }
    for (const s of sim.spots.all()) expect(sim.spots.ownerOf(s.id)?.startsWith('g:') ?? false).toBe(false);
  });

  it('a interface recebe personalidade, carteira, vínculos e o que está fazendo', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    sim.social.force('talk', clock.now, ['ana', 'caio']);
    const info = sim.social.info('ana')!;
    expect(info.coins).toBe(START_COINS.main);
    expect(info.traits.length).toBeGreaterThanOrEqual(2);
    expect(info.doing).toMatch(new RegExp(`^${KINDS.talk.emoji} ${KINDS.talk.label} com Caio`));
    expect(sim.social.info('ninguem')).toBeNull();
  });
});
