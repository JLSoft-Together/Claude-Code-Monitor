// A praça da cidade (Fase 5): o termômetro da meta coletiva da semana ("10 mil horas de agentes trabalhando"), a placa
// da prefeitura ("a cidade consumiu ≈ X esta semana" e os prédios acesos), os fogos quando a meta é batida (20 s) e o
// enfeite da semana para todos depois disso (bandeirinhas entre os postes e, da segunda meta em diante, o enfeite da
// estação: abóboras em outubro, árvore e presentes no fim do ano). Tudo cosmético e no navegador, a partir do `city` e
// do `city.fireworks` (o servidor só soma, e só com 10 prédios acesos ou mais).
// Modelos puros (testados); o desenho é em px de mundo (as placas e os enfeites com profundidade, os fogos por cima da
// noite) e os textos das placas em espaço de tela (nítidos, como as placas dos prédios).
import { tr } from '../../../../shared/i18n';
import { blockOrigin, FOUNTAIN, PLAZA } from '../../../../shared/world/city';
import { CITY_GOAL_IDS, type CityGoal } from '../../../../shared/world/protocol';
import type { WorldSceneCity } from '../../../../shared/world/api';
import { cityGoalLabel, compactNumber, tokenBandText } from '../../../../shared/world/social-labels';
import { renderSeasonalProp, type SeasonalProp } from '../../art/seasonal';
import { TILE } from '../../art/api';
import { CONFETTI_COLORS, Particles } from '../render/particles';

/** Duração dos fogos na praça. */
export const FIREWORKS_MS = 20_000;

// ------------------------------------------------------------------ modelos

export interface GoalView {
  /** 0..1 da meta da semana. */
  pct: number;
  /** "80%". */
  pctText: string;
  /** "10 mil horas de agentes trabalhando". */
  label: string;
  /** "8 mil de 10 mil h". */
  progressText: string;
  /** Metas batidas nesta semana (0 a 3): o enfeite da praça. */
  reached: number;
}

/** Quantas metas da semana já foram batidas (a do `goal` é a primeira não batida, ou a última, já batida). */
export function goalsReached(goal: CityGoal | undefined): number {
  if (!goal) return 0;
  const i = CITY_GOAL_IDS.indexOf(goal.label);
  if (i < 0) return 0;
  return i + (goal.progress >= goal.target ? 1 : 0);
}

/** O termômetro: null sem meta (com menos de 10 prédios acesos o servidor não manda). */
export function goalView(city: WorldSceneCity | undefined | null): GoalView | null {
  const g = city?.goal;
  if (!g || !(g.target > 0)) return null;
  const pct = Math.max(0, Math.min(1, g.progress / g.target));
  return {
    pct,
    pctText: `${Math.floor(pct * 100)}%`,
    label: cityGoalLabel(g.label, g.target),
    progressText: tr('{0} de {1} h', [compactNumber(Math.floor(g.progress)), compactNumber(g.target)]),
    reached: goalsReached(g),
  };
}

/** A meta que acabou de bater (`goalId` = "<segunda>:<CityGoalId>" do `city.fireworks`), cheia, durante os fogos. */
export function reachedGoalView(goalId: string): GoalView | null {
  const label = goalId.slice(goalId.lastIndexOf(':') + 1) as CityGoal['label'];
  const i = CITY_GOAL_IDS.indexOf(label);
  if (i < 0) return null;
  return { pct: 1, pctText: '100%', label: cityGoalLabel(label), progressText: tr('Meta batida!'), reached: i + 1 };
}

/** A placa da prefeitura: os tokens da semana da cidade (em faixa) e os prédios acesos. */
export function cityHallView(city: WorldSceneCity | undefined | null): { tokens: string; lit: string } | null {
  if (!city) return null;
  return {
    tokens: city.tokensBand === undefined ? tr('A soma aparece com 10 prédios ou mais.') : tr('A cidade consumiu ≈ {0} esta semana', [tokenBandText(city.tokensBand)]),
    lit: city.lit === 1 ? tr('1 prédio aceso agora') : tr('{0} prédios acesos agora', [compactNumber(city.lit)]),
  };
}

/** O enfeite da estação (pela data de quem vê): abóboras em outubro, Natal de novembro a dezembro, festa no resto. */
export type Ornament = 'halloween' | 'christmas' | 'party';

export function ornamentFor(date: Date): Ornament {
  const m = date.getMonth();
  if (m === 9) return 'halloween';
  if (m === 10 || m === 11) return 'christmas';
  return 'party';
}

// ------------------------------------------------------------------ onde as coisas ficam na praça (px de mundo)

const O = blockOrigin(PLAZA);
const PX = (t: number) => (O.x + t) * TILE;
const PY = (t: number) => (O.y + t) * TILE;

/** As duas placas (centro e base, px de mundo): o termômetro à esquerda do caminho norte, a prefeitura à direita. */
export const BOARDS = {
  goal: { x: PX(15.5), y: PY(7.6) },
  hall: { x: PX(26.5), y: PY(7.6) },
  w: 84,
  h: 52,
  posts: 12,
} as const;

/** O centro da fonte (px de mundo): de onde sobem os fogos. */
export const FOUNTAIN_PX = { x: PX(FOUNTAIN.x + FOUNTAIN.w / 2), y: PY(FOUNTAIN.y + FOUNTAIN.h / 2) };

/** Os postes da praça que seguram as bandeirinhas (px de mundo, a lâmpada). */
export const BUNTING: ReadonlyArray<readonly [number, number, number, number]> = [
  [PX(12) + 8, PY(4) - 30, PX(30) + 8, PY(4) - 30],
  [PX(12) + 8, PY(19) - 30, PX(30) + 8, PY(19) - 30],
];

// ------------------------------------------------------------------ fogos

const SPARK_COLORS: readonly string[] = ['#ff5d73', '#ffd166', '#7cf3ff', '#b28dff', '#6dff9e', '#ff9f43', '#ffffff', '#ff7ad9'];
/** Índice do branco (rastro dos foguetes). */
const WHITE = 6;

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  burstY: number;
  color: number;
}

/**
 * Fogos de artifício: foguetes que sobem da praça e estouram em bolas de faíscas com um clarão (pool fixo em arrays
 * tipados, sem alocar por quadro), mais o confete do escritório (render/particles.ts) caindo na praça no começo.
 */
export class Fireworks {
  private readonly cap = 2400;
  private n = 0;
  private readonly x = new Float32Array(this.cap);
  private readonly y = new Float32Array(this.cap);
  private readonly vx = new Float32Array(this.cap);
  private readonly vy = new Float32Array(this.cap);
  private readonly age = new Float32Array(this.cap);
  private readonly life = new Float32Array(this.cap);
  private readonly color = new Uint8Array(this.cap);
  private readonly rockets: Rocket[] = [];
  /** Clarões dos estouros: x, y, cor e quando. */
  private readonly flashes: Array<{ x: number; y: number; color: number; at: number }> = [];
  readonly confetti = new Particles(500);
  private until = 0;
  private nextLaunch = 0;
  private started = 0;
  private clock = 0;

  constructor(private readonly random: () => number = Math.random) {}

  get active(): boolean {
    return this.n > 0 || this.rockets.length > 0 || this.confetti.count > 0 || this.flashes.length > 0;
  }

  /** Os fogos estão no ar (até o fim dos 20 s). */
  showing(now: number): boolean {
    return now < this.until;
  }

  /** Começa a festa: `ms` de foguetes, a primeira salva de quatro de uma vez e o confete. */
  start(now: number, ms = FIREWORKS_MS): void {
    this.started = now;
    this.until = now + ms;
    this.nextLaunch = now + 700;
    for (let i = 0; i < 4; i++) this.launch((i + 0.5) / 4);
    for (let i = 0; i < 40; i++) this.confetti.confettiFall(FOUNTAIN_PX.x + (this.random() - 0.5) * 560, FOUNTAIN_PX.y - 200 - this.random() * 80, 260 + this.random() * 80);
  }

  stop(): void {
    this.until = 0;
    this.n = 0;
    this.rockets.length = 0;
    this.flashes.length = 0;
    this.confetti.clear();
  }

  private launch(spread = this.random()): void {
    const x = FOUNTAIN_PX.x + (spread - 0.5) * 520;
    const burstY = FOUNTAIN_PX.y - 170 - this.random() * 120;
    // sobe até o ponto do estouro em ~1 s, com um leve desvio de lado
    this.rockets.push({ x, y: FOUNTAIN_PX.y - 6, vx: (this.random() - 0.5) * 30, vy: -(250 + this.random() * 60), burstY, color: Math.floor(this.random() * SPARK_COLORS.length) });
  }

  private spark(x: number, y: number, vx: number, vy: number, life: number, color: number): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = life;
    this.color[i] = color;
  }

  private burst(r: Rocket): void {
    const kind = this.random();
    const count = 70 + Math.floor(this.random() * 40);
    const speed = 120 + this.random() * 60;
    const second = (r.color + 1 + Math.floor(this.random() * (SPARK_COLORS.length - 1))) % SPARK_COLORS.length;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.random() * 0.15;
      // anel (casca), bola cheia ou coração (o gesto da cidade)
      let s = kind < 0.3 ? speed : speed * Math.sqrt(0.15 + this.random() * 0.85);
      let dx = Math.cos(a);
      let dy = Math.sin(a);
      if (kind > 0.85) {
        const t = a;
        dx = (16 * Math.sin(t) ** 3) / 17;
        dy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
        s = speed * 0.9;
      }
      this.spark(r.x, r.y, dx * s, dy * s, 1.3 + this.random() * 0.8, kind > 0.85 ? 0 : i % 4 === 0 ? second : r.color);
    }
    this.flashes.push({ x: r.x, y: r.y, color: r.color, at: this.clock });
  }

  update(now: number, dt: number): void {
    const d = Math.min(0.1, Math.max(0, dt));
    this.clock = now;
    if (now < this.until && now >= this.nextLaunch) {
      this.launch();
      if (this.random() < 0.45) this.launch();
      // o "grand finale": nos últimos 15 %, uma salva atrás da outra
      const t = (now - this.started) / Math.max(1, this.until - this.started);
      this.nextLaunch = now + (t > 0.85 ? 120 : 300 + this.random() * 380);
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]!;
      r.x += r.vx * d;
      r.y += r.vy * d;
      r.vy += 70 * d;
      // rastro de faíscas do foguete
      this.spark(r.x + (this.random() - 0.5) * 2, r.y + 3, (this.random() - 0.5) * 10, 14 + this.random() * 12, 0.45, WHITE);
      if (r.y <= r.burstY || r.vy >= -30) {
        this.burst(r);
        this.rockets.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) if (now - this.flashes[i]!.at > 320) this.flashes.splice(i, 1);
    let i = 0;
    while (i < this.n) {
      this.age[i] += d;
      if (this.age[i] >= this.life[i]) {
        const j = --this.n;
        this.x[i] = this.x[j];
        this.y[i] = this.y[j];
        this.vx[i] = this.vx[j];
        this.vy[i] = this.vy[j];
        this.age[i] = this.age[j];
        this.life[i] = this.life[j];
        this.color[i] = this.color[j];
        continue;
      }
      this.vx[i] *= Math.max(0, 1 - 1.15 * d);
      this.vy[i] = this.vy[i] * Math.max(0, 1 - 1.15 * d) + 52 * d;
      this.x[i] += this.vx[i] * d;
      this.y[i] += this.vy[i] * d;
      i++;
    }
    this.confetti.update(d);
  }

  /** Por cima de tudo (px de mundo): os clarões, os foguetes, as faíscas com brilho e o confete. */
  draw(ctx: CanvasRenderingContext2D, now: number, view: { x0: number; y0: number; x1: number; y1: number }, night: number): void {
    if (!this.active) return;
    ctx.save();
    const glow = 0.35 + night * 0.65;
    // clarões dos estouros (somam luz: de noite, iluminam o céu em volta)
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const t = (now - f.at) / 320;
      if (t < 0 || t > 1) continue;
      const rad = 18 + t * 40;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      g.addColorStop(0, `rgba(255,255,255,${(0.55 * (1 - t) * glow).toFixed(3)})`);
      g.addColorStop(0.4, `${SPARK_COLORS[f.color]}${Math.round(90 * (1 - t) * glow).toString(16).padStart(2, '0')}`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(f.x - rad, f.y - rad, rad * 2, rad * 2);
    }
    // brilho em volta de cada faísca
    for (let i = 0; i < this.n; i += 2) {
      const left = 1 - this.age[i] / this.life[i];
      ctx.globalAlpha = left * 0.22 * glow;
      ctx.fillStyle = SPARK_COLORS[this.color[i] % SPARK_COLORS.length]!;
      ctx.fillRect(Math.round(this.x[i]) - 1, Math.round(this.y[i]) - 1, 4, 4);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const r of this.rockets) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff4c8';
      ctx.fillRect(Math.round(r.x), Math.round(r.y), 2, 3);
    }
    for (let i = 0; i < this.n; i++) {
      const x = Math.round(this.x[i]);
      const y = Math.round(this.y[i]);
      if (x < view.x0 - 4 || x > view.x1 + 4 || y < view.y0 - 4 || y > view.y1 + 4) continue;
      const left = 1 - this.age[i] / this.life[i];
      // piscam no fim da vida (o "crackle")
      if (left < 0.35 && Math.sin(now / 35 + i * 1.7) < 0) continue;
      ctx.globalAlpha = Math.min(1, left * 1.8);
      ctx.fillStyle = left > 0.75 ? '#fffbe8' : SPARK_COLORS[this.color[i] % SPARK_COLORS.length]!;
      const size = left > 0.45 ? 2 : 1;
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;
    this.confetti.draw(ctx, view.x0, view.y0, view.x1, view.y1, now);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ as placas da praça (px de mundo)

/** Uma placa de madeira em dois postes (centro em `cx`, base em `by`), com o painel escuro. */
function drawBoardFrame(ctx: CanvasRenderingContext2D, cx: number, by: number, accent: string): { x: number; y: number; w: number; h: number } {
  const w = BOARDS.w;
  const h = BOARDS.h;
  const x = Math.round(cx - w / 2);
  const y = Math.round(by - BOARDS.posts - h);
  // sombra no chão
  ctx.fillStyle = 'rgba(30,36,48,0.22)';
  ctx.fillRect(x + 4, by - 2, w - 4, 3);
  // postes
  for (const px of [x + 8, x + w - 11]) {
    ctx.fillStyle = '#3b2a1f';
    ctx.fillRect(px, y + h - 2, 3, BOARDS.posts + 2);
    ctx.fillStyle = '#6b4a33';
    ctx.fillRect(px, y + h - 2, 1, BOARDS.posts + 2);
  }
  // moldura e painel
  ctx.fillStyle = '#2a1d16';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#8a5f3f';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = '#a8784f';
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillStyle = '#1b2233';
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  // faixa de cor do título
  ctx.fillStyle = accent;
  ctx.fillRect(x + 3, y + 3, w - 6, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x + 3, y + 3, w - 6, 1);
  return { x: x + 3, y: y + 3, w: w - 6, h: h - 6 };
}

/** O termômetro (painel da esquerda): tubo com a coluna da meta, bulbo e marcas de 25 %. */
export function drawGoalBoard(ctx: CanvasRenderingContext2D, goal: GoalView | null, now: number): void {
  const p = drawBoardFrame(ctx, BOARDS.goal.x, BOARDS.goal.y, '#c8443c');
  const tx = p.x + 6;
  const top = p.y + 13;
  const bottom = p.y + p.h - 7;
  // tubo de vidro
  ctx.fillStyle = '#0d1018';
  ctx.fillRect(tx - 1, top - 1, 6, bottom - top + 2);
  ctx.fillStyle = '#d8e4f0';
  ctx.fillRect(tx, top, 4, bottom - top);
  // bulbo
  ctx.fillStyle = '#0d1018';
  ctx.fillRect(tx - 2, bottom - 1, 8, 6);
  ctx.fillStyle = '#e8473f';
  ctx.fillRect(tx - 1, bottom, 6, 4);
  // coluna (sobe devagar até o valor e pulsa no topo)
  const pct = goal?.pct ?? 0;
  const hgt = Math.round((bottom - top) * pct);
  if (hgt > 0) {
    ctx.fillStyle = '#e8473f';
    ctx.fillRect(tx + 1, bottom - hgt, 2, hgt);
    ctx.fillStyle = '#ff9c74';
    ctx.fillRect(tx + 1, bottom - hgt, 1, hgt);
    if (Math.sin(now / 300) > 0) {
      ctx.fillStyle = '#ffd7a0';
      ctx.fillRect(tx + 1, bottom - hgt, 2, 1);
    }
  }
  // marcas de 25 %
  ctx.fillStyle = '#7d8aa3';
  for (let k = 1; k < 4; k++) ctx.fillRect(tx + 5, Math.round(bottom - ((bottom - top) * k) / 4), 2, 1);
  // a bandeira da meta no topo
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(tx + 6, top - 1, 4, 3);
  ctx.fillStyle = '#c9a24a';
  ctx.fillRect(tx + 5, top - 1, 1, 6);
}

/** A placa da prefeitura (painel da direita): um prediozinho iluminado no canto. */
export function drawHallBoard(ctx: CanvasRenderingContext2D, lit: boolean): void {
  const p = drawBoardFrame(ctx, BOARDS.hall.x, BOARDS.hall.y, '#2f6fa8');
  // a prefeitura em miniatura: frontão, colunas e janelas acesas
  const x = p.x + 4;
  const y = p.y + 15;
  ctx.fillStyle = '#c9c2b2';
  ctx.fillRect(x, y + 5, 14, 11);
  ctx.fillStyle = '#e8e2d4';
  ctx.fillRect(x - 1, y + 3, 16, 2);
  ctx.fillRect(x + 2, y + 1, 10, 2);
  ctx.fillRect(x + 5, y, 4, 1);
  ctx.fillStyle = lit ? '#ffd27a' : '#4a5468';
  for (const cx of [x + 2, x + 6, x + 10]) ctx.fillRect(cx, y + 7, 2, 4);
  ctx.fillStyle = '#8f8676';
  ctx.fillRect(x - 1, y + 16, 16, 1);
}

/** Os textos das duas placas, em espaço de tela (px CSS), a partir dos retângulos dos painéis. */
export function boardTextRects(): { goal: { x: number; y: number; w: number }; hall: { x: number; y: number; w: number } } {
  const top = (by: number) => by - BOARDS.posts - BOARDS.h + 3;
  return {
    goal: { x: BOARDS.goal.x - BOARDS.w / 2 + 3, y: top(BOARDS.goal.y), w: BOARDS.w - 6 },
    hall: { x: BOARDS.hall.x - BOARDS.w / 2 + 3, y: top(BOARDS.hall.y), w: BOARDS.w - 6 },
  };
}

// ------------------------------------------------------------------ enfeites (depois de bater a meta)

/** Onde fica o barbante das bandeirinhas em `t` (0..1) de um poste ao outro (px de mundo). */
function rope(x0: number, y0: number, x1: number, y1: number, t: number): { x: number; y: number } {
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 14 };
}

/** Bandeirinhas de um poste a outro (px de mundo), balançando com o vento. */
export function drawBunting(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, now: number): void {
  const n = 24;
  ctx.fillStyle = '#4a3b2e';
  for (let i = 0; i <= 120; i++) {
    const p = rope(x0, y0, x1, y1, i / 120);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
  }
  for (let i = 1; i < n; i++) {
    const p = rope(x0, y0, x1, y1, i / n);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const sway = Math.sin(now / 380 + i * 0.9) > 0.4 ? 1 : 0;
    const c = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    // bandeirinha de 7 × 7 apontando para baixo, com uma faixa clara em cima
    ctx.fillStyle = 'rgba(20,24,33,0.35)';
    ctx.fillRect(x - 2, y + 2, 7, 1);
    ctx.fillStyle = c;
    for (let r = 0; r < 6; r++) ctx.fillRect(x - 3 + Math.floor(r / 2) + (r > 2 ? sway : 0), y + 1 + r, 7 - Math.floor(r / 2) * 2, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x - 3, y + 1, 7, 1);
  }
}

/** As lampadazinhas entre as bandeirinhas, por cima da noite (piscam devagar). */
export function drawBuntingLights(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, now: number, night: number): void {
  if (night < 0.15) return;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const p = rope(x0, y0, x1, y1, (i + 0.5) / n);
    const on = 0.55 + 0.45 * Math.sin(now / 520 + i * 1.3);
    ctx.globalAlpha = night * on;
    ctx.fillStyle = i % 3 === 0 ? '#ffd27a' : i % 3 === 1 ? '#ff9db0' : '#9ae7ff';
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    ctx.globalAlpha = night * on * 0.25;
    ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 6, 6);
  }
  ctx.globalAlpha = 1;
}

const seasonalCache = new Map<SeasonalProp, HTMLCanvasElement>();

/** Um enfeite da estação (sprite do escritório, 40×64) com a base em (x, y) px de mundo. */
export function drawSeasonal(ctx: CanvasRenderingContext2D, kind: SeasonalProp, x: number, y: number): void {
  let c = seasonalCache.get(kind);
  if (!c) {
    const { buf } = renderSeasonalProp(kind);
    c = document.createElement('canvas');
    c.width = buf.w;
    c.height = buf.h;
    c.getContext('2d')!.putImageData(new ImageData(buf.data, buf.w, buf.h), 0, 0);
    seasonalCache.set(kind, c);
  }
  ctx.drawImage(c, Math.round(x - 20), Math.round(y - 60));
}

/** Onde vão os enfeites da estação em volta da fonte (base em px de mundo) e qual. */
export function seasonalSpots(o: Ornament): Array<{ kind: SeasonalProp; x: number; y: number }> {
  const f = FOUNTAIN;
  const spots: Array<[number, number]> = [
    [f.x - 2.5, f.y + 1.2],
    [f.x + f.w + 2.5, f.y + 1.2],
    [f.x - 1.2, f.y + f.h + 1.1],
    [f.x + f.w + 1.2, f.y + f.h + 1.1],
  ];
  const kinds: SeasonalProp[] = o === 'halloween' ? ['pumpkin', 'pumpkin', 'ghost', 'pumpkin'] : o === 'christmas' ? ['tree', 'tree', 'gift', 'gift'] : ['gift', 'gift', 'gift', 'gift'];
  return spots.map(([tx, ty], i) => ({ kind: kinds[i]!, x: PX(tx), y: PY(ty) }));
}
