// Detector de eventos do GitHub: saídas SINTÉTICAS de cada comando (sucesso, falha e ruído que não
// pode disparar). Nada aqui vem de transcripts reais.
import { describe, expect, it } from 'vitest';
import type { GitHubEvent } from '../../shared/github';
import { bashCall, detectGitHubNotification, detectGitHubResult, githubCallOf, scriptSegments } from './github';
import { createTranscriptState, parseLine, type TranscriptSignal } from './transcript';
import { L } from '../test/fixtures';

/** Roda um Bash fictício: comando + saída (+ erro / gitOperation). */
function bash(command: string, output: string, o: { error?: boolean; tur?: Record<string, unknown>; branch?: string } = {}): GitHubEvent | undefined {
  const call = githubCallOf('Bash', { command });
  if (!call) return undefined;
  return detectGitHubResult(call, { content: output, tur: o.tur ?? {}, isError: !!o.error, branch: o.branch });
}

function mcp(name: string, input: Record<string, unknown>, text: string, error = false): GitHubEvent | undefined {
  const call = githubCallOf(name, input);
  if (!call) return undefined;
  return detectGitHubResult(call, { content: [{ type: 'text', text }], tur: {}, isError: error });
}

describe('comando: quais operações do git/gh', () => {
  it('separa o script em comandos (aspas, $(...), heredoc e encadeamentos)', () => {
    const segs = scriptSegments(`cd /x && git push -u origin feat/a 2>&1 | tail -3; gh pr create --title "a; b && c" --body "$(cat <<'EOF'\ntexto com git push\nEOF\n)"`);
    expect(segs.map((s) => s.words[0])).toEqual(['cd', 'git', 'tail', 'gh']);
    expect(segs.map((s) => s.next)).toEqual(['&&', '|', ';', '']);
  });

  it('reconhece push, PR, CI e release (com prefixos e flags globais)', () => {
    expect(bashCall('git -C /repo push origin main')?.ops).toEqual(['push']);
    expect(bashCall('GIT_TRACE=0 timeout 60 git push')?.ops).toEqual(['push']);
    expect(bashCall('gh -R acme/loja pr merge 12 --squash')).toMatchObject({ ops: ['pr_merge'], number: 12, repo: 'acme/loja' });
    expect(bashCall('gh pr checks https://github.com/acme/loja/pull/7 --watch')).toMatchObject({ ops: ['pr_checks'], number: 7, ciExit: true });
    expect(bashCall('gh run watch 99 --exit-status')).toMatchObject({ ops: ['run_watch'], exitStatus: true, ciExit: true });
    expect(bashCall('gh run watch 99 --exit-status 2>&1 | tail -5')?.ciExit).toBeUndefined();
    expect(bashCall('gh run watch 99 --exit-status; echo "exit=$?"')?.ciExit).toBeUndefined();
    expect(bashCall('gh release create v1.2.0 --generate-notes')?.ops).toEqual(['release_create']);
    expect(bashCall('git push --dry-run')?.noPush).toBe(true);
    expect(bashCall('gh pr merge 3 --auto --squash')?.auto).toBe(true);
  });

  it('ignora o que não é operação: git log, gh pr view/list, run list, texto em echo/heredoc', () => {
    expect(bashCall('git log --oneline -5')).toBeUndefined();
    expect(bashCall('gh pr view 12 --json url')).toBeUndefined();
    expect(bashCall('gh pr list')).toBeUndefined();
    expect(bashCall('gh run list --limit 3')).toBeUndefined();
    expect(bashCall('gh run view 12 --log-failed')).toBeUndefined();
    expect(bashCall('echo "git push e gh pr create"')).toBeUndefined();
    expect(bashCall("git commit -F - <<'EOF'\nfeat: x\n\ngit push depois\nEOF")).toBeUndefined();
    expect(bashCall('npm test')).toBeUndefined();
    expect(githubCallOf('Read', { file_path: '/x/gh' })).toBeUndefined();
  });
});

describe('PR aberto', () => {
  it('gh pr create: a URL do PR na saída', () => {
    expect(bash('gh pr create --fill', 'https://github.com/acme/loja/pull/12\n')).toEqual({ kind: 'pr_opened', number: 12, repo: 'acme/loja', url: 'https://github.com/acme/loja/pull/12' });
  });

  it('push + PR no mesmo comando: vale o PR (a URL /pull/new/ do push não é PR)', () => {
    const out = [
      'remote: Create a pull request for \'feat/x\' on GitHub by visiting:',
      'remote:      https://github.com/acme/loja/pull/new/feat/x',
      'To github.com:acme/loja.git',
      ' * [new branch]      feat/x -> feat/x',
      'https://github.com/acme/loja/pull/13',
    ].join('\n');
    expect(bash('git push -u origin feat/x && gh pr create --fill', out)).toMatchObject({ kind: 'pr_opened', number: 13 });
  });

  it('gitOperation do Claude Code tem preferência', () => {
    const tur = { stdout: '', gitOperation: { pr: { number: 21, url: 'https://github.com/acme/loja/pull/21', action: 'created' }, push: { branch: 'feat/y' } } };
    expect(bash('git push && gh pr create --fill', '', { tur })).toEqual({ kind: 'pr_opened', number: 21, url: 'https://github.com/acme/loja/pull/21', repo: 'acme/loja' });
  });

  it('não dispara: PR que já existe, comando com erro, gh pr view', () => {
    expect(bash('gh pr create --fill', 'a pull request for branch "x" into branch "main" already exists:\nhttps://github.com/acme/loja/pull/9', { error: true })).toBeUndefined();
    expect(bash('gh pr create --fill || gh pr view --json url -q .url', 'a pull request for branch "x" already exists:\nhttps://github.com/acme/loja/pull/9\nhttps://github.com/acme/loja/pull/9')).toBeUndefined();
    expect(bash('gh pr view 9', 'title: x\nurl: https://github.com/acme/loja/pull/9')).toBeUndefined();
  });

  it('MCP create_pull_request (JSON com a URL)', () => {
    expect(mcp('mcp__github__create_pull_request', { owner: 'acme', repo: 'loja', title: 't', head: 'x', base: 'main' }, '{"id":"1","url":"https://github.com/acme/loja/pull/30"}')).toMatchObject({
      kind: 'pr_opened',
      number: 30,
      repo: 'acme/loja',
    });
    expect(mcp('mcp__github__create_pull_request', { owner: 'acme', repo: 'loja' }, 'failed to create pull request: 422', true)).toBeUndefined();
  });
});

describe('PR mergeado', () => {
  it('gh pr merge com sucesso (número dos argumentos; saída vazia ou do git local)', () => {
    expect(bash('gh pr merge 37 --squash --delete-branch', 'Updating a1b2c3d..d4e5f6a\nFast-forward\n src/error.ts | 2 +-\n')).toEqual({ kind: 'pr_merged', number: 37 });
    expect(bash('gh pr merge --merge', '')).toEqual({ kind: 'pr_merged' });
    expect(bash('gh pr merge --squash', '✓ Squashed and merged pull request acme/loja#41 (Arruma o carrinho)')).toEqual({ kind: 'pr_merged', number: 41 });
    expect(bash('gh pr merge 5', '', { tur: { gitOperation: { pr: { number: 5, action: 'merged' } } } })).toEqual({ kind: 'pr_merged', number: 5 });
  });

  it('não dispara: falhou (mesmo com pipe que zera o código), --auto, já mergeado, erro', () => {
    expect(bash('gh pr merge 8 --merge 2>&1 | tail -3', 'X Pull request acme/loja#8 is not mergeable: the merge commit cannot be cleanly created.')).toBeUndefined();
    expect(bash('gh pr merge 8 --auto --squash', '! Pull request #8 will be automatically merged when all requirements are met')).toBeUndefined();
    expect(bash('gh pr merge 8', '! Pull request acme/loja#8 was already merged')).toBeUndefined();
    expect(bash('gh pr merge 8', 'GraphQL: Base branch was modified (mergePullRequest)', { error: true })).toBeUndefined();
  });

  it('MCP merge_pull_request', () => {
    expect(mcp('mcp__github__merge_pull_request', { owner: 'acme', repo: 'loja', pullNumber: 130 }, '{"sha":"abc","merged":true,"message":"Pull Request successfully merged"}')).toEqual({
      kind: 'pr_merged',
      number: 130,
      repo: 'acme/loja',
    });
    expect(mcp('mcp__github__merge_pull_request', { owner: 'acme', repo: 'loja', pullNumber: 130 }, '{"merged":false,"message":"not mergeable"}')).toBeUndefined();
    expect(mcp('mcp__github__merge_pull_request', { pullNumber: 130 }, 'failed to merge pull request: 405', true)).toBeUndefined();
  });
});

describe('push', () => {
  it('linhas de sucesso depois de "To"', () => {
    expect(bash('git push origin main', 'To github.com:acme/loja.git\n   1a2b3c4..5d6e7f8  main -> main\n')).toEqual({ kind: 'push', branch: 'main' });
    expect(bash('git push -u origin feat/z', 'To github.com:acme/loja.git\n * [new branch]      feat/z -> feat/z\n')).toEqual({ kind: 'push', branch: 'feat/z' });
    expect(bash('git push -f', 'To github.com:acme/loja.git\n + 1a2b3c4...5d6e7f8 main -> main (forced update)\n')).toEqual({ kind: 'push', branch: 'main' });
    expect(bash('git push', '', { tur: { gitOperation: { push: { branch: 'origin/main' } } } })).toEqual({ kind: 'push', branch: 'main' });
  });

  it('não dispara: rejeitado, nada a enviar, dry-run, linhas do fetch', () => {
    expect(bash('git push', 'To github.com:acme/loja.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs', { error: true })).toBeUndefined();
    expect(bash('git push 2>&1 | tail -3', 'To github.com:acme/loja.git\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs')).toBeUndefined();
    expect(bash('git push', 'Everything up-to-date')).toBeUndefined();
    expect(bash('git push --dry-run', 'To github.com:acme/loja.git\n * [new branch]      x -> x')).toBeUndefined();
    expect(bash('git fetch && git push', 'From github.com:acme/loja\n   1a2b3c4..5d6e7f8  main -> origin/main\nEverything up-to-date')).toBeUndefined();
  });
});

describe('CI', () => {
  it('gh run watch/view: cabeçalho ✓ (passou) ou X (falhou) com branch e workflow', () => {
    const ok = '✓ main Deploy acme/loja#4 · 123456\nTriggered via push about 2 minutes ago\n\nJOBS\n✓ deploy in 1m2s (ID 99)\n';
    expect(bash('gh run watch 123456 --exit-status 2>&1 | tail -20', ok)).toEqual({ kind: 'ci_passed', branch: 'main', workflow: 'Deploy' });
    const fail = 'Exit code 1\nX feat/x CI · 777\nTriggered via push about 1 minute ago\n\nJOBS\nX build in 30s (ID 5)\n  ✓ Checkout\n  X Rodar testes\n';
    expect(bash('gh run watch 777 --exit-status', fail, { error: true })).toEqual({ kind: 'ci_failed', branch: 'feat/x', workflow: 'CI' });
    expect(bash('gh run view 777', "\nX Run CI (777) completed with 'failure'")).toEqual({ kind: 'ci_failed', workflow: 'CI' });
  });

  it('gh run view --json / --jq: conclusão do objeto ou a palavra solta', () => {
    expect(bash('gh run view 5 --json status,conclusion,headBranch', '{"conclusion":"failure","headBranch":"dev","status":"completed"}')).toEqual({ kind: 'ci_failed', branch: 'dev' });
    expect(bash('gh run watch 5 --exit-status >/dev/null 2>&1; gh run view 5 --json conclusion -q .conclusion; git log -1 --oneline', 'success\n1a2b3c4 feat: x\n', { branch: 'main' })).toEqual({ kind: 'ci_passed', branch: 'main' });
  });

  it('gh pr checks: sem TTY (tabs), com TTY (resumo) e --json', () => {
    const tabs = 'build\tpass\t1m2s\thttps://github.com/acme/loja/actions/runs/1/job/2\t\ntestes\tfail\t40s\thttps://github.com/acme/loja/actions/runs/1/job/3\t\n';
    expect(bash('gh pr checks 39 2>&1 | head -20', tabs)).toEqual({ kind: 'ci_failed', workflow: 'testes', number: 39 });
    expect(bash('gh pr checks 39', 'build\tpass\t1m\turl\t\nlint\tskipping\t0\turl\t\n')).toEqual({ kind: 'ci_passed', number: 39 });
    expect(bash('gh pr checks', 'All checks were successful\n0 cancelled, 0 failing, 3 successful, 0 skipped, and 0 pending checks', { branch: 'feat/q' })).toEqual({ kind: 'ci_passed', branch: 'feat/q' });
    expect(bash('gh pr checks 2 --json name,bucket', '[{"name":"build","bucket":"pass"},{"name":"e2e","bucket":"fail"}]')).toEqual({ kind: 'ci_failed', workflow: 'e2e', number: 2 });
  });

  it('código de saída do próprio gh (sem saída para ler)', () => {
    expect(bash('gh run watch 9 --exit-status > /tmp/ci.log 2>&1', '', { branch: 'main' })).toEqual({ kind: 'ci_passed', branch: 'main' });
    expect(bash('gh run watch 9 --exit-status > /tmp/ci.log 2>&1', 'Exit code 1', { error: true, branch: 'main' })).toEqual({ kind: 'ci_failed', branch: 'main' });
    expect(bash('cd /x && gh pr checks 4 > /tmp/c 2>&1', 'Exit code 1', { error: true })).toEqual({ kind: 'ci_failed', number: 4 });
  });

  it('não dispara: pendente, rodando, código mascarado por pipe/echo, bloqueado, morto', () => {
    expect(bash('gh pr checks 4', 'build\tpending\t0\turl\t\n')).toBeUndefined();
    expect(bash('gh pr checks 4 > /tmp/c', 'Exit code 8', { error: true })).toBeUndefined();
    expect(bash('gh run view 3', '* main CI · 3\nTriggered via push less than a minute ago')).toBeUndefined();
    expect(bash('gh run view 3 --json status,conclusion', '{"conclusion":"","status":"in_progress"}')).toBeUndefined();
    expect(bash('gh run watch 3 --exit-status 2>&1 | tail -1', 'ANNOTATIONS\n! Node.js 20 is deprecated.')).toBeUndefined();
    expect(bash('gh run watch 3 --exit-status; echo fim', 'fim')).toBeUndefined();
    expect(bash('gh run watch 3 --exit-status', '<tool_use_error>Blocked: sleep</tool_use_error>', { error: true })).toBeUndefined();
    expect(bash('gh run watch 3 --exit-status', 'Exit code 143', { error: true })).toBeUndefined();
    expect(bash('gh run list --limit 3', 'completed\tfailure\tCI\tmain\tpush\t1\t1m\t2026-01-01')).toBeUndefined();
    expect(bash('cat ci.txt', 'All checks were successful')).toBeUndefined();
  });

  it('em segundo plano: o código de saída da notificação', () => {
    const call = githubCallOf('Bash', { command: 'gh run watch 9 --exit-status > /tmp/ci.log 2>&1' })!;
    expect(detectGitHubNotification(call, 'completed', 'Background command "CI" completed (exit code 0)', 'main')).toEqual({ kind: 'ci_passed', branch: 'main' });
    expect(detectGitHubNotification(call, 'failed', 'Background command "CI" failed with exit code 1', 'main')).toEqual({ kind: 'ci_failed', branch: 'main' });
    expect(detectGitHubNotification(call, 'failed', 'Background command "CI" failed with exit code 143', 'main')).toBeUndefined();
    expect(detectGitHubNotification(call, 'killed', undefined, 'main')).toBeUndefined();
    const piped = githubCallOf('Bash', { command: 'gh run watch 9 --exit-status 2>&1 | tail -25' })!;
    expect(detectGitHubNotification(piped, 'completed', 'Background command "CI" completed (exit code 0)')).toBeUndefined();
  });

  it('MCP: execução do workflow, status combinado e check runs', () => {
    expect(mcp('mcp__github__get_workflow_run', { owner: 'acme', repo: 'loja', run_id: 1 }, '{"name":"CI","head_branch":"main","status":"completed","conclusion":"failure"}')).toEqual({
      kind: 'ci_failed',
      branch: 'main',
      workflow: 'CI',
      repo: 'acme/loja',
    });
    expect(mcp('mcp__github__pull_request_read', { method: 'get_status', owner: 'acme', repo: 'loja', pullNumber: 3 }, '{"state":"success","statuses":[]}')).toEqual({
      kind: 'ci_passed',
      number: 3,
      repo: 'acme/loja',
    });
    expect(mcp('mcp__github__pull_request_read', { method: 'get', owner: 'acme', repo: 'loja', pullNumber: 3 }, '{"state":"open","merged":false,"number":3}')).toBeUndefined();
    expect(mcp('mcp__github__list_workflow_runs', {}, '{"total_count":2,"workflow_runs":[{"conclusion":"failure"}]}')).toBeUndefined();
  });
});

describe('release', () => {
  it('gh release create: URL da tag', () => {
    expect(bash('gh release create v1.4.0 --generate-notes', 'https://github.com/acme/loja/releases/tag/v1.4.0\n')).toEqual({
      kind: 'release',
      tag: 'v1.4.0',
      repo: 'acme/loja',
      url: 'https://github.com/acme/loja/releases/tag/v1.4.0',
    });
  });

  it('não dispara: rascunho, erro, gh release view', () => {
    expect(bash('gh release create v2 --draft', 'https://github.com/acme/loja/releases/tag/untagged-abc')).toBeUndefined();
    expect(bash('gh release create v2', 'HTTP 422: Validation Failed', { error: true })).toBeUndefined();
    expect(bash('gh release view v1', 'https://github.com/acme/loja/releases/tag/v1')).toBeUndefined();
  });
});

describe('no parser do transcript', () => {
  const ctx = { idPrefix: 'a', now: Date.now() };
  const signals = (lines: string[]): TranscriptSignal[] => {
    const s = createTranscriptState();
    return lines.flatMap((l) => parseLine(s, l, ctx).signals).filter((x) => x.type === 'github');
  };

  it('tool_use + tool_result viram o sinal github', () => {
    const out = signals([
      L.assistant([L.tool('t1', 'Bash', { command: 'gh pr create --fill', description: 'Abrir o PR' })]),
      L.result('t1', 'https://github.com/acme/loja/pull/5'),
    ]);
    expect(out).toEqual([{ type: 'github', event: { kind: 'pr_opened', number: 5, repo: 'acme/loja', url: 'https://github.com/acme/loja/pull/5' }, toolUseId: 't1' }]);
  });

  it('CI em segundo plano: o lançamento não dispara; a notificação (uma vez só) sim', () => {
    const out = signals([
      L.assistant([L.tool('t2', 'Bash', { command: 'gh run watch 8 --exit-status > /tmp/w.log 2>&1', run_in_background: true })], { gitBranch: 'feat/k' }),
      L.bgLaunched('t2', 'bk1', { gitBranch: 'feat/k' }),
      L.shellNotification('queue', { taskId: 'bk1', toolUseId: 't2', status: 'failed', summary: 'Background command "w" failed with exit code 1' }),
      L.shellNotification('message', { taskId: 'bk1', toolUseId: 't2', status: 'failed', summary: 'Background command "w" failed with exit code 1' }, { gitBranch: 'feat/k' }),
    ]);
    expect(out).toEqual([{ type: 'github', event: { kind: 'ci_failed', branch: 'feat/k' }, toolUseId: 't2' }]);
  });

  it('Read/Grep de um arquivo com essas saídas não dispara', () => {
    const out = signals([
      L.assistant([L.tool('t3', 'Read', { file_path: '/x/ci.txt' }), L.tool('t4', 'Grep', { pattern: 'pull' })]),
      L.result('t3', 'X main CI · 1\nhttps://github.com/acme/loja/pull/1'),
      L.result('t4', 'All checks were successful'),
    ]);
    expect(out).toEqual([]);
  });
});
