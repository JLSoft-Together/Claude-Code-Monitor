// Mensagens ao Codex: o `codex queue` (binário falso que imita as saídas reais; nunca o Codex de verdade), o binário
// pelo HABBLAUD_CODEX_BIN ou PATH, e o registro com o entregador do Codex — modo Node (o servidor roda o comando, uma
// mensagem por vez por agente) e o auxiliar do host (rodada/confirmação), canMessage, prazos e a separação da caixa de
// entrada do plugin do Claude Code. Relógio injetado; dados sintéticos.
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentInfo, OutboxMessage } from '../../shared/types';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { FAKE_CODEX_RUNS, fakeCodexCalls, writeFakeCodex } from '../test/fake-codex';
import { tempDir } from '../test/fixtures';
import { createCodexQueueRunner, findCodexBin, firstLine, queueArgs, type CodexQueueJob, type CodexQueueResult, type CodexQueueRunner } from './codex';
import {
  ERR_CODEX_HOME,
  ERR_CODEX_NOT_FETCHED,
  ERR_CODEX_SLOW,
  ERR_CODEX_UNAVAILABLE,
  ERR_GONE,
  ERR_SESSION_CHANGED,
  MessageRegistry,
  PRESENCE_MS,
  QUEUED_TIMEOUT_MS,
  SENT_TIMEOUT_MS,
  type CodexDeliveryOptions,
  type SendResult,
} from './registry';

setQuiet(true);

const THREAD = '0199b0c0-1234-7abc-8def-0123456789ab';
const GONE_THREAD = '0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';
const SLOW_THREAD = '0199bbbb-0000-7000-8000-000000000000';
const MAIN = `.codex:${THREAD}`;
const OTHER = `.codex:0199b0c0-0000-7abc-8def-0123456789ab`;
const CLAUDE = 'acc:1';

let tmp: ReturnType<typeof tempDir>;
let bin: string;
let log: string;
let codexHome: string;
beforeEach(() => {
  tmp = tempDir();
  bin = writeFakeCodex(tmp.dir);
  log = join(tmp.dir, 'chamadas.log');
  codexHome = join(tmp.dir, '.codex');
  mkdirSync(codexHome);
});
afterEach(() => tmp.cleanup());

const runner = (timeoutMs?: number) => createCodexQueueRunner(bin, { env: { PATH: process.env.PATH, FAKE_CODEX_LOG: log }, timeoutMs });
const job = (over: Partial<CodexQueueJob> = {}): CodexQueueJob => ({ codexHome, thread: THREAD, text: 'oi', ...over });

describe('codex queue (binário falso)', () => {
  it.runIf(FAKE_CODEX_RUNS)('retorno 0 = entrou na fila; argumentos com "=" e o CODEX_HOME da conta; nunca -c/--enable/--disable/--no-daemon', async () => {
    const run = runner();
    expect(await run(job({ text: '-c model="x"\n--no-daemon e mais' }))).toEqual({ ok: true });
    const [call] = fakeCodexCalls(log);
    expect(call).toEqual({ args: ['queue', `--thread=${THREAD}`, '--message=-c model="x"\n--no-daemon e mais'], codexHome });
    expect(queueArgs(THREAD, 'x')).toEqual(['queue', `--thread=${THREAD}`, '--message=x']);
  });

  it.runIf(FAKE_CODEX_RUNS)('erro: a 1ª linha do stderr; prazo esgotado; texto com NUL e thread inválido nem rodam', async () => {
    const run = runner(400);
    const gone = await run(job({ thread: GONE_THREAD }));
    expect(gone).toEqual({ ok: false, error: expect.stringMatching(/^Error: failed to queue session message: .*no rollout found for thread id 0199aaaa/) });
    expect(await run(job({ thread: SLOW_THREAD }))).toEqual({ ok: false, error: 'o codex queue não respondeu em 0 s (a mensagem pode ter entrado na fila mesmo assim)' });
    const before = fakeCodexCalls(log).length;
    expect(await run(job({ text: 'a\u0000b' }))).toEqual({ ok: false, error: 'a mensagem tem caracteres que não dá para mandar ao Codex' });
    expect(await run(job({ thread: 'nome-da-sessao' }))).toEqual({ ok: false, error: 'id de thread do Codex inválido' });
    expect(await run(job({ codexHome: 'relativo' }))).toEqual({ ok: false, error: 'pasta da conta do Codex inválida' });
    expect(fakeCodexCalls(log)).toHaveLength(before);
    expect(await createCodexQueueRunner(join(tmp.dir, 'nao-existe'))(job())).toEqual({ ok: false, error: expect.stringMatching(/^não consegui rodar o Codex/) });
    expect(firstLine('\n  \nError: x\nmais')).toBe('Error: x');
    expect(firstLine('')).toBeUndefined();
  });

  it('findCodexBin: HABBLAUD_CODEX_BIN (se for executável) ou codex no PATH', () => {
    expect(findCodexBin({ HABBLAUD_CODEX_BIN: bin, PATH: '' })).toBe(bin);
    expect(findCodexBin({ HABBLAUD_CODEX_BIN: join(tmp.dir, 'nada'), PATH: tmp.dir })).toBeUndefined();
    expect(findCodexBin({ PATH: ['/nao/existe', 'relativo', tmp.dir].join(delimiter) })).toBe(bin);
    expect(findCodexBin({ PATH: '/nao/existe' })).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')('findCodexBin no Windows: só o codex.exe; os scripts que o npm põe no PATH não rodam sem shell', () => {
    const npm = join(tmp.dir, 'npm');
    mkdirSync(npm);
    for (const f of ['codex', 'codex.cmd', 'codex.ps1']) writeFileSync(join(npm, f), '');
    expect(findCodexBin({ PATH: npm })).toBeUndefined();
    expect(findCodexBin({ PATH: [npm, tmp.dir].join(delimiter) })).toBe(bin);
  });
});

/** Runner controlado pelo teste: cada chamada fica pendente até `finish`. */
function manualRunner(): { run: CodexQueueRunner; jobs: CodexQueueJob[]; finish: (i: number, r: CodexQueueResult) => Promise<void> } {
  const jobs: CodexQueueJob[] = [];
  const done: Array<(r: CodexQueueResult) => void> = [];
  return {
    jobs,
    run: (j) => new Promise((ok) => (jobs.push(j), done.push(ok))),
    finish: async (i, r) => {
      done[i](r);
      await new Promise((ok) => setTimeout(ok, 0));
    },
  };
}

function setup(codex?: Partial<CodexDeliveryOptions> | null) {
  let now = 1_000_000;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  let registry: MessageRegistry | undefined;
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    messages: () => registry?.reachable() ?? new Set(),
    now: clock.now,
  });
  office.addMain({ id: MAIN, provider: 'codex', account: '.codex', sessionId: THREAD, cwd: '/p/loja', role: 'Agente principal', startedAt: 0, status: 'idle' });
  office.addMain({ id: OTHER, provider: 'codex', account: '.codex', sessionId: '0199b0c0-0000-7abc-8def-0123456789ab', cwd: '/p/api', role: 'Agente principal', startedAt: 0, status: 'idle' });
  office.addMain({ id: CLAUDE, account: 'acc', sessionId: THREAD, cwd: '/p/loja', role: 'Agente principal', startedAt: 0, status: 'idle' });
  registry = new MessageRegistry({
    office,
    codex: codex === null ? undefined : { homeOf: (acc) => (acc === '.codex' ? codexHome : undefined), ...codex },
    now: clock.now,
  });
  return { office, registry, clock };
}

const snapAgent = (office: Office, id: string): AgentInfo | undefined => office.commit().snapshot.agents.find((a) => a.id === id);

function sent(r: SendResult): string {
  if (!('message' in r)) throw new Error(`recusada: ${JSON.stringify(r)}`);
  return r.message.id;
}

async function settle(registry: MessageRegistry, id: string): Promise<OutboxMessage> {
  for (let i = 0; i < 200; i++) {
    const m = registry.get(id)!;
    if (m.status === 'delivered' || m.status === 'failed') return m;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  throw new Error('a mensagem não se resolveu');
}

describe('MessageRegistry: Codex no modo Node (o servidor roda o codex queue)', () => {
  it.runIf(FAKE_CODEX_RUNS)('canMessage nos principais do Codex; entrega pelo codex queue com o thread e a pasta da conta; atividade no feed', async () => {
    const { office, registry } = setup({ run: runner() });
    expect(snapAgent(office, MAIN)!.canMessage).toBe(true);
    // O do Claude Code (mesmo id de sessão, por acaso) segue dependendo do plugin.
    expect(snapAgent(office, CLAUDE)!.canMessage).toBeUndefined();
    const r = registry.send({ agentId: MAIN, text: 'roda os testes' });
    expect(r).toMatchObject({ message: { status: 'queued' } });
    const id = sent(r);
    expect(registry.get(id)!.status).toBe('sent');
    expect(await settle(registry, id)).toMatchObject({ status: 'delivered' });
    expect(fakeCodexCalls(log)).toEqual([{ args: ['queue', `--thread=${THREAD}`, '--message=roda os testes'], codexHome }]);
    expect(snapAgent(office, MAIN)!.recent.some((a) => a.text === 'Mensagem pelo Habblaud' && a.detail === 'roda os testes')).toBe(true);
    // A caixa de entrada do plugin nunca entrega mensagens do Codex (nem conhece o agente do Codex).
    expect(registry.inbox({ session: THREAD, account: '.codex' })).toEqual([]);
  });

  it.runIf(FAKE_CODEX_RUNS)('falha do codex queue vira failed com a 1ª linha do stderr', async () => {
    const { office, registry } = setup({ run: runner() });
    office.addMain({ id: `.codex:${GONE_THREAD}`, provider: 'codex', account: '.codex', sessionId: GONE_THREAD, cwd: '/p/x', role: 'Agente principal', startedAt: 0, status: 'idle' });
    const m = await settle(registry, sent(registry.send({ agentId: `.codex:${GONE_THREAD}`, text: 'oi' })));
    expect(m).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Error: .*no rollout found/) });
  });

  it('uma mensagem por vez por agente, na ordem; agentes diferentes em paralelo; nada sai pela rodada do auxiliar', async () => {
    const m = manualRunner();
    const { registry, clock } = setup({ run: m.run });
    const a1 = sent(registry.send({ agentId: MAIN, text: 'um' }));
    const a2 = sent(registry.send({ agentId: MAIN, text: 'dois' }));
    const b1 = sent(registry.send({ agentId: OTHER, text: 'outro' }));
    expect(m.jobs.map((j) => j.text)).toEqual(['um', 'outro']);
    expect(registry.get(a2)!.status).toBe('queued');
    expect(registry.codexPoll({})).toEqual([]);
    await m.finish(0, { ok: true });
    expect(registry.get(a1)!.status).toBe('delivered');
    expect(m.jobs.map((j) => j.text)).toEqual(['um', 'outro', 'dois']);
    await m.finish(2, { ok: false, error: 'Error: recusado' });
    expect(registry.get(a2)).toMatchObject({ status: 'failed', error: 'Error: recusado' });
    // Fila parada atrás de uma entrega lenta: falha no prazo com o motivo do Codex.
    const b2 = sent(registry.send({ agentId: OTHER, text: 'atrás' }));
    clock.advance(QUEUED_TIMEOUT_MS);
    registry.tick();
    expect(registry.get(b2)).toMatchObject({ status: 'failed', error: ERR_CODEX_SLOW });
    expect(registry.get(b1)!.status).toBe('failed');
    // A resposta atrasada ainda corrige a situação (o Codex é quem sabe se entrou).
    await m.finish(1, { ok: true });
    expect(registry.get(b1)!.status).toBe('delivered');
  });

  it('agente que sai: falha; conta sem pasta conhecida: falha sem rodar nada', async () => {
    const m = manualRunner();
    const { office, registry } = setup({ run: m.run, homeOf: () => undefined });
    const id = sent(registry.send({ agentId: MAIN, text: 'oi' }));
    expect(registry.get(id)).toMatchObject({ status: 'failed', error: ERR_CODEX_HOME });
    expect(m.jobs).toEqual([]);
    const s = setup({ run: m.run });
    const id2 = sent(s.registry.send({ agentId: MAIN, text: 'oi' }));
    s.office.setStatus(MAIN, 'offline');
    s.registry.tick();
    expect(s.registry.get(id2)).toMatchObject({ status: 'failed', error: ERR_GONE });
    void office;
  });
});

describe('MessageRegistry: Codex pelo auxiliar do host (Docker)', () => {
  it('uma mensagem por agente por rodada; as seguintes esperam a confirmação sem iniciar o prazo de entrega', () => {
    const { registry, clock } = setup();
    registry.codexPoll({});
    const ids = Array.from({ length: 5 }, (_, i) => sent(registry.send({ agentId: MAIN, text: `mensagem ${i}` })));
    const other = sent(registry.send({ agentId: OTHER, text: 'outro' }));
    expect(registry.codexPoll({}).map((m) => m.id)).toEqual([ids[0], other]);
    expect(ids.map((id) => registry.get(id)!.status)).toEqual(['sent', 'queued', 'queued', 'queued', 'queued']);
    expect(registry.codexPoll({})).toEqual([]);
    clock.advance(8_000);
    registry.codexAck({ results: [{ id: ids[0], ok: true }, { id: other, ok: true }] });
    for (const id of ids.slice(1)) {
      expect(registry.codexPoll({}).map((m) => m.id)).toEqual([id]);
      clock.advance(8_000);
      registry.tick();
      expect(registry.get(id)!.status).toBe('sent');
      registry.codexAck({ results: [{ id, ok: true }] });
    }
    expect(ids.map((id) => registry.get(id)!.status)).toEqual(['delivered', 'delivered', 'delivered', 'delivered', 'delivered']);
    expect(registry.get(other)!.status).toBe('delivered');
  });

  it('sem entregador: o Codex não recebe (com o motivo); subagente do Codex também não', () => {
    let s = setup(null);
    expect(snapAgent(s.office, MAIN)!.canMessage).toBeUndefined();
    expect(s.registry.send({ agentId: MAIN, text: 'oi' })).toEqual({ error: 'unavailable', reason: ERR_CODEX_UNAVAILABLE });
    s = setup();
    expect(s.registry.send({ agentId: MAIN, text: 'oi' })).toEqual({ error: 'unavailable', reason: ERR_CODEX_UNAVAILABLE });
    s.office.addSub({ id: '.codex:sub', parentId: MAIN, sessionId: '0199b0c0-5678-7abc-8def-0123456789ab', role: 'worker', background: false, startedAt: 0 });
    s.registry.codexPoll({});
    expect(s.registry.send({ agentId: '.codex:sub', text: 'oi' })).toMatchObject({ error: 'unavailable', reason: expect.stringMatching(/^subagentes/) });
  });

  it('a rodada marca a presença (canMessage) e entrega com thread e pasta; a confirmação resolve; a presença vence', () => {
    const { office, registry, clock } = setup();
    expect(registry.codexPoll({})).toEqual([]);
    expect(snapAgent(office, MAIN)!.canMessage).toBe(true);
    const a = sent(registry.send({ agentId: MAIN, text: 'um' }));
    const b = sent(registry.send({ agentId: MAIN, text: 'dois' }));
    const c = sent(registry.send({ agentId: OTHER, text: 'três' }));
    const got = registry.codexPoll({});
    expect(got).toEqual([
      { id: a, account: '.codex', codexHome, thread: THREAD, text: 'um' },
      { id: c, account: '.codex', codexHome, thread: '0199b0c0-0000-7abc-8def-0123456789ab', text: 'três' },
    ]);
    expect(registry.get(a)!.status).toBe('sent');
    expect(registry.get(b)!.status).toBe('queued');
    // A caixa de entrada do plugin e a confirmação dele não mexem nas mensagens do Codex.
    expect(registry.inbox({ session: THREAD })).toEqual([]);
    registry.ack({ session: THREAD, results: [{ id: a, ok: true }] });
    expect(registry.get(a)!.status).toBe('sent');
    registry.codexAck({ results: [{ id: a, ok: true }, { id: 'x', ok: true }] });
    expect(registry.get(a)!.status).toBe('delivered');
    expect(registry.codexPoll({})).toEqual([{ id: b, account: '.codex', codexHome, thread: THREAD, text: 'dois' }]);
    registry.codexAck({ results: [{ id: b, ok: false, error: 'Error: no rollout found' }] });
    expect(registry.get(b)).toMatchObject({ status: 'failed', error: 'Error: no rollout found' });
    // Sem confirmação no prazo: falha; a confirmação atrasada corrige.
    clock.advance(SENT_TIMEOUT_MS);
    registry.tick();
    expect(registry.get(c)!.status).toBe('failed');
    registry.codexAck({ results: [{ id: c, ok: true }] });
    expect(registry.get(c)!.status).toBe('delivered');
    clock.advance(PRESENCE_MS);
    registry.tick();
    expect(snapAgent(office, MAIN)!.canMessage).toBeUndefined();
    expect(() => registry.codexAck({})).toThrow();
    expect(() => registry.codexPoll([])).toThrow();
  });

  it('ninguém buscou: falha no prazo com o motivo do auxiliar; agente com outra em entrega espera a vez', () => {
    const { registry, clock } = setup();
    registry.codexPoll({});
    const a = sent(registry.send({ agentId: MAIN, text: 'um' }));
    expect(registry.codexPoll({}).map((m) => m.id)).toEqual([a]);
    const b = sent(registry.send({ agentId: MAIN, text: 'dois' }));
    expect(registry.codexPoll({})).toEqual([]);
    registry.codexAck({ results: [{ id: a, ok: true }] });
    expect(registry.codexPoll({}).map((m) => m.id)).toEqual([b]);
    registry.codexAck({ results: [{ id: b, ok: true }] });
    const c = sent(registry.send({ agentId: MAIN, text: 'três' }));
    clock.advance(QUEUED_TIMEOUT_MS);
    registry.tick();
    expect(registry.get(c)).toMatchObject({ status: 'failed', error: ERR_CODEX_NOT_FETCHED });
  });

  it('troca de thread antes da busca: o auxiliar não recebe a mensagem e ela falha', () => {
    const { office, registry } = setup();
    registry.codexPoll({});
    const id = sent(registry.send({ agentId: MAIN, text: 'para o thread antigo' }));
    office.switchSession(MAIN, '0199b0c0-0000-7abc-8def-0000000000ff');
    expect(registry.codexPoll({})).toEqual([]);
    expect(registry.get(id)).toMatchObject({ status: 'failed', error: ERR_SESSION_CHANGED });
  });
});
