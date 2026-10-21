// O social leve do Habblaud World no escritório (Fase 5):
// - "Enquanto você estava fora": quem passou pelo prédio enquanto o dono não estava (visitas, likes e os carimbos que
//   deixaram na portaria, sem quem). Aparece no cartão "Seu prédio" (a janela do Habblaud World) e, ao conectar,
//   num cartão flutuante no canto do escritório; fechar ou "Ok, vi" manda o `summary.seen` (POST /api/world/summary/seen).
// - O código do prédio ("HB-4F2K"), para mandar a um amigo, com "Copiar".
// - Batidas na porta: com "Avisar quando baterem na porta" ligado, um aviso "Alguém bateu na porta do seu prédio" (sem
//   nome) quando `meta.world.building.knocks` sobe.
// Só pelo próprio computador (as mesmas travas da seção do World) e nunca no timelapse. Os modelos são puros (testados).
import { intlLocale, tr } from '../../../../shared/i18n';
import type { Notice } from '../../../../shared/types';
import type { AwaySummary } from '../../../../shared/world/protocol';
import { stampIcon, stampLabel } from '../../../../shared/world/social-labels';
import type { WorldBuildingStatus, WorldClient, WorldSource } from '../../net/world';
import type { UiComponent, UiContext } from '../context';
import { copyText, h, prefersReducedMotion, setHidden, setText } from '../dom';
import { worldErrorText } from './world-model';
import './social.css';

// ------------------------------------------------------------------ modelos (puros)

export interface AwaySummaryView {
  /** "desde 14 de outubro" (o dia em que o dono viu o último resumo). */
  since: string;
  stats: Array<{ key: 'visits' | 'likes' | 'stamps'; icon: string; value: string; label: string }>;
  stamps: Array<{ id: string; icon: string; label: string; count: number }>;
  /** Uma frase para leitores de tela e para o aviso. */
  sentence: string;
}

/** "2026-10-14" → "14 de outubro" (dia UTC, mostrado como dia do calendário). */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return '';
  try {
    return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  } catch {
    return `${m[3]}/${m[2]}`;
  }
}

const n = (v: number) => v.toLocaleString(intlLocale());

/** O que o cartão mostra de um resumo: as três contagens, os carimbos (mais recebidos primeiro) e a frase. */
export function awaySummaryView(s: AwaySummary): AwaySummaryView {
  const stampsTotal = s.stamps.reduce((t, x) => t + x.count, 0);
  const since = dayLabel(s.since);
  const visits = s.visits === 1 ? tr('1 visita') : tr('{0} visitas', [n(s.visits)]);
  const likes = s.likes === 1 ? tr('1 like') : tr('{0} likes', [n(s.likes)]);
  const stamps = stampsTotal === 1 ? tr('1 carimbo') : tr('{0} carimbos', [n(stampsTotal)]);
  return {
    since: since ? tr('desde {0}', [since]) : '',
    stats: [
      { key: 'visits', icon: '🚶', value: n(s.visits), label: s.visits === 1 ? tr('visita') : tr('visitas') },
      { key: 'likes', icon: '❤️', value: n(s.likes), label: s.likes === 1 ? tr('like') : tr('likes') },
      { key: 'stamps', icon: '📮', value: n(stampsTotal), label: stampsTotal === 1 ? tr('carimbo') : tr('carimbos') },
    ],
    stamps: [...s.stamps]
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((x) => ({ id: x.stampId, icon: stampIcon(x.stampId), label: stampLabel(x.stampId), count: x.count })),
    sentence: tr('Enquanto você estava fora: {0}, {1} e {2}.', [visits, likes, stamps]),
  };
}

/** "❤️ 3 hoje" no chip da barra (null = nada: sem likes hoje ou o prédio não está aceso). */
export function likesTodayChip(state: string | null, likes: number | undefined): { text: string; title: string } | null {
  if (state !== 'live' || !likes || likes < 1) return null;
  return { text: tr('❤️ {0} hoje', [likes]), title: likes === 1 ? tr('Seu prédio ganhou 1 like hoje.') : tr('Seu prédio ganhou {0} likes hoje.', [likes]) };
}

/** Chave de um resumo (o mesmo resumo não aparece duas vezes no canto). */
export function summaryKey(s: AwaySummary | undefined): string {
  return s ? `${s.since}|${s.visits}|${s.likes}|${s.stamps.map((x) => `${x.stampId}:${x.count}`).join(',')}` : '';
}

/**
 * Batidas novas desde a última olhada: `last` = o que esta página já viu (null = ainda não viu nada: a primeira leitura
 * só marca, sem avisar, para uma batida antiga não virar aviso ao abrir a página).
 */
export function newKnocks(last: number | null, now: number | undefined): { last: number; fresh: number } {
  const cur = now ?? 0;
  if (last === null) return { last: cur, fresh: 0 };
  // o Habblaud reiniciou (a contagem voltou): marca de novo
  if (cur < last) return { last: cur, fresh: 0 };
  return { last: cur, fresh: cur - last };
}

// ------------------------------------------------------------------ DOM: o resumo (usado nos dois lugares)

function summaryBody(v: AwaySummaryView, compact: boolean): HTMLElement {
  const stats = h(
    'ul',
    { class: 'ui-away__stats', attrs: { 'aria-label': v.sentence } },
    ...v.stats.map((s) => h('li', { class: `ui-away__stat is-${s.key}` }, h('span', { class: 'ui-away__icon', text: s.icon, attrs: { 'aria-hidden': 'true' } }), h('b', { text: s.value }), h('span', { text: s.label }))),
  );
  const wall = v.stamps.length
    ? h(
        'ul',
        { class: 'ui-away__stamps', attrs: { 'aria-label': tr('Carimbos na portaria') } },
        ...v.stamps.map((st, i) =>
          h(
            'li',
            { class: 'ui-away__stamp', title: st.label, style: `--i:${i};--r:${((i * 37) % 11) - 5}deg` },
            h('span', { class: 'ui-away__stamp-icon', text: st.icon, attrs: { 'aria-hidden': 'true' } }),
            compact ? null : h('span', { class: 'ui-away__stamp-label', text: st.label }),
            st.count > 1 ? h('span', { class: 'ui-away__stamp-count', text: `×${st.count}` }) : null,
          ),
        ),
      )
    : null;
  return h('div', { class: 'ui-away__body' }, stats, wall);
}

// ------------------------------------------------------------------ dentro de "Seu prédio"

export interface BuildingSocialHost {
  readonly client: WorldClient | null;
  building(): WorldBuildingStatus | undefined;
  /** Relê o status (depois do "Ok, vi"). */
  refresh(): void;
}

/** O código do prédio e o "Enquanto você estava fora", no cartão "Seu prédio" (atualizados no lugar). */
export class BuildingSocial {
  readonly el: HTMLElement;
  private readonly codeRow: HTMLElement;
  private readonly code: HTMLElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly summaryBody: HTMLElement;
  private readonly since: HTMLElement;
  private readonly seenBtn: HTMLButtonElement;
  private readonly error: HTMLElement;
  private key = '';
  private busy = false;

  constructor(private readonly host: BuildingSocialHost) {
    this.code = h('code', { class: 'ui-away__code' });
    this.copyBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Copiar'), on: { click: () => void this.copy() } });
    this.codeRow = h(
      'div',
      { class: 'ui-away__coderow', hidden: true },
      h('span', { class: 'ui-away__codelabel', text: tr('Código do prédio') }),
      this.code,
      this.copyBtn,
      h('span', { class: 'ui-set__hint ui-away__codehint', text: tr('Mande a um amigo: na cidade, "Ir para" leva direto à sua porta.') }),
    );
    this.since = h('span', { class: 'ui-away__since' });
    this.summaryBody = h('div');
    this.seenBtn = h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Ok, vi'), on: { click: () => void this.seen() } });
    this.error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    this.summary = h(
      'section',
      { class: 'ui-away ui-away--inline', hidden: true, attrs: { 'aria-label': tr('Enquanto você estava fora') } },
      h('div', { class: 'ui-away__head' }, h('span', { class: 'ui-away__badge', text: '📬', attrs: { 'aria-hidden': 'true' } }), h('div', { class: 'ui-away__titles' }, h('strong', { class: 'ui-away__title', text: tr('Enquanto você estava fora') }), this.since)),
      this.summaryBody,
      h('div', { class: 'ui-away__actions' }, this.seenBtn),
      this.error,
    );
    this.el = h('div', { class: 'ui-away__wrap' }, this.summary, this.codeRow);
    this.sync();
  }

  sync(): void {
    const b = this.host.building();
    setHidden(this.codeRow, !b?.code);
    setText(this.code, b?.code ?? '');
    const s = b?.summary;
    const key = summaryKey(s);
    if (key !== this.key) {
      this.key = key;
      if (s) {
        const v = awaySummaryView(s);
        setText(this.since, v.since);
        this.summaryBody.replaceChildren(summaryBody(v, false));
      }
      setHidden(this.error, true);
    }
    setHidden(this.summary, !s);
  }

  private async copy(): Promise<void> {
    const code = this.host.building()?.code;
    if (!code) return;
    const ok = await copyText(code);
    setText(this.copyBtn, ok ? tr('Copiado') : tr('Copiar'));
    setTimeout(() => setText(this.copyBtn, tr('Copiar')), 1600);
  }

  private async seen(): Promise<void> {
    const client = this.host.client;
    if (!client || this.busy) return;
    this.busy = true;
    this.seenBtn.disabled = true;
    const r = await client.summarySeen();
    this.busy = false;
    this.seenBtn.disabled = false;
    if (!r.ok) {
      setText(this.error, worldErrorText(r.code, 'summary'));
      setHidden(this.error, false);
      return;
    }
    setHidden(this.summary, true);
    this.host.refresh();
  }
}

// ------------------------------------------------------------------ no escritório: o cartão ao conectar e as batidas

export interface WorldSocialHooks {
  /** A seção do World está ativa nesta página (próprio computador, travas) e a conta, liberada. */
  active(): boolean;
  /** Um aviso rápido (os toasts do escritório). */
  toast(n: Notice): void;
  /** Abre a janela do Habblaud World (onde está o cartão "Seu prédio"). */
  openWorld(): void;
}

/**
 * O "Enquanto você estava fora" ao conectar (um cartão no canto do escritório, até "Ok, vi" ou fechar) e o aviso de
 * cada batida na porta. Lê só o meta (likes, batidas e se há resumo) e pede o status (local) para mostrar o resumo.
 */
export class WorldSocialNotifier implements UiComponent {
  readonly el: HTMLElement;
  private readonly since: HTMLElement;
  private readonly body: HTMLElement;
  private readonly error: HTMLElement;
  private readonly seenBtn: HTMLButtonElement;
  private knocksSeen: number | null = null;
  /** O resumo que está no cartão (ou que esta página já mostrou e a pessoa fechou). */
  private shownKey = '';
  private dismissedKey = '';
  private loading = false;
  private busy = false;

  constructor(
    private readonly ctx: UiContext,
    private readonly src: WorldSource,
    private readonly hooks: WorldSocialHooks,
  ) {
    const titleId = 'ui-away-title';
    this.since = h('span', { class: 'ui-away__since' });
    this.body = h('div');
    this.error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    this.seenBtn = h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Ok, vi'), on: { click: () => void this.dismiss() } });
    const close = h('button', { class: 'ui-away__close', type: 'button', text: '×', title: tr('Fechar'), attrs: { 'aria-label': tr('Fechar') }, on: { click: () => void this.dismiss() } });
    this.el = h(
      'section',
      { class: 'ui-away ui-away--float', hidden: true, role: 'dialog', attrs: { 'aria-labelledby': titleId, 'aria-modal': 'false' } },
      h(
        'div',
        { class: 'ui-away__head' },
        h('span', { class: 'ui-away__badge', text: '📬', attrs: { 'aria-hidden': 'true' } }),
        h('div', { class: 'ui-away__titles' }, h('strong', { class: 'ui-away__title', text: tr('Enquanto você estava fora'), attrs: { id: titleId } }), this.since),
        close,
      ),
      this.body,
      h(
        'div',
        { class: 'ui-away__actions' },
        h('button', { class: 'ui-link-btn', type: 'button', text: tr('Ver o meu prédio'), on: { click: () => this.hooks.openWorld() } }),
        this.seenBtn,
      ),
      this.error,
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void this.dismiss();
      }
    });
  }

  private active(): boolean {
    return this.hooks.active() && this.src.meta()?.state === 'approved' && !this.ctx.store.replaying;
  }

  render(): void {
    if (!this.active()) {
      setHidden(this.el, true);
      return;
    }
    const b = this.src.meta()?.building;
    // batidas: só as novas desde a última olhada desta página
    const k = newKnocks(this.knocksSeen, b?.knocks);
    this.knocksSeen = k.last;
    if (k.fresh > 0) {
      const text = k.fresh === 1 ? tr('Alguém bateu na porta do seu prédio.') : tr('Bateram {0} vezes na porta do seu prédio.', [k.fresh]);
      this.hooks.toast({ id: `world-knock-${Date.now()}`, level: 'info', text: `🚪 ${text}`, at: Date.now() });
      this.ctx.announce(text);
    }
    // o resumo: quando o meta diz que há um, pede o status (só ele traz as contagens)
    if (!b?.awaySummary) {
      if (this.shownKey) this.hide();
      return;
    }
    if (!this.shownKey && !this.loading) void this.load();
  }

  private async load(): Promise<void> {
    const client = this.src.client;
    if (!client) return;
    this.loading = true;
    const r = await client.status();
    this.loading = false;
    const s = r.ok ? r.data.building?.summary : undefined;
    const key = summaryKey(s);
    if (!s || !key || key === this.dismissedKey || !this.active()) return;
    this.shownKey = key;
    const v = awaySummaryView(s);
    setText(this.since, v.since);
    this.body.replaceChildren(summaryBody(v, true));
    setHidden(this.error, true);
    this.el.classList.toggle('is-calm', prefersReducedMotion());
    setHidden(this.el, false);
    this.ctx.announce(v.sentence);
  }

  private hide(): void {
    this.shownKey = '';
    setHidden(this.el, true);
  }

  /** "Ok, vi" ou fechar: some daqui e o servidor local avisa o mundo (sem conexão, assim que ela abrir). */
  private async dismiss(): Promise<void> {
    const client = this.src.client;
    if (!client || this.busy) return;
    this.busy = true;
    this.seenBtn.disabled = true;
    const key = this.shownKey;
    const r = await client.summarySeen();
    this.busy = false;
    this.seenBtn.disabled = false;
    if (!r.ok) {
      // não deu: o cartão fica, com o motivo (outra tentativa fecha de novo)
      setText(this.error, worldErrorText(r.code, 'summary'));
      setHidden(this.error, false);
      return;
    }
    this.dismissedKey = key;
    this.hide();
  }
}
