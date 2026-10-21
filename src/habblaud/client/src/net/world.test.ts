import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../../shared/types';
import { fullParts, draftAppearance } from '../ui/world/world-model';
import {
  buildingFromMeta,
  FAKE_CODE,
  FAKE_EMAIL,
  FAKE_PASSWORD,
  FAKE_UPLINK,
  FakeWorldApi,
  HttpWorldApi,
  fakeWorldStateFrom,
  parseBuilding,
  parseLastUplink,
  parseWorldStatus,
  readWorldMeta,
  uplinkBytes,
  worldErrorCode,
  worldSource,
  type WorldCharacterInput,
} from './world';

type Call = { url: string; init?: RequestInit };

function recorder(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return Promise.resolve(new Response(text, { status }));
  }) as unknown as typeof fetch;
  return { calls, api: new HttpWorldApi(fetchImpl) };
}

const snap = (world: unknown): OfficeSnapshot => ({ meta: { world } }) as unknown as OfficeSnapshot;

const CHARACTER: WorldCharacterInput = {
  name: 'Pixel Dev',
  look: 'f',
  parts: fullParts(draftAppearance('f')),
  traits: ['cafeina', 'games'],
  intro: 'coffee',
};

describe('HttpWorldApi', () => {
  it('cada ação vai para a rota do contrato, com JSON (mesmo vazio) nos POST/PUT', async () => {
    const { calls, api } = recorder(202, {});
    await api.register({ email: 'a@b.co', password: 'x'.repeat(12), name: 'Ana Pixel', locale: 'pt-BR' });
    await api.verify({ email: 'a@b.co', code: '123456' });
    await api.login({ email: 'a@b.co', password: 'x'.repeat(12) });
    await api.logout();
    await api.resend({ email: 'a@b.co' });
    await api.forgotPassword({ email: 'a@b.co' });
    await api.resetPassword({ email: 'a@b.co', code: '123456', password: 'y'.repeat(12) });
    await api.saveCharacter(CHARACTER);
    await api.saveVisibility({ mode: 'discreet', closed: true, hideCountry: false, tokensVisible: true, leaderboard: false, compactions: false, knocks: false });
    await api.revokeDevice('d/1');
    expect(calls.map((c) => `${c.init?.method} ${c.url}`)).toEqual([
      'POST /api/world/register',
      'POST /api/world/verify',
      'POST /api/world/login',
      'POST /api/world/logout',
      'POST /api/world/resend',
      'POST /api/world/password/forgot',
      'POST /api/world/password/reset',
      'PUT /api/world/character',
      'PUT /api/world/visibility',
      'POST /api/world/devices/d%2F1/revoke',
    ]);
    for (const c of calls) {
      expect(c.init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(typeof c.init?.body).toBe('string');
    }
    expect(calls[3].init?.body).toBe('{}');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'a@b.co', password: 'x'.repeat(12), name: 'Ana Pixel', locale: 'pt-BR' });
    expect(JSON.parse(String(calls[7].init?.body))).toEqual(CHARACTER);
  });

  it('GET sem corpo; o status vem conferido', async () => {
    const { calls, api } = recorder(200, { available: true, configured: true, state: 'waiting', account: { emailMasked: 'vo***@exemplo.com', access: 'waiting' } });
    const r = await api.status();
    expect(calls[0].url).toBe('/api/world/status');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
    expect(r).toEqual({ ok: true, data: { available: true, configured: true, state: 'waiting', account: { emailMasked: 'vo***@exemplo.com', access: 'waiting' } } });
  });

  it('status torto vira erro, não estado inventado', async () => {
    expect((await recorder(200, { state: 'dancing' }).api.status()).ok).toBe(false);
    expect((await recorder(200, '<html>').api.status()).ok).toBe(false);
  });

  it('dispositivos: aceita a lista solta ou dentro de {devices}', async () => {
    const list = [{ id: 'd1', label: 'Dispositivo 1', current: true }, { id: 'd2', label: 'Dispositivo 2' }];
    const a = await recorder(200, list).api.devices();
    const b = await recorder(200, { devices: list }).api.devices();
    expect(a).toEqual(b);
    expect(a.ok && a.data.map((d) => d.current)).toEqual([true, false]);
  });

  it('erro do contrato: o código vem do corpo e o status vai junto', async () => {
    const r = await recorder(409, { error: { code: 'name_taken', message: 'Name taken' } }).api.saveCharacter(CHARACTER);
    expect(r).toEqual({ ok: false, code: 'name_taken', status: 409 });
  });

  it('sem código (guarda, rota desligada, corpo vazio): decide pelo status HTTP', async () => {
    expect(await recorder(403, { error: 'Origem não permitida.' }).api.logout()).toMatchObject({ code: 'forbidden' });
    expect(await recorder(404, undefined).api.status()).toMatchObject({ code: 'not_configured' });
    expect(await recorder(429, '').api.resend({ email: 'a@b.co' })).toMatchObject({ code: 'rate_limited' });
    expect(await recorder(500, { error: { code: 'algo_novo' } }).api.logout()).toMatchObject({ code: 'unknown' });
  });

  it('sem resposta do Habblaud: offline', async () => {
    const api = new HttpWorldApi((() => Promise.reject(new TypeError('rede'))) as unknown as typeof fetch);
    expect(await api.login({ email: 'a@b.co', password: 'x' })).toEqual({ ok: false, code: 'offline', status: 0 });
  });

  it('worldErrorCode só aceita os códigos conhecidos', () => {
    expect(worldErrorCode(400, { error: { code: 'invalid_code' } })).toBe('invalid_code');
    expect(worldErrorCode(400, { error: { code: '__proto__' } })).toBe('unknown');
  });
});

describe('meta.world e status', () => {
  it('readWorldMeta: ausente, torto ou com estado desconhecido', () => {
    expect(readWorldMeta(null)).toBeUndefined();
    expect(readWorldMeta(snap(undefined))).toBeUndefined();
    expect(readWorldMeta(snap({ configured: true }))).toBeUndefined();
    expect(readWorldMeta(snap({ enabled: true, configured: true, state: 'waiting' }))).toEqual({ enabled: true, configured: true, state: 'waiting' });
    expect(readWorldMeta(snap({ enabled: true, state: 'zzz' }))).toEqual({ enabled: true, configured: false, state: 'off' });
  });

  it('readWorldMeta: a cena Mundo (Fase 3) só com `available` booleano', () => {
    const base = { enabled: true, configured: true, state: 'approved' };
    expect(readWorldMeta(snap({ ...base, scene: { available: true } }))?.scene).toEqual({ available: true });
    expect(readWorldMeta(snap({ ...base, scene: { available: false, extra: 1 } }))?.scene).toEqual({ available: false });
    expect(readWorldMeta(snap({ ...base, scene: { available: 'sim' } }))).not.toHaveProperty('scene');
    expect(readWorldMeta(snap({ ...base, scene: [] }))).not.toHaveProperty('scene');
  });

  it('parseWorldStatus completa a visibilidade do personagem com os padrões', () => {
    const s = parseWorldStatus({ state: 'approved', configured: true, player: { name: 'Pixel', look: 'm', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee', visibility: { mode: 'discreet' } } });
    expect(s?.player?.visibility).toEqual({ mode: 'discreet', closed: false, hideCountry: false, tokensVisible: true, leaderboard: false, compactions: false, knocks: false });
  });

  it('parseWorldStatus: mustRename só quando é true', () => {
    const player = { name: '???', look: 'm', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee' };
    expect(parseWorldStatus({ state: 'approved', player: { ...player, mustRename: true } })?.player?.mustRename).toBe(true);
    expect(parseWorldStatus({ state: 'approved', player: { ...player, mustRename: 1 } })?.player).not.toHaveProperty('mustRename');
  });
});

describe('FakeWorldApi', () => {
  const fake = (state?: ConstructorParameters<typeof FakeWorldApi>[0]) => new FakeWorldApi({ delayMs: 0, ...state });

  it('cadastro → código → lista de espera → aprovado', async () => {
    const api = fake();
    expect(api.meta()).toEqual({ enabled: true, configured: true, state: 'logged_out' });
    expect((await api.register({ email: 'nova@exemplo.com', password: 'cavalo correto bateria', name: 'Nova Pixel', locale: 'pt-BR' })).ok).toBe(true);
    expect(await api.verify({ email: 'nova@exemplo.com', code: '000000' })).toMatchObject({ ok: false, code: 'invalid_code' });
    expect((await api.verify({ email: 'nova@exemplo.com', code: FAKE_CODE })).ok).toBe(true);
    expect(api.meta().state).toBe('waiting');
    // O nome do cadastro fica reservado até o personagem existir.
    const st = await api.status();
    expect(st.ok && st.data.account).toEqual({ emailMasked: 'no***@exemplo.com', access: 'waiting', reservedName: 'Nova Pixel' });
    api.approve();
    expect(api.meta().state).toBe('approved');
  });

  it('cadastro: o nome é conferido antes da senha e não pode estar em uso; criar o personagem usa a reserva', async () => {
    const api = fake({ state: 'waiting' });
    await api.logout();
    expect(await api.register({ email: 'x@exemplo.com', password: 'curta', name: 'a!', locale: 'pt-BR' })).toMatchObject({ code: 'name_invalid', status: 422 });
    expect(await api.register({ email: 'x@exemplo.com', password: 'cavalo correto bateria', name: 'Admin', locale: 'pt-BR' })).toMatchObject({ code: 'name_blocked' });
    // "Pixel Dev" é a reserva da conta da demonstração; "Marina" é de um personagem fixo.
    expect(await api.register({ email: 'x@exemplo.com', password: 'cavalo correto bateria', name: 'pixel dev', locale: 'pt-BR' })).toMatchObject({ code: 'name_taken', status: 409 });
    expect(await api.register({ email: 'x@exemplo.com', password: 'cavalo correto bateria', name: 'MARINA', locale: 'pt-BR' })).toMatchObject({ code: 'name_taken' });
    expect((await api.register({ email: 'x@exemplo.com', password: 'cavalo correto bateria', name: 'Xis Pixel', locale: 'pt-BR' })).ok).toBe(true);
    await api.verify({ email: 'x@exemplo.com', code: FAKE_CODE });
    // Sem `name` no corpo: o personagem nasce com a reserva; com `name`, ele é ignorado.
    const { name: _name, ...rest } = CHARACTER;
    expect((await api.saveCharacter(rest)).ok).toBe(true);
    const st = await api.status();
    expect(st.ok && st.data.player?.name).toBe('Xis Pixel');
    expect(st.ok && st.data.account).not.toHaveProperty('reservedName');
  });

  it('nome trocado à força: o status pede um nome novo e salvar o personagem resolve', async () => {
    const api = fake({ state: 'approved' });
    api.forceRename();
    const before = await api.status();
    expect(before.ok && before.data.player).toMatchObject({ name: '???', mustRename: true });
    const p = before.ok ? before.data.player! : null;
    expect((await api.saveCharacter({ name: 'Pixel Nova', look: p!.look, parts: p!.parts, traits: p!.traits, intro: p!.intro })).ok).toBe(true);
    const after = await api.status();
    expect(after.ok && after.data.player?.name).toBe('Pixel Nova');
    expect(after.ok && after.data.player).not.toHaveProperty('mustRename');
  });

  it('login: credenciais erradas, e-mail sem confirmar, banido', async () => {
    const api = fake();
    await api.register({ email: 'nova@exemplo.com', password: 'cavalo correto bateria', name: 'Nova Pixel', locale: 'pt-BR' });
    expect(await api.login({ email: 'nova@exemplo.com', password: 'outra senha qualquer' })).toMatchObject({ code: 'invalid_credentials' });
    expect(await api.login({ email: 'nova@exemplo.com', password: 'cavalo correto bateria' })).toMatchObject({ code: 'email_not_verified' });
    expect(await api.login({ email: 'banido@exemplo.com', password: 'cavalo correto bateria' })).toMatchObject({ code: 'banned' });
    expect(await api.login({ email: 'ninguem@exemplo.com', password: 'cavalo correto bateria' })).toMatchObject({ code: 'invalid_credentials' });
  });

  it('cadastro com e-mail que já existe responde igual (não revela quem tem conta)', async () => {
    const api = fake({ state: 'waiting' });
    await api.logout();
    expect((await api.register({ email: FAKE_EMAIL, password: 'cavalo correto bateria', name: 'Outra Pessoa', locale: 'pt-BR' })).ok).toBe(true);
    // A senha antiga continua valendo.
    expect((await api.login({ email: FAKE_EMAIL, password: FAKE_PASSWORD })).ok).toBe(true);
  });

  it('personagem: nome em uso, reservado, inválido e traços que não combinam (editando: o nome vem do corpo)', async () => {
    const api = fake({ state: 'approved' });
    expect(await api.saveCharacter({ ...CHARACTER, name: 'Marina' })).toMatchObject({ code: 'name_taken' });
    expect(await api.saveCharacter({ ...CHARACTER, name: 'Admin' })).toMatchObject({ code: 'name_blocked' });
    expect(await api.saveCharacter({ ...CHARACTER, name: 'a!' })).toMatchObject({ code: 'name_invalid' });
    expect(await api.saveCharacter({ ...CHARACTER, traits: ['timidez', 'piadas'] })).toMatchObject({ code: 'invalid' });
    expect((await api.saveCharacter(CHARACTER)).ok).toBe(true);
    const st = await api.status();
    expect(st.ok && st.data.player).toMatchObject({ name: 'Pixel Dev', traits: ['cafeina', 'games'], intro: 'coffee', country: 'BR' });
  });

  it('visibilidade só com personagem; esconder o país tira o país do perfil', async () => {
    const api = fake({ state: 'approved' });
    const vis = { mode: 'live', closed: false, hideCountry: true, tokensVisible: false, leaderboard: false, compactions: false, knocks: false } as const;
    expect((await api.saveVisibility(vis)).ok).toBe(true);
    const st = await api.status();
    expect(st.ok && st.data.player?.visibility).toEqual(vis);
    expect(st.ok && st.data.player?.country).toBeUndefined();
    const fresh = fake({ state: 'waiting' });
    expect(await fresh.saveVisibility(vis)).toMatchObject({ code: 'invalid' });
  });

  it('dispositivos: revogar outro some da lista; revogar este sai da conta', async () => {
    const api = fake({ state: 'approved' });
    const list = await api.devices();
    expect(list.ok && list.data.map((d) => [d.label, d.current])).toEqual([['Dispositivo 2', false], ['Dispositivo 1', true]]);
    const other = list.ok ? list.data.find((d) => !d.current)! : null;
    expect((await api.revokeDevice(other!.id)).ok).toBe(true);
    const after = await api.devices();
    expect(after.ok && after.data).toHaveLength(1);
    const me = after.ok ? after.data[0] : null;
    await api.revokeDevice(me!.id);
    expect(api.meta().state).toBe('logged_out');
  });

  it('esqueci a senha: código errado, código certo troca a senha e desconecta tudo', async () => {
    const api = fake({ state: 'waiting' });
    expect((await api.forgotPassword({ email: FAKE_EMAIL })).ok).toBe(true);
    expect(await api.resetPassword({ email: FAKE_EMAIL, code: '111111', password: 'senha nova bem longa' })).toMatchObject({ code: 'invalid_code' });
    expect((await api.resetPassword({ email: FAKE_EMAIL, code: FAKE_CODE, password: 'senha nova bem longa' })).ok).toBe(true);
    expect(api.meta().state).toBe('logged_out');
    expect(await api.login({ email: FAKE_EMAIL, password: FAKE_PASSWORD })).toMatchObject({ code: 'invalid_credentials' });
    expect((await api.login({ email: FAKE_EMAIL, password: 'senha nova bem longa' })).ok).toBe(true);
  });

  it('reenviar o código: 3 por hora', async () => {
    let now = 1_000_000;
    const api = fake({ now: () => now });
    for (let i = 0; i < 3; i++) expect((await api.resend({ email: 'a@b.co' })).ok).toBe(true);
    expect(await api.resend({ email: 'a@b.co' })).toMatchObject({ code: 'rate_limited' });
    now += 3_600_001;
    expect((await api.resend({ email: 'a@b.co' })).ok).toBe(true);
  });

  it('failNext simula erro de rede ou do servidor do mundo na próxima chamada', async () => {
    const api = fake({ state: 'waiting' });
    api.failNext('network');
    expect(await api.status()).toMatchObject({ ok: false, code: 'network' });
    expect((await api.status()).ok).toBe(true);
  });

  it('sem servidor configurado: tudo responde not_configured', async () => {
    const api = fake({ state: 'off' });
    expect(api.meta()).toEqual({ enabled: false, configured: false, state: 'off' });
    expect(await api.login({ email: 'a@b.co', password: 'x' })).toMatchObject({ code: 'not_configured' });
  });

  it('avisa quem escuta quando o estado muda', async () => {
    const api = fake();
    let n = 0;
    const off = api.onChange(() => n++);
    await api.register({ email: 'nova@exemplo.com', password: 'cavalo correto bateria', name: 'Nova Pixel', locale: 'pt-BR' });
    await api.verify({ email: 'nova@exemplo.com', code: FAKE_CODE });
    expect(n).toBe(2);
    // Ler não avisa (senão a interface releria o status sem parar).
    await api.status();
    await api.devices();
    expect(n).toBe(2);
    off();
    api.approve();
    expect(n).toBe(2);
  });
});

describe('de onde vêm os dados', () => {
  it('?world= escolhe o estado inicial do falso (valor desconhecido: sem conta)', () => {
    expect(fakeWorldStateFrom('?mock=1')).toBeNull();
    expect(fakeWorldStateFrom('?mock=1&world')).toBe('logged_out');
    expect(fakeWorldStateFrom('?mock=1&world=waiting')).toBe('waiting');
    expect(fakeWorldStateFrom('?world=xyz')).toBe('logged_out');
  });

  it('modo demonstração sem &world: nada do World (as capturas antigas não mudam)', () => {
    const src = worldSource({ mock: true, liveSnapshot: null }, '?mock=1');
    expect(src.client).toBeNull();
    expect(src.meta()).toBeUndefined();
  });

  it('modo demonstração com &world: o falso responde (aprovado: com o prédio no mundo)', () => {
    const src = worldSource({ mock: true, liveSnapshot: null }, '?mock=1&world=approved');
    expect(src.fake).toBe(true);
    expect(src.client).toBeInstanceOf(FakeWorldApi);
    expect(src.meta()).toEqual({
      enabled: true,
      configured: true,
      state: 'approved',
      // Fase 5: likes do dia (3 e mais um por minuto) e o resumo não visto do modo demonstração
      building: { connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: expect.any(Number), visitors: 0, likesToday: 3, awaySummary: true },
      scene: { available: true },
    });
    expect(worldSource({ mock: true, liveSnapshot: null }, '?mock=1&world=waiting').meta()).toEqual({ enabled: true, configured: true, state: 'waiting' });
  });

  it('ao vivo: rotas locais e o meta.world do snapshot ao vivo', () => {
    const store = { mock: false, liveSnapshot: snap({ enabled: true, configured: true, state: 'logged_out' }) };
    const src = worldSource(store, '?world=waiting');
    expect(src.client).toBeInstanceOf(HttpWorldApi);
    expect(src.meta()).toEqual({ enabled: true, configured: true, state: 'logged_out' });
  });
});

// ------------------------------------------------------------------ Fase 2: prédio no mundo

describe('prédio: rotas locais da Fase 2', () => {
  it('última remessa, pausar, retomar, sair do mundo e tema vão para as rotas do contrato', async () => {
    const { calls, api } = recorder(200, {});
    await api.lastUplink();
    await api.pause();
    await api.resume();
    await api.leave();
    await api.join();
    await api.setTheme('christmas');
    expect(calls.map((c) => `${c.init?.method} ${c.url} ${c.init?.body ?? ''}`.trim())).toEqual([
      'GET /api/world/last-uplink',
      'POST /api/world/pause {}',
      'POST /api/world/resume {}',
      'POST /api/world/leave {}',
      'POST /api/world/join {}',
      'PUT /api/world/theme {"theme":"christmas"}',
    ]);
  });

  it('última remessa: {} é "nada saiu ainda"; o pacote vem como foi guardado; fora do formato é erro', async () => {
    expect(await recorder(200, {}).api.lastUplink()).toEqual({ ok: true, data: null });
    const body = { at: 1_760_000_000_000, bytes: 1174, uplink: FAKE_UPLINK, ack: { ok: true, at: 1_760_000_000_050 } };
    expect(await recorder(200, body).api.lastUplink()).toEqual({ ok: true, data: body });
    expect(await recorder(200, { at: 'ontem', uplink: {} }).api.lastUplink()).toMatchObject({ ok: false, code: 'unknown' });
    expect(await recorder(401, { error: { code: 'not_logged_in' } }).api.lastUplink()).toMatchObject({ ok: false, code: 'not_logged_in' });
  });

  it('a resposta recusada sem código (ou com um que esta versão não conhece) vira "internal"; números tortos viram 0', () => {
    expect(parseLastUplink({ at: 5, bytes: 10, uplink: { v: 1 }, ack: { ok: false, at: 6 } })?.ack).toEqual({ ok: false, error: 'internal', at: 6 });
    expect(parseLastUplink({ at: 5, bytes: 10, uplink: { v: 1 }, ack: { ok: false, error: 'novo', at: 6 } })?.ack).toEqual({ ok: false, error: 'internal', at: 6 });
    // Aceita: os bytes que o mundo contou; sem horário, a resposta não vale.
    expect(parseLastUplink({ at: 5, bytes: 10, uplink: { v: 1 }, ack: { ok: true, at: 6, bytes: 10 } })?.ack).toEqual({ ok: true, at: 6, bytes: 10 });
    expect(parseLastUplink({ at: 5, bytes: 10, uplink: { v: 1 }, ack: { ok: true } })?.ack).toBeUndefined();
    expect(parseBuilding({ connected: 'sim', paused: true, floors: -3, agents: 2.7, lastUplinkAt: 'agora', lastAck: { ok: false, error: 'rate' } })).toEqual({
      connected: false,
      paused: true,
      floors: 0,
      agents: 2,
      lastAck: { ok: false, error: 'rate' },
    });
    expect(parseBuilding('prédio')).toBeUndefined();
  });

  it('pausar e retomar devolvem o WorldStatus: vale o building.paused dele; sem o campo, o que foi pedido', async () => {
    expect(await recorder(200, { state: 'approved', building: { paused: true } }).api.pause()).toEqual({ ok: true, data: { paused: true } });
    expect(await recorder(200, { state: 'approved', building: { paused: true } }).api.resume()).toEqual({ ok: true, data: { paused: true } });
    expect(await recorder(200, '').api.resume()).toEqual({ ok: true, data: { paused: false } });
    expect(await recorder(409, { error: { code: 'no_player' } }).api.pause()).toMatchObject({ ok: false, code: 'no_player' });
    expect(await recorder(503, { error: { code: 'unavailable' } }).api.leave()).toMatchObject({ ok: false, code: 'unavailable', status: 503 });
  });

  it('status: o motivo da parada (só os conhecidos), fora do mundo e o tema guardado', () => {
    const base = { connected: false, paused: true, floors: 1, agents: 1 };
    expect(parseWorldStatus({ state: 'approved', building: { ...base, stopped: 'update', left: true }, theme: 'christmas' })).toMatchObject({
      building: { ...base, stopped: 'update', left: true },
      theme: 'christmas',
    });
    const odd = parseWorldStatus({ state: 'approved', building: { ...base, stopped: 'deploy', left: 'sim' }, theme: 'pascoa' });
    expect(odd?.building).toEqual(base);
    expect(odd?.theme).toBeUndefined();
    // No snapshot, a parada é só sim/não (o motivo não vai ao celular).
    expect(readWorldMeta(snap({ enabled: true, configured: true, state: 'approved', building: { ...base, stopped: true } }))?.building).toEqual({ ...base, stopped: true });
    expect(readWorldMeta(snap({ enabled: true, configured: true, state: 'approved', building: { ...base, stopped: 'update' } }))?.building).toEqual(base);
    expect(buildingFromMeta({ ...base, stopped: true, left: true })).toEqual({ ...base, left: true });
  });

  it('meta.world e o status trazem o prédio, conferido', () => {
    const building = { connected: true, paused: false, floors: 3, agents: 5, lastUplinkAt: 1_760_000_000_000 };
    expect(readWorldMeta(snap({ enabled: true, configured: true, state: 'approved', building }))).toEqual({ enabled: true, configured: true, state: 'approved', building });
    expect(readWorldMeta(snap({ enabled: true, configured: true, state: 'approved', building: 7 }))).toEqual({ enabled: true, configured: true, state: 'approved' });
    const st = parseWorldStatus({ state: 'approved', configured: true, building: { ...building, lastAck: { ok: false, error: 'limits' } } });
    expect(st?.building).toEqual({ ...building, lastAck: { ok: false, error: 'limits' } });
  });
});

describe('FakeWorldApi: prédio', () => {
  const OCT = Date.UTC(2026, 9, 15, 12);
  const JULY = Date.UTC(2026, 6, 1, 12);
  const clock = (start: number) => {
    let t = start;
    return { now: () => t, tick: (ms: number) => (t += ms) };
  };

  it('visitantes de mentira (Fase 4): ninguém nos primeiros segundos, depois 1 e 2; setVisitors fixa; pausado, nada', async () => {
    const c = clock(OCT);
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: c.now });
    expect(api.meta().building?.visitors).toBe(0);
    c.tick(9_000);
    expect(api.meta().building?.visitors).toBe(1);
    c.tick(15_000);
    expect(api.meta().building?.visitors).toBe(2);
    api.setVisitors(5);
    expect(api.meta().building?.visitors).toBe(5);
    expect((await api.status()).ok && (await api.status() as { data: { building?: { visitors?: number } } }).data.building?.visitors).toBe(5);
    await api.pause();
    expect(api.meta().building).not.toHaveProperty('visitors');
  });

  it('o exemplo da 3.3: ids aleatórios no formato do protocolo, pais presentes, peças completas', () => {
    const agents = FAKE_UPLINK.floors.flatMap((f) => f.agents);
    for (const f of FAKE_UPLINK.floors) expect(f.id).toMatch(/^f_[0-9a-f]{10}$/);
    for (const a of agents) {
      expect(a.id).toMatch(/^a_[0-9a-f]{8}$/);
      expect(Object.keys(a.parts)).toHaveLength(12);
      if (a.kind === 'sub') expect(agents.map((x) => x.id)).toContain(a.parentId);
    }
    expect(uplinkBytes(FAKE_UPLINK)).toBe(new TextEncoder().encode(JSON.stringify(FAKE_UPLINK)).length);
  });

  it('aprovado: prédio aceso, a remessa de exemplo com o tema do dia e a resposta aceita', async () => {
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: () => OCT });
    const st = await api.status();
    expect(st.ok && st.data.building).toMatchObject({ connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: OCT, lastAck: { ok: true }, visitors: 0 });
    const last = await api.lastUplink();
    const bytes = uplinkBytes({ ...FAKE_UPLINK, theme: 'halloween' });
    expect(last.ok && last.data).toEqual({ at: OCT, bytes, uplink: { ...FAKE_UPLINK, theme: 'halloween' }, ack: { ok: true, at: OCT, bytes } });
    // Fora de outubro, o automático manda o visual original.
    const july = await new FakeWorldApi({ state: 'approved', delayMs: 0, now: () => JULY }).lastUplink();
    expect(july.ok && july.data?.uplink.theme).toBe('none');
  });

  it('na lista de espera, sem conta ou sem personagem: sem prédio', async () => {
    expect(new FakeWorldApi({ state: 'waiting', delayMs: 0 }).meta()).not.toHaveProperty('building');
    expect(await new FakeWorldApi({ state: 'logged_out', delayMs: 0 }).lastUplink()).toMatchObject({ ok: false, code: 'not_logged_in' });
    const api = new FakeWorldApi({ state: 'waiting', delayMs: 0 });
    // A conta de exemplo da espera não tem personagem: aprovada, ainda sem prédio; com o personagem, ele acende.
    api.approve();
    expect(api.meta()).not.toHaveProperty('building');
    expect(await api.pause()).toMatchObject({ ok: false, code: 'no_player' });
    expect(await api.lastUplink()).toEqual({ ok: true, data: null });
    expect((await api.saveCharacter(CHARACTER)).ok).toBe(true);
    expect(api.meta().building).toMatchObject({ connected: true, paused: false, floors: 2, agents: 3 });
  });

  it('pausar apaga e para o envio; retomar acende e manda o pacote inteiro de novo', async () => {
    const c = clock(OCT);
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: c.now });
    let n = 0;
    api.onChange(() => n++);
    c.tick(60_000);
    expect(await api.pause()).toEqual({ ok: true, data: { paused: true } });
    expect(api.meta().building).toMatchObject({ connected: false, paused: true, floors: 2, agents: 3, lastUplinkAt: OCT });
    // Pausado, mudar o tema não manda nada.
    await api.setTheme('christmas');
    expect(api.meta().building?.lastUplinkAt).toBe(OCT);
    c.tick(60_000);
    expect(await api.resume()).toEqual({ ok: true, data: { paused: false } });
    expect(api.meta().building).toMatchObject({ connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: OCT + 120_000, visitors: expect.any(Number) });
    const last = await api.lastUplink();
    expect(last.ok && last.data?.uplink.theme).toBe('christmas');
    expect(n).toBe(3);
  });

  it('tema: grava a escolha, resolve o automático e recusa valor fora da lista', async () => {
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: () => OCT });
    expect(api.worldTheme()).toBe('auto');
    expect((await api.setTheme('none')).ok).toBe(true);
    expect(api.worldTheme()).toBe('none');
    const last = await api.lastUplink();
    expect(last.ok && last.data?.uplink.theme).toBe('none');
    expect(await api.setTheme('carnaval' as 'none')).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('remessa recusada: o status e a última remessa trazem o motivo', async () => {
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: () => OCT });
    api.rejectUplinks('limits');
    const st = await api.status();
    expect(st.ok && st.data.building?.lastAck).toEqual({ ok: false, error: 'limits' });
    const last = await api.lastUplink();
    expect(last.ok && last.data?.ack).toEqual({ ok: false, error: 'limits', at: OCT });
    expect(api.meta().building).not.toHaveProperty('lastAck');
  });

  it('sair do mundo: apagado e fora do mundo até voltar, que manda o pacote inteiro de novo', async () => {
    const c = clock(OCT);
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: c.now });
    expect((await api.leave()).ok).toBe(true);
    expect(api.meta().building).toMatchObject({ connected: false, paused: true, left: true });
    const st = await api.status();
    expect(st.ok && st.data.building).toMatchObject({ left: true });
    c.tick(60_000);
    expect(await api.join()).toEqual({ ok: true, data: null });
    expect(api.meta().building).toMatchObject({ connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: OCT + 60_000, visitors: expect.any(Number) });
    // Sem ter saído, voltar não muda nada (nem manda outra remessa).
    c.tick(60_000);
    expect((await api.join()).ok).toBe(true);
    expect(api.meta().building?.lastUplinkAt).toBe(OCT + 60_000);
  });

  it('parada pelo "mundo": o status traz o motivo, o meta só "parou"; retomar volta', async () => {
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: () => OCT });
    api.stopBuilding('other-device');
    const st = await api.status();
    expect(st.ok && st.data.building?.stopped).toBe('other-device');
    expect(api.meta().building).toMatchObject({ connected: false, stopped: true });
    await api.resume();
    expect(api.meta().building).not.toHaveProperty('stopped');
  });

  it('o status traz o tema guardado (ausente no automático)', async () => {
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0, now: () => OCT });
    expect((await api.status()).ok && (await api.status()).ok).toBe(true);
    const before = await api.status();
    expect(before.ok && before.data.theme).toBeUndefined();
    await api.setTheme('halloween');
    const after = await api.status();
    expect(after.ok && after.data.theme).toBe('halloween');
  });

  it('conexão caída: reconectando até retomar; sair da conta tira o prédio do meta', async () => {
    const api = new FakeWorldApi({ state: 'approved', delayMs: 0 });
    api.dropConnection();
    expect(api.meta().building).toMatchObject({ connected: false, paused: false });
    await api.logout();
    expect(api.meta()).toEqual({ enabled: true, configured: true, state: 'logged_out' });
  });
});

describe('conta e dados (Fase 6)', () => {
  it('excluir a conta e baixar os dados vão para as rotas do contrato; o JSON vem formatado para salvar', async () => {
    const { calls, api } = recorder(200, { account: { email: 'a@b.co' }, likesGiven: [] });
    expect(await api.requestAccountDeletion()).toEqual({ ok: true, data: null });
    expect(await api.confirmAccountDeletion({ code: '123456' })).toEqual({ ok: true, data: null });
    const exp = await api.exportData();
    expect(exp).toEqual({ ok: true, data: '{\n  "account": {\n    "email": "a@b.co"\n  },\n  "likesGiven": []\n}\n' });
    expect(calls.map((c) => `${c.init?.method} ${c.url} ${c.init?.body ?? ''}`)).toEqual([
      'POST /api/world/delete-account {}',
      'POST /api/world/delete-account/confirm {"code":"123456"}',
      'GET /api/world/export ',
    ]);
    expect((await recorder(200, [1]).api.exportData()).ok).toBe(false);
    expect(await recorder(429, { error: { code: 'rate_limited', retryAfter: 86400 } }).api.exportData()).toMatchObject({ ok: false, code: 'rate_limited', status: 429 });
    expect(await recorder(503, { error: { code: 'maintenance' } }).api.status()).toMatchObject({ ok: false, code: 'maintenance', status: 503 });
  });

  it('status: o id da conta (só um id limpo) e o selo "não verificado" do prédio', () => {
    const base = { available: true, configured: true, state: 'approved' };
    expect(parseWorldStatus({ ...base, account: { emailMasked: 'a***@b.co', access: 'approved', id: 'acc_1' } })?.account).toEqual({ emailMasked: 'a***@b.co', access: 'approved', id: 'acc_1' });
    expect(parseWorldStatus({ ...base, account: { emailMasked: 'a***@b.co', access: 'approved', id: '<x>' } })?.account).toEqual({ emailMasked: 'a***@b.co', access: 'approved' });
    expect(parseBuilding({ connected: true, paused: false, floors: 1, agents: 1, unverified: true })?.unverified).toBe(true);
    expect(parseBuilding({ connected: true, paused: false, floors: 1, agents: 1, unverified: 'sim' })?.unverified).toBeUndefined();
    expect(parseWorldStatus({ ...base, player: { name: 'P', look: 'f', parts: {}, traits: [], intro: 'hello', visibility: { notifyInactivity: false } } })?.player?.visibility.notifyInactivity).toBe(false);
  });

  it('FakeWorldApi: excluir a conta pede o código; o certo tira a conta e deixa o aviso; exportar uma vez por dia', async () => {
    const api = new FakeWorldApi({ delayMs: 0, state: 'approved' });
    await api.setTheme('halloween');
    const data = await api.exportData();
    expect(data.ok && JSON.parse(data.data)).toMatchObject({ account: { email: FAKE_EMAIL }, player: { name: 'Pixel Dev' } });
    expect(await api.exportData()).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(await api.confirmAccountDeletion({ code: FAKE_CODE })).toMatchObject({ ok: false, code: 'invalid_code' });
    expect((await api.requestAccountDeletion()).ok).toBe(true);
    expect(await api.confirmAccountDeletion({ code: '000000' })).toMatchObject({ ok: false, code: 'invalid_code' });
    expect((await api.confirmAccountDeletion({ code: FAKE_CODE })).ok).toBe(true);
    const st = await api.status();
    expect(st.ok && st.data).toEqual({ available: true, configured: true, state: 'logged_out', lastError: 'account_deleted' });
    expect(api.meta()).toEqual({ enabled: true, configured: true, state: 'logged_out' });
    expect(await api.login({ email: FAKE_EMAIL, password: FAKE_PASSWORD })).toMatchObject({ ok: false, code: 'invalid_credentials' });
  });

  it('FakeWorldApi: manutenção no status e o prédio sem conexão até acabar', async () => {
    const api = new FakeWorldApi({ delayMs: 0, state: 'approved' });
    api.setMaintenance(true);
    let st = await api.status();
    expect(st.ok && st.data).toMatchObject({ lastError: 'maintenance', building: { connected: false } });
    api.setMaintenance(false);
    st = await api.status();
    expect(st.ok && st.data.lastError).toBeUndefined();
    expect(st.ok && st.data.building?.connected).toBe(true);
  });

  it('FakeWorldApi: o "mundo" marca o prédio como não verificado e o aviso de inatividade fica na visibilidade', async () => {
    const api = new FakeWorldApi({ delayMs: 0, state: 'approved' });
    api.markUnverified(true);
    let st = await api.status();
    expect(st.ok && st.data.building?.unverified).toBe(true);
    api.markUnverified(false);
    st = await api.status();
    expect(st.ok && st.data.building?.unverified).toBeUndefined();
    const vis = st.ok ? st.data.player!.visibility : undefined;
    expect((await api.saveVisibility({ ...vis!, notifyInactivity: false })).ok).toBe(true);
    st = await api.status();
    expect(st.ok && st.data.player?.visibility.notifyInactivity).toBe(false);
  });
});
