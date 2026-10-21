// Cartões da cidade: o do prédio (ao passar o mouse ou clicar) e o do jogador (ao clicar; o perfil chega pelo
// stream). Os modelos são puros (testados); a parte DOM usa as classes `ui-city-card*` de ui/styles.css.
import { avatarCanvas } from '../../art';
import { hash32 } from '../../../../shared/hash';
import { intlLocale, tr } from '../../../../shared/i18n';
import { introLabel } from '../../../../shared/world/intro';
import type { WorldBuildingPublic, WorldPlayerPublic } from '../../../../shared/world/protocol';
import { TRAITS, isTraitId } from '../../../../shared/world/traits';
import { h, setHidden, setText } from '../../ui/dom';

/** O cartão mostra o número de andares até este; acima, "24+". (A fachada desenha até 12 e põe "+N".) */
export const CARD_MAX_FLOORS = 24;

/** Bandeira (emoji) de um código ISO-2; vazio se o código não tem o formato. */
export function flagEmoji(code: string | undefined | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  const up = code.toUpperCase();
  return String.fromCodePoint(0x1f1e6 + up.charCodeAt(0) - 65, 0x1f1e6 + up.charCodeAt(1) - 65);
}

/** Nome do país no idioma de quem vê (o código, se o navegador não souber). */
export function countryName(code: string | undefined | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  try {
    return new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** "2026-10" → "outubro de 2026" (mês local, sem fuso: o dia 1 às 0 h na hora de quem vê). */
export function monthLabel(ym: string | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '');
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return '';
  try {
    return new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1));
  } catch {
    return `${m[2]}/${m[1]}`;
  }
}

/** "1 andar", "7 andares", "24+ andares", "só o térreo". */
export function floorsLabel(floors: number): string {
  const n = Number.isFinite(floors) ? Math.max(0, Math.floor(floors)) : 0;
  if (n === 0) return tr('só o térreo');
  if (n > CARD_MAX_FLOORS) return tr('{0} andares', [`${CARD_MAX_FLOORS}+`]);
  return n === 1 ? tr('1 andar') : tr('{0} andares', [n]);
}

export function likesLabel(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return v === 1 ? tr('1 curtida') : tr('{0} curtidas', [v.toLocaleString(intlLocale())]);
}

export interface BuildingCardModel {
  owner: string;
  flag: string;
  country: string;
  online: boolean;
  state: string;
  floors: string;
  /** null = modo discreto (o dono não mostra os agentes). */
  agents: { working: number; waiting: number; idle: number } | null;
  likes: string;
  since: string;
  closed: boolean;
  mine: boolean;
}

export function buildingCardModel(b: WorldBuildingPublic, myBuildingId: string | null = null): BuildingCardModel {
  const online = b.state === 'online';
  return {
    owner: b.owner.name,
    flag: flagEmoji(b.owner.country),
    country: countryName(b.owner.country),
    online,
    state: online ? tr('Luzes acesas') : tr('Luzes apagadas'),
    floors: floorsLabel(b.floors),
    agents: b.agents ? { working: b.agents.working, waiting: b.agents.waiting, idle: b.agents.idle } : null,
    likes: likesLabel(b.likes),
    since: monthLabel(b.sinceMonth),
    closed: b.closed === true,
    mine: !!myBuildingId && b.id === myBuildingId,
  };
}

export interface PlayerCardModel {
  name: string;
  flag: string;
  country: string;
  traits: { emoji: string; label: string; desc: string }[];
  intro: string;
  likes: string;
  /** O prédio do jogador, se ele tem um e a cidade conhece. */
  building: { id: string; floors: string; online: boolean } | null;
  hasBuilding: boolean;
}

export function playerCardModel(p: WorldPlayerPublic, building: WorldBuildingPublic | undefined): PlayerCardModel {
  return {
    name: p.name,
    flag: flagEmoji(p.country),
    country: countryName(p.country),
    traits: (p.traits ?? []).filter(isTraitId).map((t) => ({ emoji: TRAITS[t].emoji, label: TRAITS[t].label, desc: TRAITS[t].desc })),
    intro: p.intro ? introLabel(p.intro) : '',
    likes: likesLabel(p.likesReceived),
    building: building ? { id: building.id, floors: floorsLabel(building.floors), online: building.state === 'online' } : null,
    hasBuilding: !!p.buildingId,
  };
}

// ====================================================================== DOM

export interface CardActions {
  /** Leva a câmera até o prédio (não o jogador). */
  showBuilding(id: string): void;
  /** Até onde vai a barra do topo (px): o cartão fica abaixo dela. */
  topInset(): number;
  /** (Opcional) Entrar no prédio: o meu, de qualquer lugar ("Ver como os outros veem"). */
  enter?(id: string): void;
  /**
   * O que mais vai no fim do cartão (Fase 5, city/social.ts: curtir, bater, cumprimentar, bloquear, denunciar): um
   * elemento que se atualiza sozinho, posto de volta a cada vez que o cartão é refeito.
   */
  extras?(kind: 'building' | 'player', id: string): HTMLElement | null;
}

/** Os dois cartões (um de cada vez), posicionados perto do ponto da tela. */
export class CityCards {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly flag: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly body: HTMLElement;
  private readonly avatar: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  /** O que está aberto: ('building'|'player', id) e se foi por clique (fica) ou por hover (some ao sair). */
  kind: 'building' | 'player' | null = null;
  id: string | null = null;
  pinned = false;
  private sig = '';

  constructor(private readonly actions: CardActions) {
    this.avatar = h('span', { class: 'ui-city-card__avatar', hidden: true, attrs: { 'aria-hidden': 'true' } });
    this.flag = h('span', { class: 'ui-city-card__flag', attrs: { 'aria-hidden': 'true' } });
    this.title = h('strong', { class: 'ui-city-card__title' });
    this.sub = h('div', { class: 'ui-city-card__sub' });
    this.body = h('div', { class: 'ui-city-card__body' });
    this.closeBtn = h('button', { class: 'ui-city-card__close', type: 'button', title: tr('Fechar'), attrs: { 'aria-label': tr('Fechar') }, text: '×', on: { click: () => this.hide() } });
    this.el = h(
      'section',
      { class: 'ui-city-card', hidden: true, role: 'dialog', attrs: { 'aria-live': 'polite', 'aria-label': tr('Cartão') } },
      h('div', { class: 'ui-city-card__head' }, this.avatar, h('div', { class: 'ui-city-card__names' }, h('div', { class: 'ui-city-card__line' }, this.flag, this.title), this.sub), this.closeBtn),
      this.body,
    );
  }

  get open(): boolean {
    return this.kind !== null;
  }

  hide(): void {
    this.kind = null;
    this.id = null;
    this.pinned = false;
    this.sig = '';
    this.el.hidden = true;
  }

  showBuilding(b: WorldBuildingPublic, myBuildingId: string | null, at: { x: number; y: number }, pinned: boolean): void {
    const m = buildingCardModel(b, myBuildingId);
    const sig = `b|${b.id}|${JSON.stringify(m)}`;
    this.kind = 'building';
    this.id = b.id;
    this.pinned = pinned || (this.pinned && this.id === b.id);
    this.el.classList.toggle('is-pinned', this.pinned);
    if (sig !== this.sig) {
      this.sig = sig;
      setHidden(this.avatar, true);
      setText(this.flag, m.flag);
      this.flag.title = m.country;
      setText(this.title, m.owner);
      setText(this.sub, [m.mine ? tr('Seu prédio') : '', m.country].filter(Boolean).join(' · '));
      this.el.classList.toggle('is-online', m.online);
      const rows: HTMLElement[] = [];
      rows.push(h('div', { class: 'ui-city-card__row' }, h('span', { class: `ui-city-card__dot ${m.online ? 'is-on' : 'is-off'}` }), h('span', { text: m.state }), h('span', { class: 'ui-city-card__sep', text: '·' }), h('span', { text: m.floors })));
      if (m.agents) {
        rows.push(
          h(
            'div',
            { class: 'ui-city-card__agents' },
            h('span', { class: 'ui-city-card__agent is-working', title: tr('Agentes trabalhando') }, h('b', { text: String(m.agents.working) }), ` ${tr('trabalhando')}`),
            h('span', { class: 'ui-city-card__agent is-waiting', title: tr('Agentes esperando o dono') }, h('b', { text: String(m.agents.waiting) }), ` ${tr('esperando')}`),
            h('span', { class: 'ui-city-card__agent is-idle', title: tr('Agentes à toa') }, h('b', { text: String(m.agents.idle) }), ` ${tr('à toa')}`),
          ),
        );
      } else rows.push(h('div', { class: 'ui-city-card__muted', text: tr('Modo discreto: o dono não mostra os agentes.') }));
      if (m.closed) rows.push(h('div', { class: 'ui-city-card__muted', text: `🔒 ${tr('Fechado a visitas')}` }));
      rows.push(h('div', { class: 'ui-city-card__row ui-city-card__foot' }, h('span', { text: `❤️ ${m.likes}` }), m.since ? h('span', { class: 'ui-city-card__since', text: tr('No mundo desde {0}', [m.since]) }) : null));
      // o meu prédio: entrar de qualquer lugar e ver o que os outros veem lá dentro
      const enter = this.actions.enter;
      if (m.mine && enter) {
        const id = b.id;
        rows.push(h('button', { class: 'ui-city-card__link', type: 'button', text: `👁 ${tr('Ver como os outros veem')}`, on: { click: () => enter(id) } }));
      }
      const extra = this.actions.extras?.('building', b.id);
      if (extra) rows.push(extra);
      this.body.replaceChildren(...rows);
    }
    this.place(at);
    this.el.hidden = false;
  }

  showPlayer(p: WorldPlayerPublic, building: WorldBuildingPublic | undefined, at: { x: number; y: number } | null): void {
    const m = playerCardModel(p, building);
    const sig = `p|${p.id}|${JSON.stringify(m)}|${JSON.stringify(p.parts)}`;
    this.kind = 'player';
    this.id = p.id;
    this.pinned = true;
    this.el.classList.add('is-pinned');
    this.el.classList.remove('is-online');
    if (sig !== this.sig) {
      this.sig = sig;
      setHidden(this.avatar, false);
      try {
        const c = avatarCanvas(hash32(p.id), { look: p.look, parts: p.parts, scale: 2 });
        c.className = 'ui-city-card__avatar-img';
        this.avatar.replaceChildren(c);
      } catch {
        this.avatar.replaceChildren();
      }
      setText(this.flag, m.flag);
      this.flag.title = m.country;
      setText(this.title, m.name);
      setText(this.sub, m.country);
      const rows: HTMLElement[] = [];
      if (m.intro) rows.push(h('div', { class: 'ui-city-card__intro', text: `“${m.intro}”` }));
      if (m.traits.length) rows.push(h('div', { class: 'ui-city-card__traits' }, ...m.traits.map((t) => h('span', { class: 'ui-trait', title: t.desc, text: `${t.emoji} ${t.label}` }))));
      const foot = h('div', { class: 'ui-city-card__row ui-city-card__foot' }, h('span', { text: `❤️ ${tr('{0} recebidas', [m.likes])}` }));
      if (m.building) {
        const b = m.building;
        foot.append(
          h('button', { class: 'ui-city-card__link', type: 'button', text: `🏢 ${tr('Ver o prédio')} (${b.floors})`, on: { click: () => this.actions.showBuilding(b.id) } }),
        );
      } else foot.append(h('span', { class: 'ui-city-card__muted', text: m.hasBuilding ? tr('Prédio longe daqui') : tr('Ainda sem prédio') }));
      rows.push(foot);
      const extra = this.actions.extras?.('player', p.id);
      if (extra) rows.push(extra);
      this.body.replaceChildren(...rows);
    }
    if (at) this.place(at);
    this.el.hidden = false;
  }

  /** Perto do ponto (px da janela), sem sair da tela. */
  private place(at: { x: number; y: number }): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = this.el.offsetWidth || 260;
    const hgt = this.el.offsetHeight || 140;
    if (vw <= 520) {
      // celular: o cartão fica embaixo, de lado a lado
      this.el.style.transform = '';
      this.el.classList.add('is-docked');
      return;
    }
    this.el.classList.remove('is-docked');
    const top = this.actions.topInset() + 8;
    let x = at.x + 16;
    let y = at.y - hgt - 12;
    if (x + w > vw - 8) x = at.x - w - 16;
    if (y < top) y = at.y + 18;
    x = Math.max(8, Math.min(vw - w - 8, x));
    y = Math.max(top, Math.min(vh - hgt - 8, y));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
