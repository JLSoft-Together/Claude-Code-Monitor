// Regras puras da camada de texto do mundo (balões e enquadramento).
import { describe, expect, it } from 'vitest';
import { overviewFrame } from '../camera';
import { rationBubbles, waitBubbleText } from './overlay';

describe('balões', () => {
  it('espera: só o motivo, sem o prefixo redundante', () => {
    expect(waitBubbleText('aprovar uma permissão')).toBe('Aprovar uma permissão');
    expect(waitBubbleText('Precisa de você: escolher uma opção')).toBe('Escolher uma opção');
    expect(waitBubbleText(undefined)).toBe('Responder no terminal');
    expect(waitBubbleText('   ')).toBe('Responder no terminal');
  });

  it('visão geral: no máximo 1 balão com texto por área e 4 na tela (mais recentes primeiro)', () => {
    const items = [
      { room: 'a', prio: 50, changedAt: 10 },
      { room: 'a', prio: 50, changedAt: 30 },
      { room: 'a', prio: 50, changedAt: 20 },
      { room: 'b', prio: 30, changedAt: 99 },
      { room: 'c', prio: 50, changedAt: 1 },
      { room: 'd', prio: 50, changedAt: 2 },
      { room: 'e', prio: 50, changedAt: 3 },
    ];
    const keep = rationBubbles(items, 1, 4);
    expect(keep.size).toBe(4);
    expect(keep.has(1)).toBe(true); // o mais recente da área "a"
    expect(keep.has(0) || keep.has(2)).toBe(false);
    expect(keep.has(3)).toBe(false); // prioridade menor perde para as outras áreas
  });
});

describe('visão geral', () => {
  const building = { x: 0, y: 0, w: 4 * 16 * 16, h: 29 * 16 };

  it('enquadra o prédio na área livre (fora dos painéis), com folga para as placas acima', () => {
    const free = overviewFrame(building, 1440, 900, { top: 0, right: 0, bottom: 0, left: 0 });
    const ui = overviewFrame(building, 1440, 900, { top: 64, right: 0, bottom: 200, left: 320 });
    expect(ui.zoom).toBeLessThan(free.zoom);
    // a altura do enquadramento (placas + prédio + meio-fio) cabe entre a barra superior e a inferior
    const h = (building.h + 3.5 * 16) * ui.zoom;
    expect(h).toBeLessThanOrEqual(900 - 64 - 200 - 30);
    // começa acima da parede norte (placas) e termina abaixo da fachada sul
    expect(ui.cy).toBeGreaterThan(building.h / 2);
    expect(ui.dy).toBeGreaterThan(0);
  });
});
