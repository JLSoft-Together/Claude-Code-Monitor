// Cumprimentos na cidade (Fase 5): a roda com os 10 cumprimentos da lista (só ids; o texto sai traduzido para quem
// lê), quem recebe (o jogador selecionado no cartão ou o mais perto), os balões sobre as cabeças por 5 s e o limite do
// lado de cá (1 a cada 3 s, 20 por minuto: o servidor fecha a conexão depois de 3 recusas num minuto).
// Os modelos são puros (testados); a roda é DOM (classes `ui-city-wheel*` de city/social.css).
import { tr } from '../../../../shared/i18n';
import { GREETINGS, greetingIcon, greetingLabel } from '../../../../shared/world/social-labels';
import { GREETING_IDS, type GreetingId } from '../../../../shared/world/protocol';
import { h, setText } from '../../ui/dom';

/** Quanto tempo o balão fica sobre a cabeça (o servidor também diz 5 s; o relógio daqui é o que vale). */
export const BALLOON_MS = 5_000;
/** Até onde (tiles) a roda procura alguém para cumprimentar. */
export const GREET_RANGE = 12;
/** Quem me cumprimentou há menos disto é o primeiro da roda (para responder). */
export const REPLY_WINDOW_MS = 10_000;

/** A ordem da roda (a do protocolo). */
export const WHEEL: readonly GreetingId[] = GREETING_IDS;

/** Posição de cada item na roda: o primeiro em cima, no sentido do relógio (px a partir do centro). */
export function wheelLayout(n: number, radius: number): Array<{ x: number; y: number; angle: number }> {
  const out: Array<{ x: number; y: number; angle: number }> = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    out.push({ x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius), angle });
  }
  return out;
}

/** Tecla de atalho de cada item da roda: 1–9 e 0 (o 10º). */
export function wheelKey(i: number): string {
  return i === 9 ? '0' : String(i + 1);
}

/** O item da roda de uma tecla ("1".."9", "0"), ou -1. */
export function wheelIndexOfKey(key: string): number {
  if (!/^[0-9]$/.test(key)) return -1;
  const i = key === '0' ? 9 : Number(key) - 1;
  return i < WHEEL.length ? i : -1;
}

/**
 * Para quem vai o cumprimento: quem acabou de me cumprimentar (para responder), o jogador selecionado no cartão (se
 * ainda está aqui) ou o mais perto até `range` tiles. null = ninguém.
 */
export function pickGreetTarget(
  me: { x: number; y: number },
  players: Iterable<{ id: string; x: number; y: number }>,
  opts: { selected?: string | null; replyTo?: string | null; range?: number } = {},
): string | null {
  const range = opts.range ?? GREET_RANGE;
  let best: string | null = null;
  let bestD = range * range;
  const ids = new Set<string>();
  for (const p of players) {
    ids.add(p.id);
    const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = p.id;
    }
  }
  if (opts.replyTo && ids.has(opts.replyTo)) return opts.replyTo;
  if (opts.selected && ids.has(opts.selected)) return opts.selected;
  return best;
}

/** Os balões ativos (por jogador), cada um por BALLOON_MS a partir de quando chegou aqui. */
export class BalloonBook {
  private readonly map = new Map<string, { id: GreetingId; at: number }>();

  add(playerId: string, greetingId: GreetingId, now: number): void {
    this.map.set(playerId, { id: greetingId, at: now });
  }

  /** O balão de um jogador agora (`t`: 0..1 do tempo de vida), ou null. */
  get(playerId: string, now: number): { id: GreetingId; t: number; age: number } | null {
    const b = this.map.get(playerId);
    if (!b) return null;
    const age = now - b.at;
    if (age >= BALLOON_MS || age < 0) {
      this.map.delete(playerId);
      return null;
    }
    return { id: b.id, t: age / BALLOON_MS, age };
  }

  get size(): number {
    return this.map.size;
  }

  ids(): string[] {
    return [...this.map.keys()];
  }

  clear(): void {
    this.map.clear();
  }
}

/** Limite do lado de cá: no máximo um a cada `gapMs` e `perMinute` por minuto. */
export class RateGate {
  private readonly times: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly gapMs = 0,
  ) {}

  /** Quanto falta (ms) para poder de novo; 0 = pode agora. */
  wait(now: number): number {
    while (this.times.length && now - this.times[0]! >= 60_000) this.times.shift();
    const last = this.times[this.times.length - 1];
    let w = last === undefined ? 0 : Math.max(0, last + this.gapMs - now);
    if (this.times.length >= this.perMinute) w = Math.max(w, this.times[0]! + 60_000 - now);
    return w;
  }

  /** Tenta usar: true (e conta) se pode agora. */
  take(now: number): boolean {
    if (this.wait(now) > 0) return false;
    this.times.push(now);
    return true;
  }
}

/** Uma resposta que combina com o cumprimento recebido (sugestão: a primeira da roda ao responder). */
export function suggestedReply(got: GreetingId): GreetingId {
  switch (got) {
    case 'hello':
    case 'wave':
      return 'nice_to_meet';
    case 'nice_building':
    case 'congrats':
    case 'clap':
    case 'good_luck':
      return 'thanks';
    case 'coffee':
      return 'coffee';
    case 'bye':
      return 'bye';
    case 'thanks':
      return 'clap';
    case 'nice_to_meet':
      return 'wave';
  }
}

// ====================================================================== DOM: a roda

export interface WheelTarget {
  id: string;
  name: string;
}

/**
 * A roda de cumprimentos: 10 botões em círculo em volta do meu personagem, o nome de quem recebe no meio e uma seta
 * apontando para a pessoa. Clique, toque ou 1–9/0 escolhem; setas mudam o destaque; Esc fecha.
 */
export class GreetingWheel {
  readonly el: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly center: HTMLElement;
  private readonly to: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private target: WheelTarget | null = null;
  private focused = 0;
  private pick: ((id: GreetingId) => void) | null = null;

  constructor() {
    this.to = h('strong', { class: 'ui-city-wheel__to' });
    this.hint = h('span', { class: 'ui-city-wheel__hint' });
    this.arrow = h('span', { class: 'ui-city-wheel__arrow', attrs: { 'aria-hidden': 'true' } });
    this.center = h('div', { class: 'ui-city-wheel__center' }, h('span', { class: 'ui-city-wheel__label', text: tr('Cumprimentar') }), this.to, this.hint);
    this.ring = h('div', { class: 'ui-city-wheel__ring', role: 'menu', attrs: { 'aria-label': tr('Cumprimentos') } });
    const layout = wheelLayout(WHEEL.length, 96);
    WHEEL.forEach((id, i) => {
      const p = layout[i]!;
      const b = h(
        'button',
        {
          class: 'ui-city-wheel__item',
          type: 'button',
          role: 'menuitem',
          style: `--x:${p.x}px;--y:${p.y}px;--i:${i}`,
          attrs: { 'aria-label': `${greetingLabel(id)} (${wheelKey(i)})`, 'data-greeting': id },
          on: {
            click: () => this.choose(i),
            pointerenter: () => this.focus(i, false),
            focus: () => this.focus(i, false),
          },
        },
        h('span', { class: 'ui-city-wheel__emoji', text: greetingIcon(id), attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'ui-city-wheel__key', text: wheelKey(i), attrs: { 'aria-hidden': 'true' } }),
      );
      this.buttons.push(b);
      this.ring.append(b);
    });
    this.el = h('div', { class: 'ui-city-wheel', hidden: true }, this.arrow, this.ring, this.center);
    this.el.addEventListener('pointerdown', (e) => {
      // tocar fora dos botões fecha
      if (e.target === this.el) this.close();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  get targetId(): string | null {
    return this.target?.id ?? null;
  }

  /** Abre centrada em `at` (px da janela), apontando para `toward` (px da janela, opcional). */
  show(target: WheelTarget, at: { x: number; y: number }, toward: { x: number; y: number } | null, first: GreetingId | null, onPick: (id: GreetingId) => void): void {
    this.target = target;
    this.pick = onPick;
    setText(this.to, target.name);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = 132;
    const x = Math.max(r, Math.min(vw - r, at.x));
    const y = Math.max(r + 40, Math.min(vh - r, at.y));
    this.el.style.setProperty('--cx', `${Math.round(x)}px`);
    this.el.style.setProperty('--cy', `${Math.round(y)}px`);
    if (toward) {
      const a = Math.atan2(toward.y - y, toward.x - x);
      this.arrow.style.setProperty('--a', `${a}rad`);
      this.arrow.hidden = Math.hypot(toward.x - x, toward.y - y) < 30;
    } else this.arrow.hidden = true;
    this.el.hidden = false;
    this.el.classList.remove('is-in');
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
    this.focus(Math.max(0, first ? WHEEL.indexOf(first) : 0), true);
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.target = null;
    this.pick = null;
  }

  /** Tecla com a roda aberta: true se usou. */
  key(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const i = wheelIndexOfKey(e.key);
    if (i >= 0) {
      this.choose(i);
      return true;
    }
    switch (e.key) {
      case 'Escape':
      case 'g':
      case 'G':
        this.close();
        return true;
      case 'ArrowRight':
      case 'ArrowDown':
        this.focus((this.focused + 1) % WHEEL.length, true);
        return true;
      case 'ArrowLeft':
      case 'ArrowUp':
        this.focus((this.focused + WHEEL.length - 1) % WHEEL.length, true);
        return true;
      case 'Enter':
      case ' ':
        this.choose(this.focused);
        return true;
    }
    return false;
  }

  private focus(i: number, move: boolean): void {
    this.focused = i;
    this.buttons.forEach((b, k) => b.classList.toggle('is-focus', k === i));
    const id = WHEEL[i]!;
    setText(this.hint, `${GREETINGS[id].icon} ${greetingLabel(id)}`);
    if (move) this.buttons[i]?.focus({ preventScroll: true });
  }

  private choose(i: number): void {
    const id = WHEEL[i];
    const cb = this.pick;
    if (!id || !cb) return;
    this.buttons[i]?.classList.add('is-picked');
    setTimeout(() => this.buttons[i]?.classList.remove('is-picked'), 300);
    this.close();
    cb(id);
  }
}
