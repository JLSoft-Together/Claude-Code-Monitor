// O visitante da cena Visita (PLANO.md, seção 8.4): o meu personagem dentro do prédio de outra pessoa. Entra pelo
// elevador da recepção com o crachá de visitante, anda com o teclado (passo livre, com colisão na grade do prédio) ou
// com um clique (caminho do A*) e nunca senta: os assentos contam como parede para ele. Fica fora de `Sim.chars`: não
// vem do snapshot, não entra na vida social, não reserva lugar e não acende nem apaga luz. Na v1 ninguém mais o vê
// (nenhum passo sai daqui: a posição lá dentro não vai ao servidor do mundo). Regras puras (sem DOM).
import type { AgentInfo } from '../../../../shared/types';
import type { AppearanceParts } from '../../../../shared/appearance';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import type { Dir } from '../../art/api';
import { TILE } from '../constants';
import { RECEPTION_ID } from '../layout/core';
import { BLOCKED, SEAT, type WalkGrid } from '../path/grid';
import { dirOf } from './character';

/** Id do visitante (nunca um id de agente: nem do escritório local nem `world:`). */
export const VISITOR_ID = 'visita:eu';
/** Cor do crachá de visitante (cordão e selo da etiqueta). */
export const VISITOR_LANYARD = '#ff8a3d';
/** Distância (tiles) da frente de um elevador em que aparece "Sair pelo elevador (E)". */
export const EXIT_RADIUS = 1.6;

/** Para onde o teclado manda o visitante: -1, 0 ou 1 em cada eixo; `run` com Shift. */
export interface VisitorIntent {
  dx: number;
  dy: number;
  run: boolean;
}

export const NO_INTENT: Readonly<VisitorIntent> = { dx: 0, dy: 0, run: false };

/** O meu personagem do mundo (o `me` da cena), como agente do `Sim` só para desenhar. */
export function visitorInfo(me: { name: string; look: 'f' | 'm'; parts?: AppearanceParts }, now: number): AgentInfo {
  return {
    id: VISITOR_ID,
    kind: 'main',
    provider: 'claude',
    roomId: RECEPTION_ID,
    name: me.name,
    look: me.look,
    ...(me.parts && Object.keys(me.parts).length ? { parts: me.parts } : {}),
    role: tr('Visitante'),
    sessionId: VISITOR_ID,
    account: '',
    status: 'idle',
    recent: [],
    tasks: [],
    startedAt: now,
    lastEventAt: now,
    statusSince: now,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: hash32(`${VISITOR_ID}:${me.name}`),
  };
}

/** Tile em que estão os pés (px de mundo). */
export function tileAt(x: number, y: number): { x: number; y: number } {
  return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
}

/** Margens (px) em volta dos pés que precisam estar em chão livre: o corpo não entra na parede nem nos móveis. */
const HALF_W = 4;
const UP = 4;
const DOWN = 2;

/** O visitante pode ficar com os pés em (x, y)? Chão livre (assentos contam como parede: ele não senta). */
export function canStand(grid: WalkGrid, x: number, y: number): boolean {
  for (const [ox, oy] of [
    [-HALF_W, -UP],
    [HALF_W, -UP],
    [-HALF_W, DOWN],
    [HALF_W, DOWN],
  ] as const) {
    const t = tileAt(x + ox, y + oy);
    const c = grid.get(t.x, t.y);
    if (c === BLOCKED || c === SEAT) return false;
  }
  return true;
}

/**
 * Um passo livre do teclado: anda `dist` px na direção pedida (diagonal normalizada), um eixo de cada vez para
 * deslizar na parede. Devolve a posição nova, a direção e se andou.
 */
export function stepFree(grid: WalkGrid, pos: { x: number; y: number; dir: Dir }, intent: VisitorIntent, dist: number): { x: number; y: number; dir: Dir; moved: boolean } {
  let { dx, dy } = intent;
  dx = Math.sign(dx);
  dy = Math.sign(dy);
  if (!dx && !dy) return { ...pos, moved: false };
  const k = dx && dy ? Math.SQRT1_2 : 1;
  let { x, y } = pos;
  let moved = false;
  if (dx) {
    const nx = x + dx * dist * k;
    if (canStand(grid, nx, y)) {
      x = nx;
      moved = true;
    }
  }
  if (dy) {
    const ny = y + dy * dist * k;
    if (canStand(grid, x, ny)) {
      y = ny;
      moved = true;
    }
  }
  return { x, y, dir: dirOf(dx, dy, pos.dir), moved };
}
