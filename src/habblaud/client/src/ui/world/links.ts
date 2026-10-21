// Links do Habblaud World para fora (termos e privacidade), usados pela seção de Configurações, pelo cartão "Seu
// prédio", pela janela "Ver o que foi enviado" e pelo cartão de convite.
import { h } from '../dom';

export const WORLD_TERMS_URL = 'https://habblaud.com/world/termos';
export const WORLD_PRIVACY_URL = 'https://habblaud.com/world/privacidade';

/** Link para fora (termos, privacidade), sempre em outra aba. */
export function extLink(text: string, href: string): HTMLAnchorElement {
  return h('a', { class: 'ui-link-btn', text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
}
