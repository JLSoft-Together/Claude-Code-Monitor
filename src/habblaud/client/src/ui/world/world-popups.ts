// Os popups do lançamento do Habblaud World, um modal de verdade (<dialog> no top layer, com o fundo escurecido, o
// foco preso e o Esc fechando) por cima do escritório, e acima da janela do Habblaud World quando ela está aberta:
// - "Novidade: Habblaud World", para quem ainda não tem conta. "Agora não" fecha e ele volta depois de 3 dias, no
//   máximo 3 vezes; "Não mostrar de novo" encerra; com a conta criada, nunca mais. Com Configurações ou a janela do
//   World abertos, espera.
// - "Você está na lista de espera", logo depois do cadastro (ou ao abrir a página já na espera), uma vez por navegador.
// - "Acesso liberado!", quando a conta é liberada com a página aberta (ou ao abrir já liberada, sem personagem), uma
//   vez por navegador; "Criar personagem" abre a janela do Habblaud World na tela do personagem.
// Quem decide é nextWorldPopup (world-model.ts, puro e testado); a memória vai ao localStorage quando o popup aparece
// (sem armazenamento, vale só para esta página). Só com o servidor do World configurado e a página aberta pelo próprio
// computador: nunca pela porta do celular, no timelapse ou no modo demonstração.
import { tr } from '../../../../shared/i18n';
import type { WorldSource } from '../../net/world';
import type { UiComponent, UiContext } from '../context';
import { h } from '../dom';
import { pixelIcon } from '../icons';
import { safeLocalStorage } from '../prefs';
import { extLink, WORLD_PRIVACY_URL } from './links';
import { worldGate } from './settings-world';
import {
  APPROVED_SEEN_KEY,
  EMPTY_POPUP_MEMORY,
  INVITE_SEEN_KEY,
  LAUNCH_KEY,
  nextWorldPopup,
  parsePopupMemory,
  serializePopupMemory,
  WAITLIST_SEEN_KEY,
  type WorldPopupKind,
  type WorldPopupMemory,
} from './world-model';

/** Prédio em pixels (o mundo é uma cidade de prédios): o selo dos popups e do cabeçalho da janela do World. */
export const WORLD_BUILDING_ICON = pixelIcon(
  [
    '....####....',
    '....#..#....',
    '.##########.',
    '.#.##.##.##.',
    '.##########.',
    '.#.##.##.##.',
    '.##########.',
    '.#.##.##.##.',
    '.##########.',
    '.####..####.',
    '.####..####.',
    '############',
  ],
  { '#': 'currentColor' },
  'ui-px-icon ui-world-popup__icon',
);

export interface WorldPopupHooks {
  /** Abre a janela do Habblaud World na tela pedida (o cadastro ou o personagem). */
  openWorld(screen: 'register' | 'character'): void;
  /** Configurações ou a janela do World abertos: o popup de lançamento espera (os outros dois ficam por cima). */
  panelOpen(): boolean;
}

const TITLE_ID = 'ui-world-popup-title';

export class WorldPopups implements UiComponent {
  readonly el: HTMLDialogElement;
  private memory: WorldPopupMemory;
  private open: WorldPopupKind | null = null;
  /** Quem tinha o foco antes do popup (volta para lá ao fechar). */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly ctx: UiContext,
    private readonly src: WorldSource,
    private readonly hooks: WorldPopupHooks,
  ) {
    this.memory = this.load();
    // `aria-modal` só enquanto aberto: fechado, o <dialog> continua no DOM e não pode parecer um modal aberto
    // (o teclado da cidade e os atalhos do escritório param na presença de um modal).
    this.el = h('dialog', { class: 'ui-world-popup', attrs: { 'aria-labelledby': TITLE_ID } });
    // Clique no fundo (fora do conteúdo) fecha, como "Agora não" / "Depois".
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('close', () => this.onClosed());
    // Esc fecha (o <dialog> modal já faz isso; sem showModal, fazemos aqui) e não chega aos atalhos do escritório.
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (typeof this.el.showModal !== 'function') {
        e.preventDefault();
        this.close();
      }
    });
  }

  render(): void {
    const meta = this.src.meta();
    if (this.open) {
      // A conta foi criada por outro caminho (a janela do World, outra aba): o lançamento não vale mais.
      if (this.open === 'launch' && meta?.state !== 'logged_out') this.close();
      return;
    }
    const gate = { ...worldGate(this.ctx, this.src), replaying: this.ctx.store.replaying };
    const d = nextWorldPopup(meta, gate, this.memory, Date.now());
    // Com Configurações ou a janela do World abertos, o lançamento espera a próxima leitura (sem contar como aparição).
    if (d.show === 'launch' && this.hooks.panelOpen()) return;
    if (d.memory) this.remember(d.memory);
    if (d.show) this.show(d.show);
  }

  // ---------------------------------------------------------------- conteúdo

  private show(kind: WorldPopupKind): void {
    this.open = kind;
    const badge = h('span', { class: 'ui-world-popup__badge', attrs: { 'aria-hidden': 'true' } });
    badge.innerHTML = WORLD_BUILDING_ICON;
    const { title, body, actions, primary } = this.content(kind);
    this.el.className = `ui-world-popup is-${kind}`;
    this.el.replaceChildren(
      h('div', { class: 'ui-world-popup__head' }, badge, h('h2', { class: 'ui-world-popup__title', text: title, attrs: { id: TITLE_ID } })),
      h('div', { class: 'ui-world-popup__body' }, ...body),
      h('div', { class: 'ui-world-popup__actions' }, ...actions),
    );
    this.opener = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof this.el.showModal === 'function') {
      if (!this.el.open) this.el.showModal();
    } else {
      this.el.setAttribute('open', '');
    }
    this.el.setAttribute('aria-modal', 'true');
    primary.focus({ preventScroll: true });
  }

  private content(kind: WorldPopupKind): { title: string; body: HTMLElement[]; actions: HTMLElement[]; primary: HTMLButtonElement } {
    const hint = (text: string) => h('p', { class: 'ui-set__hint ui-world-popup__hint', text });
    const para = (text: string) => h('p', { class: 'ui-world-popup__text', text });
    if (kind === 'waitlist') {
      const ok = h('button', { class: 'ui-btn ui-btn--primary ui-world-popup__cta', type: 'button', text: tr('Entendi'), attrs: { autofocus: true }, on: { click: () => this.close() } });
      return {
        title: tr('Você está na lista de espera'),
        body: [
          para(tr('O acesso é liberado aos poucos, em lotes. Avisamos por e-mail quando chegar a sua vez.')),
          hint(tr('Enquanto isso, o Habblaud continua normal e nada do escritório é enviado.')),
        ],
        actions: [ok],
        primary: ok,
      };
    }
    if (kind === 'approved') {
      const create = h('button', { class: 'ui-btn ui-btn--primary ui-world-popup__cta', type: 'button', text: tr('Criar personagem'), attrs: { autofocus: true }, on: { click: () => this.go('character') } });
      return {
        title: tr('Acesso liberado!'),
        body: [para(tr('Chegou a sua vez: crie o seu personagem e entre na cidade.'))],
        actions: [create, h('button', { class: 'ui-btn', type: 'button', text: tr('Depois'), on: { click: () => this.close() } })],
        primary: create,
      };
    }
    const create = h('button', { class: 'ui-btn ui-btn--primary ui-world-popup__cta', type: 'button', text: tr('Criar conta'), attrs: { autofocus: true }, on: { click: () => this.go('register') } });
    return {
      title: tr('Novidade: Habblaud World'),
      body: [
        h('p', { class: 'ui-world-popup__lead', text: tr('Seu escritório agora pode virar um prédio numa cidade online, aceso enquanto os seus agentes trabalham.') }),
        h(
          'ul',
          { class: 'ui-world-popup__perks' },
          h('li', { text: tr('Seu escritório vira um prédio numa cidade em pixel art, aceso enquanto os seus agentes trabalham.') }),
          h('li', { text: tr('Crie um personagem, ande pela cidade e visite os prédios de outras pessoas.') }),
          h('li', { text: tr('Cumprimente quem passa e deixe likes nos prédios, sem chat e sem spam.') }),
        ),
        h(
          'p',
          { class: 'ui-world-popup__privacy' },
          tr('Nada do seu trabalho sai do computador: só o tema, quantos andares e se cada personagem está ocupado ou à toa.'),
          ' ',
          extLink(tr('Ver a lista'), WORLD_PRIVACY_URL),
        ),
        hint(tr('Nada é enviado enquanto você não criar a conta. O acesso é liberado aos poucos, por lista de espera.')),
      ],
      actions: [
        create,
        h('button', { class: 'ui-btn', type: 'button', text: tr('Agora não'), on: { click: () => this.close() } }),
        h('button', { class: 'ui-link-btn', type: 'button', text: tr('Não mostrar de novo'), on: { click: () => this.never() } }),
      ],
      primary: create,
    };
  }

  // ---------------------------------------------------------------- ações

  private go(screen: 'register' | 'character'): void {
    this.close();
    this.hooks.openWorld(screen);
  }

  private never(): void {
    this.remember({ ...this.memory, launch: 'never' });
    this.close();
  }

  private close(): void {
    if (this.el.open) {
      if (typeof this.el.close === 'function') this.el.close();
      else this.el.removeAttribute('open');
    }
    this.el.removeAttribute('aria-modal');
    if (this.open) this.onClosed();
  }

  private onClosed(): void {
    if (!this.open) return;
    this.open = null;
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
    this.ctx.invalidate();
  }

  // ---------------------------------------------------------------- memória

  private load(): WorldPopupMemory {
    try {
      const s = safeLocalStorage();
      if (!s) return { ...EMPTY_POPUP_MEMORY };
      return parsePopupMemory({ launch: s.getItem(LAUNCH_KEY), legacy: s.getItem(INVITE_SEEN_KEY), waitlist: s.getItem(WAITLIST_SEEN_KEY), approved: s.getItem(APPROVED_SEEN_KEY) });
    } catch {
      return { ...EMPTY_POPUP_MEMORY };
    }
  }

  private remember(m: WorldPopupMemory): void {
    this.memory = m;
    try {
      const s = safeLocalStorage();
      if (!s) return;
      const v = serializePopupMemory(m);
      for (const [key, value] of [
        [LAUNCH_KEY, v.launch],
        [WAITLIST_SEEN_KEY, v.waitlist],
        [APPROVED_SEEN_KEY, v.approved],
      ] as const) {
        if (value === null) s.removeItem(key);
        else s.setItem(key, value);
      }
    } catch {
      // Sem armazenamento: a memória vale só para esta página.
    }
  }
}
