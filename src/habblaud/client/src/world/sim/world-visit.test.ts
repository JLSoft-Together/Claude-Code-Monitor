// A visita a um prédio do mundo no `Sim` de verdade: o snapshot de shared/world/office-from-world.ts tem tudo o que a
// simulação exige (semente, vaga, contas, tempos, listas vazias) e cada agente aparece na sala do andar dele, no
// comportamento do status. Também o modo discreto, o prédio apagado e os patches (status, andar que some, andar novo).
import { describe, expect, it } from 'vitest';
import { applyBuildingPatch, officeFromBuilding } from '../../../../shared/world/office-from-world';
import type { WorldBuildingDetail } from '../../../../shared/world/protocol';
import { sampleBuildingDetail } from '../../../../shared/world/visit-sample';
import type { OfficeSnapshot } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { MISSING_DEBOUNCE_MS } from '../constants';
import { inRect } from '../layout/geometry';
import type { Character } from './character';
import { Sim, type VisitLight } from './sim';
import { canStand, NO_INTENT, stepFree, VISITOR_ID, VISITOR_LANYARD, visitorInfo } from './visitor';

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

const T0 = 1_790_000_000_000;
const OPTS = { version: 't' };

/** Avança a simulação em passos de 1/30 s. */
function run(sim: Sim, clock: { now: number }, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (until?.()) return;
  }
}

/** Carteiras só em memória, como o timelapse. */
const newSim = () => new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }), null);

function enter(detail: WorldBuildingDetail): { sim: Sim; clock: { now: number }; snap: OfficeSnapshot } {
  const sim = newSim();
  const clock = { now: T0 };
  const snap = officeFromBuilding(detail, clock.now, OPTS);
  sim.applySnapshot(snap, clock.now);
  return { sim, clock, snap };
}

const charByName = (sim: Sim, name: string): Character => [...sim.chars.values()].find((c) => c.info.name === name)!;

/** O tile em que o personagem está fica dentro do retângulo da sala dele. */
function insideOwnRoom(sim: Sim, ch: Character): boolean {
  const room = sim.rooms.get(ch.roomId);
  return !!room && inRect(room.layout.rect, ch.tx, ch.ty);
}

describe('visita a um prédio do mundo no Sim', () => {
  it('todos os personagens existem, na sala do andar deles e no comportamento do status', () => {
    const detail = sampleBuildingDetail();
    const { sim, clock, snap } = enter(detail);
    run(sim, clock, 3);
    expect(sim.rooms.size).toBe(3);
    for (const r of sim.rooms.values()) {
      expect(r.phase).toBe('ready');
      expect(r.lightOn).toBe(true);
    }
    expect(sim.chars.size).toBe(6);
    for (const f of detail.floors) {
      for (const a of f.agents) {
        const ch = sim.chars.get(`world:${a.id}`)!;
        expect(ch, a.name).toBeDefined();
        expect(ch.roomId).toBe(f.id);
        expect(ch.info.status).toBe(a.status);
        expect(ch.gone || ch.leaving).toBe(false);
      }
    }
    const mode = (name: string) => charByName(sim, name).mode;
    expect([mode('Marina'), mode('Rafael'), mode('Beatriz'), mode('Thiago'), mode('Larissa'), mode('Gustavo')]).toEqual([
      'work',
      'work',
      'wait',
      'shell',
      'idle',
      'idle',
    ]);
    // quem trabalha ou espera está na própria mesa, dentro da sala do andar
    for (const name of ['Marina', 'Beatriz']) {
      const ch = charByName(sim, name);
      expect(ch.homeSpot).not.toBeNull();
      expect(ch.atSpot).toBe(ch.homeSpot);
      expect(insideOwnRoom(sim, ch)).toBe(true);
    }
    expect(charByName(sim, 'Marina').pose).toBe('type');
    expect(charByName(sim, 'Beatriz').pose).toBe('raise_hand');
    // o subagente acha o pai pelo id `world:`; o órfão segue sozinho
    const sub = charByName(sim, 'Rafael');
    expect(sim.chars.get(sub.info.parentId!)).toBe(charByName(sim, 'Marina'));
    expect(charByName(sim, 'Thiago').info.parentId).toBeUndefined();
    // contas fictícias nas etiquetas: a do Codex com o selo da ferramenta
    expect(sim.accounts.get('world:codex')).toEqual({ short: 'X', color: snap.accounts[1].color, name: 'Codex', provider: 'codex' });
    expect(sim.accounts.get('world:claude')).toMatchObject({ short: 'C', name: 'Claude Code' });
    // um tempo depois, ninguém foi embora nem trocou de sala
    run(sim, clock, 20);
    expect(sim.chars.size).toBe(6);
    for (const ch of sim.chars.values()) expect(ch.leaving).toBe(false);
  });

  it('modo discreto: as salas aparecem, com a luz acesa, sem ninguém', () => {
    const { sim, clock } = enter(sampleBuildingDetail('discreet'));
    run(sim, clock, 5);
    expect(sim.rooms.size).toBe(3);
    for (const r of sim.rooms.values()) {
      expect(r.phase).toBe('ready');
      expect(r.lightOn).toBe(true);
    }
    expect(sim.chars.size).toBe(0);
  });

  it('prédio apagado: as salas existem e ninguém aparece (a cena apaga as luzes)', () => {
    const { sim, clock } = enter(sampleBuildingDetail('away'));
    run(sim, clock, 5);
    expect([...sim.rooms.keys()]).toEqual(['f_0a1b2c3d4e', 'f_1b2c3d4e5f', 'f_2c3d4e5f60']);
    expect(sim.chars.size).toBe(0);
  });

  it('patch: agente que troca de status, andar que some (todos vão embora) e andar novo (construído, com quem chega)', () => {
    const { sim, clock, snap } = enter(sampleBuildingDetail());
    run(sim, clock, 3);
    const floors = sampleBuildingDetail().floors.filter((f) => f.label !== 'aurora');
    floors[1].agents[0].status = 'working'; // Beatriz: esperando -> trabalhando
    floors.push({
      id: 'f_3d4e5f6071',
      label: 'orion',
      agents: [{ id: 'a_0badf00d', kind: 'main', provider: 'claude', status: 'working', look: 'f', name: 'Camila', parts: {} }],
    });
    const { snapshot } = applyBuildingPatch(snap, { rev: 13, floors }, clock.now);
    sim.applySnapshot(snapshot, clock.now);
    const beatriz = charByName(sim, 'Beatriz');
    expect(beatriz.mode).toBe('work');
    const aurora = sim.rooms.get('f_2c3d4e5f60')!;
    expect(aurora.listed).toBe(false);
    const orion = sim.rooms.get('f_3d4e5f6071')!;
    expect(orion.phase).toBe('building');
    const camila = charByName(sim, 'Camila');
    expect(camila.roomId).toBe('f_3d4e5f6071');
    expect(camila.arriving).toBe(true);
    // quem estava no andar que sumiu vai embora depois do debounce
    run(sim, clock, MISSING_DEBOUNCE_MS / 1000 + 1);
    expect(charByName(sim, 'Larissa').leaving).toBe(true);
    expect(charByName(sim, 'Gustavo').leaving).toBe(true);
    run(sim, clock, 120, () => !sim.rooms.has('f_2c3d4e5f60') && camila.atSpot === camila.homeSpot && !!camila.homeSpot);
    expect(sim.rooms.has('f_2c3d4e5f60')).toBe(false);
    expect(charByName(sim, 'Larissa')).toBeUndefined();
    expect(orion.phase).toBe('ready');
    expect(orion.lightOn).toBe(true);
    expect(camila.atSpot).toBe(camila.homeSpot);
    expect(insideOwnRoom(sim, camila)).toBe(true);
    expect(insideOwnRoom(sim, beatriz)).toBe(true);
    expect(beatriz.pose).toBe('type');
    run(sim, clock, 120, () => !charByName(sim, 'Gustavo'));
    expect([...sim.chars.values()].map((c) => c.info.name).sort()).toEqual(['Beatriz', 'Camila', 'Marina', 'Rafael', 'Thiago']);
  });

  it('o prédio ficou discreto no meio da visita: todo mundo vai embora e as salas ficam', () => {
    const { sim, clock, snap } = enter(sampleBuildingDetail());
    run(sim, clock, 3);
    const { snapshot } = applyBuildingPatch(snap, { rev: 13, building: sampleBuildingDetail('discreet').building }, clock.now);
    sim.applySnapshot(snapshot, clock.now);
    run(sim, clock, 120, () => sim.chars.size === 0);
    expect(sim.chars.size).toBe(0);
    expect(sim.rooms.size).toBe(3);
  });
});

// ------------------------------------------------------------------------------------------------ cena Visita (Fase 4)

/** O Sim da cena Visita: `visit: true`, carteiras só em memória. */
const visitSim = () => new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }), null, { visit: true });

function visit(detail: WorldBuildingDetail, light: VisitLight = 'live'): { sim: Sim; clock: { now: number }; snap: OfficeSnapshot } {
  const sim = visitSim();
  sim.visitLight = light;
  const clock = { now: T0 };
  const snap = officeFromBuilding(detail, clock.now, OPTS);
  sim.applySnapshot(snap, clock.now);
  return { sim, clock, snap };
}

describe('Sim da visita (visit: true)', () => {
  it('nenhum tempo do status: quem espera um shell fica de braços cruzados (sem pipoca, teia ou cochilo) e o ocioso não cochila', () => {
    const { sim, clock } = visit(sampleBuildingDetail());
    expect(sim.visit).toBe(true);
    // 40 min depois (o tempo da visita não é o tempo do status: nada escala)
    run(sim, clock, 2);
    clock.now += 40 * 60_000;
    run(sim, clock, 3);
    const thiago = charByName(sim, 'Thiago');
    expect(thiago.mode).toBe('shell');
    expect(thiago.shellStage).toBeNull();
    if (thiago.atSpot === thiago.homeSpot && thiago.seated) {
      expect(thiago.pose).toBe('wait');
      expect(thiago.held).toBe('none');
    }
    for (const name of ['Larissa', 'Gustavo']) {
      const ch = charByName(sim, name);
      expect(sim.longIdle(ch, clock.now)).toBe(false);
      expect(ch.icon).not.toBe('zzz');
    }
    // o mesmo prédio fora da visita: 40 min de espera viram cochilo com teia
    const office = newSim();
    const snap = officeFromBuilding(sampleBuildingDetail(), T0, OPTS);
    office.applySnapshot(snap, T0);
    const c2 = { now: T0 };
    run(office, c2, 2);
    c2.now += 40 * 60_000;
    run(office, c2, 1);
    expect(charByName(office, 'Thiago').shellStage).toBe('nap');
    expect(office.longIdle(charByName(office, 'Larissa'), c2.now)).toBe(true);
  });

  it('apagado: as salas entram escuras e ficam assim; discreto: acesas e vazias; o prédio que acende chama os agentes, que acendem a luz', () => {
    const away = visit(sampleBuildingDetail('away'), 'away');
    for (const r of away.sim.rooms.values()) expect(r.lightOn, r.id).toBe(false);
    run(away.sim, away.clock, 5);
    for (const r of away.sim.rooms.values()) expect(r.lightOn).toBe(false);
    const discreet = visit(sampleBuildingDetail('discreet'), 'discreet');
    run(discreet.sim, discreet.clock, 2);
    for (const r of discreet.sim.rooms.values()) expect(r.lightOn).toBe(true);
    expect(discreet.sim.chars.size).toBe(0);
    // o dono voltou: o patch traz o prédio aceso e os andares com gente
    const live = sampleBuildingDetail();
    away.sim.visitLight = 'live';
    const { snapshot } = applyBuildingPatch(away.snap, { rev: 13, floors: live.floors, building: live.building }, away.clock.now);
    away.sim.applySnapshot(snapshot, away.clock.now);
    run(away.sim, away.clock, 60, () => [...away.sim.rooms.values()].every((r) => r.lightOn));
    expect([...away.sim.rooms.values()].every((r) => r.lightOn)).toBe(true);
    expect(away.sim.chars.size).toBe(6);
  });
});

describe('o visitante', () => {
  const ME = { name: 'Pixel Dev', look: 'f' as const, parts: {} };

  function withVisitor(detail = sampleBuildingDetail()) {
    const v = visit(detail);
    run(v.sim, v.clock, 1);
    const ch = v.sim.setVisitor(visitorInfo(ME, v.clock.now), v.clock.now)!;
    run(v.sim, v.clock, 10, () => !v.sim.visitorBusy);
    return { ...v, ch };
  }

  it('chega pelo elevador da recepção, com o crachá de visitante, fora dos agentes (snapshot, vida social, lugares)', () => {
    const { sim, clock, ch, snap } = withVisitor();
    expect(ch.id).toBe(VISITOR_ID);
    expect(ch.appearance.lanyard).toBe(VISITOR_LANYARD);
    expect(ch.alpha).toBe(1);
    expect(ch.inside).toBe(false);
    expect(sim.visitorBusy).toBe(false);
    const el = sim.spots.get(sim.elevators[0]!.spotId)!;
    expect([ch.tx, ch.ty]).toEqual([el.tx, el.ty]);
    expect(sim.chars.has(VISITOR_ID)).toBe(false);
    expect([...sim.people()].at(-1)).toBe(ch);
    expect(sim.person(VISITOR_ID)).toBe(ch);
    expect(sim.visitorElevator()).not.toBeNull();
    // snapshots seguintes não mexem nele (nem o mandam embora)
    sim.applySnapshot(snap, clock.now);
    run(sim, clock, MISSING_DEBOUNCE_MS / 1000 + 2);
    expect(sim.visitor).toBe(ch);
    expect(ch.leaving).toBe(false);
    for (const c of sim.chars.values()) expect(c.gathering?.members.some((m) => m.id === VISITOR_ID) ?? false).toBe(false);
    expect(ch.gathering).toBeNull();
    // ninguém contou o visitante: as carteiras e as salas são só dos agentes
    expect(sim.social.wallets.get(VISITOR_ID)).toBeUndefined();
  });

  it('anda com o teclado e não atravessa parede nem assento; o clique leva por um caminho', () => {
    const { sim, clock, ch } = withVisitor();
    const start = { x: ch.x, y: ch.y };
    sim.visitorIntent = { dx: 0, dy: 1, run: false };
    run(sim, clock, 1.5);
    expect(ch.y).toBeGreaterThan(start.y + 20);
    expect(['walk', 'stand']).toContain(ch.pose);
    // segurando para cima por muito tempo: para na parede, nunca dentro dela
    sim.visitorIntent = { dx: 0, dy: -1, run: true };
    run(sim, clock, 6);
    sim.visitorIntent = { ...NO_INTENT };
    const grid = sim.building.grid;
    expect(canStand(grid, ch.x, ch.y)).toBe(true);
    // passeando em todas as direções, os pés ficam sempre em chão livre
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 1], [1, -1], [-1, 0]] as const) {
      sim.visitorIntent = { dx, dy, run: true };
      for (let i = 0; i < 60; i++) {
        run(sim, clock, 1 / 30);
        expect(canStand(grid, ch.x, ch.y)).toBe(true);
      }
    }
    sim.visitorIntent = { ...NO_INTENT };
    run(sim, clock, 0.2);
    // o clique: até a porta da sala do primeiro andar
    const room = sim.rooms.get('f_0a1b2c3d4e')!;
    const door = room.layout.door!;
    expect(sim.visitorWalkTo(door.x, door.y)).toBe(true);
    run(sim, clock, 30, () => !ch.step && !ch.queue.length);
    expect([ch.tx, ch.ty]).toEqual([door.x, door.y]);
    expect(ch.seated).toBe(false);
  });

  it('sai pelo elevador: entra, some e só então a cena manda o leave; ocupado, não anda nem sai de novo', () => {
    const { sim, clock, ch } = withVisitor();
    sim.visitorIntent = { dx: 1, dy: 1, run: false };
    run(sim, clock, 1);
    sim.visitorIntent = { ...NO_INTENT };
    let left = 0;
    expect(sim.visitorExit(() => left++)).toBe(true);
    expect(sim.visitorBusy).toBe(true);
    expect(sim.visitorExit(() => left++)).toBe(false);
    expect(sim.visitorWalkTo(1, 1)).toBe(false);
    run(sim, clock, 15, () => left > 0);
    expect(left).toBe(1);
    expect(ch.inside).toBe(true);
    expect(ch.alpha).toBe(0);
    sim.setVisitor(null, clock.now);
    expect(sim.visitor).toBeNull();
    expect([...sim.people()].some((c) => c.id === VISITOR_ID)).toBe(false);
  });

  it('a aba voltou do segundo plano no meio da chegada ou da saída: termina na hora (e a saída acontece)', () => {
    const v = visit(sampleBuildingDetail());
    const ch = v.sim.setVisitor(visitorInfo(ME, v.clock.now), v.clock.now)!;
    v.sim.fastForward(v.clock.now);
    expect(ch.alpha).toBe(1);
    expect(v.sim.visitorBusy).toBe(false);
    let left = false;
    v.sim.visitorExit(() => (left = true));
    v.sim.fastForward(v.clock.now + 1000);
    expect(left).toBe(true);
  });
});

describe('stepFree e canStand (puros)', () => {
  it('sem intenção não anda; diagonal normalizada; desliza na parede por um eixo', () => {
    const sim = visitSim();
    const grid = sim.building.grid;
    const el = sim.spots.get(sim.elevators[0]!.spotId)!;
    const pos = { x: el.tx * 16 + 8, y: el.ty * 16 + 11, dir: 'down' as const };
    expect(stepFree(grid, pos, NO_INTENT, 10)).toEqual({ ...pos, moved: false });
    const d = stepFree(grid, pos, { dx: 1, dy: 1, run: false }, 10);
    expect(Math.hypot(d.x - pos.x, d.y - pos.y)).toBeCloseTo(10, 5);
    // para cima, logo abaixo da parede dos elevadores: não sobe, mas anda para o lado
    const up = stepFree(grid, pos, { dx: 1, dy: -1, run: false }, 40);
    expect(up.moved).toBe(true);
    expect(canStand(grid, up.x, up.y)).toBe(true);
    expect(up.y).toBeGreaterThanOrEqual(pos.y - 40 * Math.SQRT1_2 - 1e-9);
  });
});
