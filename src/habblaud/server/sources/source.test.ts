// Fontes de agentes (SourceSet) e histórico de várias ferramentas (HistorySet): o que o servidor vê como uma
// fonte só, o parser escolhido por agente, a falha isolada de uma fonte e o boot contado no Office.
import { describe, expect, it } from 'vitest';
import type { Provider, RecentSession, SourceInfo, TerminalEntry } from '../../shared/types';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { HistorySet, SourceSet, type AgentSource, type HistoryProvider, type HistoryResolveResult } from './source';
import type { TerminalParser } from './terminal';

setQuiet(true);

const CLAUDE_LINE = JSON.stringify({
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000001',
  timestamp: new Date(1_000).toISOString(),
  sessionId: 's',
  message: { role: 'user', content: 'oi' },
});

/** Parser marcado: cada linha vira uma entrada 'user' com o id `${tag}-${n}`. */
function tagged(tag: string): TerminalParser {
  let n = 0;
  return { push: (): TerminalEntry[] => [{ kind: 'user', id: `${tag}-${++n}`, at: 0, text: tag }] };
}

function fakeSource(provider: Provider, opts: Partial<AgentSource> & { paths?: Record<string, string>; log?: string[] } = {}): AgentSource {
  const paths = opts.paths ?? {};
  const events = opts.log ?? [];
  return {
    provider,
    start: opts.start ?? (() => void events.push(`start:${provider}`)),
    stop: opts.stop ?? (() => void events.push(`stop:${provider}`)),
    sources: opts.sources ?? (() => [{ label: `.${provider}`, path: `/x/.${provider}`, sessions: 1, ok: true }]),
    transcriptPathOf: (id) => paths[id],
    ...(opts.terminalParser ? { terminalParser: opts.terminalParser } : {}),
  };
}

describe('SourceSet', () => {
  it('fontes, transcript e parser por agente (o da fonte dona; senão o do Claude Code)', () => {
    const claude = fakeSource('claude', { paths: { 'c:1': '/t/c1.jsonl' } });
    const codex = fakeSource('codex', {
      paths: { '.codex:t1': '/t/rollout.jsonl', '.codex:t2': '/t/rollout2.jsonl' },
      terminalParser: (id) => (id === '.codex:t1' ? tagged('cx') : undefined),
      sources: (): SourceInfo[] => [{ label: '.codex', provider: 'codex', path: '/x/.codex', sessions: 2, ok: true }],
    });
    const set = new SourceSet([claude]);
    set.add(codex);
    expect(set.all().map((s) => s.provider)).toEqual(['claude', 'codex']);
    expect(set.of('codex')).toBe(codex);
    expect(set.sources().map((s) => [s.label, s.provider, s.sessions])).toEqual([
      ['.claude', undefined, 1],
      ['.codex', 'codex', 2],
    ]);
    expect(set.transcriptPathOf('c:1')).toBe('/t/c1.jsonl');
    expect(set.transcriptPathOf('.codex:t1')).toBe('/t/rollout.jsonl');
    expect(set.transcriptPathOf('ninguem')).toBeUndefined();

    // Agente do Codex: o parser da fonte dele, um novo a cada chamada.
    const p1 = set.parserFor('.codex:t1');
    const p2 = set.parserFor('.codex:t1');
    expect(p1).not.toBe(p2);
    expect(p1.push('x').map((e) => e.id)).toEqual(['cx-1']);
    expect(p2.push('x').map((e) => e.id)).toEqual(['cx-1']);
    // Fonte sem parser próprio (ou que não devolve um), agente desconhecido: o do Claude Code.
    for (const id of ['c:1', '.codex:t2', 'ninguem']) {
      const entries = set.parserFor(id).push(CLAUDE_LINE);
      expect(entries).toMatchObject([{ kind: 'user', text: 'oi' }]);
    }
  });

  it('start na ordem (as síncronas terminam ali); a falha de uma fonte não derruba as outras', async () => {
    const log: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((ok) => (release = ok));
    const set = new SourceSet([
      fakeSource('claude', { log, start: () => void log.push('start:claude') }),
      fakeSource('codex', {
        log,
        start: () => {
          log.push('start:codex');
          return slow.then(() => void log.push('ready:codex'));
        },
      }),
      fakeSource('codex', {
        start: () => {
          throw new Error('quebrou');
        },
        stop: () => {
          throw new Error('quebrou de novo');
        },
      }),
      fakeSource('codex', { start: () => Promise.reject(new Error('assíncrona quebrou')) }),
    ]);
    const done = set.start();
    // As síncronas já rodaram; a assíncrona segue.
    expect(log).toEqual(['start:claude', 'start:codex']);
    let finished = false;
    void done.then(() => (finished = true));
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await done;
    expect(log).toEqual(['start:claude', 'start:codex', 'ready:codex']);
    expect(() => set.stop()).not.toThrow();
    expect(log.slice(-2)).toEqual(['stop:claude', 'stop:codex']);
  });

  it('boot contado no Office: pronto só quando a fonte assíncrona termina', async () => {
    const office = new Office({
      names: new NameStore(null),
      version: 't',
      startedAt: 0,
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
    });
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const sync = fakeSource('claude', {
      start: () => {
        office.beginBoot();
        office.endBoot();
      },
    });
    const async = fakeSource('codex', {
      start: async () => {
        office.beginBoot();
        try {
          await gate;
        } finally {
          office.endBoot();
        }
      },
    });
    const done = new SourceSet([async, sync]).start();
    expect(office.isBooting()).toBe(true);
    release();
    await done;
    expect(office.isBooting()).toBe(false);
  });
});

// ------------------------------------------------------------------ histórico

const session = (provider: Provider | undefined, account: string, sessionId: string, lastAt: number): RecentSession => {
  const s: RecentSession = { account, sessionId, projectDir: 'p', lastAt, size: 1, open: false };
  if (provider) s.provider = provider;
  return s;
};

function fakeHistory(provider: Provider, accounts: string[], list: () => Promise<RecentSession[]>, resolved?: HistoryResolveResult): HistoryProvider {
  return {
    provider,
    hasAccount: (a) => accounts.includes(a),
    list,
    resolve: (account, sessionId) => resolved ?? { status: 404, error: `${provider}:${account}:${sessionId}` },
  };
}

describe('HistorySet', () => {
  it('junta as listas de todas as ferramentas: da mais recente para a mais antiga, até o limite', async () => {
    const claude = fakeHistory('claude', ['.claude'], async () => [session(undefined, '.claude', 'c2', 50), session(undefined, '.claude', 'c1', 10)]);
    const codex = fakeHistory('codex', ['.codex'], async () => [session('codex', '.codex', 'x1', 30), session('codex', '.codex', 'x0', 5)]);
    expect((await new HistorySet([claude, codex]).list()).map((s) => s.sessionId)).toEqual(['c2', 'x1', 'c1', 'x0']);
    expect((await new HistorySet([claude, codex], 3).list()).map((s) => s.sessionId)).toEqual(['c2', 'x1', 'c1']);
    // Um provedor só: a lista dele, igual.
    expect(await new HistorySet([claude]).list()).toEqual(await claude.list());
    expect(await new HistorySet().list()).toEqual([]);
  });

  it('um provedor que falha fica de fora; todos falhando, a falha sobe', async () => {
    const ok = fakeHistory('claude', ['.claude'], async () => [session(undefined, '.claude', 'c1', 10)]);
    const bad = fakeHistory('codex', ['.codex'], () => Promise.reject(new Error('ilegível')));
    expect((await new HistorySet([ok, bad]).list()).map((s) => s.sessionId)).toEqual(['c1']);
    await expect(new HistorySet([bad]).list()).rejects.toThrow('ilegível');
  });

  it('resolve: pelo provedor da conta; conta desconhecida vai para o primeiro (o do Claude Code)', () => {
    const parser = () => tagged('cx');
    const claude = fakeHistory('claude', ['.claude'], async () => []);
    const codex = fakeHistory('codex', ['.codex'], async () => [], { path: '/r/rollout.jsonl', createParser: parser });
    const set = new HistorySet([claude, codex]);
    expect(set.resolve('.codex', 'abc')).toEqual({ path: '/r/rollout.jsonl', createParser: parser });
    expect(set.resolve('.claude', 'abc')).toEqual({ status: 404, error: 'claude:.claude:abc' });
    expect(set.resolve('.outra', 'abc')).toEqual({ status: 404, error: 'claude:.outra:abc' });
    expect(new HistorySet().resolve('.claude', 'abc')).toEqual({ status: 404, error: 'conta desconhecida' });
  });
});
