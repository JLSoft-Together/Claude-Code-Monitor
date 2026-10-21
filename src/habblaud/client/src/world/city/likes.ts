// Like, carimbo e "bater na porta" na cidade (Fase 5): a porta mais perto que dá para tocar (like a até 4 tiles da
// porta; bater e carimbar a até 2; nunca no próprio prédio), os limites do lado de cá (like 10 por minuto; bater 1 por
// minuto por prédio) e o coração que voa até a placa. Puro (testado); o desenho fica em social.ts.
import { lotDoor, type CityPoint } from '../../../../shared/world/city';
import type { WorldBuildingPublic } from '../../../../shared/world/protocol';
import { nearestDoor } from './layout';

/** Distâncias (tiles) até `lotDoor(lot).front`, as mesmas do servidor do mundo. */
export const LIKE_DISTANCE = 4;
export const KNOCK_DISTANCE = 2;
export const STAMP_DISTANCE = 2;
/**
 * Bater na porta: uma vez por minuto por prédio (o servidor recusa antes disso). Do lado de cá, com folga: os comandos
 * saem em lotes a cada 200 ms e podem chegar mais juntos do que saíram.
 */
export const KNOCK_EVERY_MS = 62_000;
/** Tempo do coração voando até a placa. */
export const HEART_MS = 900;

export interface DoorTarget {
  building: WorldBuildingPublic;
  front: CityPoint;
  /** Distância (tiles) até a frente da porta. */
  dist: number;
}

/**
 * A porta mais perto (até `max` tiles) de um prédio que está na cidade e não é o meu. `buildingAt` diz o prédio de
 * cada lote (o estado da cena).
 */
export function doorTarget(
  me: { x: number; y: number },
  buildingAt: (lot: CityPoint) => WorldBuildingPublic | undefined,
  myBuildingId: string | null,
  max: number,
): DoorTarget | null {
  const d = nearestDoor(me.x, me.y, (lot) => {
    const b = buildingAt(lot);
    return !!b && b.id !== myBuildingId;
  }, max);
  if (!d) return null;
  const building = buildingAt(d.lot);
  if (!building) return null;
  return { building, front: d.front, dist: Math.hypot(d.front.x - me.x, d.front.y - me.y) };
}

/** Distância (tiles) de mim até a porta de um prédio. */
export function doorDistance(me: { x: number; y: number }, b: Pick<WorldBuildingPublic, 'lot'>): number {
  const f = lotDoor(b.lot).front;
  return Math.hypot(f.x - me.x, f.y - me.y);
}

/** O que os botões de um prédio mostram agora: curtir (perto), bater (perto e o dono aceita) e por que não. */
export interface DoorActions {
  canLike: boolean;
  canKnock: boolean;
  liked: boolean;
  mine: boolean;
}

export function doorActions(b: WorldBuildingPublic, me: { x: number; y: number } | null, myBuildingId: string | null): DoorActions {
  const mine = !!myBuildingId && b.id === myBuildingId;
  const dist = me ? doorDistance(me, b) : Infinity;
  return {
    canLike: !mine && dist <= LIKE_DISTANCE + 1e-9,
    canKnock: !mine && b.knocks === true && dist <= KNOCK_DISTANCE + 1e-9,
    liked: b.likedByMe === true,
    mine,
  };
}

/** Bater na porta: quando cada prédio foi batido por último (só do lado de cá). */
export class KnockBook {
  private readonly at = new Map<string, number>();

  /** Quanto falta (ms) para bater de novo neste prédio. */
  wait(buildingId: string, now: number): number {
    const t = this.at.get(buildingId);
    return t === undefined ? 0 : Math.max(0, t + KNOCK_EVERY_MS - now);
  }

  take(buildingId: string, now: number): boolean {
    if (this.wait(buildingId, now) > 0) return false;
    this.at.set(buildingId, now);
    return true;
  }
}

/** Um coração voando de `from` até `to` (px de mundo), num arco. */
export interface HeartFlight {
  from: { x: number; y: number };
  to: { x: number; y: number };
  start: number;
  /** Desfazer o like: o coração cai da placa, partido. */
  broken?: boolean;
}

/** Onde está o coração (px de mundo), a escala e a opacidade; null quando já chegou. */
export function heartAt(f: HeartFlight, now: number): { x: number; y: number; scale: number; alpha: number } | null {
  const t = (now - f.start) / HEART_MS;
  if (t < 0 || t >= 1) return null;
  if (f.broken) {
    // cai da placa, balançando
    return { x: f.to.x + Math.sin(t * 9) * 3, y: f.to.y + t * t * 26, scale: 1, alpha: 1 - t };
  }
  const e = 1 - (1 - t) * (1 - t);
  const lift = Math.sin(t * Math.PI) * 26;
  const x = f.from.x + (f.to.x - f.from.x) * e;
  const y = f.from.y + (f.to.y - f.from.y) * e - lift;
  const scale = t < 0.15 ? 0.6 + (t / 0.15) * 0.8 : t > 0.8 ? 1.4 - ((t - 0.8) / 0.2) * 0.6 : 1.4;
  return { x, y, scale, alpha: t > 0.9 ? (1 - t) * 10 : 1 };
}

/** Coração em pixel art (7×6), 1 = cor, 2 = brilho. */
export const HEART_PIXELS: readonly string[] = ['.11.11.', '1211111', '1111111', '.11111.', '..111..', '...1...'];
