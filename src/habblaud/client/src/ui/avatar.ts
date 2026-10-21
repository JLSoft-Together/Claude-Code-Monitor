// Avatares dos agentes para a UI: gerados pelo módulo de arte uma única vez e reaproveitados como data URL.
import { partsKey } from '../../../shared/appearance';
import type { AgentInfo } from '../../../shared/types';
import { avatarCanvas } from '../art';
import { h } from './dom';

const cache = new Map<string, { url: string; w: number; h: number }>();

type AvatarSource = Pick<AgentInfo, 'seed' | 'look' | 'kind' | 'parts'>;

function avatarData(agent: AvatarSource, scale: number): { url: string; w: number; h: number } {
  const key = `${agent.seed}|${agent.look}|${agent.kind}|${scale}|${partsKey(agent.parts)}`;
  let entry = cache.get(key);
  if (!entry) {
    const c = avatarCanvas(agent.seed, { look: agent.look, sub: agent.kind === 'sub', scale, parts: agent.parts });
    entry = { url: c.toDataURL('image/png'), w: c.width, h: c.height };
    cache.set(key, entry);
  }
  return entry;
}

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

/** Escala inteira do módulo de arte para cada tamanho (pixels sempre nítidos). */
const SCALE: Record<AvatarSize, number> = { xs: 1, sm: 2, md: 2, lg: 4 };

/** Moldura do avatar (caixa com fundo) + imagem em tamanho natural, alinhada pelos ombros. */
export function createAvatar(agent: AvatarSource, size: AvatarSize): HTMLElement {
  const box = createAvatarPlaceholder(size);
  updateAvatar(box, agent, size);
  return box;
}

/** Moldura vazia (agente desconhecido); `updateAvatar` preenche depois. */
export function createAvatarPlaceholder(size: AvatarSize): HTMLElement {
  return h('span', { class: `ui-avatar ui-avatar--${size}`, attrs: { 'aria-hidden': 'true' } });
}

/** Atualiza o avatar só se a aparência (semente, look, peças) mudou. */
export function updateAvatar(box: HTMLElement, agent: AvatarSource, size: AvatarSize): void {
  const sig = `${agent.seed}|${agent.look}|${agent.kind}|${partsKey(agent.parts)}`;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  let img = box.querySelector('img');
  if (!img) {
    img = h('img', { attrs: { alt: '', draggable: 'false', decoding: 'async' } });
    box.append(img);
  }
  try {
    const data = avatarData(agent, SCALE[size]);
    img.width = data.w;
    img.height = data.h;
    img.src = data.url;
  } catch (err) {
    // A arte ainda pode estar em construção; a moldura vazia continua legível.
    console.warn('[ui] falha ao gerar avatar', err);
  }
}
