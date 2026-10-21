// Seção "Vida social" da gaveta do agente: o que está fazendo numa roda, carteira de moedinhas,
// placar, personalidade, amizades/rivalidades com quem está no escritório e o extrato.
import type { AgentSocial } from '../world/api';
import type { UiContext } from './context';
import { h, setHidden, setText, setTitle } from './dom';
import { plural, relativeTime } from './format';
import { tr } from '../../../shared/i18n';

/** "+🪙10" / "−🪙10" (sinal tipográfico de menos). */
export function coinDelta(delta: number): string {
  return `${delta >= 0 ? '+' : '−'}🪙${Math.abs(delta)}`;
}

/** "3 vitórias · 1 derrota" (ou "Sem partidas ainda"). */
export function recordText(wins: number, losses: number): string {
  if (!wins && !losses) return tr('Sem partidas ainda');
  return `${plural(wins, tr('vitória'), tr('vitórias'))} · ${plural(losses, tr('derrota'), tr('derrotas'))}`;
}

const LEDGER_SHOWN = 6;

export class SocialSection {
  readonly el: HTMLElement;
  private extra: HTMLElement;
  private doing: HTMLElement;
  private coins: HTMLElement;
  private earned: HTMLElement;
  private record: HTMLElement;
  private traits: HTMLElement;
  private phrase: HTMLElement;
  private friends: HTMLElement;
  private rivals: HTMLElement;
  private friendsRow: HTMLElement;
  private rivalsRow: HTMLElement;
  private ledger: HTMLElement;
  private ledgerBox: HTMLDetailsElement;
  /** Assinaturas do que já está no DOM (só refaz as listas quando mudam). */
  private keys = { traits: '', bonds: '', ledger: '' };

  constructor(private ctx: UiContext) {
    const title = h('h3', { class: 'ui-sec__title', text: tr('Vida social') });
    this.extra = h('span', { class: 'ui-sec__extra ui-social__balance' });
    this.doing = h('p', { class: 'ui-social__doing' });
    this.coins = h('strong', { class: 'ui-social__coins' });
    this.earned = h('span', { class: 'ui-social__earned' });
    this.record = h('span', { class: 'ui-social__record' });
    this.traits = h('div', { class: 'ui-social__traits' });
    this.phrase = h('p', { class: 'ui-social__phrase' });
    this.friends = h('span', { class: 'ui-social__names' });
    this.rivals = h('span', { class: 'ui-social__names' });
    this.friendsRow = h('p', { class: 'ui-social__bond' }, h('span', { class: 'ui-social__bond-label', text: tr('💛 Amizades') }), this.friends);
    this.rivalsRow = h('p', { class: 'ui-social__bond' }, h('span', { class: 'ui-social__bond-label', text: tr('⚔️ Rivalidades') }), this.rivals);
    this.ledger = h('ol', { class: 'ui-social__ledger' });
    this.ledgerBox = h('details', { class: 'ui-social__extract' }, h('summary', { text: tr('Extrato') }), this.ledger);
    const wallet = h(
      'div',
      { class: 'ui-social__wallet' },
      h('span', { class: 'ui-social__purse', attrs: { 'aria-hidden': 'true' }, text: '🪙' }),
      h('div', { class: 'ui-social__wallet-body' }, h('div', { class: 'ui-social__wallet-line' }, this.coins, this.record), this.earned),
    );
    setTitle(wallet, tr('Moedinhas fictícias: entra no escritório com um saldo, ganha 🪙10 por tarefa concluída e 🪙5 por pedido atendido, e aposta com os colegas. Ficam salvas neste navegador.'));
    this.el = h(
      'section',
      { class: 'ui-sec ui-social' },
      h('div', { class: 'ui-sec__head' }, title, this.extra),
      this.doing,
      wallet,
      this.traits,
      this.phrase,
      this.friendsRow,
      this.rivalsRow,
      this.ledgerBox,
    );
  }

  /** Atualiza com o agente `id`; some quando o mundo não sabe dele (já saiu, ou mundo antigo). */
  render(id: string, now: number): void {
    const s: AgentSocial | null = this.ctx.world.social?.(id) ?? null;
    setHidden(this.el, !s);
    if (!s) return;
    setText(this.extra, `🪙 ${s.coins}`);
    setText(this.doing, s.doing ?? '');
    setHidden(this.doing, !s.doing);
    setText(this.coins, tr('{0} moedinhas', [s.coins]));
    setText(this.record, recordText(s.wins, s.losses));
    setText(this.earned, tr('{0} ganhos trabalhando', [coinDelta(s.earned)]));
    setText(this.phrase, tr('Bordão: “{0}”', [s.catchphrase]));

    const tk = s.traits.map((t) => t.label).join('|');
    if (tk !== this.keys.traits) {
      this.keys.traits = tk;
      this.traits.replaceChildren(...s.traits.map((t) => h('span', { class: 'ui-trait', title: t.desc, text: `${t.emoji} ${t.label}` })));
    }

    const bk = s.bonds.map((b) => `${b.id}:${b.kind}:${b.name}:${b.record?.join('-') ?? ''}`).join('|');
    if (bk !== this.keys.bonds) {
      this.keys.bonds = bk;
      const link = (b: AgentSocial['bonds'][number]) => {
        const label = b.record ? `${b.name} (${b.record[0]}×${b.record[1]})` : b.name;
        return h('button', {
          class: 'ui-social__name',
          type: 'button',
          text: label,
          title: b.record ? tr('Retrospecto contra {0}: {1}', [b.name, recordText(b.record[0], b.record[1])]) : tr('Ver {0}', [b.name]),
          on: { click: () => this.ctx.select({ type: 'agent', id: b.id }, { focus: true }) },
        });
      };
      const friends = s.bonds.filter((b) => b.kind === 'amizade');
      const rivals = s.bonds.filter((b) => b.kind === 'rivalidade');
      this.friends.replaceChildren(...friends.map(link));
      this.rivals.replaceChildren(...rivals.map(link));
      setHidden(this.friendsRow, !friends.length);
      setHidden(this.rivalsRow, !rivals.length);
    }

    const items = s.ledger.slice(0, LEDGER_SHOWN);
    const lk = items.map((e) => `${e.at}:${e.delta}:${e.text}`).join('|') + `@${Math.floor(now / 30_000)}`;
    if (lk !== this.keys.ledger) {
      this.keys.ledger = lk;
      this.ledger.replaceChildren(
        ...items.map((e) =>
          h(
            'li',
            { class: `ui-social__entry ${e.delta >= 0 ? 'is-plus' : 'is-minus'}` },
            h('span', { class: 'ui-social__delta', text: coinDelta(e.delta) }),
            h('span', { class: 'ui-social__what', text: `${e.icon} ${e.text}` }),
            h('time', { class: 'ui-social__when', text: relativeTime(e.at, now) }),
          ),
        ),
      );
    }
    setHidden(this.ledgerBox, !items.length);
  }
}
