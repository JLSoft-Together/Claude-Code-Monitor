// Peças visuais reutilizadas pelos painéis: chip de conta (e o selo "Codex"), ponto de status, selo de papel, barra
// de progresso.
import type { AccountInfo, Activity, AgentInfo, AgentStatus, Provider } from '../../../shared/types';
import { h, setAttr, setHidden, setStyleVar, setText, setTitle, setVariant } from './dom';
import { WORDMARK } from './icons';
import { shellDoneKind, shellLine, shellStage, statusLabel, type ShellWait } from './model';
import { accountChipLabel, accountProvider, fallbackShort, showsProviderTag } from './provider';
import { tr } from '../../../shared/i18n';

/**
 * Chip quadrado com a letra curta da conta ("C", "D") na cor da conta. Conta do Codex: o chip fica vazado (fundo
 * escuro, borda e letra na cor da conta, cantos em degrau): `data-provider="codex"`.
 */
export function createAccountChip(size: 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
  return h('span', { class: `ui-acc-chip ui-acc-chip--${size}` });
}

/** `provider` = dica para quando a conta não está no snapshot (ex.: a sessão do histórico diz de que ferramenta é). */
export function updateAccountChip(chip: HTMLElement, account: AccountInfo | undefined, fallbackId = '', provider?: Provider): void {
  const p = accountProvider(account, fallbackId, provider);
  setText(chip, account?.short ?? fallbackShort(fallbackId, p));
  setStyleVar(chip, '--acc', account?.color ?? '#8b98b3');
  setAttr(chip, 'data-provider', p === 'codex' ? 'codex' : null);
  const label = accountChipLabel(account, fallbackId, p);
  setTitle(chip, label);
  setAttr(chip, 'aria-label', label);
}

/** Selo de texto "Codex" ao lado do nome da conta (onde há espaço: gaveta, terminal, cartão de uso, dica). */
export function createProviderTag(extra = ''): HTMLElement {
  return h('span', { class: `ui-prov${extra ? ` ${extra}` : ''}`, text: 'Codex', hidden: true, title: tr('Agente do Codex (OpenAI)') });
}

/** Mostra o selo só para o Codex (e não repete quando o nome da conta já diz "Codex"). */
export function updateProviderTag(tag: HTMLElement, provider: Provider, accountName = ''): void {
  setHidden(tag, !showsProviderTag(provider, accountName));
}

/** Quadradinho de status (pixel), com pulso quando precisa de você. */
export function createStatusDot(): HTMLElement {
  return h('span', { class: 'ui-status-dot', role: 'img' });
}

export function updateStatusDot(dot: HTMLElement, status: AgentStatus): void {
  setVariant(dot, 'is-', status);
  const label = statusLabel(status);
  setAttr(dot, 'aria-label', label);
  setTitle(dot, label);
}

export function createRoleBadge(): HTMLElement {
  return h('span', { class: 'ui-role' });
}

export function updateRoleBadge(badge: HTMLElement, agent: Pick<AgentInfo, 'kind' | 'role' | 'background'>): void {
  setText(badge, agent.kind === 'main' ? tr('Principal') : agent.role || tr('Subagente'));
  setVariant(badge, 'ui-role--', agent.kind);
  setTitle(badge, agent.kind === 'main' ? tr('Agente principal') : tr('Subagente: {0}{1}', [agent.role, agent.background ? tr(' (em segundo plano)') : '']));
}

/** Barra de progresso fina; `value` 0–1. */
export function createProgress(label: string): HTMLElement {
  const bar = h('span', { class: 'ui-progress', role: 'progressbar', attrs: { 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 } });
  bar.append(h('span', { class: 'ui-progress__fill' }));
  return bar;
}

export function updateProgress(bar: HTMLElement, done: number, total: number, partial = 0): void {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const partialPct = total > 0 ? Math.round(((done + partial) / total) * 100) : 0;
  setStyleVar(bar, '--p', `${pct}%`);
  setStyleVar(bar, '--pp', `${partialPct}%`);
  setAttr(bar, 'aria-valuenow', String(pct));
  setAttr(bar, 'aria-valuetext', `${done} de ${total}`);
  bar.classList.toggle('is-complete', total > 0 && done === total);
}

/**
 * Linha "ícone + texto" de atividade, com reticências. Tem também um cronômetro e um contador "×N"
 * (ocultos fora da espera por shell), para que o tempo nunca seja cortado pelas reticências do texto.
 */
export function createActivityLine(): HTMLElement {
  const el = h('span', { class: 'ui-activity' });
  el.append(
    h('span', { class: 'ui-activity__icon', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'ui-activity__text' }),
    h('span', { class: 'ui-activity__time', hidden: true }),
    h('span', { class: 'ui-activity__count', hidden: true }),
  );
  return el;
}

function activityParts(el: HTMLElement): [HTMLElement, HTMLElement, HTMLElement, HTMLElement] {
  return el.children as unknown as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
}

export function updateActivityLine(el: HTMLElement, activity: Activity | undefined, fallback = tr('Sem atividade ainda')): void {
  const [icon, text, time, count] = activityParts(el);
  setText(icon, activity?.icon ?? '·');
  setText(text, activity?.text ?? fallback);
  setHidden(time, true);
  setHidden(count, true);
  el.classList.remove('is-shell');
  el.classList.toggle('is-error', !!activity?.error);
  // Fim de um shell (✅/❌ do servidor): destaque próprio, para não se perder entre as outras atividades.
  const done = shellDoneKind(activity);
  el.classList.toggle('is-shell-ok', done === 'ok');
  el.classList.toggle('is-shell-fail', done === 'fail');
  setTitle(el, activity ? (activity.detail ? `${activity.text}\n${activity.detail}` : activity.text) : fallback);
}

/** Mesma linha para quem espera um shell: "⏳ <label> · 12:31 ×2", com o tempo correndo. */
export function updateShellActivityLine(el: HTMLElement, wait: ShellWait, now: number): void {
  const [icon, text, time, count] = activityParts(el);
  const line = shellLine(wait, now);
  setText(icon, '⏳');
  setText(text, line.label);
  setText(time, line.time);
  setHidden(time, false);
  setText(count, line.count);
  setHidden(count, !line.count);
  el.classList.add('is-shell');
  el.classList.remove('is-error', 'is-shell-ok', 'is-shell-fail');
  const stage = shellStage(now - wait.since);
  const main = wait.main;
  setTitle(
    el,
    [line.text, main?.command && main.command !== main.label ? main.command : '', `${stage.emoji} ${stage.text}`].filter(Boolean).join('\n'),
  );
}

/** Nome do produto como logotipo em pixels (o texto fica para leitores de tela). */
export function wordmark(cls = 'ui-brand__name'): HTMLElement {
  const el = h('span', { class: cls });
  el.innerHTML = WORDMARK;
  el.append(h('span', { class: 'ui-sr', text: 'Habblaud' }));
  return el;
}
