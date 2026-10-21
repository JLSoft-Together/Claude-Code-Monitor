// O social leve da cidade (Fase 5), os modelos puros: a roda e os balões dos cumprimentos, os limites do lado de cá, a
// porta que dá para curtir ou bater, o coração voando, os tokens na fachada, o confete do fim de turno, a meta da
// cidade e o código do "Ir para".
import { describe, expect, it } from 'vitest';
import { lotDoor } from '../../../../shared/world/city';
import type { CityGoal, WorldBuildingPublic } from '../../../../shared/world/protocol';
import { cityHallView, goalsReached, goalView, ornamentFor, reachedGoalView } from './fireworks';
import { BalloonBook, BALLOON_MS, pickGreetTarget, RateGate, suggestedReply, WHEEL, wheelIndexOfKey, wheelKey, wheelLayout } from './greetings';
import { doorActions, doorTarget, heartAt, HEART_MS, KnockBook, KNOCK_EVERY_MS, LIKE_DISTANCE } from './likes';
import { FADE, normalizeBuildingCode, TeleportFade } from './teleport';
import { meterBars, meterRect, shiftEnded, signGlowLevel } from './tokens-facade';

function building(id: string, lot: { x: number; y: number }, extra: Partial<WorldBuildingPublic> = {}): WorldBuildingPublic {
  return { id, lot: { district: 'centro', ...lot }, owner: { id, name: `Dono ${id}` }, state: 'online', theme: 'none', floors: 3, rev: 1, likes: 5, sinceMonth: '2026-10', ...extra };
}

describe('roda de cumprimentos', () => {
  it('10 itens em círculo, o primeiro em cima, teclas 1–9 e 0', () => {
    const l = wheelLayout(WHEEL.length, 100);
    expect(l).toHaveLength(10);
    expect(l[0]).toMatchObject({ x: 0, y: -100 });
    expect(l[5]).toMatchObject({ x: 0, y: 100 });
    expect(WHEEL.map((_, i) => wheelKey(i)).join('')).toBe('1234567890');
    expect(wheelIndexOfKey('1')).toBe(0);
    expect(wheelIndexOfKey('0')).toBe(9);
    expect(wheelIndexOfKey('a')).toBe(-1);
  });

  it('para quem: quem me cumprimentou, depois o selecionado, depois o mais perto (até 12 tiles)', () => {
    const me = { x: 0, y: 0 };
    const ps = [{ id: 'perto', x: 2, y: 0 }, { id: 'meio', x: 6, y: 0 }, { id: 'longe', x: 30, y: 0 }];
    expect(pickGreetTarget(me, ps)).toBe('perto');
    expect(pickGreetTarget(me, ps, { selected: 'meio' })).toBe('meio');
    expect(pickGreetTarget(me, ps, { selected: 'meio', replyTo: 'longe' })).toBe('longe');
    expect(pickGreetTarget(me, ps, { selected: 'sumiu' })).toBe('perto');
    expect(pickGreetTarget(me, [{ id: 'longe', x: 30, y: 0 }])).toBeNull();
  });

  it('balão por 5 s a partir de quando chegou; um novo do mesmo jogador recomeça', () => {
    const b = new BalloonBook();
    b.add('p1', 'hello', 1_000);
    expect(b.get('p1', 1_000 + BALLOON_MS / 2)).toMatchObject({ id: 'hello', t: 0.5 });
    b.add('p1', 'thanks', 4_000);
    expect(b.get('p1', 1_000 + BALLOON_MS + 10)?.id).toBe('thanks');
    expect(b.get('p1', 4_000 + BALLOON_MS)).toBeNull();
    expect(b.size).toBe(0);
  });

  it('limite do lado de cá: um a cada 3 s e 20 por minuto', () => {
    const g = new RateGate(20, 3_000);
    expect(g.take(0)).toBe(true);
    expect(g.take(2_999)).toBe(false);
    expect(g.wait(2_000)).toBe(1_000);
    let t = 0;
    let ok = 1;
    for (let i = 0; i < 40; i++) {
      t += 3_000;
      if (t < 60_000 && g.take(t)) ok++;
    }
    expect(ok).toBe(20);
    expect(g.take(59_999)).toBe(false);
    expect(g.take(60_000)).toBe(true);
  });

  it('resposta sugerida: sempre um cumprimento da lista', () => {
    for (const id of WHEEL) expect(WHEEL).toContain(suggestedReply(id));
    expect(suggestedReply('hello')).toBe('nice_to_meet');
    expect(suggestedReply('congrats')).toBe('thanks');
  });
});

describe('like e bater na porta', () => {
  const near = building('b1', { x: 4, y: 1 }, { knocks: true });
  const mine = building('eu', { x: 3, y: 1 });
  const at = (lot: { x: number; y: number }) => (lot.x === 4 && lot.y === 1 ? near : lot.x === 3 && lot.y === 1 ? mine : undefined);
  const door = lotDoor(near.lot).front;

  it('a porta mais perto até a distância pedida, nunca a do meu prédio', () => {
    expect(doorTarget({ x: door.x + 3, y: door.y }, at, 'eu', LIKE_DISTANCE)?.building.id).toBe('b1');
    expect(doorTarget({ x: door.x + 5, y: door.y }, at, 'eu', LIKE_DISTANCE)).toBeNull();
    const myDoor = lotDoor(mine.lot).front;
    expect(doorTarget(myDoor, at, 'eu', LIKE_DISTANCE)).toBeNull();
  });

  it('curtir a até 4 passos; bater a até 2 e só em quem aceita; o meu, nada', () => {
    expect(doorActions(near, { x: door.x + 3.9, y: door.y }, 'eu')).toEqual({ canLike: true, canKnock: false, liked: false, mine: false });
    expect(doorActions(near, { x: door.x + 1, y: door.y }, 'eu')).toMatchObject({ canLike: true, canKnock: true });
    expect(doorActions({ ...near, knocks: undefined }, door, 'eu').canKnock).toBe(false);
    expect(doorActions(mine, lotDoor(mine.lot).front, 'eu')).toMatchObject({ canLike: false, canKnock: false, mine: true });
    expect(doorActions(near, null, 'eu').canLike).toBe(false);
  });

  it('bater: uma vez por minuto por prédio', () => {
    const k = new KnockBook();
    expect(k.take('b1', 0)).toBe(true);
    expect(k.take('b1', KNOCK_EVERY_MS - 1)).toBe(false);
    expect(k.take('b2', 10)).toBe(true);
    expect(k.take('b1', KNOCK_EVERY_MS)).toBe(true);
  });

  it('o coração sobe em arco até a placa e some ao chegar; desfeito, cai partido', () => {
    const f = { from: { x: 0, y: 100 }, to: { x: 100, y: 0 }, start: 0 };
    const mid = heartAt(f, HEART_MS / 2)!;
    expect(mid.x).toBeGreaterThan(50);
    expect(mid.y).toBeLessThan(50);
    expect(heartAt(f, HEART_MS)).toBeNull();
    const broken = heartAt({ ...f, broken: true }, HEART_MS / 2)!;
    expect(broken.y).toBeGreaterThan(0);
    expect(broken.alpha).toBeLessThan(1);
  });
});

describe('tokens na fachada e fim de turno', () => {
  it('letreiro: apagado sem faixa, depois fraco, normal, neon e neon com faíscas (4 e 5)', () => {
    expect([undefined, 0, 1, 2, 3, 4, 5].map((b) => signGlowLevel(b as never))).toEqual([0, 0, 1, 2, 3, 4, 4]);
    expect([undefined, 0, 3, 5].map((b) => meterBars(b as never))).toEqual([0, 0, 3, 5]);
  });

  it('o medidor fica na vitrine, ao lado da porta (frente) ou da marquise (fundos), dentro do sprite', () => {
    const front = meterRect({ side: 'front', height: 100 });
    expect(front.y + front.h).toBeLessThanOrEqual(100);
    expect(front.x + front.w).toBeLessThanOrEqual(192 / 2 - 16);
    expect(meterRect({ side: 'back', height: 100 }).y).toBe(0);
  });

  it('fim de turno: menos trabalhando e mais à toa no mesmo patch', () => {
    const prev = { total: 4, working: 3, waiting: 0, idle: 1 };
    expect(shiftEnded(prev, { total: 4, working: 1, waiting: 0, idle: 3 })).toBe(true);
    expect(shiftEnded(prev, { total: 4, working: 4, waiting: 0, idle: 0 })).toBe(false);
    expect(shiftEnded(prev, { total: 4, working: 2, waiting: 1, idle: 1 })).toBe(false);
    expect(shiftEnded(undefined, { working: 0, idle: 4 })).toBe(false);
    expect(shiftEnded(prev, undefined)).toBe(false);
  });
});

describe('a meta da cidade', () => {
  const goal = (label: CityGoal['label'], target: number, progress: number): CityGoal => ({ id: `2026-10-12:${label}`, label, target, progress, until: 0 });

  it('termômetro: porcentagem, rótulo e quantas metas a semana já bateu', () => {
    const v = goalView({ lit: 40, goal: goal('agent_hours_10k', 10_000, 8_000) })!;
    expect(v).toMatchObject({ pct: 0.8, pctText: '80%', reached: 0 });
    expect(v.label).toMatch(/horas de agentes trabalhando/);
    expect(goalView({ lit: 40, goal: goal('agent_hours_50k', 50_000, 12_000) })?.reached).toBe(1);
    expect(goalsReached(goal('agent_hours_100k', 100_000, 100_000))).toBe(3);
    expect(goalView({ lit: 3 })).toBeNull();
    expect(goalView(null)).toBeNull();
  });

  it('durante os fogos, o termômetro mostra a meta que acabou de bater, cheia', () => {
    expect(reachedGoalView('2026-10-12:agent_hours_10k')).toMatchObject({ pct: 1, pctText: '100%', reached: 1, progressText: 'Meta batida!' });
    expect(reachedGoalView('2026-10-12:agent_hours_50k')?.reached).toBe(2);
    expect(reachedGoalView('qualquer')).toBeNull();
  });

  it('prefeitura: prédios acesos e a faixa dos tokens (ou o aviso dos 10 prédios)', () => {
    expect(cityHallView({ lit: 1 })).toMatchObject({ lit: '1 prédio aceso agora', tokens: 'A soma aparece com 10 prédios ou mais.' });
    expect(cityHallView({ lit: 42, tokensBand: 5 })?.tokens).toBe('A cidade consumiu ≈ mais de 100 milhões de tokens esta semana');
  });

  it('o enfeite da estação: abóboras em outubro, Natal em novembro e dezembro, festa no resto', () => {
    expect(ornamentFor(new Date(2026, 9, 15))).toBe('halloween');
    expect(ornamentFor(new Date(2026, 11, 1))).toBe('christmas');
    expect(ornamentFor(new Date(2026, 5, 1))).toBe('party');
  });
});

describe('Ir para HB-XXXX', () => {
  it('o código como foi digitado vira o canônico; fora do alfabeto, null', () => {
    expect(normalizeBuildingCode('hb-4f2k')).toBe('HB-4F2K');
    expect(normalizeBuildingCode(' HB 4F2K ')).toBe('HB-4F2K');
    expect(normalizeBuildingCode('4f2k')).toBe('HB-4F2K');
    expect(normalizeBuildingCode('hb4f2k')).toBe('HB-4F2K');
    for (const bad of ['', 'HB-0O1I', 'HB-4F2', 'HB-4F2KK', 'HB-LULU']) expect(normalizeBuildingCode(bad), bad).toBeNull();
  });

  it('fade: escurece, espera o pos, clareia; sem resposta, desiste em 5 s', () => {
    const f = new TeleportFade();
    f.start(0);
    expect(f.tick(FADE.out / 2)).toMatchObject({ phase: 'out', dark: 0.5 });
    expect(f.tick(FADE.out + 10).phase).toBe('wait');
    f.arrived();
    expect(f.tick(FADE.out + 20)).toMatchObject({ phase: 'in', dark: 1, timedOut: false });
    expect(f.tick(FADE.out + 20 + FADE.in).phase).toBe('idle');
    expect(f.busy).toBe(false);
    const g = new TeleportFade();
    g.start(0);
    g.tick(FADE.out);
    expect(g.tick(FADE.out + FADE.wait)).toMatchObject({ phase: 'in', timedOut: true });
  });
});
