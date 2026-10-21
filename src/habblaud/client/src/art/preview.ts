// Página de prévia do módulo de arte (client/art-preview.html): mostra, ampliado e rotulado, tudo
// o que o módulo desenha — personagens, poses, itens, móveis, pisos, paredes, telas, quadro,
// janela, relógio, ícones, temas e avatares — além de uma cena de exemplo para checar a coesão.
import '@fontsource/pixelify-sans/400.css';
import * as art from './index';
import { pixelText, pixelTextWidth } from './pixelfont';
import {
  FURNITURE,
  TILE,
  type Dir,
  type FloorKind,
  type FurnitureKind,
  type HeldItem,
  type IconName,
  type Pose,
  type ScreenMode,
  type Sprite,
  type WallPattern,
  type WallStyle,
} from './api';

const SCALE = 3;
const DIRS: readonly Dir[] = ['down', 'left', 'up', 'right'];
const DIR_PT: Record<Dir, string> = { down: 'baixo', left: 'esquerda', up: 'cima', right: 'direita' };
const POSES: readonly Pose[] = [
  'stand', 'walk', 'run', 'sit', 'type', 'sleep', 'drink', 'use', 'raise_hand', 'talk', 'stretch', 'read', 'play', 'wait',
  'cheer', 'laugh', 'game', 'rps', 'groom', 'sulk',
];
const POSE_PT: Record<Pose, string> = {
  stand: 'parado', walk: 'andando', run: 'correndo', sit: 'sentado', type: 'digitando', sleep: 'cochilando', drink: 'bebendo',
  use: 'usando máquina', raise_hand: 'mão levantada', talk: 'conversando', stretch: 'espreguiçando', read: 'lendo', play: 'ping-pong',
  wait: 'esperando', cheer: 'comemorando', laugh: 'gargalhando', game: 'videogame', rps: 'jokenpô', groom: 'no espelho', sulk: 'chateado',
};
/** Poses que sempre são sentadas (as demais podem ser em pé ou sentadas). */
const SEATED_POSES: readonly Pose[] = ['sit', 'type', 'sleep', 'wait'];
const HELD: readonly HeldItem[] = ['coffee', 'water', 'papers', 'laptop', 'book', 'box', 'paddle', 'popcorn', 'controller', 'phone', 'lipstick', 'comb', 'rock', 'paper', 'scissors'];
const HELD_PT: Record<HeldItem, string> = {
  none: 'nada', coffee: 'café', water: 'água', papers: 'papéis', laptop: 'notebook', book: 'livro', box: 'caixa', paddle: 'raquete', popcorn: 'pipoca',
  controller: 'controle', phone: 'celular', lipstick: 'batom', comb: 'pente', rock: 'pedra', paper: 'papel', scissors: 'tesoura',
};
const SCREENS: readonly ScreenMode[] = ['off', 'standby', 'idle', 'code', 'terminal', 'browser', 'search', 'chat', 'docs', 'tasks', 'alert', 'progress', 'show', 'game'];
const SCREEN_PT: Record<ScreenMode, string> = {
  off: 'desligado', standby: 'em espera', idle: 'descanso', code: 'código', terminal: 'terminal', browser: 'navegador', search: 'busca', chat: 'chat', docs: 'documento', tasks: 'tarefas', alert: 'alerta',
  progress: 'progresso', show: 'programa', game: 'videogame',
};
const FLOORS: readonly FloorKind[] = ['carpet', 'wood', 'tile_check', 'tile_white', 'concrete', 'marble', 'grass', 'sidewalk', 'street'];
const FLOOR_PT: Record<FloorKind, string> = {
  carpet: 'carpete', wood: 'madeira', tile_check: 'xadrez', tile_white: 'azulejo', concrete: 'cimento polido', marble: 'mármore', grass: 'grama', sidewalk: 'calçada', street: 'asfalto',
};
const ICONS: readonly IconName[] = [
  'alert', 'question', 'zzz', 'check', 'heart', 'coffee', 'music', 'idea', 'sweat', 'star', 'lightning', 'chat', 'box', 'wave',
  'hourglass', 'hourglass_flip', 'cobweb', 'storm', 'coin', 'sparkle', 'trophy', 'hand_rock', 'hand_paper', 'hand_scissors',
];

type Painter = (ctx: CanvasRenderingContext2D, t: number) => void;
const painters: { ctx: CanvasRenderingContext2D; w: number; h: number; bg: string; paint: Painter }[] = [];

const root = document.getElementById('root') as HTMLElement;
const nav = document.getElementById('nav') as HTMLElement;

function section(id: string, title: string, desc: string): HTMLElement {
  const s = document.createElement('section');
  s.id = id;
  s.innerHTML = `<h2>${title}</h2><p class="desc">${desc}</p>`;
  root.appendChild(s);
  const a = document.createElement('a');
  a.href = `#${id}`;
  a.textContent = title;
  nav.appendChild(a);
  return s;
}

/** Canvas em resolução 1x exibido ampliado; `paint` é chamado a cada quadro. */
function canvas(parent: HTMLElement, w: number, h: number, paint: Painter, bg = '#e9ecf1', scale = SCALE): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.className = 'px';
  c.style.width = `${w * scale}px`;
  c.style.height = `${h * scale}px`;
  const wrap = document.createElement('div');
  wrap.className = 'scroll';
  wrap.appendChild(c);
  parent.appendChild(wrap);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  painters.push({ ctx, w, h, bg, paint });
  return c;
}

function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number): void {
  ctx.drawImage(s.canvas, Math.round(x - s.ax), Math.round(y - s.ay));
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#5b6576'): void {
  pixelText(ctx, text, x, y, color);
}

/** Rótulo centralizado numa célula [x0, x0 + w). */
function labelCentered(ctx: CanvasRenderingContext2D, text: string, x0: number, w: number, y: number, color = '#5b6576'): void {
  pixelText(ctx, text, x0 + Math.floor((w - pixelTextWidth(text)) / 2), y, color);
}

function frameOf(pose: Pose, t: number, offset = 0): number {
  return Math.floor((t + offset) / art.poseFrameDuration(pose)) % art.poseFrameCount(pose);
}

function anchorMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#ff2bd6';
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, y - 1, 1, 3);
}

function dotted(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(80,90,110,0.55)';
  for (let i = 0; i < w; i += 2) {
    ctx.fillRect(x + i, y, 1, 1);
    ctx.fillRect(x + i, y + h - 1, 1, 1);
  }
  for (let i = 0; i < h; i += 2) {
    ctx.fillRect(x, y + i, 1, 1);
    ctx.fillRect(x + w - 1, y + i, 1, 1);
  }
}

const SEAT_FOOT_DY = 3; // igual ao mundo: pés de quem senta ficam 3px acima da base do assento

// ------------------------------------------------------------------ cena de exemplo

function sampleScene(): void {
  const s = section('cena', 'Cena de exemplo', 'Sala de projeto + lounge montados só com o módulo de arte (como o mundo faz): ilha de mesas face a face, telas animadas, cadeiras com encosto por cima de quem senta, vidro, copa e gente circulando.');
  const W = 26 * TILE;
  const H = 15 * TILE;
  const theme = art.roomTheme(0);
  const lounge: WallStyle = { base: '#f3efe7', trim: '#a88a6a', pattern: 'wood_panel' };
  type D = { y: number; draw: Painter };
  const cast = (seed: number, sub = false) => art.appearanceFromSeed(seed, { sub });

  canvas(s, W, H, (ctx, t) => {
    const ds: D[] = [];
    // Pisos.
    art.drawFloor(ctx, 'carpet', 0, 2 * TILE, 15 * TILE, 12 * TILE, { seed: 1, tint: theme.carpet, tint2: theme.carpet2 });
    art.drawFloor(ctx, 'wood', 15 * TILE, 2 * TILE, 7 * TILE, 12 * TILE, { seed: 2 });
    art.drawFloor(ctx, 'tile_check', 22 * TILE, 2 * TILE, 4 * TILE, 12 * TILE, { seed: 3 });
    art.drawRug(ctx, 16 * TILE, 6 * TILE + 4, 5 * TILE, 3 * TILE, '#6fae7a', 4);
    // Paredes.
    art.drawWallFace(ctx, 0, 0, 15 * TILE, theme.wall, { doorways: [{ x: 10 * TILE, w: 2 * TILE }] });
    art.drawWallFace(ctx, 15 * TILE, 0, 7 * TILE, lounge);
    art.drawWallFace(ctx, 22 * TILE, 0, 4 * TILE, { base: '#eceae6', trim: '#9aa2ae', pattern: 'marble' });
    // Itens de parede (desenhados junto da parede).
    const wall = (kind: FurnitureKind, tx: number, variant?: string, extra?: (sp: Sprite, x: number, y: number) => void, seed = 0) => {
      const sp = art.furnitureSprites(kind, variant, 0, { seed }).base;
      const x = tx * TILE + (FURNITURE[kind].footprint.w * TILE) / 2;
      const y = 2 * TILE;
      if (kind === 'window' && sp.rects?.glass) {
        const g = sp.rects.glass;
        art.drawWindowView(ctx, { x: x - sp.ax + g.x, y: y - sp.ay + g.y, w: g.w, h: g.h }, 15.5, t, 3);
      }
      blit(ctx, sp, x, y);
      extra?.(sp, x - sp.ax, y - sp.ay);
    };
    wall('window', 0.5);
    wall('whiteboard', 3, undefined, (sp, ox, oy) => {
      const r = sp.rects?.board;
      if (r) art.drawBoard(ctx, { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }, [{ status: 'completed' }, { status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }, { status: 'pending' }, { status: 'pending' }, { status: 'completed' }], t);
    });
    wall('sign', 6.5, undefined, (sp, ox, oy) => {
      const r = sp.rects?.sign;
      if (!r) return;
      ctx.fillStyle = '#2b3142';
      ctx.font = '8px "Pixelify Sans", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('habblaud', ox + r.x + r.w / 2, oy + r.y + r.h / 2 + 0.5);
      ctx.textAlign = 'left';
    });
    wall('door_frame', 10);
    wall('light_switch', 9, 'on');
    wall('clock', 13, undefined, (sp, ox, oy) => {
      const r = sp.rects?.face;
      if (r) art.drawClock(ctx, { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }, new Date());
    });
    wall('painting', 15.5, undefined, undefined, 1);
    wall('tv', 18.5, undefined, (sp, ox, oy) => {
      const r = sp.rects?.tv;
      if (r) art.drawScreen(ctx, { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }, 'browser', t, 9);
    });
    wall('shelf_wall', 22, undefined, undefined, 2);
    // Móveis de chão.
    const furn = (kind: FurnitureKind, tx: number, ty: number, variant?: string, o: { dx?: number; state?: number; seed?: number; screen?: ScreenMode; sseed?: number } = {}) => {
      const f = art.furnitureSprites(kind, variant, o.state ?? 0, { seed: o.seed });
      const def = FURNITURE[kind];
      const x = tx * TILE + (def.footprint.w * TILE) / 2 + (o.dx ?? 0);
      const y = (ty + def.footprint.h) * TILE;
      ds.push({
        y,
        draw: (c) => {
          blit(c, f.base, x, y);
          const r = f.base.rects?.screen;
          if (r && o.screen) art.drawScreen(c, { x: x - f.base.ax + r.x, y: y - f.base.ay + r.y, w: r.w, h: r.h }, o.screen, t, o.sseed ?? tx);
        },
      });
      if (f.front) ds.push({ y: y + 0.5, draw: (c) => blit(c, f.front as Sprite, x, y) });
      return { x, y };
    };
    const person = (seed: number, x: number, y: number, dir: Dir, pose: Pose, o: { held?: HeldItem; seated?: boolean; sub?: boolean; sortY?: number } = {}) => {
      const a = cast(seed, o.sub);
      ds.push({
        y: o.sortY ?? y,
        draw: (c) => blit(c, art.characterSprite({ appearance: a, dir, pose, frame: frameOf(pose, t, seed * 37), held: o.held, seated: o.seated }), x, y),
      });
    };
    const modes: ScreenMode[] = ['code', 'terminal', 'browser', 'docs', 'chat', 'search'];
    for (let i = 0; i < 3; i++) {
      const lx = 1 + i * 2;
      furn('desk_back', lx, 5, theme.deskVariant, { seed: i + 1 });
      furn('desk', lx, 6, theme.deskVariant, { seed: i * 2, screen: modes[i], sseed: i * 7 });
      const cf = furn('office_chair_front', lx, 4, theme.chairVariant, { dx: TILE / 2 });
      const cb = furn('office_chair', lx, 7, theme.chairVariant, { dx: TILE / 2 });
      if (i !== 1) person(10 + i, cf.x, cf.y - SEAT_FOOT_DY, 'down', i === 0 ? 'type' : 'raise_hand', { seated: true, sortY: cf.y + 0.25, sub: i === 2 });
      person(20 + i, cb.x, cb.y - SEAT_FOOT_DY, 'up', i === 1 ? 'sleep' : 'type', { seated: true, sortY: cb.y + 0.25 });
    }
    furn('meeting_table', 8, 5, undefined, { seed: 1 });
    for (const [tx, ty] of [[8, 4], [10, 4], [8, 7], [10, 7]] as const) furn('stool', tx, ty);
    person(31, 8 * TILE + 8, 5 * TILE - SEAT_FOOT_DY, 'down', 'talk', { seated: true, sortY: 5 * TILE + 0.25, sub: true });
    furn('bookshelf', 12, 2, undefined, { seed: 2 });
    furn('plant_tall', 0, 2, 'ficus', { seed: 1 });
    furn('plant_tall', 14, 2, 'bonsai');
    furn('binder_shelf', 14, 4, undefined, { seed: 1 });
    furn('printer', 13, 9);
    furn('filing_cabinet', 14, 9);
    furn('trash_bin', 7, 6);
    furn('plant_small', 0, 12, 'fern');
    furn('floor_lamp', 0, 9);
    for (let ty = 2; ty < 14; ty++) if (ty < 10 || ty > 11) furn('glass_partition', 15, ty, 'v');
    // Lounge.
    furn('sofa', 16, 5, 'down');
    furn('coffee_table', 17, 7, undefined, { seed: 1 });
    furn('armchair', 21, 7, 'left');
    furn('beanbag', 16, 11, 'yellow');
    furn('beanbag', 18, 11, 'blue');
    furn('plant_tall', 21, 2, 'monstera');
    furn('plant_small', 15, 3, 'flower');
    person(41, 17 * TILE + 8, 6 * TILE - SEAT_FOOT_DY, 'down', 'read', { seated: true, sortY: 6 * TILE + 0.25 });
    person(42, 18 * TILE + 4, 6 * TILE - SEAT_FOOT_DY, 'down', 'talk', { seated: true, sortY: 6 * TILE + 0.25, held: 'coffee' });
    person(43, 21 * TILE + 8, 8 * TILE - SEAT_FOOT_DY, 'left', 'sit', { seated: true, sortY: 8 * TILE + 0.25 });
    // Copa.
    furn('fridge', 22, 2);
    furn('coffee_machine', 23, 2, undefined, { state: Math.floor(t / 2500) % 2 });
    furn('counter_sink', 24, 2);
    furn('counter', 25, 2, 'drawers');
    furn('water_cooler', 25, 6);
    furn('vending_machine', 22, 8);
    furn('cafe_table', 24, 10);
    furn('cafe_chair', 23, 10, 'right');
    furn('cafe_chair', 25, 10, 'left');
    person(51, 23 * TILE + 8, 4 * TILE - 5, 'up', 'use');
    person(52, 25 * TILE + 8, 8 * TILE - 5, 'up', 'drink', { held: 'water' });
    person(53, 25 * TILE + 8, 11 * TILE - SEAT_FOOT_DY, 'left', 'drink', { seated: true, sortY: 11 * TILE + 0.25, held: 'coffee' });
    // Pessoas andando em circuitos.
    const loop = (seed: number, pts: readonly [number, number][], speed: number, held?: HeldItem, sub = false) => {
      const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as const);
      const lens = segs.map(([a, b]) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]));
      const total = lens.reduce((x, y) => x + y, 0);
      let d = ((t / 1000) * speed + seed * 13) % total;
      let k = 0;
      while (d > lens[k]) d -= lens[k++];
      const [a, b] = segs[k];
      const u = d / Math.max(1, lens[k]);
      const x = a[0] + (b[0] - a[0]) * u;
      const y = a[1] + (b[1] - a[1]) * u;
      const dir: Dir = b[0] > a[0] ? 'right' : b[0] < a[0] ? 'left' : b[1] > a[1] ? 'down' : 'up';
      person(seed, Math.round(x), Math.round(y), dir, speed > 60 ? 'run' : 'walk', { held, sub });
    };
    loop(61, [[2 * 16, 10 * 16 + 11], [12 * 16, 10 * 16 + 11], [12 * 16, 13 * 16 + 11], [2 * 16, 13 * 16 + 11]], 40, 'coffee');
    loop(62, [[11 * 16, 3 * 16 + 11], [11 * 16, 9 * 16 + 11], [5 * 16, 9 * 16 + 11], [5 * 16, 8 * 16 + 11]], 32, 'papers', true);
    loop(63, [[16 * 16, 13 * 16 + 11], [24 * 16, 13 * 16 + 11], [24 * 16, 12 * 16 + 11]], 70);
    // Ordenação por profundidade.
    ds.sort((a, b) => a.y - b.y);
    for (const d of ds) d.draw(ctx, t);
    // Parede sul com passagem e tampas laterais.
    art.drawSouthWall(ctx, 0, 14 * TILE, W, theme.wall, { doorways: [{ x: 6 * TILE, w: 2 * TILE }, { x: 18 * TILE, w: 2 * TILE }] });
    art.drawWallTop(ctx, 0, 0, 3, H, theme.wall);
    art.drawWallTop(ctx, W - 3, 0, 3, H, theme.wall);
  });
}

// ------------------------------------------------------------------ esperando o shell

/**
 * A piada do estado 'shell' montada só com peças do módulo de arte, em escalada cômica pela idade
 * do shell: pipoca (0–3 min), impaciência com giro na cadeira (3–10), teia crescendo (> 10),
 * cochilo coberto de teia (> 25) e o desfecho (sucesso com confete / falha com nuvem de chuva).
 * Em cima: de frente, atrás da desk_back (o verso do monitor esconde o colo). Embaixo: de costas,
 * diante do monitor em 'progress'. Partículas (pipoca, confete) e giro são simulados aqui só para
 * a prévia — no escritório quem anima é o mundo.
 */
function shellWait(): void {
  const s = section(
    'shell',
    'Esperando o shell',
    'Pose wait (com e sem pipoca), ampulheta girando, tela progress, teia (1× e 2×), cochilo, e o desfecho: estrela com confete (sucesso) ou nuvem de chuva (falha). Em cima de frente (atrás da desk_back); embaixo de costas, diante do monitor.',
  );
  type Stage = { name: string; pose: Pose; held?: HeldItem; icon?: IconName | 'hourglass'; web?: 1 | 2; spin?: boolean; fx?: 'popcorn' | 'confetti' };
  const stages: Stage[] = [
    { name: '0-3 min', pose: 'wait', held: 'popcorn', icon: 'hourglass', fx: 'popcorn' },
    { name: '3-10 min', pose: 'wait', icon: 'hourglass', spin: true },
    { name: '> 10 min', pose: 'wait', icon: 'hourglass', web: 1 },
    { name: '> 25 min', pose: 'sleep', icon: 'zzz', web: 2 },
    { name: 'terminou', pose: 'raise_hand', icon: 'star', fx: 'confetti' },
    { name: 'falhou', pose: 'sit', icon: 'storm' },
  ];
  const cw = 64;
  const rowH = 78;
  const theme = art.roomTheme(3);
  const who = art.appearanceFromSeed(5150, { look: 'f' });
  const SPIN_DOWN: readonly Dir[] = ['down', 'left', 'up', 'right'];
  const SPIN_UP: readonly Dir[] = ['up', 'right', 'down', 'left'];
  const CONFETTI = ['#ff6b6b', '#ffd84d', '#5bd1ff', '#7be07b', '#c38cff', '#ff9f43'];
  const H = rowH * 2 + 6;
  canvas(s, cw * stages.length, H, (ctx, t) => {
    art.drawFloor(ctx, 'carpet', 0, 0, cw * stages.length, H, { seed: 3, tint: theme.carpet, tint2: theme.carpet2 });
    stages.forEach((st, i) => {
      const cx = i * cw + cw / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(i * cw + 1, 0, cw - 2, 11);
      labelCentered(ctx, st.name, i * cw, cw, 4, '#2b3142');
      for (const row of [0, 1] as const) {
        const front = row === 0;
        const cy = front ? 60 : 60 + rowH;
        // Giro na cadeira: a cada 5 s, quatro direções em 0,8 s.
        let dir: Dir = front ? 'down' : 'up';
        const ph = (t + i * 700) % 5000;
        if (st.spin && ph < 800) dir = (front ? SPIN_DOWN : SPIN_UP)[Math.floor(ph / 200) % 4];
        const sprite = art.characterSprite({ appearance: who, dir, pose: st.pose, frame: frameOf(st.pose, t, i * 90), held: st.held, seated: true });
        if (front) {
          blit(ctx, art.furnitureSprites('office_chair_front', theme.chairVariant).base, cx, cy);
          blit(ctx, sprite, cx, cy - SEAT_FOOT_DY);
          blit(ctx, art.furnitureSprites('desk_back', theme.deskVariant, 0, { seed: 0 }).base, cx, cy + TILE);
        } else {
          const desk = art.furnitureSprites('desk', theme.deskVariant, 0, { seed: 0 }).base;
          blit(ctx, desk, cx, cy - TILE);
          const r = desk.rects?.screen;
          const mode: ScreenMode = st.name === 'terminou' ? 'tasks' : st.name === 'falhou' ? 'alert' : 'progress';
          if (r) art.drawScreen(ctx, { x: cx - desk.ax + r.x, y: cy - TILE - desk.ay + r.y, w: r.w, h: r.h }, mode, t, 4);
          const chair = art.furnitureSprites('office_chair', theme.chairVariant);
          blit(ctx, chair.base, cx, cy);
          blit(ctx, sprite, cx, cy - SEAT_FOOT_DY);
          if (chair.front) blit(ctx, chair.front, cx, cy);
        }
        const headTop = cy - SEAT_FOOT_DY - 23;
        // Teia: 1× no canto ao lado da cadeira; 2× já cobrindo quem cochila.
        if (st.web) {
          const web = art.iconSprite('cobweb').canvas;
          if (st.web === 1) ctx.drawImage(web, cx - 21, headTop + 6);
          else ctx.drawImage(web, cx - 22, headTop - 4, web.width * 2, web.height * 2);
        }
        // Pipoca pulando do balde (de frente ele fica sob o queixo; de costas, ao lado do quadril).
        if (st.fx === 'popcorn') {
          const u = ((t + row * 900) % 2300) / 650;
          if (u < 1) {
            const bx = front ? cx - 1 : cx - 10;
            const by = front ? cy - 15 : cy - 12;
            const px = Math.round(bx + (front ? 5 : -4) * u);
            const py = Math.round(by - 7 * Math.sin(u * Math.PI) + 2 * u);
            ctx.fillStyle = '#fff9e6';
            ctx.fillRect(px, py, 1, 1);
            ctx.fillStyle = '#ffd75e';
            ctx.fillRect(px + 1, py, 1, 1);
          }
        }
        if (st.fx === 'confetti') {
          for (let k = 0; k < 14; k++) {
            const life = ((t / 1600 + k / 14) % 1 + 1) % 1;
            const px = Math.round(cx - 12 + ((k * 37) % 25) + Math.sin(life * 9 + k) * 2);
            const py = Math.round(headTop - 14 + life * 30);
            ctx.fillStyle = CONFETTI[k % CONFETTI.length];
            ctx.fillRect(px, py, k % 3 === 0 ? 2 : 1, 1);
          }
        }
        // Ícone acima da cabeça (a ampulheta alterna com a versão deitada a cada 1,2 s).
        if (st.icon) {
          const name: IconName = st.icon === 'hourglass' ? (Math.floor(t / 1200) % 2 ? 'hourglass_flip' : 'hourglass') : st.icon;
          const bob = st.icon === 'zzz' ? Math.round(Math.sin(t / 500) * 1.5) : 0;
          blit(ctx, art.iconSprite(name), cx + (st.web === 2 ? 3 : 0), headTop - 1 + bob);
        }
      }
    });
  }, '#e9ecf1', 4);
}

// ------------------------------------------------------------------ vida social

/**
 * Vida social montada só com peças do módulo de arte: torcida diante da TV (programa mudando),
 * dupla no videogame com plateia, jokenpô valendo moedas (contagem, revelação com o gesto sobre a
 * cabeça, vencedor comemorando com a moeda e perdedor chateado) e o espelho do banheiro com o
 * reflexo de quem se arruma (o reflexo é recortado no rects.glass — sugestão para o mundo).
 */
function socialLife(): void {
  const s = section(
    'social',
    'Vida social',
    'TV com torcida (o programa troca a cada 6 s: futebol, novela, desenho), videogame com plateia, jokenpô valendo moedas nas 4 direções (contagem, revelação, vitória e derrota) e o espelho com reflexo. Abaixo, os programas da TV e do fliperama por semente.',
  );
  const W = 31 * TILE;
  const H = 12 * TILE;
  const lounge: WallStyle = { base: '#e6e2ea', trim: '#8f8aa3', pattern: 'plain' };
  const bath: WallStyle = { base: '#dce8ee', trim: '#8fb0c4', pattern: 'tiles' };
  type D = { y: number; draw: Painter };
  const G = ['rock', 'paper', 'scissors'] as const;
  const HAND: Record<(typeof G)[number], IconName> = { rock: 'hand_rock', paper: 'hand_paper', scissors: 'hand_scissors' };
  canvas(s, W, H, (ctx, t) => {
    const ds: D[] = [];
    const icons: { name: IconName; x: number; y: number }[] = [];
    art.drawFloor(ctx, 'wood', 0, 2 * TILE, 18 * TILE, 10 * TILE, { seed: 7 });
    art.drawFloor(ctx, 'marble', 18 * TILE, 2 * TILE, 8 * TILE, 10 * TILE, { seed: 8 });
    art.drawFloor(ctx, 'tile_white', 26 * TILE, 2 * TILE, 5 * TILE, 10 * TILE, { seed: 9 });
    art.drawRug(ctx, 1 * TILE, 5 * TILE, 15 * TILE, 4 * TILE, '#4f8a5b', 2);
    art.drawWallFace(ctx, 0, 0, 18 * TILE, lounge);
    art.drawWallFace(ctx, 18 * TILE, 0, 8 * TILE, { base: '#e9e5dc', trim: '#a88e6c', pattern: 'wood_panel' });
    art.drawWallFace(ctx, 26 * TILE, 0, 5 * TILE, bath);
    const wall = (kind: FurnitureKind, cx: number, fn?: (sp: Sprite, ox: number, oy: number) => void) => {
      const sp = art.furnitureSprites(kind).base;
      const x = cx * TILE;
      blit(ctx, sp, x, 2 * TILE);
      fn?.(sp, x - sp.ax, 2 * TILE - sp.ay);
    };
    const program = Math.floor(t / 6000) % 3;
    wall('tv', 4.5, (sp, ox, oy) => {
      const r = sp.rects?.tv;
      if (r) art.drawScreen(ctx, { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }, 'show', t, program);
    });
    wall('tv', 12.5, (sp, ox, oy) => {
      const r = sp.rects?.tv;
      if (r) art.drawScreen(ctx, { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }, 'game', t, Math.floor(t / 8000) % 2);
    });
    // Espelhos com o reflexo de quem está diante da pia.
    const groomers = [
      { seed: 404, tx: 27, held: 'lipstick' as HeldItem },
      { seed: 505, tx: 29, held: 'comb' as HeldItem },
    ];
    for (const g of groomers) {
      wall('mirror', g.tx + 0.5, (sp, ox, oy) => {
        const r = sp.rects?.glass;
        if (!r) return;
        const who = art.characterSprite({ appearance: art.appearanceFromSeed(g.seed), dir: 'down', pose: 'groom', frame: frameOf('groom', t, g.seed), held: g.held });
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox + r.x, oy + r.y, r.w, r.h);
        ctx.clip();
        ctx.globalAlpha = 0.8;
        // Rosto centrado no vidro: a franja no topo, olhos e boca no meio (o corpo fica abaixo da moldura).
        ctx.drawImage(who.canvas, Math.round(ox + r.x + r.w / 2 - who.ax), Math.round(oy + r.y - 6));
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#cfe6f2';
        ctx.fillRect(ox + r.x, oy + r.y, r.w, r.h);
        ctx.restore();
      });
    }
    const furn = (kind: FurnitureKind, tx: number, ty: number, variant?: string) => {
      const f = art.furnitureSprites(kind, variant);
      const def = FURNITURE[kind];
      const x = tx * TILE + (def.footprint.w * TILE) / 2;
      const y = (ty + def.footprint.h) * TILE;
      ds.push({ y, draw: (c) => blit(c, f.base, x, y) });
      if (f.front) ds.push({ y: y + 0.5, draw: (c) => blit(c, f.front as Sprite, x, y) });
      return { x, y };
    };
    const person = (seed: number, x: number, y: number, dir: Dir, pose: Pose, o: { held?: HeldItem; seated?: boolean; sortY?: number; icon?: IconName } = {}) => {
      const a = art.appearanceFromSeed(seed);
      ds.push({
        y: o.sortY ?? y,
        draw: (c) => blit(c, art.characterSprite({ appearance: a, dir, pose, frame: frameOf(pose, t, seed * 37), held: o.held, seated: o.seated }), x, y),
      });
      if (o.icon) icons.push({ name: o.icon, x, y: y - (o.seated ? 26 : 30) });
    };
    // TV: três no sofá (de costas) trocando de reação; poltrona com alguém no celular.
    const sofa = furn('sofa', 3, 6, 'up');
    const react: { pose: Pose; held?: HeldItem }[] = [{ pose: 'wait', held: 'popcorn' }, { pose: 'laugh' }, { pose: 'cheer' }, { pose: 'sit' }];
    for (let i = 0; i < 3; i++) {
      const r = react[(Math.floor(t / 2500) + i) % react.length];
      person(700 + i, sofa.x + (i - 1) * TILE, sofa.y - SEAT_FOOT_DY, 'up', r.pose, { seated: true, held: r.held, sortY: sofa.y + 0.25 });
    }
    const chair = furn('armchair', 7, 4, 'left');
    person(710, chair.x, chair.y - SEAT_FOOT_DY, 'left', 'read', { seated: true, held: 'phone', sortY: chair.y + 0.25 });
    // Videogame: dois jogando no sofá, uma pessoa torcendo atrás e outra de frente, de pé.
    const sofa2 = furn('sofa', 11, 6, 'up');
    person(720, sofa2.x - TILE, sofa2.y - SEAT_FOOT_DY, 'up', 'game', { seated: true, held: 'controller', sortY: sofa2.y + 0.25 });
    person(721, sofa2.x, sofa2.y - SEAT_FOOT_DY, 'up', 'game', { seated: true, held: 'controller', sortY: sofa2.y + 0.25 });
    person(722, sofa2.x + 2 * TILE, sofa2.y + TILE + 11, 'up', Math.floor(t / 3000) % 2 ? 'cheer' : 'laugh');
    person(723, 15 * TILE + 8, 5 * TILE + 11, 'left', 'game', { held: 'controller' });
    // Jokenpô: rodadas de 4 s — contagem, revelação (gesto sobre a cabeça), vitória/derrota.
    const duel = (k: number, ax: number, ay: number, adir: Dir, bx: number, by: number, bdir: Dir) => {
      const round = Math.floor((t + k * 900) / 4000);
      const ph = ((t + k * 900) % 4000) / 4000;
      const ga = G[(round * 7 + k) % 3];
      let gb = G[(round * 5 + k * 2 + 1) % 3];
      if (gb === ga) gb = G[(G.indexOf(ga) + 1) % 3];
      const beats = (x: string, y: string) => (x === 'rock' && y === 'scissors') || (x === 'scissors' && y === 'paper') || (x === 'paper' && y === 'rock');
      const aWins = beats(ga, gb);
      const side = (seed: number, x: number, y: number, dir: Dir, g: (typeof G)[number], win: boolean) => {
        if (ph < 0.3) person(seed, x, y, dir, 'rps');
        else if (ph < 0.65) person(seed, x, y, dir, 'rps', { held: g, icon: HAND[g] });
        else person(seed, x, y, dir, win ? 'cheer' : 'sulk', { icon: win ? 'coin' : undefined });
      };
      side(800 + k, ax, ay, adir, ga, aWins);
      side(810 + k, bx, by, bdir, gb, !aWins);
    };
    duel(0, 19 * TILE + 8, 5 * TILE + 11, 'right', 22 * TILE + 8, 5 * TILE + 11, 'left');
    duel(1, 21 * TILE + 8, 8 * TILE + 11, 'down', 21 * TILE + 8, 10 * TILE + 11, 'up');
    // Banheiro: pias diante dos espelhos.
    for (const g of groomers) {
      furn('sink', g.tx, 2);
      person(g.seed, g.tx * TILE + 8, 3 * TILE + 8, 'up', 'groom', { held: g.held, icon: Math.floor(t / 2200) % 2 ? 'sparkle' : undefined });
    }
    furn('plant_tall', 17, 2, 'monstera');
    furn('plant_small', 25, 2, 'flower');
    ds.sort((a, b) => a.y - b.y);
    for (const d of ds) d.draw(ctx, t);
    for (const ic of icons) blit(ctx, art.iconSprite(ic.name), ic.x, ic.y);
    for (const [txt, cx] of [['ver tv', 4.5], ['videogame', 12.5], ['jokenpô', 22], ['espelho', 28.5]] as const) {
      const w = pixelTextWidth(txt) + 6;
      ctx.fillStyle = 'rgba(22,26,38,0.78)';
      ctx.fillRect(Math.round(cx * TILE - w / 2), H - 10, w, 9);
      labelCentered(ctx, txt, Math.round(cx * TILE - w / 2), w, H - 8, '#f5f7fb');
    }
  }, '#e9ecf1', 3);
  // Programas por semente (o mundo usa o mesmo mapeamento fixo).
  const progs: { mode: ScreenMode; seed: number; name: string }[] = [
    { mode: 'show', seed: 0, name: 'futebol' },
    { mode: 'show', seed: 1, name: 'novela' },
    { mode: 'show', seed: 2, name: 'desenho' },
    { mode: 'game', seed: 0, name: 'corrida' },
    { mode: 'game', seed: 1, name: 'luta' },
  ];
  const tv = art.furnitureSprites('tv').base;
  const arcade = art.furnitureSprites('arcade').base;
  const cw = 56;
  canvas(s, cw * progs.length + 2 * 36, 64, (ctx, t) => {
    progs.forEach((p, i) => {
      const x = i * cw + cw / 2;
      blit(ctx, tv, x, 34);
      const r = tv.rects?.tv;
      if (r) art.drawScreen(ctx, { x: x - tv.ax + r.x, y: 34 - tv.ay + r.y, w: r.w, h: r.h }, p.mode, t, p.seed);
      labelCentered(ctx, `${p.mode} ${p.seed}`, i * cw, cw, 40, '#2b3142');
      labelCentered(ctx, p.name, i * cw, cw, 48);
    });
    // Fliperama com as duas partidas.
    [0, 1].forEach((seed, j) => {
      const ax = progs.length * cw + 18 + j * 36;
      blit(ctx, arcade, ax, 56);
      const ra = arcade.rects?.screen;
      if (ra) art.drawScreen(ctx, { x: ax - arcade.ax + ra.x, y: 56 - arcade.ay + ra.y, w: ra.w, h: ra.h }, 'game', t, seed);
    });
  }, '#dfe3e8', 4);
}

// ------------------------------------------------------------------ personagens

function characters(): void {
  const s = section('personagens', 'Personagens — 40 sementes', 'Sementes variadas (a cada 5ª, subagente com crachá) andando nas 4 direções. Variedade de pele, cabelo, roupas e acessórios.');
  const cw = 26;
  const ch = 36;
  canvas(s, cw * 16, ch * 10, (ctx, t) => {
    for (let i = 0; i < 40; i++) {
      const a = art.appearanceFromSeed(i * 7919 + 13, { sub: i % 5 === 4 });
      DIRS.forEach((dir, k) => {
        const col = (i % 4) * 4 + k;
        const row = Math.floor(i / 4);
        blit(ctx, art.characterSprite({ appearance: a, dir, pose: 'walk', frame: frameOf('walk', t, i * 50) }), col * cw + cw / 2, row * ch + 32);
      });
    }
  });
}

function poses(): void {
  const s = section('poses', 'Poses × direções', 'Todas as poses do contrato, animadas. Poses sentadas sobre cadeira de escritório (de costas) e cadeira frontal (de frente), como o mundo posiciona.');
  const cw = 30;
  const ch = 40;
  const list: { pose: Pose; seated: boolean; held?: HeldItem }[] = [
    ...POSES.map((pose) => ({ pose, seated: SEATED_POSES.includes(pose) })),
    { pose: 'wait', seated: true, held: 'popcorn' },
    { pose: 'raise_hand', seated: true },
    { pose: 'talk', seated: true },
    { pose: 'read', seated: true, held: 'papers' },
    { pose: 'cheer', seated: true },
    { pose: 'laugh', seated: true },
    { pose: 'game', seated: true, held: 'controller' },
    { pose: 'rps', seated: false, held: 'rock' },
    { pose: 'rps', seated: false, held: 'paper' },
    { pose: 'rps', seated: false, held: 'scissors' },
    { pose: 'groom', seated: false, held: 'lipstick' },
    { pose: 'groom', seated: false, held: 'comb' },
    { pose: 'sulk', seated: true },
    { pose: 'read', seated: false, held: 'phone' },
    { pose: 'sit', seated: true, held: 'phone' },
  ];
  const a = art.appearanceFromSeed(2024, { look: 'f', sub: true });
  const b = art.appearanceFromSeed(77, { look: 'm' });
  canvas(s, cw * 8 + 66, ch * list.length + 10, (ctx, t) => {
    DIRS.forEach((dir, k) => label(ctx, DIR_PT[dir], 72 + k * 2 * cw - 10, 1, '#3e4757'));
    ctx.save();
    ctx.translate(0, 6);
    list.forEach((p, row) => {
      label(ctx, POSE_PT[p.pose], 2, row * ch + 16);
      let ly = row * ch + 23;
      if (p.held) {
        label(ctx, `(${HELD_PT[p.held]})`, 2, ly);
        ly += 7;
      }
      if (p.seated && !SEATED_POSES.includes(p.pose)) label(ctx, '(sentado)', 2, ly);
      DIRS.forEach((dir, k) => {
        [a, b].forEach((ap, j) => {
          const x = 72 + (k * 2 + j) * cw;
          const y = row * ch + 36;
          if (p.seated) {
            const kind: FurnitureKind = dir === 'up' ? 'office_chair' : dir === 'down' ? 'office_chair_front' : 'cafe_chair';
            const f = art.furnitureSprites(kind, kind === 'cafe_chair' ? dir : 'blue');
            blit(ctx, f.base, x, y);
            blit(ctx, art.characterSprite({ appearance: ap, dir, pose: p.pose, frame: frameOf(p.pose, t), seated: true, held: p.held }), x, y - SEAT_FOOT_DY);
            if (f.front) blit(ctx, f.front, x, y);
          } else {
            blit(ctx, art.characterSprite({ appearance: ap, dir, pose: p.pose, frame: frameOf(p.pose, t), held: p.held }), x, y);
          }
        });
      });
    });
    ctx.restore();
  });
}

function heldItems(): void {
  const s = section('itens', 'Itens nas mãos', 'Cada item nas 4 direções, parado e andando.');
  const cw = 26;
  const ch = 38;
  const a = art.appearanceFromSeed(5150, { look: 'm' });
  canvas(s, cw * 8 + 46, ch * HELD.length, (ctx, t) => {
    HELD.forEach((held, row) => {
      label(ctx, HELD_PT[held], 2, row * ch + 18);
      DIRS.forEach((dir, k) => {
        (['stand', 'walk'] as const).forEach((pose, j) => {
          blit(ctx, art.characterSprite({ appearance: a, dir, pose, frame: frameOf(pose, t), held }), 52 + (k * 2 + j) * cw, row * ch + 34);
        });
      });
    });
  });
}

// ------------------------------------------------------------------ móveis

function furniture(): void {
  const s = section('moveis', 'Móveis', 'Todos os kinds, variantes e estados do catálogo, com âncora (magenta) e footprint (pontilhado). Retângulos dinâmicos preenchidos (tela, quadro, vidro, relógio, TV).');
  const cells: { kind: FurnitureKind; variant?: string; state: number }[] = [];
  for (const kind of Object.keys(FURNITURE) as FurnitureKind[]) {
    const def = FURNITURE[kind];
    for (const v of def.variants ?? [undefined]) for (let st = 0; st < (def.states ?? 1); st++) cells.push({ kind, variant: v, state: st });
  }
  const cols = 6;
  const cw = 76;
  const ch = 82;
  const wallStyle: WallStyle = { base: '#eef1f4', trim: '#9fb0c4', pattern: 'plain' };
  canvas(s, cols * cw, Math.ceil(cells.length / cols) * ch, (ctx, t) => {
    cells.forEach((c, i) => {
      const def = FURNITURE[c.kind];
      const ox = (i % cols) * cw;
      const oy = Math.floor(i / cols) * ch;
      const ax = ox + cw / 2;
      const ay = oy + 62;
      ctx.fillStyle = (i + Math.floor(i / cols)) % 2 ? '#e3e6ea' : '#e9ecef';
      ctx.fillRect(ox, oy, cw, ch);
      if (def.mount === 'wall') {
        art.drawWallFace(ctx, ox, ay - 2 * TILE, cw, wallStyle, c.kind === 'door_frame' || c.kind === 'elevator' ? { doorways: [{ x: ax - TILE, w: 2 * TILE }] } : {});
      } else {
        dotted(ctx, ax - (def.footprint.w * TILE) / 2, ay - def.footprint.h * TILE, def.footprint.w * TILE, def.footprint.h * TILE);
      }
      const f = art.furnitureSprites(c.kind, c.variant, c.state);
      const sx = ax - f.base.ax;
      const sy = ay - f.base.ay;
      const g = f.base.rects?.glass;
      if (g) art.drawWindowView(ctx, { x: sx + g.x, y: sy + g.y, w: g.w, h: g.h }, 10, t, 1);
      blit(ctx, f.base, ax, ay);
      const r = f.base.rects ?? {};
      if (r.screen) art.drawScreen(ctx, { x: sx + r.screen.x, y: sy + r.screen.y, w: r.screen.w, h: r.screen.h }, 'code', t, i);
      if (r.tv) art.drawScreen(ctx, { x: sx + r.tv.x, y: sy + r.tv.y, w: r.tv.w, h: r.tv.h }, 'idle', t, i);
      if (r.board) art.drawBoard(ctx, { x: sx + r.board.x, y: sy + r.board.y, w: r.board.w, h: r.board.h }, [{ status: 'pending' }, { status: 'in_progress' }, { status: 'completed' }, { status: 'pending' }], t);
      if (r.face) art.drawClock(ctx, { x: sx + r.face.x, y: sy + r.face.y, w: r.face.w, h: r.face.h }, new Date());
      if (f.front) blit(ctx, f.front, ax, ay);
      anchorMark(ctx, ax, ay);
      label(ctx, c.kind, ox + 2, oy + 66, '#3e4757');
      if (c.variant || def.states) label(ctx, `${c.variant ?? ''}${def.states ? ` #${c.state}` : ''}`.trim(), ox + 2, oy + 73, '#6b7586');
    });
  });
}

// ------------------------------------------------------------------ superfícies

function floors(): void {
  const s = section('pisos', 'Pisos', 'Todos os FloorKind com variação por tile; carpete em três tintas de tema; tapetes.');
  const cw = 5 * TILE + 8;
  const items: { kind: FloorKind; tint?: string; tint2?: string; name: string }[] = FLOORS.map((k) => ({ kind: k, name: FLOOR_PT[k] }));
  for (const seed of [2, 4, 8]) {
    const th = art.roomTheme(seed);
    items.push({ kind: 'carpet', tint: th.carpet, tint2: th.carpet2, name: `carpete tema ${seed}` });
  }
  canvas(s, cw * 6, (4 * TILE + 14) * 2 + 4 * TILE + 14, (ctx) => {
    items.forEach((it, i) => {
      const x = (i % 6) * cw;
      const y = Math.floor(i / 6) * (4 * TILE + 14);
      art.drawFloor(ctx, it.kind, x, y, 5 * TILE, 4 * TILE, { seed: i + 1, tint: it.tint, tint2: it.tint2 });
      // +4: espaço para os acentos (ficam 3 px acima da linha do texto).
      label(ctx, it.name, x + 1, y + 4 * TILE + 4);
    });
    const ry = 2 * (4 * TILE + 14);
    ['#6fae7a', '#d67a5a', '#5b7fbd', '#c9a14a'].forEach((c, i) => {
      art.drawFloor(ctx, 'wood', i * cw, ry, 5 * TILE, 4 * TILE, { seed: 9 + i });
      art.drawRug(ctx, i * cw + 8, ry + 8, 4 * TILE, 3 * TILE - 4, c, i);
      label(ctx, `tapete ${i + 1}`, i * cw + 1, ry + 4 * TILE + 4);
    });
  });
}

function walls(): void {
  const s = section('paredes', 'Paredes', 'Face norte (2 tiles, tampa escura + rodapé) em todos os padrões, com passagem recortada; abaixo, parede sul (tampa + mureta) e tampa lateral.');
  const patterns: { name: string; style: WallStyle }[] = [
    ...(['plain', 'stripes', 'tiles', 'wood_panel', 'brick', 'glass', 'marble'] as WallPattern[]).map((p) => ({
      name: p,
      style: { base: p === 'brick' ? '#c98a6a' : p === 'tiles' ? '#e8eef2' : '#eef1f4', trim: '#9fb0c4', pattern: p },
    })),
    { name: 'exterior', style: { base: '#b9bcc4', trim: '#6d7583', pattern: 'plain', exterior: true } },
    { name: 'exterior tijolo', style: { base: '#b5745a', trim: '#5a4a44', pattern: 'brick', exterior: true } },
  ];
  const w = 7 * TILE;
  const cw = w + 10;
  canvas(s, cw * 3, Math.ceil(patterns.length / 3) * (4 * TILE + 16), (ctx) => {
    patterns.forEach((p, i) => {
      const x = (i % 3) * cw;
      const y = Math.floor(i / 3) * (4 * TILE + 16);
      art.drawFloor(ctx, 'concrete', x, y, w, 4 * TILE, { seed: i });
      art.drawWallFace(ctx, x, y, w, p.style, { doorways: [{ x: x + 3 * TILE, w: 2 * TILE }] });
      art.drawSouthWall(ctx, x, y + 3 * TILE, w, p.style, { doorways: [{ x: x + TILE, w: 2 * TILE }] });
      art.drawWallTop(ctx, x, y + 2 * TILE, 4, TILE, p.style);
      label(ctx, p.name, x + 1, y + 4 * TILE + 3);
    });
  });
}

// ------------------------------------------------------------------ telas, quadro, janela, relógio

function screens(): void {
  const s = section('telas', 'Telas animadas', 'Todos os ScreenMode no monitor da mesa (14×9) e numa TV (28×15). Abaixo, as mesas com 2º monitor/notebook (conteúdo fixo escurecido) e o verso dos monitores (desk_back) nas 3 variantes.');
  const desk = art.furnitureSprites('desk', 'white');
  const tv = art.furnitureSprites('tv');
  const cw = 44;
  canvas(s, cw * SCREENS.length, 168, (ctx, t) => {
    // Linha de baixo: mesas com tela secundária e versos de monitor em cada variante.
    ctx.fillStyle = '#d3d9e2';
    ctx.fillRect(0, 112, cw * SCREENS.length, 56);
    (['white', 'wood', 'dark'] as const).forEach((v, k) => {
      const x0 = k * 150 + 6;
      [1, 2, 4].forEach((seed, j) => {
        const d = art.furnitureSprites('desk', v, 0, { seed });
        const x = x0 + 18 + j * 34;
        blit(ctx, d.base, x, 136);
        const r = d.base.rects?.screen;
        if (r) art.drawScreen(ctx, { x: x - d.base.ax + r.x, y: 136 - d.base.ay + r.y, w: r.w, h: r.h }, (['code', 'terminal', 'off'] as const)[j], t, j);
      });
      [0, 1].forEach((seed, j) => blit(ctx, art.furnitureSprites('desk_back', v, 0, { seed }).base, x0 + 34 + j * 40, 162));
    });
    SCREENS.forEach((m, i) => {
      const x = i * cw + cw / 2;
      const y = 40;
      blit(ctx, desk.base, x, y);
      const r = desk.base.rects?.screen;
      if (r) art.drawScreen(ctx, { x: x - desk.base.ax + r.x, y: y - desk.base.ay + r.y, w: r.w, h: r.h }, m, t, i * 3);
      labelCentered(ctx, SCREEN_PT[m], i * cw, cw, 48);
      ctx.fillStyle = '#dfe3e8';
      ctx.fillRect(i * cw, 58, cw, 54);
      blit(ctx, tv.base, x, 100);
      const rt = tv.base.rects?.tv;
      if (rt) art.drawScreen(ctx, { x: x - tv.base.ax + rt.x, y: 100 - tv.base.ay + rt.y, w: rt.w, h: rt.h }, m, t, i * 5);
    });
  });
}

function boards(): void {
  const s = section('quadro', 'Quadro kanban', 'A fazer / fazendo / feito, com 0, 5 e 18 itens (excesso vira pontinhos).');
  const wb = art.furnitureSprites('whiteboard');
  const sets: { status: 'pending' | 'in_progress' | 'completed' }[][] = [
    [],
    [{ status: 'pending' }, { status: 'pending' }, { status: 'in_progress' }, { status: 'completed' }, { status: 'completed' }],
    Array.from({ length: 18 }, (_, i) => ({ status: (['pending', 'in_progress', 'completed'] as const)[i % 3 === 1 ? 2 : i % 4 === 0 ? 1 : 0] })),
  ];
  canvas(s, 60 * 3, 40, (ctx, t) => {
    sets.forEach((items, i) => {
      const x = i * 60 + 30;
      const y = 36;
      blit(ctx, wb.base, x, y);
      const r = wb.base.rects?.board;
      if (r) art.drawBoard(ctx, { x: x - wb.base.ax + r.x, y: y - wb.base.ay + r.y, w: r.w, h: r.h }, items, t);
    });
  }, '#eef1f4');
}

function windows(): void {
  const s = section('janela', 'Janela em 6 horários', 'Noite (estrelas e lua), amanhecer, manhã, tarde (nuvens deslizando), entardecer e início da noite (cidade com janelas acesas).');
  const win = art.furnitureSprites('window');
  const hours = [1, 6, 9.5, 14, 18.2, 20.5];
  const names = ['madrugada', 'amanhecer', 'manhã', 'tarde', 'entardecer', 'noite'];
  // Célula fixa mais larga que o maior rótulo ("entardecer" = 39 px) + rótulo centralizado sob a janela.
  const cw = 48;
  canvas(s, cw * hours.length, 50, (ctx, t) => {
    hours.forEach((h, i) => {
      const x = i * cw + cw / 2;
      const y = 36;
      const g = win.base.rects?.glass;
      art.drawWallFace(ctx, i * cw, y - 32, cw, { base: '#eef1f4', trim: '#9fb0c4' });
      if (g) art.drawWindowView(ctx, { x: x - win.base.ax + g.x, y: y - win.base.ay + g.y, w: g.w, h: g.h }, h, t, 5);
      blit(ctx, win.base, x, y);
      labelCentered(ctx, names[i], i * cw, cw, 42);
    });
  });
}

function clockAndIcons(): void {
  const s = section('icones', 'Relógio, ícones e temas', `Relógio com a hora local; os ${ICONS.length} ícones de estado (a teia, com contorno translúcido, também em 2×); temas de sala (piso, parede, mesa e cadeira).`);
  const row = document.createElement('div');
  row.className = 'row';
  s.appendChild(row);
  const clk = art.furnitureSprites('clock');
  canvas(row, 40, 40, (ctx) => {
    art.drawWallFace(ctx, 0, 4, 40, { base: '#eef1f4', trim: '#9fb0c4' });
    blit(ctx, clk.base, 20, 36);
    const r = clk.base.rects?.face;
    if (r) art.drawClock(ctx, { x: 20 - clk.base.ax + r.x, y: 36 - clk.base.ay + r.y, w: r.w, h: r.h }, new Date());
  });
  canvas(row, ICONS.length * 16, 16, (ctx) => {
    ICONS.forEach((n, i) => blit(ctx, art.iconSprite(n), i * 16 + 8, 14));
  }, '#5b6b85');
  // Ampulheta girando (alterna as duas a cada 1,2 s, como o mundo faz) e a teia em 1× e 2× sobre
  // fundos claro e escuro.
  canvas(row, 82, 30, (ctx, t) => {
    ctx.fillStyle = '#e9ecf1';
    ctx.fillRect(16, 0, 66, 30);
    blit(ctx, art.iconSprite(Math.floor(t / 1200) % 2 ? 'hourglass_flip' : 'hourglass'), 8, 24);
    const web = art.iconSprite('cobweb');
    ctx.drawImage(web.canvas, 20, 2);
    ctx.drawImage(web.canvas, 36, 2, web.canvas.width * 2, web.canvas.height * 2);
    ctx.fillStyle = '#3f62a3';
    ctx.fillRect(66, 0, 16, 30);
    ctx.drawImage(web.canvas, 67, 2);
  }, '#5b6b85');
  const th = document.createElement('div');
  s.appendChild(th);
  canvas(th, 10 * 70, 76, (ctx, t) => {
    for (let i = 0; i < 10; i++) {
      const theme = art.roomTheme(i);
      const x = i * 70;
      art.drawFloor(ctx, 'carpet', x, 32, 64, 32, { seed: i, tint: theme.carpet, tint2: theme.carpet2 });
      art.drawWallFace(ctx, x, 0, 64, theme.wall);
      const d = art.furnitureSprites('desk', theme.deskVariant, 0, { seed: i });
      blit(ctx, d.base, x + 32, 50);
      const r = d.base.rects?.screen;
      if (r) art.drawScreen(ctx, { x: x + 32 - d.base.ax + r.x, y: 50 - d.base.ay + r.y, w: r.w, h: r.h }, 'code', t, i);
      const c = art.furnitureSprites('office_chair', theme.chairVariant);
      blit(ctx, c.base, x + 32, 64);
      if (c.front) blit(ctx, c.front, x + 32, 64);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x + 2, 66, 8, 8);
      label(ctx, `tema ${i}`, x + 12, 66);
    }
  });
}

function avatars(): void {
  const s = section('avatares', 'Avatares', 'avatarCanvas (busto ampliado, fundo transparente) para a interface.');
  const row = document.createElement('div');
  row.className = 'row';
  s.appendChild(row);
  for (let i = 0; i < 24; i++) {
    const c = art.avatarCanvas(i * 101 + 7, { sub: i % 6 === 5, scale: 3 });
    c.style.background = '#2a3142';
    c.style.borderRadius = '8px';
    c.className = 'px';
    row.appendChild(c);
  }
}

// ------------------------------------------------------------------ laço de animação

sampleScene();
shellWait();
socialLife();
characters();
poses();
heldItems();
furniture();
floors();
walls();
screens();
boards();
windows();
clockAndIcons();
avatars();

function loop(t: number): void {
  for (const p of painters) {
    p.ctx.fillStyle = p.bg;
    p.ctx.fillRect(0, 0, p.w, p.h);
    p.paint(p.ctx, t);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

Object.assign(window, { art });
