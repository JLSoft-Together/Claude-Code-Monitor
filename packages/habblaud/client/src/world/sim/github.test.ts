// GitHub no escritório (mundo): efeitos das salas vindos do snapshot (relógio, expiração, troca) e a
// comemoração dos personagens na festa. Sem DOM.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomEffect, RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { beaconFacing, beaconFrame, fxFade } from '../render/github-fx';
import { cheerDelay, PARTY_CHEER_MS, RoomFxState } from './github';
import { Sim } from './sim';

const T0 = 1_700_000_000_000;

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

function room(id: string, slot: number, effect?: RoomEffect): RoomInfo {
  const r: RoomInfo = { id, name: id.replace('/', ''), path: id, slot, seed: slot * 99 + 7, createdAt: T0 };
  if (effect) r.effect = effect;
  return r;
}

function agent(id: string, roomId: string, status: AgentInfo['status']): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId,
    name: id,
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
    seed: id.length * 1234567,
  };
}

function snap(rooms: RoomInfo[], agents: AgentInfo[], serverTime = T0, rev = 1): OfficeSnapshot {
  return {
    rev,
    serverTime,
    rooms,
    agents,
    accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
    meta: { demo: true, sources: [], startedAt: T0, version: 't' },
  };
}

const party = (at: number, agentId?: string): RoomEffect => ({ kind: 'party', text: 'PR #12 mergeado!', at, until: at + 12_000, ...(agentId ? { agentId } : {}) });
const alarm = (at: number, agentId?: string): RoomEffect => ({ kind: 'alarm', text: 'CI falhou (main)', at, until: at + 600_000, ...(agentId ? { agentId } : {}) });

describe('efeitos das salas no mundo', () => {
  it('converte para o relógio do navegador (relógios divergentes não importam)', () => {
    const fx = new RoomFxState();
    // servidor 1 h adiantado; a festa começou há 2 s no servidor
    const server = T0 + 3_600_000;
    fx.sync([room('/a', 0, party(server - 2_000, 'ana'))], server, T0);
    const a = fx.get('/a', T0)!;
    expect(a).toMatchObject({ kind: 'party', agentId: 'ana', start: T0 - 2_000, end: T0 + 10_000 });
    expect(fx.get('/a', T0 + 10_000)).toBeUndefined();
  });

  it('mesmo efeito em snapshots seguidos é o mesmo (não recomeça); outro `at` recomeça', () => {
    const fx = new RoomFxState();
    fx.sync([room('/a', 0, party(T0))], T0, T0);
    const first = fx.active.get('/a')!;
    first.cheered.add('ana');
    fx.sync([room('/a', 0, party(T0))], T0 + 1_000, T0 + 1_000);
    expect(fx.active.get('/a')).toBe(first);
    fx.sync([room('/a', 0, party(T0 + 5_000))], T0 + 5_000, T0 + 5_000);
    expect(fx.active.get('/a')!.cheered.size).toBe(0);
  });

  it('some quando sai do snapshot (CI verde apagou o alarme) ou vence; o forçado pela depuração fica', () => {
    const fx = new RoomFxState();
    fx.sync([room('/a', 0, alarm(T0, 'ana')), room('/b', 1, alarm(T0))], T0, T0);
    expect(fx.alarmOwner('ana', T0 + 1)?.roomId).toBe('/a');
    fx.active.get('/b')!.sticky = true;
    fx.sync([room('/a', 0), room('/b', 1)], T0 + 1_000, T0 + 1_000);
    expect(fx.get('/a', T0 + 1_000)).toBeUndefined();
    expect(fx.alarmOwner('ana', T0 + 1_000)).toBeUndefined();
    expect(fx.get('/b', T0 + 1_000)?.kind).toBe('alarm');
    // efeito já vencido no servidor nem entra
    fx.sync([room('/c', 2, party(T0 - 20_000))], T0, T0);
    expect(fx.get('/c', T0)).toBeUndefined();
  });

  it('giroflex: de frente, à direita, de costas, à esquerda; fade de entrada e saída', () => {
    expect([0, 0.25, 0.5, 0.75, 0.95].map(beaconFrame)).toEqual([0, 1, 2, 3, 0]);
    expect(beaconFacing(0)).toBe(1);
    expect(beaconFacing(0.5)).toBe(0);
    expect(fxFade({ start: T0, end: T0 + 12_000 }, T0)).toBe(0);
    expect(fxFade({ start: T0, end: T0 + 12_000 }, T0 + 5_000)).toBe(1);
    expect(fxFade({ start: T0, end: T0 + 12_000 }, T0 + 11_700)).toBeCloseTo(0.5);
  });
});

describe('festa: a sala comemora', () => {
  function run(sim: Sim, clock: { now: number }, seconds: number): void {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      clock.now += 1000 / 30;
      sim.update(1 / 30, clock.now);
    }
  }

  it('quem está na mesa levanta e dá pulinhos; o responsável ganha estrela e confete; quem precisa de você não', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
    const clock = { now: T0 };
    const agents = [agent('ana', '/a', 'working'), agent('bia', '/a', 'idle'), agent('caio', '/a', 'waiting'), agent('davi', '/b', 'working')];
    sim.applySnapshot(snap([room('/a', 0), room('/b', 1)], agents), clock.now);
    run(sim, clock, 0.5);
    sim.applySnapshot(snap([room('/a', 0, party(clock.now, 'ana')), room('/b', 1)], agents, clock.now, 2), clock.now);
    let cheered = new Set<string>();
    for (let i = 0; i < 60; i++) {
      run(sim, clock, 1 / 30);
      for (const ch of sim.chars.values()) if (ch.pose === 'cheer') cheered.add(ch.id);
    }
    expect(cheered).toEqual(new Set(['ana', 'bia']));
    expect(sim.chars.get('ana')!.icon).toBe('star');
    expect(sim.effects.some((e) => e.kind === 'confetti' && e.charId === 'ana')).toBe(true);
    expect(sim.chars.get('caio')!.pose).toBe('raise_hand');
    // depois da comemoração, cada um volta para o lugar
    run(sim, clock, PARTY_CHEER_MS / 1000 + 1);
    const ana = sim.chars.get('ana')!;
    expect(ana.atSpot).toBe(ana.homeSpot);
    expect(ana.pose).toBe('type');
    // ninguém comemora duas vezes a mesma festa
    cheered = new Set();
    for (let i = 0; i < 60; i++) {
      run(sim, clock, 1 / 30);
      for (const ch of sim.chars.values()) if (ch.pose === 'cheer') cheered.add(ch.id);
    }
    expect(cheered.size).toBe(0);
  });

  it('cada um começa num instante (a sala não pula em uníssono)', () => {
    const delays = ['ana', 'bia', 'caio', 'davi', 'eva'].map(cheerDelay);
    expect(new Set(delays).size).toBeGreaterThan(1);
    for (const d of delays) expect(d).toBeLessThan(700);
  });
});
