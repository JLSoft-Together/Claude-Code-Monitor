// Jogadores na rua (puro): o meu (movimento local imediato, colisão pelo `isWalkable` do city.ts, caminho do A*,
// envio de `move` até 10 por segundo) e os outros (amostras de posição a 5/s para os 20 mais perto e a 2,5/s para os
// outros, desenhados um pouco atrás e interpolados entre elas; o atraso acompanha o intervalo entre as amostras de
// cada um). Posições em TILES (o ponto dos pés; o mesmo do protocolo).
import type { Dir } from '../../art/api';
import type { Direction } from '../../../../shared/world/protocol';
import { walkable as cityWalkable } from './layout';

/** Velocidades (tiles/s): as do escritório. O servidor aceita até 6 × 1,2. */
export const WALK_TPS = 3.2;
export const RUN_TPS = 6;
/**
 * Atraso com que os outros são desenhados (ms): o maior intervalo recente entre as amostras de cada um mais uma folga
 * para a rede, para sempre haver uma amostra adiante (5/s: ~260 ms; 2,5/s: ~460 ms), entre o mínimo e o máximo.
 */
export const INTERP_MIN_MS = 150;
export const INTERP_MAX_MS = 700;
const INTERP_MARGIN_MS = 60;
/** Intervalos maiores que isto não são a cadência (o jogador parou e o servidor não mandou nada): não contam. */
const CADENCE_MAX_GAP_MS = 1_000;
/** Quantos intervalos recentes contam. */
const CADENCE_GAPS = 4;
/** Quanto o atraso muda por ms de relógio (subindo, o desenho anda a 0,5×; descendo, a 1,25×): nunca volta atrás. */
const DELAY_UP_RATE = 0.5;
const DELAY_DOWN_RATE = 0.25;
/** Intervalo mínimo entre dois `move` (10/s). */
export const MOVE_INTERVAL_MS = 100;
/** Amostras guardadas por jogador. */
const MAX_SAMPLES = 10;

export const DIR_TO_PROTO: Readonly<Record<Dir, Direction>> = { up: 'n', down: 's', left: 'w', right: 'e' };
export const PROTO_TO_DIR: Readonly<Record<Direction, Dir>> = { n: 'up', s: 'down', w: 'left', e: 'right' };

/** Direção dominante de um deslocamento (mantém a anterior parado). */
export function dirOf(dx: number, dy: number, fallback: Dir): Dir {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

// ------------------------------------------------------------------ outros jogadores

export interface Sample {
  t: number;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

/** Guarda a amostra em ordem de tempo, com limite. */
export function pushSample(samples: Sample[], s: Sample): void {
  const last = samples[samples.length - 1];
  if (last && s.t < last.t) s = { ...s, t: last.t };
  samples.push(s);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

export interface Interpolated {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /** Velocidade estimada (tiles/s) entre as duas amostras. */
  speed: number;
}

/** Atraso alvo (ms) para as amostras de um jogador: o maior dos últimos intervalos entre elas, mais a folga. */
export function interpDelay(samples: readonly Sample[]): number {
  let worst = 0;
  let n = 0;
  for (let i = samples.length - 1; i > 0 && n < CADENCE_GAPS; i--) {
    const gap = samples[i]!.t - samples[i - 1]!.t;
    if (gap <= 0 || gap > CADENCE_MAX_GAP_MS) continue;
    worst = Math.max(worst, gap);
    n++;
  }
  return Math.min(INTERP_MAX_MS, Math.max(INTERP_MIN_MS, worst + INTERP_MARGIN_MS));
}

/** Leva o atraso atual até o alvo aos poucos (`dtMs` de relógio), sem o desenho voltar no tempo. */
export function stepDelay(current: number, target: number, dtMs: number): number {
  if (target > current) return Math.min(target, current + dtMs * DELAY_UP_RATE);
  return Math.max(target, current - dtMs * DELAY_DOWN_RATE);
}

/**
 * Posição no instante `t` (o "agora" menos o atraso): linear entre as duas amostras que o cercam; antes da primeira,
 * a primeira; depois da última, a última (parado se ela já é velha).
 */
export function sampleAt(samples: readonly Sample[], t: number): Interpolated | null {
  const n = samples.length;
  if (!n) return null;
  const first = samples[0]!;
  if (t <= first.t) return { x: first.x, y: first.y, dir: first.dir, moving: first.moving && n > 1, speed: 0 };
  for (let i = 1; i < n; i++) {
    const b = samples[i]!;
    if (t > b.t) continue;
    const a = samples[i - 1]!;
    const span = Math.max(1, b.t - a.t);
    const k = Math.min(1, Math.max(0, (t - a.t) / span));
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: b.dir, moving: dist > 1e-3 || b.moving, speed: (dist * 1000) / span };
  }
  const last = samples[n - 1]!;
  // a última amostra dizia "andando", mas faz tempo: parou (a próxima chega quando ele mexer)
  const stale = t - last.t > 400;
  return { x: last.x, y: last.y, dir: last.dir, moving: last.moving && !stale, speed: 0 };
}

// ------------------------------------------------------------------ meu jogador

export type Walkable = (x: number, y: number) => boolean;

/**
 * Anda (dx, dy) tiles a partir de (x, y), um eixo de cada vez (desliza na parede), sem entrar onde não dá para pisar.
 * Passos grandes são quebrados em pedaços de no máximo meio tile, para não atravessar quinas.
 */
export function stepMove(x: number, y: number, dx: number, dy: number, can: Walkable = cityWalkable): { x: number; y: number; blocked: boolean } {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.5));
  let blocked = false;
  for (let i = 0; i < n; i++) {
    const nx = x + dx / n;
    if (can(nx, y)) x = nx;
    else blocked = true;
    const ny = y + dy / n;
    if (can(x, ny)) y = ny;
    else blocked = true;
  }
  return { x, y, blocked };
}

export interface MoveIntent {
  /** Direção das teclas (-1..1 em cada eixo; 0,0 = nenhuma). */
  dx: number;
  dy: number;
  run: boolean;
}

export class LocalPlayer {
  x: number;
  y: number;
  dir: Dir = 'down';
  moving = false;
  running = false;
  /** Pontos (tiles) do caminho do clique, já no formato [x0, y0, x1, y1...]. */
  private path: number[] = [];
  private pathI = 0;
  private pathRun = false;
  /** Tempo (ms) na pose atual, para os quadros da animação. */
  animT = 0;

  constructor(
    x: number,
    y: number,
    private readonly can: Walkable = cityWalkable,
  ) {
    this.x = x;
    this.y = y;
  }

  get hasPath(): boolean {
    return this.pathI < this.path.length;
  }

  /** Caminho (pontos em tiles) a seguir. */
  follow(points: number[], run: boolean): void {
    this.path = points;
    this.pathI = 0;
    this.pathRun = run;
  }

  stopPath(): void {
    this.path = [];
    this.pathI = 0;
  }

  /** Correção do servidor (`pos`): vai para lá na hora e esquece o caminho. */
  correct(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.stopPath();
  }

  /** Avança `dt` segundos. Teclas têm prioridade sobre o caminho do clique. */
  update(dt: number, intent: MoveIntent): void {
    const prevMoving = this.moving;
    const prevRun = this.running;
    dt = Math.min(0.1, Math.max(0, dt));
    let dx = intent.dx;
    let dy = intent.dy;
    if (dx || dy) {
      this.stopPath();
      const len = Math.hypot(dx, dy);
      // diagonal normalizada: nunca mais rápido que a velocidade de corrida
      dx /= len;
      dy /= len;
      const v = (intent.run ? RUN_TPS : WALK_TPS) * dt;
      const r = stepMove(this.x, this.y, dx * v, dy * v, this.can);
      this.dir = dirOf(dx, dy, this.dir);
      this.moving = Math.hypot(r.x - this.x, r.y - this.y) > 1e-4;
      this.running = intent.run && this.moving;
      this.x = r.x;
      this.y = r.y;
    } else if (this.hasPath) {
      let budget = (this.pathRun ? RUN_TPS : WALK_TPS) * dt;
      this.moving = true;
      this.running = this.pathRun;
      while (budget > 0 && this.hasPath) {
        const tx = this.path[this.pathI]!;
        const ty = this.path[this.pathI + 1]!;
        const ddx = tx - this.x;
        const ddy = ty - this.y;
        const d = Math.hypot(ddx, ddy);
        if (d <= budget) {
          this.x = tx;
          this.y = ty;
          budget -= d;
          this.pathI += 2;
          if (d > 1e-6) this.dir = dirOf(ddx, ddy, this.dir);
        } else {
          this.x += (ddx / d) * budget;
          this.y += (ddy / d) * budget;
          this.dir = dirOf(ddx, ddy, this.dir);
          budget = 0;
        }
      }
      if (!this.hasPath) {
        this.moving = false;
        this.running = false;
      }
    } else {
      this.moving = false;
      this.running = false;
    }
    if (prevMoving !== this.moving || prevRun !== this.running) this.animT = 0;
    else this.animT += dt * 1000;
  }
}

/** Converte o caminho do A* (tiles inteiros da grade local) em pontos (centro dos tiles) até o destino fino. */
export function pathPoints(cells: readonly number[], ox: number, oy: number, goal: { x: number; y: number } | null): number[] {
  const out: number[] = [];
  for (let i = 0; i < cells.length; i += 2) out.push(cells[i]! + ox + 0.5, cells[i + 1]! + oy + 0.5);
  if (goal && out.length >= 2) {
    // o último ponto vira o ponto exato do clique (dentro do mesmo tile)
    out[out.length - 2] = goal.x;
    out[out.length - 1] = goal.y;
  } else if (goal && !out.length) out.push(goal.x, goal.y);
  return out;
}

/**
 * Posição para o fio, em centésimos de tile, sempre truncada para baixo: arredondar poderia levar quem parou rente à
 * borda norte ou oeste de um lote (y = 11,996) para dentro dele (12,00), e o servidor devolveria `pos`. Truncar
 * nunca troca de tile.
 */
export function wirePos(v: number): number {
  return Math.floor(v * 100) / 100;
}

/**
 * Quando mandar `move`: no máximo um a cada 100 ms, só quando a posição ou o "andando" mudou desde o último. O
 * "parei" sempre sai (no próximo intervalo livre).
 */
export class MoveSender {
  private lastAt = -Infinity;
  private last: { x: number; y: number; dir: Direction; moving: boolean } | null = null;

  constructor(private readonly send: (m: { t: 'move'; x: number; y: number; dir: Direction; moving: boolean }) => void) {}

  tick(now: number, p: { x: number; y: number; dir: Dir; moving: boolean }): boolean {
    if (now - this.lastAt < MOVE_INTERVAL_MS) return false;
    const cur = { x: wirePos(p.x), y: wirePos(p.y), dir: DIR_TO_PROTO[p.dir], moving: p.moving };
    const l = this.last;
    if (l && l.x === cur.x && l.y === cur.y && l.dir === cur.dir && l.moving === cur.moving) return false;
    this.lastAt = now;
    this.last = cur;
    this.send({ t: 'move', ...cur });
    return true;
  }

  /**
   * Repete a posição parada (aba em segundo plano: o servidor não tira o jogador da rua).
   * Sem hora: quem chama usa outro relógio que o `tick`, e guardar a hora dele calava os envios até um `reset`.
   */
  keepAlive(p: { x: number; y: number; dir: Dir }): void {
    const cur = { x: wirePos(p.x), y: wirePos(p.y), dir: DIR_TO_PROTO[p.dir], moving: false };
    this.lastAt = -Infinity;
    this.last = cur;
    this.send({ t: 'move', ...cur });
  }

  /** Esquece o último enviado (depois de uma correção, o próximo tick manda de novo). */
  reset(): void {
    this.last = null;
    this.lastAt = -Infinity;
  }
}
