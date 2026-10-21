// Cartões: bandeira só de código ISO-2, andares com teto de 24 ("24+"), mês sem fuso, modo discreto, perfil.
import { describe, expect, it } from 'vitest';
import type { WorldBuildingPublic, WorldPlayerPublic } from '../../../../shared/world/protocol';
import { CARD_MAX_FLOORS, buildingCardModel, flagEmoji, floorsLabel, likesLabel, monthLabel, playerCardModel } from './cards';

const b: WorldBuildingPublic = { id: 'b1', lot: { district: 'centro', x: 3, y: 0 }, owner: { id: 'o1', name: 'Ana Pixel', country: 'br' }, state: 'online', theme: 'none', floors: 30, agents: { total: 5, working: 2, waiting: 1, idle: 2 }, rev: 1, likes: 12, sinceMonth: '2026-10' };

describe('cartão do prédio', () => {
  it('bandeira do país (emoji) só para dois letras', () => {
    expect(flagEmoji('BR')).toBe('🇧🇷');
    expect(flagEmoji('fr')).toBe('🇫🇷');
    expect(flagEmoji('BRA')).toBe('');
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji(undefined)).toBe('');
  });

  it('andares: a fachada vai até 12 com "+N"; o cartão mostra até 24 e "24+" acima', () => {
    expect(CARD_MAX_FLOORS).toBe(24);
    expect(floorsLabel(0)).toBe('só o térreo');
    expect(floorsLabel(1)).toBe('1 andar');
    expect(floorsLabel(16)).toBe('16 andares');
    expect(floorsLabel(24)).toBe('24 andares');
    expect(floorsLabel(25)).toBe('24+ andares');
  });

  it('o mês de entrada é o do dia 1 local (sem cair no mês anterior pelo fuso)', () => {
    expect(monthLabel('2026-10')).toMatch(/outubro/);
    expect(monthLabel('2026-10')).toMatch(/2026/);
    expect(monthLabel('2026-13')).toBe('');
    expect(monthLabel('lixo')).toBe('');
  });

  it('modelo: estado, agentes (ou modo discreto), likes e "no mundo desde"', () => {
    const m = buildingCardModel(b, 'b1');
    expect(m).toMatchObject({ owner: 'Ana Pixel', flag: '🇧🇷', online: true, state: 'Luzes acesas', floors: '24+ andares', agents: { working: 2, waiting: 1, idle: 2 }, likes: '12 curtidas', closed: false, mine: true });
    expect(m.since).toMatch(/outubro/);
    const d = buildingCardModel({ ...b, agents: undefined, state: 'away', closed: true }, null);
    expect(d.agents).toBeNull();
    expect(d.state).toBe('Luzes apagadas');
    expect(d.closed).toBe(true);
    expect(d.mine).toBe(false);
    expect(likesLabel(1)).toBe('1 curtida');
  });
});

describe('cartão do jogador', () => {
  it('traços com emoji, frase traduzida, likes recebidos e o prédio (se a cidade conhece)', () => {
    const p: WorldPlayerPublic = { id: 'w1', name: 'Luna', country: 'JP', look: 'f', parts: {}, traits: ['games', 'cafeina', 'inexistente' as never], intro: 'coffee', buildingId: 'b1', likesReceived: 3, pos: { x: 0, y: 0, dir: 's', moving: false }, where: 'street' };
    const m = playerCardModel(p, b);
    expect(m.flag).toBe('🇯🇵');
    expect(m.traits.map((t) => t.emoji)).toEqual(['🎮', '☕']);
    expect(m.intro).toBe('Movido a café');
    expect(m.likes).toBe('3 curtidas');
    expect(m.building).toEqual({ id: 'b1', floors: '24+ andares', online: true });
    const far = playerCardModel(p, undefined);
    expect(far.building).toBeNull();
    expect(far.hasBuilding).toBe(true);
  });
});
