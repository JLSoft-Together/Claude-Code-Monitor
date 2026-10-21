// Chip do Habblaud World na barra do topo, ao lado da versão: "🏙️ no mundo" com o prédio aceso, "⏸ pausado",
// "reconectando…" quando a conexão caiu e "⚠️ parado" quando o servidor do mundo parou o prédio. Só com
// `meta.world.building` (conta aprovada; fora do mundo, nada) e nunca no celular pela porta remota (worldChipState).
// Um clique abre a janela do Habblaud World, onde estão o cartão "Seu prédio", a pausa e o motivo de uma parada.
// Com gente visitando o prédio, "👀 N" ao lado; o primeiro visitante de cada conexão ainda dá o aviso "Alguém entrou
// no seu prédio" (desligável na janela do Habblaud World).
// Fase 5: com o prédio aceso, "❤️ 3 hoje" (os likes que o prédio recebeu hoje), que pula quando chega um novo.
import type { Notice } from '../../../../shared/types';
import { tr } from '../../../../shared/i18n';
import type { WorldSource } from '../../net/world';
import type { UiComponent, UiContext } from '../context';
import { h, prefersReducedMotion, setAttr, setHidden, setText, setTitle, setVariant } from '../dom';
import { worldGate } from './settings-world';
import { likesTodayChip } from './away-summary';
import { agentsText, floorsText, nextVisitorAlert, VISITOR_ALERT_START, visitorsText, worldChipState, type WorldChipState } from './world-model';

const ICON: Record<WorldChipState, string> = { live: '🏙️', paused: '⏸', reconnecting: '🏙️', stopped: '⚠️' };

export class WorldChip implements UiComponent {
  readonly el: HTMLButtonElement;
  private readonly icon: HTMLElement;
  private readonly text: HTMLElement;
  private readonly visitors: HTMLElement;
  private alert = VISITOR_ALERT_START;
  private alertSeq = 0;
  private readonly likes: HTMLElement;
  private lastLikes: number | null = null;

  constructor(
    private readonly ctx: UiContext,
    private readonly src: WorldSource,
    open: () => void,
    /** O aviso "Alguém entrou no seu prédio" (os toasts da interface). */
    private readonly notify?: (n: Notice) => void,
  ) {
    this.icon = h('span', { class: 'ui-world-chip__icon', attrs: { 'aria-hidden': 'true' } });
    this.text = h('span', { class: 'ui-world-chip__text' });
    this.visitors = h('span', { class: 'ui-world-chip__visitors', hidden: true });
    this.likes = h('span', { class: 'ui-world-chip__likes', hidden: true });
    this.el = h('button', { class: 'ui-world-chip', type: 'button', hidden: true, attrs: { 'aria-haspopup': 'dialog' }, on: { click: open } }, this.icon, this.text, this.visitors, this.likes);
  }

  render(): void {
    const meta = this.src.meta();
    const state = worldChipState(meta, worldGate(this.ctx, this.src));
    // visitantes no prédio: o aviso do primeiro de cada conexão (fora do mundo ou sem conta, sem contagem)
    const count = state ? meta?.building?.visitors : undefined;
    const next = nextVisitorAlert(this.alert, count, this.ctx.prefs.worldVisitNotify);
    this.alert = next.state;
    if (next.notify) this.notify?.({ id: `world-visit-${++this.alertSeq}`, level: 'info', text: `👀 ${tr('Alguém entrou no seu prédio no Habblaud World.')}`, at: Date.now() });
    setHidden(this.el, !state);
    setHidden(this.visitors, !count);
    setText(this.visitors, count ? `👀 ${count}` : '');
    if (!state) return;
    const b = meta?.building;
    setVariant(this.el, 'is-', state);
    setText(this.icon, ICON[state]);
    const texts: Record<WorldChipState, [text: string, title: string]> = {
      live: [tr('no mundo'), tr('Seu prédio está aceso no Habblaud World: {0} e {1}. Clique para abrir o Habblaud World.', [floorsText(b?.floors ?? 0), agentsText(b?.agents ?? 0)])],
      paused: [tr('pausado'), tr('Pausado: seu prédio está apagado, mas você pode andar pela cidade. Nada do escritório sai deste computador; clique para retomar.')],
      reconnecting: [tr('reconectando…'), tr('Sem conexão com o Habblaud World agora; o Habblaud tenta de novo sozinho. Clique para ver o seu prédio.')],
      stopped: [tr('parado'), tr('Seu prédio parou de subir ao Habblaud World. Clique para ver o motivo.')],
    };
    const [text, base] = texts[state];
    const title = count ? `${base} ${visitorsText(count)}.` : base;
    setText(this.text, text);
    const likes = likesTodayChip(state, b?.likesToday);
    setHidden(this.likes, !likes);
    setText(this.likes, likes?.text ?? '');
    const full = likes ? `${title} ${likes.title}` : title;
    setTitle(this.el, full);
    setAttr(this.el, 'aria-label', full);
    // um like novo: o coração pula
    const n = b?.likesToday ?? 0;
    if (likes && this.lastLikes !== null && n > this.lastLikes && !prefersReducedMotion()) {
      this.likes.classList.remove('is-bump');
      void this.likes.offsetWidth;
      this.likes.classList.add('is-bump');
    }
    this.lastLikes = n;
  }
}
