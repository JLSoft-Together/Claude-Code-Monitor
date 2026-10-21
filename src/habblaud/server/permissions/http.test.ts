// Rotas de /api/permissions: a trava (desligado / Host que não é local), o guard (JSON e Origin), os
// status (400, 404, 405, 409), o fluxo completo (registrar → esperar → decidir), o long-poll sem decisão,
// a resposta imediata sem páginas abertas, as perguntas do AskUserQuestion e os pedidos fictícios do demo.
import { afterEach, describe, expect, it } from 'vitest';
import type { OfficeSnapshot, PermissionRequestInfo } from '../../shared/types';
import { setQuiet } from '../log';
import { hookJson, MAIN, request, servePermissions, type PermissionServer } from '../test/permission-server';
import { waitMs } from './http';

setQuiet(true);

let srv: PermissionServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const register = (s: PermissionServer, over: Record<string, unknown> = {}) => request(s.base, '/api/permissions', { method: 'POST', body: hookJson(over) });

describe('trava local', () => {
  it('desligado (sem bind local): 403 em todas as rotas; health diz permissions: false', async () => {
    srv = await servePermissions({ enabled: false });
    for (const [method, path] of [
      ['POST', '/api/permissions'],
      ['GET', '/api/permissions/x/wait'],
      ['POST', '/api/permissions/x/decision'],
      ['GET', '/api/permissions/x'],
    ]) {
      const r = await request(srv.base, path, { method, body: method === 'POST' ? {} : undefined });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json).toMatchObject({ error: expect.stringMatching(/desligado/) });
    }
    expect((await request(srv.base, '/api/health')).json).toMatchObject({ permissions: false });
  });

  it('Host que não é local (proxy/túnel de HABBLAUD_ALLOWED_HOSTS ou IP da rede): 403', async () => {
    srv = await servePermissions();
    expect((await request(srv.base, '/api/health')).json).toMatchObject({ permissions: true });
    for (const host of ['habblaud.lan', '192.168.0.10:4747']) {
      const r = await request(srv.base, '/api/permissions', { method: 'POST', body: hookJson(), headers: { Host: host } });
      expect(r.status, host).toBe(403);
      expect(r.json).toMatchObject({ error: expect.stringMatching(/próprio computador/) });
    }
    // Host local com porta e localhost: valem.
    expect((await request(srv.base, '/api/permissions', { method: 'POST', body: hookJson(), headers: { Host: `localhost:${srv.port}` } })).status).toBe(201);
  });

  it('guard: POST sem JSON (415) ou de outra origem (403) é barrado antes da rota', async () => {
    srv = await servePermissions();
    const id = ((await register(srv)).json as { id: string }).id;
    const form = await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: 'behavior=allow', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(form.status).toBe(415);
    const evil = await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'allow' }, headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    // Da própria página (Origin local): passa.
    const ok = await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'allow' }, headers: { Origin: srv.base } });
    expect(ok.status).toBe(200);
  });
});

describe('rotas', () => {
  it('sem página aberta: resposta imediata {skip: no-viewers}; sessão desconhecida: {skip: unknown-session}', async () => {
    srv = await servePermissions({ viewers: 0 });
    const t0 = Date.now();
    const r = await register(srv);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ skip: 'no-viewers' });
    srv.setViewers(1);
    expect((await register(srv, { session_id: 'nao-existe' })).json).toEqual({ skip: 'unknown-session' });
  });

  it('corpo inválido: 400; ids desconhecidos: 404; métodos errados: 405', async () => {
    srv = await servePermissions();
    expect((await request(srv.base, '/api/permissions', { method: 'POST', body: { foo: 1 } })).status).toBe(400);
    expect((await request(srv.base, '/api/permissions', { method: 'POST', body: '{quebrado' })).status).toBe(400);
    expect((await request(srv.base, '/api/permissions/nao-existe/wait?timeout=0.1')).status).toBe(404);
    expect((await request(srv.base, '/api/permissions/nao-existe')).status).toBe(404);
    expect((await request(srv.base, '/api/permissions/nao-existe/decision', { method: 'POST', body: { behavior: 'allow' } })).status).toBe(404);
    expect((await request(srv.base, '/api/permissions')).status).toBe(405);
    expect((await request(srv.base, '/api/permissions/x/wait', { method: 'POST', body: {} })).status).toBe(405);
    expect((await request(srv.base, '/api/permissions/x/decision')).status).toBe(405);
    expect((await request(srv.base, '/api/permissions/x/y/z')).status).toBe(404);
  });

  it('fluxo: registra (201) → espera sem decisão (pending) → página decide → a espera recebe a decisão', async () => {
    srv = await servePermissions();
    const reg = await register(srv);
    expect(reg.status).toBe(201);
    const { id } = reg.json as { id: string; expiresAt: number };
    const t0 = Date.now();
    expect((await request(srv.base, `/api/permissions/${id}/wait?timeout=0.2`)).json).toEqual({ status: 'pending' });
    expect(Date.now() - t0).toBeLessThan(2_000);

    // A página vê o pedido no snapshot (sem os argumentos) e busca o detalhe.
    const snap = (await request(srv.base, '/api/snapshot')).json as OfficeSnapshot;
    const agent = snap.agents.find((a) => a.id === MAIN)!;
    expect(agent).toMatchObject({ status: 'waiting', permission: { id, tool: 'Bash', title: 'Bash(npm test)' } });
    expect(agent.permission!.input).toBeUndefined();
    const detail = (await request(srv.base, `/api/permissions/${id}`)).json as PermissionRequestInfo;
    expect(detail).toMatchObject({ id, input: 'npm test', inputKind: 'command' });

    const waiting = request(srv.base, `/api/permissions/${id}/wait?timeout=20`);
    await new Promise((ok) => setTimeout(ok, 50));
    const bad = await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'talvez' } });
    expect(bad.status).toBe(400);
    expect((await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'allow', suggestion: 3 } })).status).toBe(400);
    const dec = await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'deny', message: 'agora não' } });
    expect(dec).toMatchObject({ status: 200, json: { ok: true } });
    expect((await waiting).json).toEqual({ status: 'decided', behavior: 'deny', message: 'agora não' });
    expect((await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'allow' } })).status).toBe(404);
  });

  it('decidir duas vezes antes de o hook buscar: 409', async () => {
    srv = await servePermissions();
    const { id } = (await register(srv)).json as { id: string };
    expect((await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'allow' } })).status).toBe(200);
    expect((await request(srv.base, `/api/permissions/${id}/decision`, { method: 'POST', body: { behavior: 'deny' } })).status).toBe(409);
    expect((await request(srv.base, `/api/permissions/${id}/wait`)).json).toEqual({ status: 'decided', behavior: 'allow' });
  });

  it('hook que desiste (conexão fechada) vira órfão e o pedido some', async () => {
    srv = await servePermissions({ registry: { orphanMs: 150 } });
    const { id } = (await register(srv)).json as { id: string };
    expect(srv.registry!.size).toBe(1);
    await new Promise((ok) => setTimeout(ok, 400));
    expect(srv.registry!.size).toBe(0);
    expect((await request(srv.base, `/api/permissions/${id}/wait?timeout=0.1`)).json).toEqual({ status: 'released', reason: 'orphan' });
  });

  it('pergunta (AskUserQuestion): responder pela rota entrega as respostas ao hook; respostas que não servem: 400', async () => {
    srv = await servePermissions();
    const questions = [
      { question: 'Qual banco usar?', header: 'Banco', options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
      { question: 'Quais testes rodar?', multiSelect: true, options: [{ label: 'Unidade' }, { label: 'E2E' }] },
    ];
    const reg = await register(srv, { tool_name: 'AskUserQuestion', tool_input: { questions }, permission_suggestions: [] });
    expect(reg.status).toBe(201);
    const { id } = reg.json as { id: string };
    const agent = ((await request(srv.base, '/api/snapshot')).json as OfficeSnapshot).agents.find((a) => a.id === MAIN)!;
    expect(agent).toMatchObject({ status: 'waiting', waitingFor: 'responder uma pergunta', permission: { id, tool: 'AskUserQuestion' } });
    expect(agent.permission!.questions!.map((q) => q.question)).toEqual(['Qual banco usar?', 'Quais testes rodar?']);

    const decide = (body: unknown) => request(srv!.base, `/api/permissions/${id}/decision`, { method: 'POST', body });
    for (const body of [{ behavior: 'answer' }, { behavior: 'answer', answers: [{ question: 0, options: [0, 0] }] }]) {
      const r = await decide(body);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: expect.stringMatching(/answer/) });
    }
    const allow = await decide({ behavior: 'allow' });
    expect(allow.status).toBe(400);
    expect(allow.json).toMatchObject({ error: expect.stringMatching(/^resposta que não serve/) });
    expect((await decide({ behavior: 'answer', answers: [{ question: 0, options: [1] }] })).status).toBe(400);

    const waiting = request(srv.base, `/api/permissions/${id}/wait?timeout=20`);
    await new Promise((ok) => setTimeout(ok, 50));
    expect((await decide({ behavior: 'answer', answers: [{ question: 0, options: [1] }, { question: 1, options: [0], other: 'lint' }] })).status).toBe(200);
    expect((await waiting).json).toEqual({
      status: 'decided',
      behavior: 'answer',
      answers: [
        { question: 0, options: [1] },
        { question: 1, options: [0], other: 'lint' },
      ],
    });
  });

  it('demo: a pergunta fictícia responde pela mesma rota (e aprovar não serve)', async () => {
    srv = await servePermissions({ demo: true });
    const sim = (srv.office as unknown as { demo: { forcePermission(now: number, kind?: string): string | undefined } }).demo;
    const agentId = sim.forcePermission(Date.now(), 'question');
    srv.office.tick();
    const p = ((await request(srv.base, '/api/snapshot')).json as OfficeSnapshot).agents.find((a) => a.id === agentId)!.permission!;
    expect(p.tool).toBe('AskUserQuestion');
    const decide = (body: unknown) => request(srv!.base, `/api/permissions/${encodeURIComponent(p.id)}/decision`, { method: 'POST', body });
    expect((await decide({ behavior: 'allow' })).status).toBe(400);
    expect((await decide({ behavior: 'answer', answers: [{ question: 0, options: [0] }] })).status).toBe(400);
    const [single, multi] = p.questions!;
    expect((await decide({ behavior: 'answer', answers: [{ question: single!.index, options: [0] }, { question: multi!.index, options: [0, 1] }] })).status).toBe(200);
    const after = ((await request(srv.base, '/api/snapshot')).json as OfficeSnapshot).agents.find((a) => a.id === agentId)!;
    expect(after.permission).toBeUndefined();
    expect(after.status).toBe('working');
    expect(after.recent.at(-1)).toMatchObject({ icon: '💬', text: 'Respondido no Habblaud' });
  });

  it('demo: o pedido fictício responde pela mesma rota', async () => {
    srv = await servePermissions({ demo: true });
    // Algum agente do demo pede permissão agora.
    const sim = (srv.office as unknown as { demo: { forcePermission(now: number, kind?: string): string | undefined } }).demo;
    const agentId = sim.forcePermission(Date.now(), 'permission');
    srv.office.tick();
    const snap = (await request(srv.base, '/api/snapshot')).json as OfficeSnapshot;
    const agent = snap.agents.find((a) => a.id === agentId)!;
    expect(agent.status).toBe('waiting');
    const p = agent.permission!;
    expect(p.id.startsWith('demo:')).toBe(true);
    expect(p.input).toBeTruthy();
    expect((await request(srv.base, `/api/permissions/${encodeURIComponent(p.id)}`)).json).toMatchObject({ id: p.id });
    expect((await request(srv.base, `/api/permissions/${encodeURIComponent(p.id)}/decision`, { method: 'POST', body: { behavior: 'allow' } })).status).toBe(200);
    const after = ((await request(srv.base, '/api/snapshot')).json as OfficeSnapshot).agents.find((a) => a.id === agentId)!;
    expect(after.permission).toBeUndefined();
    expect(after.status).toBe('working');
  });

  it('waitMs: ?timeout= em segundos, limitado a 25 s', () => {
    expect(waitMs(new URL('http://x/?timeout=5'))).toBe(5_000);
    expect(waitMs(new URL('http://x/?timeout=999'))).toBe(25_000);
    expect(waitMs(new URL('http://x/?timeout=0.001'))).toBe(50);
    expect(waitMs(new URL('http://x/'))).toBe(25_000);
    expect(waitMs(new URL('http://x/?timeout=abc'))).toBe(25_000);
  });
});
