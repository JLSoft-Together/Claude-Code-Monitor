// Registro das mensagens pelo escritório: presença das sessões (canMessage no snapshot), validação, limites, entrega
// ao plugin, confirmação, prazos, agente que sai, limpeza das resolvidas e a entrega fictícia do demo.
// Tudo com dados sintéticos e relógio injetado.
import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../shared/types';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import {
  ERR_GONE,
  ERR_NOT_CONFIRMED,
  ERR_NOT_FETCHED,
  ERR_REFUSED,
  ERR_SESSION_CHANGED,
  INBOX_BATCH,
  KEEP_MS,
  MAX_OPEN,
  MessageRegistry,
  PRESENCE_MS,
  QUEUED_TIMEOUT_MS,
  SENT_TIMEOUT_MS,
  type SendResult,
} from './registry';

setQuiet(true);

const MAIN = 'acc:1';
const SESSION = 'sess-1';
const OTHER = 'acc:2';
const SUB = `${SESSION}:a1b2c3`;

function setup() {
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
  office.addMain({ id: MAIN, account: 'acc', sessionId: SESSION, cwd: '/p/loja', role: 'Agente principal', startedAt: 0, status: 'idle' });
  office.addMain({ id: OTHER, account: 'acc', sessionId: 'sess-2', cwd: '/p/api', role: 'Agente principal', startedAt: 0, status: 'idle' });
  registry = new MessageRegistry({
    office,
    demoAgent: (id) => office.demoAgent(id),
    demoDeliver: (id, text) => office.deliverDemoMessage(id, text),
    now: clock.now,
  });
  return { office, registry, clock };
}

const snapAgent = (office: Office, id: string): AgentInfo | undefined => office.commit().snapshot.agents.find((a) => a.id === id);

function sent(r: SendResult): string {
  if (!('message' in r)) throw new Error(`recusada: ${JSON.stringify(r)}`);
  return r.message.id;
}

describe('MessageRegistry: presença', () => {
  it('a sessão que pergunta pela caixa de entrada passa a receber mensagens (canMessage) e o snapshot muda só na transição', () => {
    const { office, registry, clock } = setup();
    expect(snapAgent(office, MAIN)?.canMessage).toBeUndefined();
    expect(office.commit().changed).toBe(false);

    expect(registry.inbox({ session: SESSION, account: 'acc' })).toEqual([]);
    expect(registry.canMessage(MAIN)).toBe(true);
    expect(registry.reachable()).toEqual(new Set([MAIN]));
    const c1 = office.commit();
    expect(c1.changed).toBe(true);
    expect(c1.snapshot.agents.find((a) => a.id === MAIN)?.canMessage).toBe(true);
    expect(c1.snapshot.agents.find((a) => a.id === OTHER)?.canMessage).toBeUndefined();
    expect(c1.snapshot.meta.messages).toBe(true);

    // A rodada seguinte (2 s depois) não mexe no snapshot.
    clock.advance(2_000);
    registry.inbox({ session: SESSION });
    registry.tick();
    expect(office.commit().changed).toBe(false);

    // Sem rodada por PRESENCE_MS: volta a não receber.
    clock.advance(PRESENCE_MS);
    expect(registry.canMessage(MAIN)).toBe(false);
    registry.tick();
    const c2 = office.commit();
    expect(c2.changed).toBe(true);
    expect(c2.snapshot.agents.find((a) => a.id === MAIN)?.canMessage).toBeUndefined();
  });

  it('sessão desconhecida, de outra conta, de quem saiu ou corpo inválido: nenhuma presença', () => {
    const { office, registry } = setup();
    expect(registry.inbox({ session: 'nao-existe' })).toEqual([]);
    expect(registry.inbox({ session: SESSION, account: 'outra-conta' })).toEqual([]);
    expect(registry.canMessage(MAIN)).toBe(false);
    office.closeMain(OTHER);
    expect(registry.inbox({ session: 'sess-2' })).toEqual([]);
    expect(registry.canMessage(OTHER)).toBe(false);
    for (const bad of [null, {}, { session: '' }, { session: 42 }, []]) expect(() => registry.inbox(bad)).toThrow(/session/);
  });

  it('subagente nunca recebe (mesma sessão do principal: a presença vai para o principal)', () => {
    const { office, registry } = setup();
    office.addSub({ id: SUB, parentId: MAIN, sessionId: SESSION, role: 'Explore', background: false, startedAt: 0 });
    registry.inbox({ session: SESSION });
    const snap = office.commit().snapshot;
    expect(snap.agents.find((a) => a.id === MAIN)?.canMessage).toBe(true);
    expect(snap.agents.find((a) => a.id === SUB)?.canMessage).toBeUndefined();
    expect(registry.send({ agentId: SUB, text: 'oi' })).toEqual({ error: 'unavailable', reason: expect.stringMatching(/subagentes/) });
  });
});

describe('MessageRegistry: mandar', () => {
  it('valida o corpo: agentId e texto, vazio e acima de 20.000 caracteres', () => {
    const { registry } = setup();
    registry.inbox({ session: SESSION });
    for (const bad of [null, {}, { agentId: MAIN }, { text: 'oi' }, { agentId: MAIN, text: 3 }]) expect(() => registry.send(bad)).toThrow(/agentId/);
    expect(() => registry.send({ agentId: MAIN, text: '  \n ' })).toThrow(/vazia/);
    expect(() => registry.send({ agentId: MAIN, text: 'x'.repeat(20_001) })).toThrow(/20\.000/);
    expect('message' in registry.send({ agentId: MAIN, text: 'x'.repeat(20_000) })).toBe(true);
  });

  it('agente desconhecido (not-found), sem o plugin conectado ou que saiu (unavailable, com o motivo)', () => {
    const { office, registry } = setup();
    expect(registry.send({ agentId: 'nao-existe', text: 'oi' })).toEqual({ error: 'not-found' });
    expect(registry.send({ agentId: MAIN, text: 'oi' })).toEqual({ error: 'unavailable', reason: expect.stringMatching(/habblaud-mensagens/) });
    registry.inbox({ session: SESSION });
    office.closeMain(MAIN);
    expect(registry.send({ agentId: MAIN, text: 'oi' })).toEqual({ error: 'unavailable', reason: expect.stringMatching(/saiu/) });
  });

  it(`no máximo ${MAX_OPEN} mensagens não resolvidas por agente (too-many); resolvidas não contam`, () => {
    const { registry } = setup();
    registry.inbox({ session: SESSION });
    registry.inbox({ session: 'sess-2' });
    const ids = Array.from({ length: MAX_OPEN }, (_, i) => sent(registry.send({ agentId: MAIN, text: `m${i}` })));
    expect(registry.send({ agentId: MAIN, text: 'demais' })).toEqual({ error: 'too-many' });
    // Outro agente tem a própria fila.
    expect('message' in registry.send({ agentId: OTHER, text: 'oi' })).toBe(true);
    const batch = registry.inbox({ session: SESSION });
    registry.ack({ session: SESSION, results: [{ id: batch[0].id, ok: true }] });
    expect(registry.get(ids[0])?.status).toBe('delivered');
    expect('message' in registry.send({ agentId: MAIN, text: 'agora cabe' })).toBe(true);
  });

  it('a resposta (201/GET) é só a situação: o texto nunca sai para a página', () => {
    const { registry, clock } = setup();
    registry.inbox({ session: SESSION });
    const r = registry.send({ agentId: MAIN, text: 'segredo do usuário' });
    expect(r).toEqual({ message: { id: expect.stringMatching(/^m-/), agentId: MAIN, status: 'queued', createdAt: clock.now(), updatedAt: clock.now() } });
    const id = sent(r);
    expect(JSON.stringify(registry.get(id))).not.toContain('segredo');
  });
});

describe('MessageRegistry: entrega pelo plugin', () => {
  it('a rodada entrega as mensagens do próprio agente na ordem (até 5) com o texto como foi digitado e marca sent', () => {
    const { registry, clock } = setup();
    registry.inbox({ session: SESSION });
    registry.inbox({ session: 'sess-2' });
    const text = '  Use a chave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 no .env\n\ne rode `npm test`  ';
    const first = sent(registry.send({ agentId: MAIN, text }));
    const others = [1, 2, 3, 4].map((i) => sent(registry.send({ agentId: MAIN, text: `m${i}` })));
    sent(registry.send({ agentId: OTHER, text: 'para o outro' }));
    clock.advance(500);

    const batch = registry.inbox({ session: SESSION });
    expect(batch.length).toBe(INBOX_BATCH);
    expect(batch[0]).toEqual({ id: first, text });
    expect(batch.slice(1).map((m) => m.id)).toEqual(others);
    expect(registry.get(first)).toMatchObject({ status: 'sent', updatedAt: clock.now() });
    // Já buscadas não voltam; as do outro agente só saem para a sessão dele.
    expect(registry.inbox({ session: SESSION })).toEqual([]);
    expect(registry.inbox({ session: 'sess-2' }).map((m) => m.text)).toEqual(['para o outro']);
  });

  it('confirmação: ok → delivered com a atividade (mascarada e cortada) no feed; falha → failed com o motivo', () => {
    const { office, registry, clock } = setup();
    registry.inbox({ session: SESSION });
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const a = sent(registry.send({ agentId: MAIN, text: `Use ${secret} ${'e mais um pouco '.repeat(40)}` }));
    const b = sent(registry.send({ agentId: MAIN, text: 'outra' }));
    const c = sent(registry.send({ agentId: MAIN, text: 'terceira' }));
    registry.inbox({ session: SESSION });
    office.commit();
    clock.advance(1_000);
    registry.ack({ session: SESSION, results: [{ id: a, ok: true }, { id: b, ok: false, error: 'a sessão recusou (drop)' }, { id: c, ok: false }] });
    expect(registry.get(a)).toEqual({ id: a, agentId: MAIN, status: 'delivered', createdAt: clock.now() - 1_000, updatedAt: clock.now() });
    expect(registry.get(b)).toMatchObject({ status: 'failed', error: 'a sessão recusou (drop)' });
    expect(registry.get(c)).toMatchObject({ status: 'failed', error: ERR_REFUSED });

    const commit = office.commit();
    const feed = commit.feed.map((f) => f.activity);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: 'communicate', icon: '✉️', text: 'Mensagem pelo Habblaud', at: clock.now() });
    expect(feed[0].detail).not.toContain(secret);
    expect(feed[0].detail!.length).toBeLessThanOrEqual(300);
    expect(feed[0].detail).toMatch(/^Use /);
  });

  it('confirmação de outra sessão, de id desconhecido ou de mensagem não buscada é ignorada; corpo inválido lança', () => {
    const { registry } = setup();
    registry.inbox({ session: SESSION });
    const queued = sent(registry.send({ agentId: MAIN, text: 'na fila' }));
    registry.ack({ session: SESSION, results: [{ id: queued, ok: true }, { id: 'nao-existe', ok: true }, { foo: 1 }, null] });
    expect(registry.get(queued)?.status).toBe('queued');
    const [m] = registry.inbox({ session: SESSION });
    registry.ack({ session: 'sess-2', results: [{ id: m.id, ok: true }] });
    expect(registry.get(m.id)?.status).toBe('sent');
    for (const bad of [null, {}, { session: SESSION }, { session: SESSION, results: 'x' }]) expect(() => registry.ack(bad)).toThrow(/results/);
  });
});

describe('MessageRegistry: prazos e limpeza', () => {
  it('na fila sem ser buscada: falha em 60 s; buscada sem confirmação: falha em 30 s', () => {
    const { registry, clock } = setup();
    registry.inbox({ session: SESSION });
    const a = sent(registry.send({ agentId: MAIN, text: 'a' }));
    clock.advance(QUEUED_TIMEOUT_MS - 1);
    // A sessão continua presente (pergunta pela caixa), mas sem buscar esta: só o prazo conta.
    registry.inbox({ session: 'sess-2' });
    registry.tick();
    expect(registry.get(a)?.status).toBe('queued');
    clock.advance(1);
    registry.tick();
    expect(registry.get(a)).toMatchObject({ status: 'failed', error: ERR_NOT_FETCHED });

    registry.inbox({ session: SESSION });
    const b = sent(registry.send({ agentId: MAIN, text: 'b' }));
    registry.inbox({ session: SESSION });
    clock.advance(SENT_TIMEOUT_MS - 1);
    registry.tick();
    expect(registry.get(b)?.status).toBe('sent');
    clock.advance(1);
    registry.tick();
    expect(registry.get(b)).toMatchObject({ status: 'failed', error: ERR_NOT_CONFIRMED });
  });

  it('confirmação atrasada (depois do prazo) ainda corrige a situação: o plugin é quem sabe se entrou', () => {
    const { office, registry, clock } = setup();
    registry.inbox({ session: SESSION });
    const id = sent(registry.send({ agentId: MAIN, text: 'entrou tarde' }));
    registry.inbox({ session: SESSION });
    clock.advance(SENT_TIMEOUT_MS);
    registry.tick();
    expect(registry.get(id)?.status).toBe('failed');
    office.commit();
    registry.ack({ session: SESSION, results: [{ id, ok: true }] });
    expect(registry.get(id)).toMatchObject({ status: 'delivered' });
    expect(registry.get(id)?.error).toBeUndefined();
    expect(office.commit().feed.map((f) => f.activity.detail)).toEqual(['entrou tarde']);
    // Resolvida de vez: outra confirmação não muda nada.
    registry.ack({ session: SESSION, results: [{ id, ok: false, error: 'x' }] });
    expect(registry.get(id)?.status).toBe('delivered');
  });

  it('agente que sai: as mensagens não resolvidas falham e a presença some', () => {
    const { office, registry } = setup();
    registry.inbox({ session: SESSION });
    const a = sent(registry.send({ agentId: MAIN, text: 'a' }));
    const b = sent(registry.send({ agentId: MAIN, text: 'b' }));
    registry.inbox({ session: SESSION });
    const c = sent(registry.send({ agentId: MAIN, text: 'c' }));
    office.closeMain(MAIN);
    registry.tick();
    for (const id of [a, b, c]) expect(registry.get(id)).toMatchObject({ status: 'failed', error: ERR_GONE });
    expect(registry.reachable().size).toBe(0);
  });

  it('/clear ou /resume antes da busca: a mensagem não vai para a sessão nova e falha', () => {
    const { office, registry } = setup();
    registry.inbox({ session: SESSION });
    const id = sent(registry.send({ agentId: MAIN, text: 'para a conversa antiga' }));
    office.switchSession(MAIN, 'sess-nova');
    expect(registry.inbox({ session: 'sess-nova' })).toEqual([]);
    registry.tick();
    expect(registry.get(id)).toMatchObject({ status: 'failed', error: ERR_SESSION_CHANGED });
    // A mandada depois da troca vai para a sessão nova.
    const next = sent(registry.send({ agentId: MAIN, text: 'para a nova' }));
    expect(registry.inbox({ session: 'sess-nova' }).map((m) => m.id)).toEqual([next]);
  });

  it('resolvidas ficam 10 min para a consulta e depois somem', () => {
    const { registry, clock } = setup();
    registry.inbox({ session: SESSION });
    const id = sent(registry.send({ agentId: MAIN, text: 'a' }));
    registry.ack({ session: SESSION, results: [{ id: registry.inbox({ session: SESSION })[0].id, ok: true }] });
    clock.advance(KEEP_MS - 1);
    registry.tick();
    expect(registry.get(id)?.status).toBe('delivered');
    clock.advance(1);
    registry.tick();
    expect(registry.get(id)).toBeUndefined();
    expect(registry.size).toBe(0);
  });
});

describe('MessageRegistry: demo', () => {
  it('agente do demo: entrega fictícia em ~1 s com a atividade no agente; nunca sai pela caixa de entrada', () => {
    const { office, registry, clock } = setup();
    office.setDemo(true);
    const demo = office.commit().snapshot.agents.find((a) => a.id.startsWith('demo:') && a.kind === 'main' && a.status !== 'offline')!;
    expect(demo.canMessage).toBe(true);
    const id = sent(registry.send({ agentId: demo.id, text: 'oi, demo' }));
    // Nem a sessão fictícia nem uma real recebem a mensagem do demo.
    expect(registry.inbox({ session: demo.sessionId })).toEqual([]);
    expect(registry.inbox({ session: SESSION })).toEqual([]);
    clock.advance(999);
    registry.tick();
    expect(registry.get(id)?.status).toBe('queued');
    clock.advance(1);
    registry.tick();
    expect(registry.get(id)?.status).toBe('delivered');
    const after = office.commit().snapshot.agents.find((a) => a.id === demo.id)!;
    expect(after.recent.at(-1)).toMatchObject({ kind: 'communicate', text: 'Mensagem pelo Habblaud', detail: 'oi, demo' });
  });

  it('demo desligado no meio do caminho: a mensagem falha (o agente saiu)', () => {
    const { office, registry } = setup();
    office.setDemo(true);
    const demo = office.commit().snapshot.agents.find((a) => a.id.startsWith('demo:') && a.kind === 'main' && a.status !== 'offline')!;
    const id = sent(registry.send({ agentId: demo.id, text: 'oi' }));
    office.setDemo(false);
    registry.tick();
    expect(registry.get(id)).toMatchObject({ status: 'failed', error: ERR_GONE });
  });
});
