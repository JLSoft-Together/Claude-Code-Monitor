// Eventos do GitHub fictícios do modo demonstração: de tempos em tempos alguém abre ou mergeia um PR,
// publica uma release ou vê o CI falhar (e depois passar), para a festa e o alarme das salas aparecerem
// nos prints sem nenhum dado real.
import type { GitHubEvent } from '../github';
import { tr } from '../i18n';

const WORKFLOWS = ['CI', 'build-test', tr('Testes'), tr('Lint e tipos'), 'Deploy'];

/**
 * Sorteia um evento. `alarm` = a sala já está com o CI vermelho: na maioria das vezes, o próximo
 * evento é o conserto (CI verde). `pr` = número do próximo PR fictício.
 */
export function demoGitHubEvent(rng: () => number, opts: { branch?: string; alarm: boolean; pr: number }): GitHubEvent {
  const branch = opts.branch ?? 'main';
  const workflow = WORKFLOWS[Math.floor(rng() * WORKFLOWS.length)];
  if (opts.alarm && rng() < 0.75) return { kind: 'ci_passed', branch, workflow };
  const r = rng();
  if (r < 0.32) return { kind: 'pr_opened', number: opts.pr };
  if (r < 0.58) return { kind: 'pr_merged', number: Math.max(1, opts.pr - 1 - Math.floor(rng() * 3)) };
  if (r < 0.84) return { kind: 'ci_failed', branch, workflow };
  if (r < 0.92) return { kind: 'ci_passed', branch, workflow };
  return { kind: 'release', tag: `v${1 + Math.floor(rng() * 3)}.${Math.floor(rng() * 10)}.${Math.floor(rng() * 10)}` };
}
