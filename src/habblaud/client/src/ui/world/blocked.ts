// Habblaud World › Bloqueados (Fase 5): quem esta conta bloqueou (pelo cartão da pessoa, na cidade) e
// "Desbloquear" (POST /api/world/unblock, pela conexão com o mundo). Bloquear vale nos dois sentidos: um não vê o outro
// na rua, nos prédios, nos cumprimentos e nos carimbos. A lista vem do /v1/me (o status relido ao abrir a tela).
import { tr } from '../../../../shared/i18n';
import type { WorldBlockedPlayer, WorldClient } from '../../net/world';
import { h, setAttr, setHidden, setText } from '../dom';
import { worldErrorText } from './world-model';

export interface BlockedHost {
  readonly client: WorldClient | null;
  /** A lista do último status (undefined antes de chegar). */
  list(): WorldBlockedPlayer[] | undefined;
  /** Relê o status com /v1/me (a lista pode ter mudado na cidade). */
  refresh(): Promise<void>;
  /** A tela ainda é esta (uma resposta que chega depois de sair dela não mexe em nada). */
  current(): boolean;
  announce(text: string): void;
}

/** A tela: o cabeçalho (com o voltar) vem de settings-world.ts. */
export function buildBlocked(head: HTMLElement, host: BlockedHost): { el: HTMLElement; sync(): void } {
  const list = h('ul', { class: 'ui-world__blocked' });
  const note = h('p', { class: 'ui-set__hint', text: tr('Carregando…') });
  const error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
  /** Ids desbloqueados nesta tela (somem da lista na hora, antes do status novo). */
  const gone = new Set<string>();
  let key = '';
  let loaded = false;

  const row = (p: WorldBlockedPlayer): HTMLElement => {
    const btn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Desbloquear'), attrs: { 'aria-label': tr('Desbloquear {0}', [p.name]) } });
    btn.addEventListener('click', async () => {
      const client = host.client;
      if (!client || btn.disabled) return;
      btn.disabled = true;
      setAttr(btn, 'aria-busy', 'true');
      setHidden(error, true);
      const r = await client.unblock(p.id);
      if (!host.current()) return;
      btn.disabled = false;
      setAttr(btn, 'aria-busy', null);
      if (!r.ok) {
        setText(error, worldErrorText(r.code, 'unblock'));
        setHidden(error, false);
        return;
      }
      gone.add(p.id);
      host.announce(tr('{0} desbloqueado.', [p.name]));
      sync();
    });
    return h(
      'li',
      { class: 'ui-set ui-world__blocked-row' },
      h('div', { class: 'ui-set__text' }, h('span', { class: 'ui-world__blocked-name' }, h('span', { text: '🚫', attrs: { 'aria-hidden': 'true' } }), ` ${p.name}`)),
      btn,
    );
  };

  const sync = () => {
    const all = host.list();
    const items = (all ?? []).filter((p) => !gone.has(p.id));
    const k = `${loaded}|${all ? 'y' : 'n'}|${items.map((p) => `${p.id}:${p.name}`).join(',')}`;
    if (k === key) return;
    key = k;
    if (!all && !loaded) {
      setText(note, tr('Carregando…'));
      setHidden(note, false);
      list.replaceChildren();
      return;
    }
    setText(note, items.length ? '' : tr('Ninguém bloqueado.'));
    setHidden(note, items.length > 0);
    list.replaceChildren(...items.map(row));
  };

  void host.refresh().finally(() => {
    if (!host.current()) return;
    loaded = true;
    sync();
  });
  sync();
  return {
    el: h(
      'div',
      { class: 'ui-world__stack' },
      head,
      h('p', { class: 'ui-set__hint', text: tr('Quem você bloqueia não te vê e você não vê a pessoa: na rua, nos prédios, nos cumprimentos e nos carimbos. Para bloquear alguém, abra o cartão da pessoa na cidade.') }),
      note,
      list,
      error,
    ),
    sync,
  };
}
