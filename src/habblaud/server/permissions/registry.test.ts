// Registro dos pedidos de permissão (responder pelo escritório): desvio só com páginas abertas e sessão
// conhecida, snapshot (status 'waiting', sem os argumentos), decisões, esperas do hook, órfãos, expiração,
// agente que saiu, resposta no terminal (tool_result no transcript), sugestões "sempre permitir" e as
// perguntas do AskUserQuestion (respostas por posição). Tudo com dados sintéticos.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { appendLines, L, tempDir, writeLines } from '../test/fixtures';
import { EXPIRY_GRACE_MS, parseDecision, pickSuggestions, PermissionRegistry, UNWATCHED_MS, type WaitResult } from './registry';
import { callSignature, scanToolCall } from './transcript';

setQuiet(true);

const MAIN = 'acc:1';
const SESSION = 'sess-1';
const SUB = `${SESSION}:a1b2c3`;

function setup(opts: { viewers?: number; transcript?: string; orphanMs?: number; answerLater?: boolean } = {}) {
  let now = 1_000_000;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  let permissions: PermissionRegistry | undefined;
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    permissions: () => permissions?.snapshot() ?? new Map(),
    now: clock.now,
  });
  office.addMain({ id: MAIN, account: 'acc', sessionId: SESSION, cwd: '/p/loja', role: 'Agente principal', startedAt: 0, status: 'working' });
  let viewers = opts.viewers ?? 1;
  const paths = new Map<string, string>();
  if (opts.transcript) paths.set(MAIN, opts.transcript);
  permissions = new PermissionRegistry({
    office,
    viewers: () => viewers,
    answerLater: () => !!opts.answerLater,
    transcriptPathOf: (id) => paths.get(id),
    now: clock.now,
    orphanMs: opts.orphanMs,
  });
  return { office, registry: permissions, clock, paths, setViewers: (n: number) => (viewers = n) };
}

function hookInput(over: Record<string, unknown> = {}) {
  return {
    session_id: SESSION,
    cwd: '/p/loja',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test', description: 'Rodar os testes' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }],
    timeout_ms: 60_000,
    ...over,
  };
}

const snapAgent = (office: Office, id: string) => office.commit().snapshot.agents.find((a) => a.id === id);

function registered(r: ReturnType<PermissionRegistry['register']>): string {
  if ('skip' in r) throw new Error(`pulou: ${r.skip}`);
  return r.id;
}

/**
 * tool_input de um AskUserQuestion: a entrada 1 é inválida (pulada; as posições contam no original), um segredo
 * na primeira pergunta e uma opção sem rótulo na segunda.
 */
const ASK_INPUT = {
  questions: [
    { question: 'Qual banco usar? (Authorization: Bearer abcdef123456)', header: 'Banco', multiSelect: false, options: [{ label: 'Postgres', description: 'Já usado no projeto' }, { label: 'SQLite' }] },
    'lixo',
    { question: 'Quais testes rodar?', header: 'Testes', multiSelect: true, options: [{ label: 'Unidade' }, { label: '' }, { label: 'E2E' }] },
  ],
};

const askInput = (over: Record<string, unknown> = {}) => hookInput({ tool_name: 'AskUserQuestion', tool_input: ASK_INPUT, permission_suggestions: [], ...over });

describe('PermissionRegistry: registro', () => {
  it('sem página local aberta, com sessão desconhecida ou AskUserQuestion sem perguntas para mostrar: não desvia (skip)', () => {
    const { registry, setViewers } = setup({ viewers: 0 });
    expect(registry.register(hookInput())).toEqual({ skip: 'no-viewers' });
    setViewers(2);
    expect(registry.register(hookInput({ session_id: 'outra' }))).toEqual({ skip: 'unknown-session' });
    expect(registry.register(hookInput({ tool_name: 'AskUserQuestion' }))).toEqual({ skip: 'unsupported-tool' });
    expect(registry.register(askInput({ tool_input: { questions: [] } }))).toEqual({ skip: 'unsupported-tool' });
    // Mais perguntas do que o escritório mostra: o hook não conseguiria responder todas.
    const five = Array.from({ length: 5 }, (_, i) => ({ question: `Pergunta ${i}?`, options: [{ label: 'Sim' }, { label: 'Não' }] }));
    expect(registry.register(askInput({ tool_input: { questions: five } }))).toEqual({ skip: 'unsupported-tool' });
    expect(registry.size).toBe(0);
  });

  it('corpo inválido lança (vira 400 na rota)', () => {
    const { registry } = setup();
    expect(() => registry.register({})).toThrow(/session_id/);
    expect(() => registry.register(null)).toThrow();
    expect(() => registry.register({ session_id: SESSION })).toThrow();
  });

  it('publica no snapshot: status waiting, título e resumo, sugestão, SEM os argumentos; feed e aviso', () => {
    const { office, registry, clock } = setup();
    office.commit();
    const r = registry.register(hookInput({ tool_input: { command: 'curl -H "Authorization: Bearer abcdef123456" https://api.x' } }));
    const id = registered(r);
    expect('expiresAt' in r && r.expiresAt).toBe(clock.now() + 60_000 + EXPIRY_GRACE_MS);
    const commit = office.commit();
    const a = commit.snapshot.agents.find((x) => x.id === MAIN)!;
    expect(a.status).toBe('waiting');
    expect(a.waitingFor).toBe('aprovar uma permissão');
    expect(a.permission).toMatchObject({ id, tool: 'Bash', createdAt: clock.now(), expiresAt: clock.now() + 60_000 });
    expect(a.permission!.title).toMatch(/^Bash\(curl/);
    expect(a.permission!.title).not.toContain('abcdef123456');
    expect(a.permission!.input).toBeUndefined();
    expect(a.permission!.suggestions).toEqual([{ index: 0, rules: ['Bash(npm test:*)'], destination: 'localSettings' }]);
    // Detalhe (com acesso local): os argumentos, mascarados.
    const d = registry.detail(id)!;
    expect(d.inputKind).toBe('command');
    expect(d.input).toContain('Authorization: ***');
    expect(d.input).not.toContain('abcdef123456');
    // Feed e aviso.
    expect(commit.feed.map((f) => f.activity.text)).toEqual([expect.stringMatching(/^Pede permissão:/)]);
    expect(commit.notices.map((n) => n.text)).toEqual([expect.stringMatching(/^🔐 .+ pede permissão em loja:/)]);
    expect(commit.notices[0]).toMatchObject({ level: 'alert', agentId: MAIN });
  });

  it('subagente acompanhado recebe o pedido; desconhecido vai para o principal com o tipo', () => {
    const { office, registry } = setup();
    office.addSub({ id: SUB, parentId: MAIN, sessionId: SESSION, role: 'Explore', background: true, startedAt: 0 });
    const a = registered(registry.register(hookInput({ agent_id: 'a1b2c3', agent_type: 'Explore' })));
    const b = registered(registry.register(hookInput({ agent_id: 'zzz', agent_type: 'Plan', tool_input: { command: 'ls' } })));
    const snap = office.commit().snapshot;
    const sub = snap.agents.find((x) => x.id === SUB)!;
    expect(sub.status).toBe('waiting');
    expect(sub.permission?.id).toBe(a);
    expect(sub.permission?.subagent).toBeUndefined();
    const main = snap.agents.find((x) => x.id === MAIN)!;
    expect(main.permission).toMatchObject({ id: b, subagent: 'Plan' });
  });

  it('vários pedidos do mesmo agente: o mais antigo no snapshot, com quantos esperam depois', () => {
    const { office, registry, clock } = setup();
    const first = registered(registry.register(hookInput()));
    clock.advance(10);
    const second = registered(registry.register(hookInput({ tool_input: { command: 'npm run build' } })));
    expect(snapAgent(office, MAIN)!.permission).toMatchObject({ id: first, queued: 1 });
    expect(registry.detail(first)!.queued).toBe(1);
    expect(registry.detail(second)!.queued).toBeUndefined();
    expect(registry.decide(first, { behavior: 'allow' })).toBe('ok');
    expect(snapAgent(office, MAIN)!.permission).toMatchObject({ id: second });
    expect(snapAgent(office, MAIN)!.permission!.queued).toBeUndefined();
  });

  it('pedidos do mesmo agente no mesmo milissegundo: só o primeiro tem outros esperando', () => {
    const { registry } = setup();
    const first = registered(registry.register(hookInput()));
    const second = registered(registry.register(hookInput({ tool_input: { command: 'npm run build' } }))); // sem avançar o relógio
    expect(registry.detail(first)!.queued).toBe(1);
    expect(registry.detail(second)!.queued).toBeUndefined();
  });

  it('limite de pedidos abertos', () => {
    const { office } = setup();
    const r = new PermissionRegistry({ office, viewers: () => 1, maxPending: 2 });
    registered(r.register(hookInput()));
    registered(r.register(hookInput()));
    expect(r.register(hookInput())).toEqual({ skip: 'too-many' });
  });
});

describe('PermissionRegistry: decisões e esperas do hook', () => {
  it('aprovar entrega a decisão a quem espera e tira o pedido do snapshot (o status volta)', async () => {
    const { office, registry } = setup();
    const id = registered(registry.register(hookInput()));
    const w = registry.wait(id, 25_000)!;
    expect(registry.decide(id, { behavior: 'allow', suggestion: 0 })).toBe('ok');
    await expect(w.result).resolves.toEqual({ status: 'decided', behavior: 'allow', suggestion: 0 });
    const a = snapAgent(office, MAIN)!;
    expect(a.permission).toBeUndefined();
    expect(a.status).toBe('working');
    expect(registry.wait(id, 10)).toBeUndefined();
    expect(registry.decide(id, { behavior: 'deny' })).toBe('not-found');
    expect(office.detail(MAIN)!.history.map((h) => h.text)).toContain('Aprovado no Habblaud (sempre permitir)');
  });

  it('recusa com motivo e interrupção; decisão sem ninguém esperando fica guardada para a próxima espera', async () => {
    const { registry } = setup();
    const id = registered(registry.register(hookInput()));
    expect(registry.decide(id, { behavior: 'deny', message: 'use pnpm', interrupt: true })).toBe('ok');
    expect(registry.decide(id, { behavior: 'allow' })).toBe('conflict');
    await expect(registry.wait(id, 25_000)!.result).resolves.toEqual({ status: 'decided', behavior: 'deny', message: 'use pnpm', interrupt: true });
    // Entregue: some.
    expect(registry.wait(id, 10)).toBeUndefined();
  });

  it('"responder no terminal" libera o hook sem decisão', async () => {
    const { office, registry } = setup();
    const id = registered(registry.register(hookInput()));
    const w = registry.wait(id, 25_000)!;
    expect(registry.decide(id, { behavior: 'terminal' })).toBe('ok');
    await expect(w.result).resolves.toEqual({ status: 'released', reason: 'terminal' });
    expect(snapAgent(office, MAIN)!.permission).toBeUndefined();
  });

  it('sugestão que não existe no pedido: inválida', () => {
    const { registry } = setup();
    const id = registered(registry.register(hookInput({ permission_suggestions: [] })));
    expect(registry.decide(id, { behavior: 'allow', suggestion: 0 })).toBe('invalid');
    expect(registry.decide(id, { behavior: 'allow' })).toBe('ok');
  });

  it('espera sem decisão responde "pending" no tempo pedido', async () => {
    const { registry } = setup();
    const id = registered(registry.register(hookInput()));
    const t0 = Date.now();
    await expect(registry.wait(id, 30)!.result).resolves.toEqual({ status: 'pending' });
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe('PermissionRegistry: perguntas (AskUserQuestion)', () => {
  it('publica as perguntas com as posições do original (mascaradas): espera "responder uma pergunta"; feed e aviso de pergunta', () => {
    const { office, registry } = setup();
    office.commit();
    const id = registered(registry.register(askInput()));
    const commit = office.commit();
    const a = commit.snapshot.agents.find((x) => x.id === MAIN)!;
    expect(a).toMatchObject({ status: 'waiting', waitingFor: 'responder uma pergunta' });
    expect(a.permission).toMatchObject({ id, tool: 'AskUserQuestion', icon: '❓' });
    expect(a.permission!.suggestions).toBeUndefined();
    const qs = a.permission!.questions!;
    expect(qs.map((q) => q.index)).toEqual([0, 2]);
    expect(qs[0]!.question).not.toContain('abcdef123456');
    expect(qs[0]!.multiSelect).toBeUndefined();
    expect(qs[1]).toMatchObject({ header: 'Testes', multiSelect: true, options: [{ index: 0, label: 'Unidade' }, { index: 2, label: 'E2E' }] });
    expect(commit.feed.map((f) => f.activity)).toEqual([expect.objectContaining({ icon: '❓', text: expect.stringMatching(/^Pergunta: Qual banco usar\?/) })]);
    expect(commit.notices.map((n) => n.text)).toEqual([expect.stringMatching(/^❓ .+ tem uma pergunta em loja: Qual banco usar\?/)]);
    expect(commit.notices[0]!.text).not.toContain('abcdef123456');
  });

  it('responder: a espera recebe as respostas por posição (normalizadas) e a linha do tempo ganha o resumo', async () => {
    const { office, registry } = setup();
    const id = registered(registry.register(askInput()));
    const w = registry.wait(id, 25_000)!;
    const d = parseDecision({ behavior: 'answer', answers: [{ question: 2, options: [2, 0], other: '  lint  ' }, { question: 0, options: [1] }] })!;
    expect(registry.decide(id, d)).toBe('ok');
    await expect(w.result).resolves.toEqual({
      status: 'decided',
      behavior: 'answer',
      answers: [
        { question: 0, options: [1] },
        { question: 2, options: [0, 2], other: 'lint' },
      ],
    });
    const a = snapAgent(office, MAIN)!;
    expect(a.permission).toBeUndefined();
    expect(a.status).toBe('working');
    const act = office.detail(MAIN)!.history.find((h) => h.text === 'Respondido no Habblaud')!;
    expect(act).toMatchObject({ icon: '💬', kind: 'other' });
    expect(act.detail).toBe('Banco: SQLite · Testes: Unidade, E2E, “lint”');
    expect(registry.decide(id, d)).toBe('not-found');
  });

  it('respostas que não batem com as perguntas, aprovar uma pergunta ou responder uma permissão: inválidas (o pedido segue aberto)', () => {
    const { registry } = setup();
    const id = registered(registry.register(askInput()));
    const answer = (answers: unknown) => registry.decide(id, parseDecision({ behavior: 'answer', answers })!);
    const multi = { question: 2, options: [0] };
    expect(registry.decide(id, { behavior: 'allow' })).toBe('invalid-answer');
    expect(answer([{ question: 0, options: [0] }])).toBe('invalid-answer'); // falta uma pergunta
    expect(answer([{ question: 0, options: [0, 1] }, multi])).toBe('invalid-answer'); // escolha única com duas
    expect(answer([{ question: 0, options: [0], other: 'e mais' }, multi])).toBe('invalid-answer');
    expect(answer([{ question: 0, options: [0] }, { question: 2, options: [1] }])).toBe('invalid-answer'); // opção sem rótulo
    expect(answer([{ question: 0, options: [0] }, { question: 2, options: [7] }])).toBe('invalid-answer');
    expect(answer([{ question: 0, options: [0] }, { question: 1, options: [0] }])).toBe('invalid-answer'); // entrada inválida
    expect(answer([{ question: 0, options: [0] }, { question: 2 }])).toBe('invalid-answer'); // várias, mas nenhuma
    expect(registry.size).toBe(1);
    const bash = registered(registry.register(hookInput()));
    expect(registry.decide(bash, { behavior: 'answer', answers: [{ question: 0, options: [0] }] })).toBe('invalid-answer');
    // Recusar (não responder) e devolver ao terminal valem para a pergunta.
    expect(registry.decide(id, { behavior: 'deny', message: 'decida você' })).toBe('ok');
  });

  it('respondida no terminal: o principal deixa de esperar (plano B; a chamada só vai ao transcript com a resposta)', async () => {
    const { office, registry, clock } = setup();
    const id = registered(registry.register(askInput()));
    const w = registry.wait(id, 25_000)!;
    office.setStatus(MAIN, 'waiting', 'responder uma pergunta');
    registry.tick();
    office.setStatus(MAIN, 'working');
    registry.tick();
    expect(registry.size).toBe(1);
    clock.advance(3_100);
    registry.tick();
    await expect(w.result).resolves.toEqual({ status: 'released', reason: 'answered' });
  });
});

describe('PermissionRegistry: pedidos órfãos', () => {
  it('hook que some (ninguém esperando por ORPHAN_MS) e tempo limite do hook', async () => {
    const { office, registry, clock } = setup({ orphanMs: 8_000 });
    const orphan = registered(registry.register(hookInput()));
    clock.advance(7_000);
    registry.tick();
    expect(snapAgent(office, MAIN)!.permission?.id).toBe(orphan);
    clock.advance(1_500);
    registry.tick();
    expect(snapAgent(office, MAIN)!.permission).toBeUndefined();
    await expect(registry.wait(orphan, 10)!.result).resolves.toEqual({ status: 'released', reason: 'orphan' });

    const late = registered(registry.register(hookInput()));
    const w = registry.wait(late, 25_000)!;
    clock.advance(60_000 + EXPIRY_GRACE_MS);
    registry.tick();
    await expect(w.result).resolves.toEqual({ status: 'released', reason: 'expired' });
  });

  it('espera cancelada (conexão fechada) conta para o órfão; agente que saiu libera o hook', async () => {
    const { office, registry, clock } = setup();
    const id = registered(registry.register(hookInput()));
    const w = registry.wait(id, 25_000)!;
    clock.advance(20_000);
    registry.tick();
    expect(registry.size).toBe(1);
    w.cancel();
    const w2 = registry.wait(id, 25_000)!;
    office.closeMain(MAIN);
    registry.tick();
    await expect(w2.result).resolves.toEqual({ status: 'released', reason: 'gone' });
  });

  it('espera longa sem nenhuma página que responda: volta ao terminal depois de UNWATCHED_MS (a espera padrão não muda)', async () => {
    const { registry, clock, setViewers } = setup({ orphanMs: 60 * 60_000 });
    const long = registered(registry.register(hookInput({ timeout_ms: 86_400_000 })));
    const short = registered(registry.register(hookInput({ timeout_ms: 300_000, tool_input: { command: 'ls' } })));
    const w = registry.wait(long, 25_000)!;
    setViewers(0);
    registry.tick();
    clock.advance(UNWATCHED_MS - 1_000);
    registry.tick();
    expect(registry.size).toBe(2);
    clock.advance(2_000);
    registry.tick();
    await expect(w.result).resolves.toEqual({ status: 'released', reason: 'unwatched' });
    // O pedido com a espera padrão (5 min) segue até o tempo dele.
    await expect(registry.wait(short, 10)!.result).resolves.not.toEqual({ status: 'released', reason: 'unwatched' });
  });

  it('espera longa com celular que pode entrar depois (porta remota com permissions): continua esperando', () => {
    const { registry, clock, setViewers } = setup({ orphanMs: 60 * 60_000, answerLater: true });
    registered(registry.register(hookInput({ timeout_ms: 86_400_000 })));
    setViewers(0);
    registry.tick();
    clock.advance(UNWATCHED_MS * 3);
    registry.tick();
    expect(registry.size).toBe(1);
  });

  it('decisões não buscadas são esquecidas depois de um tempo', () => {
    const { registry, clock } = setup();
    const id = registered(registry.register(hookInput()));
    registry.decide(id, { behavior: 'allow' });
    clock.advance(31_000);
    registry.tick();
    expect(registry.wait(id, 10)).toBeUndefined();
  });

  it('respondido no terminal: o tool_result da chamada aparece no transcript', async () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'sess-1.jsonl');
      const at = 1_000_000;
      // Uma chamada igual, antiga e já respondida, não conta.
      writeLines(file, [
        L.assistant([L.tool('toolu_old', 'Bash', { command: 'npm test' })], { at: at - 60_000 }),
        L.result('toolu_old', 'ok', { at: at - 59_000 }),
      ]);
      const { office, registry, clock } = setup({ transcript: file });
      const id = registered(registry.register(hookInput()));
      const w = registry.wait(id, 25_000)!;
      clock.advance(1_100);
      registry.tick();
      expect(registry.size).toBe(1);
      appendLines(file, [L.assistant([L.tool('toolu_new', 'Bash', { command: 'npm test', description: 'x' })], { at })]);
      clock.advance(1_100);
      registry.tick();
      expect(registry.size).toBe(1);
      appendLines(file, [L.result('toolu_new', 'The user doesn\'t want to proceed', { at: at + 2_000, error: true })]);
      clock.advance(1_100);
      registry.tick();
      await expect(w.result).resolves.toEqual({ status: 'released', reason: 'answered' });
      expect(snapAgent(office, MAIN)!.permission).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });

  it('plano B (chamada não achada no transcript): o principal esperou e deixou de esperar no registro', async () => {
    const { office, registry, clock } = setup();
    const id = registered(registry.register(hookInput()));
    const w = registry.wait(id, 25_000)!;
    // Ainda não esperou: "trabalhando" não conta.
    clock.advance(4_000);
    registry.tick();
    expect(registry.size).toBe(1);
    office.setStatus(MAIN, 'waiting', 'aprovar uma permissão');
    registry.tick();
    office.setStatus(MAIN, 'working');
    clock.advance(500);
    registry.tick();
    clock.advance(2_000);
    registry.tick();
    expect(registry.size).toBe(1);
    clock.advance(1_100);
    registry.tick();
    await expect(w.result).resolves.toEqual({ status: 'released', reason: 'answered' });
  });

  it('com a chamada achada no transcript, só o tool_result vale (pedidos em sequência passam por "busy")', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'sess-1.jsonl');
      writeLines(file, [L.assistant([L.tool('toolu_x', 'Bash', { command: 'npm test' })], { at: 1_000_000 })]);
      const { office, registry, clock } = setup({ transcript: file });
      registered(registry.register(hookInput()));
      office.setStatus(MAIN, 'waiting', 'aprovar uma permissão');
      registry.tick();
      office.setStatus(MAIN, 'working');
      clock.advance(5_000);
      registry.tick();
      expect(registry.size).toBe(1);
    } finally {
      tmp.cleanup();
    }
  });

  it('stop libera quem espera', async () => {
    const { registry } = setup();
    const id = registered(registry.register(hookInput()));
    const w = registry.wait(id, 25_000)!;
    registry.stop();
    await expect(w.result).resolves.toEqual<WaitResult>({ status: 'released', reason: 'shutdown' });
  });
});

describe('peças puras', () => {
  it('pickSuggestions: só addRules/allow em destino conhecido, com a posição original', () => {
    expect(
      pickSuggestions([
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git status:*' }, { toolName: 'Read' }], behavior: 'allow', destination: 'session' },
        { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'deny', destination: 'localSettings' },
        { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'policySettings' },
        { type: 'addRules', rules: [], behavior: 'allow', destination: 'userSettings' },
      ]),
    ).toEqual([{ index: 1, rules: ['Bash(git status:*)', 'Read'], destination: 'session' }]);
    expect(pickSuggestions(undefined)).toEqual([]);
  });

  it('parseDecision', () => {
    expect(parseDecision({ behavior: 'allow' })).toEqual({ behavior: 'allow' });
    expect(parseDecision({ behavior: 'deny', message: '  não  ', interrupt: true })).toEqual({ behavior: 'deny', message: 'não', interrupt: true });
    expect(parseDecision({ behavior: 'terminal', message: 'x' })).toEqual({ behavior: 'terminal' });
    expect(parseDecision({ behavior: 'allow', suggestion: 2 })).toEqual({ behavior: 'allow', suggestion: 2 });
    expect(parseDecision({ behavior: 'allow', suggestion: -1 })).toBeUndefined();
    expect(parseDecision({ behavior: 'allow', suggestion: '1' })).toBeUndefined();
    expect(parseDecision({ behavior: 'yes' })).toBeUndefined();
    expect(parseDecision(null)).toBeUndefined();
  });

  it('parseDecision: answer (posições inteiras, opções distintas em ordem, texto livre aparado até 2.000)', () => {
    expect(parseDecision({ behavior: 'answer', answers: [{ question: 1, options: [3, 0], other: '  x  ', extra: 1 }, { question: 0, options: [], other: ' ' }], message: 'ignorado' })).toEqual({
      behavior: 'answer',
      answers: [{ question: 1, options: [0, 3], other: 'x' }, { question: 0 }],
    });
    const bad: unknown[] = [
      { behavior: 'answer' },
      { behavior: 'answer', answers: [] },
      { behavior: 'answer', answers: Array.from({ length: 5 }, (_, i) => ({ question: i, options: [0] })) },
      { behavior: 'answer', answers: [{ options: [0] }] },
      { behavior: 'answer', answers: [{ question: -1, options: [0] }] },
      { behavior: 'answer', answers: [{ question: 0.5, options: [0] }] },
      { behavior: 'answer', answers: [{ question: 0, options: [1, 1] }] },
      { behavior: 'answer', answers: [{ question: 0, options: ['1'] }] },
      { behavior: 'answer', answers: [{ question: 0, options: 1 }] },
      { behavior: 'answer', answers: [{ question: 0, other: 3 }] },
      { behavior: 'answer', answers: [{ question: 0, other: 'x'.repeat(2_001) }] },
      { behavior: 'answer', answers: ['x'] },
    ];
    for (const b of bad) expect(parseDecision(b), JSON.stringify(b).slice(0, 80)).toBeUndefined();
    expect(parseDecision({ behavior: 'answer', answers: [{ question: 0, other: ` ${'x'.repeat(2_000)} ` }] })).toBeDefined();
  });

  it('callSignature: o argumento principal das ferramentas conhecidas, o resto inteiro', () => {
    expect(callSignature('Bash', { command: 'ls', description: 'a' })).toBe(callSignature('Bash', { command: 'ls', timeout: 5 }));
    expect(callSignature('Edit', { file_path: '/a.ts', old_string: 'x' })).toBe(callSignature('Edit', { file_path: '/a.ts', replace_all: false }));
    expect(callSignature('mcp__x__y', { b: 1, a: 'z' })).toBe(callSignature('mcp__x__y', { a: 'z', b: 1 }));
    expect(callSignature('mcp__x__y', { a: 'z' })).not.toBe(callSignature('mcp__x__y', { a: 'w' }));
  });

  it('scanToolCall: chamada mais recente sem resultado; com o id, só confere o resultado', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 't.jsonl');
      const at = 5_000_000;
      writeLines(file, [L.assistant([L.tool('t1', 'Bash', { command: 'ls' })], { at }), 'linha quebrada {', L.assistant([L.tool('t2', 'Bash', { command: 'ls' })], { at: at + 1 })]);
      const sig = callSignature('Bash', { command: 'ls' });
      expect(scanToolCall(file, { tool: 'Bash', signature: sig, createdAt: at })).toEqual({ toolUseId: 't2', answered: false });
      appendLines(file, [L.result('t2', 'ok', { at: at + 2 })]);
      expect(scanToolCall(file, { tool: 'Bash', signature: sig, knownId: 't2', createdAt: at })).toEqual({ toolUseId: 't2', answered: true });
      // Muito antes do pedido: não é candidata.
      expect(scanToolCall(file, { tool: 'Bash', signature: sig, createdAt: at + 3_600_000 })).toEqual({ answered: false });
    } finally {
      tmp.cleanup();
    }
  });
});
