// WorldService: a releitura automática de /v1/me na lista de espera (relógio falso; o resto do serviço é coberto pelas
// rotas em http.test.ts).
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse, WorldAccess } from '../../shared/world/protocol';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import type { WorldClient, WorldResult } from './client';
import { WAITING_POLL_MS, WorldService } from './service';
import { WorldSettingsStore } from './settings';

setQuiet(true);

const TOKEN = 't'.repeat(43);

/** `extra`: campos a mais do /v1/me (`player`, `account.reservedName`...). */
function me(access: WorldAccess, extra: Omit<Partial<MeResponse>, 'account'> & { account?: Partial<MeResponse['account']> } = {}): WorldResult<MeResponse> {
  const { account, ...rest } = extra;
  return {
    ok: true,
    status: 200,
    data: { account: { emailMasked: 'a***@exemplo.com', access, locale: 'pt-BR', createdAt: '', ...account }, devices: [], ...rest },
  };
}

const PLAYER = { name: 'Ana Pixel', look: 'f' as const, parts: {}, traits: ['games' as const, 'cafeina' as const], intro: 'coffee' as const, visibility: { mode: 'live' as const, closed: false, hideCountry: false, tokensVisible: true, leaderboard: false, compactions: false }, updatedAt: '' };

describe('WorldService: lista de espera', () => {
  let cleanup: () => void;
  let store: WorldSettingsStore;
  let services: WorldService[];

  beforeEach(() => {
    vi.useFakeTimers();
    const t = tempDir();
    cleanup = t.cleanup;
    store = new WorldSettingsStore(join(t.dir, 'world.json'));
    services = [];
  });

  afterEach(() => {
    services.forEach((s) => s.stop());
    vi.useRealTimers();
    cleanup();
  });

  function start(opts: { access?: WorldAccess | null; terminal?: boolean; meFn?: () => Promise<WorldResult<MeResponse>>; putPlayer?: WorldClient['putPlayer'] } = {}) {
    const access = opts.access === undefined ? 'waiting' : opts.access;
    if (access) store.save({ deviceId: 'dev1', token: TOKEN, email: 'ana@exemplo.com', access });
    const meFn = vi.fn(opts.meFn ?? (async () => me('waiting')));
    const logout = vi.fn(async () => ({ ok: true as const, status: 204, data: {} }));
    const client = { me: meFn, logout, putPlayer: opts.putPlayer } as unknown as WorldClient;
    const onChange = vi.fn();
    const service = new WorldService({ config: { enabled: true, dev: true, url: 'http://127.0.0.1:1' }, terminal: opts.terminal ?? true, store, client, onChange });
    services.push(service);
    return { service, meFn, logout, onChange };
  }

  it('relê /v1/me a cada 30 min enquanto espera e vira "approved" sozinho, avisando o snapshot', async () => {
    let access: WorldAccess = 'waiting';
    const { service, meFn, onChange } = start({ meFn: async () => me(access) });
    expect(WAITING_POLL_MS).toBe(30 * 60_000);

    await vi.advanceTimersByTimeAsync(WAITING_POLL_MS - 1);
    expect(meFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(meFn).toHaveBeenCalledTimes(1);
    expect(service.state()).toBe('waiting');
    expect(onChange).not.toHaveBeenCalled();

    access = 'approved';
    await vi.advanceTimersByTimeAsync(WAITING_POLL_MS);
    expect(meFn).toHaveBeenCalledTimes(2);
    expect(service.state()).toBe('approved');
    expect(service.meta()).toEqual({ enabled: true, configured: true, state: 'approved' });
    expect(store.get()?.access).toBe('approved');
    expect(onChange).toHaveBeenCalledTimes(1);

    // Aprovada: para de perguntar.
    await vi.advanceTimersByTimeAsync(4 * WAITING_POLL_MS);
    expect(meFn).toHaveBeenCalledTimes(2);
  });

  it('o nome reservado no cadastro vai ao status (/v1/me com reservedName) e some com o personagem', async () => {
    const a = start({ meFn: async () => me('waiting', { account: { reservedName: 'Ana Pixel' } }) });
    expect((await a.service.status(true)).account).toEqual({ emailMasked: 'a***@exemplo.com', access: 'waiting', reservedName: 'Ana Pixel' });
    const b = start({ meFn: async () => me('waiting') });
    expect((await b.service.status(true)).account).not.toHaveProperty('reservedName');
    const c = start({ meFn: async () => me('waiting', { account: { reservedName: 'Ana Pixel' }, player: PLAYER }) });
    expect((await c.service.status(true)).account).not.toHaveProperty('reservedName');
  });

  it('criar o personagem: sem name com a reserva (o pedido vai sem name); conta antiga sem reserva exige o name', async () => {
    const putPlayer = vi.fn(async (_token: string, body: unknown) => ({ ok: true as const, status: 200, data: { ...PLAYER, ...(body as object) } }));
    const withReserve = start({ meFn: async () => me('waiting', { account: { reservedName: 'Ana Pixel' } }), putPlayer });
    await withReserve.service.status(true);
    const r = await withReserve.service.setCharacter({ name: 'Outro Nome', look: 'f', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee' });
    expect(r.ok).toBe(true);
    expect(putPlayer).toHaveBeenCalledTimes(1);
    expect(putPlayer.mock.calls[0][1]).toEqual({ look: 'f', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee' });

    store.clear();
    const old = start({ meFn: async () => me('waiting'), putPlayer });
    await old.service.status(true);
    expect(await old.service.setCharacter({ look: 'f', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee' })).toEqual({ ok: false, status: 422, code: 'name_invalid' });
    expect(putPlayer).toHaveBeenCalledTimes(1);
    expect((await old.service.setCharacter({ name: 'Ana Pixel', look: 'f', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee' })).ok).toBe(true);
    expect(putPlayer.mock.calls[1][1]).toMatchObject({ name: 'Ana Pixel' });
  });

  it('meta.world.scene: só com a conta aprovada e o personagem; available pede a trava do terminal', () => {
    const player = PLAYER;
    const a = start({ access: 'approved' });
    expect(a.service.meta()).not.toHaveProperty('scene');
    store.update({ player });
    expect(a.service.meta().scene).toEqual({ available: true });
    const b = start({ access: 'approved', terminal: false });
    store.update({ player });
    expect(b.service.meta().scene).toEqual({ available: false });
  });

  it('servidor fora do ar: continua tentando no mesmo ritmo, com lastError network', async () => {
    const { service, meFn } = start({ meFn: async () => ({ ok: false, status: 502, code: 'world_unreachable' }) });
    await vi.advanceTimersByTimeAsync(2 * WAITING_POLL_MS);
    expect(meFn).toHaveBeenCalledTimes(2);
    expect(service.state()).toBe('waiting');
    expect((await service.status()).lastError).toBe('network');
  });

  it('token recusado (401): apaga a sessão e para', async () => {
    const { service, meFn } = start({ meFn: async () => ({ ok: false, status: 401, code: 'unauthorized' }) });
    await vi.advanceTimersByTimeAsync(WAITING_POLL_MS);
    expect(service.state()).toBe('logged_out');
    await vi.advanceTimersByTimeAsync(3 * WAITING_POLL_MS);
    expect(meFn).toHaveBeenCalledTimes(1);
  });

  it('não relê sem conta, já aprovado, sem a trava do terminal, depois de sair ou de stop()', async () => {
    const none = start({ access: null });
    const approved = start({ access: 'approved' });
    await vi.advanceTimersByTimeAsync(2 * WAITING_POLL_MS);
    expect(none.meFn).not.toHaveBeenCalled();
    expect(approved.meFn).not.toHaveBeenCalled();

    store.clear();
    const noTerminal = start({ terminal: false });
    await vi.advanceTimersByTimeAsync(2 * WAITING_POLL_MS);
    expect(noTerminal.meFn).not.toHaveBeenCalled();

    store.clear();
    const out = start();
    await out.service.logout();
    await vi.advanceTimersByTimeAsync(2 * WAITING_POLL_MS);
    expect(out.meFn).not.toHaveBeenCalled();

    const stopped = start();
    stopped.service.stop();
    await vi.advanceTimersByTimeAsync(2 * WAITING_POLL_MS);
    expect(stopped.meFn).not.toHaveBeenCalled();
  });
});

describe('WorldService: status barato', () => {
  it('sem refresh: responde da memória e relê em segundo plano quando venceu; com refresh, espera', async () => {
    const t = tempDir();
    try {
      const store = new WorldSettingsStore(join(t.dir, 'world.json'));
      store.save({ deviceId: 'dev1', token: TOKEN, email: 'ana@exemplo.com', access: 'approved' });
      let now = 1_000_000;
      let release: (() => void) | undefined;
      let slow = false;
      const meFn = vi.fn(async () => {
        if (slow) await new Promise<void>((ok) => (release = ok));
        return me('approved');
      });
      const client = { me: meFn } as unknown as WorldClient;
      const service = new WorldService({ config: { enabled: true, dev: true, url: 'http://127.0.0.1:1' }, terminal: true, store, client, now: () => now, meTtlMs: 30_000 });
      // Nada guardado ainda: espera a primeira leitura.
      expect((await service.status()).account?.emailMasked).toBe('a***@exemplo.com');
      expect(meFn).toHaveBeenCalledTimes(1);
      // Dentro do prazo: nem toca na rede.
      now += 10_000;
      await service.status();
      expect(meFn).toHaveBeenCalledTimes(1);
      // Venceu e o servidor demora: responde na hora com o que tem e relê por trás.
      now += 30_000;
      slow = true;
      const st = await service.status();
      expect(st.state).toBe('approved');
      expect(meFn).toHaveBeenCalledTimes(2);
      release!();
      await new Promise((ok) => setImmediate(ok));
      // Com refresh, espera a leitura.
      slow = false;
      await service.status(true);
      expect(meFn).toHaveBeenCalledTimes(3);
      service.stop();
    } finally {
      t.cleanup();
    }
  });
});

describe('WorldService: retomada sem resposta do servidor do mundo', () => {
  let cleanup: () => void;
  let store: WorldSettingsStore;
  let services: WorldService[];

  beforeEach(() => {
    vi.useFakeTimers();
    const t = tempDir();
    cleanup = t.cleanup;
    store = new WorldSettingsStore(join(t.dir, 'world.json'));
    store.save({ deviceId: 'dev1', token: TOKEN, email: 'ana@exemplo.com', access: 'approved' });
    services = [];
  });

  afterEach(() => {
    services.forEach((s) => s.stop());
    vi.useRealTimers();
    cleanup();
  });

  type Reply = WorldResult<{ state: 'online' }>;
  const ok: Reply = { ok: true, status: 200, data: { state: 'online' } };
  const down: Reply = { ok: false, status: 502, code: 'world_unreachable' };

  /** `replies`: as respostas do resume, em ordem (depois delas, sempre ok). */
  function start(replies: Reply[]) {
    const resumeBuilding = vi.fn(async () => replies.shift() ?? ok);
    const pauseBuilding = vi.fn(async () => ({ ok: true as const, status: 200, data: { state: 'paused' as const } }));
    const client = { me: async () => me('approved'), resumeBuilding, pauseBuilding } as unknown as WorldClient;
    // random 0.5: a espera é exatamente a base (2 s, 4 s, 8 s...).
    const service = new WorldService({ config: { enabled: true, dev: true, url: 'http://127.0.0.1:1' }, terminal: true, store, client, random: () => 0.5 });
    services.push(service);
    return { service, resumeBuilding, pauseBuilding };
  }

  it('tenta de novo com a espera crescente da reconexão (2 s, 4 s...) até o servidor confirmar', async () => {
    const { service, resumeBuilding } = start([down, down, { ok: false, status: 503, code: 'unavailable' }]);
    await service.pause();
    expect((await service.resume()).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(resumeBuilding).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(resumeBuilding).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(resumeBuilding).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(resumeBuilding).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(resumeBuilding).toHaveBeenCalledTimes(4);
    // Confirmada: para de tentar.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(resumeBuilding).toHaveBeenCalledTimes(4);
  });

  it('pausar (ou sair) de novo cancela as tentativas; 4xx não insiste; o Retry-After maior vale', async () => {
    const a = start([down]);
    await a.service.pause();
    a.service.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.resumeBuilding).toHaveBeenCalledTimes(1);
    await a.service.pause();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(a.resumeBuilding).toHaveBeenCalledTimes(1);
    a.service.stop();

    const b = start([{ ok: false, status: 409, code: 'conflict' }]);
    b.service.resume();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(b.resumeBuilding).toHaveBeenCalledTimes(1);
    b.service.stop();

    const c = start([{ ok: false, status: 429, code: 'rate_limited', retryAfter: 30 }]);
    c.service.resume();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(c.resumeBuilding).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(c.resumeBuilding).toHaveBeenCalledTimes(2);
  });
});
