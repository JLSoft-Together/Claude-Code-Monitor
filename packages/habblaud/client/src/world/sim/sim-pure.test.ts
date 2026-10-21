import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../../shared/hash';
import type { SpotDef } from '../layout/types';
import {
  canDismantle,
  chooseSeat,
  idleSitMs,
  IDLE_WEIGHTS,
  isLastInRoom,
  isLongIdle,
  LONG_IDLE_MS,
  lightLevel,
  modeFor,
  pickIdleActivity,
  screenModeFor,
  shouldRun,
} from './behavior';
import { SpotRegistry } from './spots';
import { Elevator } from './elevator';
import { buildAnim, furnitureScale, sweepDelay } from '../render/anim';
import { ambientAt } from '../render/daylight';

function spot(id: string, kind: SpotDef['kind'], extra: Partial<SpotDef> = {}): SpotDef {
  return { id, kind, areaId: 'a', tx: 0, ty: 0, x: 0, y: 0, dir: 'up', ...extra };
}

describe('modos de comportamento', () => {
  it('status -> modo', () => {
    expect(modeFor('working', { kind: 'main' })).toBe('work');
    expect(modeFor('waiting', { kind: 'main' })).toBe('wait');
    expect(modeFor('idle', { kind: 'main' })).toBe('idle');
    expect(modeFor('offline', { kind: 'main' })).toBe('leave');
    expect(modeFor('done', { kind: 'sub' })).toBe('deliver');
    expect(modeFor('done', { kind: 'main' })).toBe('idle');
    expect(modeFor('working', { kind: 'main', missing: true })).toBe('leave');
    expect(modeFor('working', { kind: 'sub', parentGone: true })).toBe('leave');
  });

  it('tela do monitor segue a atividade', () => {
    expect(screenModeFor('edit')).toBe('code');
    expect(screenModeFor('write')).toBe('code');
    expect(screenModeFor('test')).toBe('terminal');
    expect(screenModeFor('git')).toBe('terminal');
    expect(screenModeFor('web')).toBe('browser');
    expect(screenModeFor('search')).toBe('search');
    expect(screenModeFor('read')).toBe('docs');
    expect(screenModeFor('plan')).toBe('tasks');
    expect(screenModeFor('ask')).toBe('chat');
    expect(screenModeFor('error')).toBe('alert');
    expect(screenModeFor(undefined)).toBe('code');
  });

  it('corre quando longe (trabalho) ou quando precisa do usuário', () => {
    expect(shouldRun(20, 'work')).toBe(true);
    expect(shouldRun(5, 'work')).toBe(false);
    expect(shouldRun(4, 'wait')).toBe(true);
    expect(shouldRun(40, 'idle')).toBe(false);
  });

  it('ocioso há mais de 10 min cochila', () => {
    const now = 1_000_000_000;
    expect(isLongIdle('idle', now - LONG_IDLE_MS - 1, now)).toBe(true);
    expect(isLongIdle('idle', now - 1000, now)).toBe(false);
    expect(isLongIdle('working', now - LONG_IDLE_MS * 2, now)).toBe(false);
  });
});

describe('passeios', () => {
  it('sorteio ponderado respeita a disponibilidade', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const a = pickIdleActivity(rng, { pingpong: false, talk: false, bathroom: false });
      expect(a).not.toBeNull();
      expect(['pingpong', 'talk', 'bathroom']).not.toContain(a);
    }
    const none = Object.fromEntries(Object.keys(IDLE_WEIGHTS).map((k) => [k, false]));
    expect(pickIdleActivity(rng, none)).toBeNull();
  });

  it('café é o passeio mais comum', () => {
    const rng = mulberry32(7);
    const count = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const a = pickIdleActivity(rng)!;
      count.set(a, (count.get(a) ?? 0) + 1);
    }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(top).toBe('coffee');
  });

  it('tempo sentado depende da animação escolhida', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const calm = idleSitMs(rng, 'calm');
      const lively = idleSitMs(rng, 'lively');
      expect(calm).toBeGreaterThanOrEqual(16_000);
      expect(lively).toBeLessThanOrEqual(10_000);
      const normal = idleSitMs(rng, 'normal');
      expect(normal).toBeGreaterThanOrEqual(6_000);
      expect(normal).toBeLessThanOrEqual(20_000);
    }
  });
});

describe('assentos e reservas', () => {
  const spots: SpotDef[] = [
    spot('d0', 'desk', { rank: 0 }),
    spot('d1', 'desk', { rank: 1 }),
    spot('s0', 'stool'),
    spot('p0', 'stand'),
  ];

  it('principal e subagente pegam a primeira mesa livre; sem mesa, banqueta; depois em pé', () => {
    const reg = new SpotRegistry();
    reg.setSpots(spots);
    const pick = (who: string) => {
      const s = chooseSeat(spots, (id) => reg.isFree(id, who), 'sub');
      if (s) reg.reserve(s.id, who);
      return s?.id ?? null;
    };
    expect(pick('a')).toBe('d0');
    expect(pick('b')).toBe('d1');
    expect(pick('c')).toBe('s0');
    expect(pick('d')).toBe('p0');
    expect(pick('e')).toBeNull();
  });

  it('reserva tem um único dono e alternativas livres são encontradas', () => {
    const reg = new SpotRegistry();
    reg.setSpots([spot('c1', 'coffee', { tx: 0 }), spot('c2', 'coffee', { tx: 10 })]);
    expect(reg.reserve('c1', 'ana')).toBe(true);
    expect(reg.reserve('c1', 'bia')).toBe(false);
    expect(reg.reserve('c1', 'ana')).toBe(true);
    expect(reg.findFree('coffee', { near: { tx: 0, ty: 0 } })?.id).toBe('c2');
    reg.release('c1', 'bia');
    expect(reg.ownerOf('c1')).toBe('ana');
    reg.releaseAll('ana');
    expect(reg.isFree('c1')).toBe(true);
  });

  it('grupos (pares) só são oferecidos inteiros', () => {
    const reg = new SpotRegistry();
    reg.setSpots([spot('t1', 'talk', { group: 'g' }), spot('t2', 'talk', { group: 'g' })]);
    expect(reg.findFreeGroup('talk')?.length).toBe(2);
    reg.reserve('t2', 'x');
    expect(reg.findFreeGroup('talk')).toBeNull();
  });

  it('reservas de spots que deixaram de existir são devolvidas', () => {
    const reg = new SpotRegistry();
    reg.setSpots([spot('a', 'desk'), spot('b', 'desk')]);
    reg.reserve('a', 'ana');
    reg.reserve('b', 'bia');
    const lost = reg.setSpots([spot('b', 'desk')]);
    expect(lost).toEqual([{ spotId: 'a', owner: 'ana' }]);
    expect(reg.ownerOf('b')).toBe('bia');
  });
});

describe('salas, luz e elevador', () => {
  it('último da sala é quem apaga a luz', () => {
    const chars = [
      { id: 'a', roomId: 'r', leaving: true },
      { id: 'b', roomId: 'r', leaving: false },
      { id: 'c', roomId: 'x', leaving: false },
    ];
    expect(isLastInRoom('r', 'a', chars)).toBe(false);
    chars[1].leaving = true;
    expect(isLastInRoom('r', 'a', chars)).toBe(true);
  });

  it('desmontagem só com sala fora do snapshot, vazia e apagada', () => {
    const base = { listed: false, occupants: 0, lightOn: false, dark: true, unlistedForMs: 5000 };
    expect(canDismantle(base, 1500)).toBe(true);
    expect(canDismantle({ ...base, listed: true }, 1500)).toBe(false);
    expect(canDismantle({ ...base, occupants: 1 }, 1500)).toBe(false);
    expect(canDismantle({ ...base, lightOn: true }, 1500)).toBe(false);
    expect(canDismantle({ ...base, unlistedForMs: 100 }, 1500)).toBe(false);
  });

  it('luz pisca ao acender e apaga em ~0,6 s', () => {
    expect(lightLevel(true, 100)).toBeLessThan(0.5);
    expect(lightLevel(true, 2000)).toBe(1);
    expect(lightLevel(false, 30)).toBeGreaterThan(0);
    expect(lightLevel(false, 600)).toBe(0);
  });

  it('elevador abre enquanto há usuários e escalona as chegadas', () => {
    const e = new Elevator(0, 'e');
    e.request('a');
    for (let i = 0; i < 10; i++) e.update(0.05, 0);
    expect(e.isOpen).toBe(true);
    expect(e.state).toBe(4);
    e.release('a', 0);
    for (let i = 0; i < 40; i++) e.update(0.05, 2000);
    expect(e.state).toBe(0);
    const t1 = e.reserveAppear(1000);
    const t2 = e.reserveAppear(1000);
    expect(t2).toBeGreaterThan(t1);
  });
});

describe('animações', () => {
  it('construção: piso, paredes e móveis em sequência', () => {
    const early = buildAnim('building', 0.1);
    expect(early.floor).toBeGreaterThan(0);
    expect(early.walls).toBe(0);
    expect(furnitureScale(early, 0)).toBe(0);
    const done = buildAnim('building', 1);
    expect(done.floor).toBe(1);
    expect(done.walls).toBe(1);
    expect(furnitureScale(done, 1)).toBeCloseTo(1, 5);
    expect(done.sign).toBe(1);
  });

  it('desmontagem: móveis somem antes das paredes e do piso', () => {
    const start = buildAnim('dismantling', 0.05);
    expect(furnitureScale(start, 0)).toBe(1);
    expect(furnitureScale(start, 1)).toBeLessThan(1.2);
    const mid = buildAnim('dismantling', 0.46);
    for (const order of [0, 0.3, 0.7, 1]) expect(furnitureScale(mid, order)).toBe(0);
    expect(mid.walls).toBe(1);
    const end = buildAnim('dismantling', 1);
    expect(end.floor).toBe(0);
    expect(end.walls).toBe(0);
  });

  it('varredura do piso começa no canto superior esquerdo', () => {
    expect(sweepDelay(0, 0, 16, 12)).toBe(0);
    expect(sweepDelay(15, 11, 16, 12)).toBeGreaterThan(sweepDelay(1, 1, 16, 12));
  });

  it('dia e noite', () => {
    expect(ambientAt(12).night).toBe(0);
    expect(ambientAt(23).night).toBe(1);
    expect(ambientAt(3).night).toBe(1);
    expect(ambientAt(18.5).night).toBeGreaterThan(0);
    expect(ambientAt(18.5).night).toBeLessThan(1);
  });
});
