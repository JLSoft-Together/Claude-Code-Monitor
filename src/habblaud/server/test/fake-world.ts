// Servidor do Habblaud World de mentira, para os testes do lado local (server/world/): as rotas REST do contrato da
// Fase 1, em memória, com um ALTCHA de verdade (pequeno) e o registro de cada requisição recebida; e o WebSocket
// (`/v1/socket`, fase 2) feito à mão sobre o `upgrade` do http (RFC 6455, só texto, sem extensões: o Habblaud não tem
// o pacote `ws`), que responde ao `hello` como o servidor de verdade, confirma cada `uplink` e responde ao `ping`.
// Fase 3: depois do DELETE /v1/me/building, os pacotes são recusados com `left` até o POST /v1/me/building/join; a
// cidade (view, move...) é só registrada em `messages`: os testes mandam a área e os jogadores com `conn.send`.
// Fase 6: excluir a conta (código FAKE_CODE; as conexões da conta recebem `goodbye: deleted`), exportar os dados (uma
// vez por dia: a segunda vira 429), o aviso de inatividade na visibilidade e a manutenção (`options.maintenance`: 503
// `maintenance` em toda rota REST e `goodbye: deploy` a cada `hello`).
import { createHash, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import {
  GREETING_IDS,
  VISIBILITY_DEFAULTS,
  type GoodbyeReason,
  type HelloMessage,
  type Player,
  type PlayerInput,
  type Visibility,
  type WorldAccess,
  type WorldUplink,
} from '../../shared/world/protocol';
import { parsePlayerName, playerNameKey } from '../../shared/world/names-rules';

export interface FakeRequest {
  method: string;
  path: string;
  authorization?: string;
  userAgent?: string;
  contentType?: string;
  body?: Record<string, unknown>;
}

interface Account {
  email: string;
  password: string;
  verified: boolean;
  access: WorldAccess;
  code: string;
  player?: Player;
  /** O nome de jogador do cadastro, reservado até o personagem existir (conta antiga: ausente). */
  reservedName?: string;
  locale: string;
  invite?: string;
  /** Prédio pausado pelo dono (POST /v1/me/building/pause). */
  buildingPaused?: boolean;
  /** Quantas vezes o dono saiu do mundo (DELETE /v1/me/building). */
  buildingLeft?: number;
  /** Fora do mundo agora (DELETE sem o join depois): o pacote é recusado com `left`. */
  left?: boolean;
  /** Quantas vezes voltou ao mundo (POST /v1/me/building/join). */
  buildingJoined?: number;
  /** Aviso de inatividade por e-mail (ausente = nunca mandado; o servidor de verdade guarda true por padrão). */
  notifyInactivity?: boolean;
  /** POST /v1/me/delete pedido (o código é FAKE_CODE). */
  deleteRequested?: boolean;
  /** Exportações feitas (GET /v1/me/export; a segunda no mesmo "dia" recebe 429). */
  exports?: number;
  /** Campos a mais no GET /v1/me (Fase 5: `building` com likes do dia, código e resumo; `blocked`). */
  meExtra?: Record<string, unknown>;
}

/** Uma conexão do WebSocket de mentira. */
export interface FakeConnection {
  id: number;
  /** Quando a conexão abriu (ms). */
  openedAt: number;
  /** E-mail da conta, depois do `welcome`. */
  email?: string;
  /** Caminho e query do pedido de upgrade (o token nunca pode estar aqui). */
  url: string;
  headers: http.IncomingHttpHeaders;
  open: boolean;
  /** Fechou com frame de close (true) ou caiu (false); undefined enquanto aberta. */
  closedCleanly?: boolean;
  /** Mensagens recebidas, em ordem. */
  messages: Array<Record<string, unknown>>;
  send(msg: unknown): void;
  /** Manda `goodbye` e fecha (como o servidor de verdade). */
  goodbye(reason: GoodbyeReason): void;
  /** Derruba o TCP sem fechamento (queda de rede). */
  drop(): void;
}

export interface FakeSocketOptions {
  /**
   * Resposta ao `hello`: `auto` confere o token, a lista de espera e o personagem como o servidor de verdade; um motivo
   * força o `goodbye`; `silent` não responde.
   */
  hello: 'auto' | 'welcome' | 'silent' | GoodbyeReason;
  /** Resposta a cada `uplink`: `ok` ({at, bytes}), `silent`, ou o código de erro do ack. */
  ack: 'ok' | 'silent' | string;
  /** Responde `pong` ao `ping`. */
  pong: boolean;
  /** Responde ao close do cliente (false = servidor mudo: a conexão fica pendurada). */
  answerClose: boolean;
  /** O prédio que vai no `welcome` (WorldBuildingPublic), se houver. */
  building?: Record<string, unknown>;
}

export interface FakeSocket {
  connections: FakeConnection[];
  hellos: HelloMessage[];
  /** Cada uplink recebido, com os bytes do JSON do pacote. */
  uplinks: Array<{ conn: number; uplink: WorldUplink; bytes: number; at: number }>;
  pings: number;
  options: FakeSocketOptions;
  /** Conexões abertas agora. */
  readonly open: FakeConnection[];
}

export interface FakeWorld {
  base: string;
  ws: FakeSocket;
  requests: FakeRequest[];
  accounts: Map<string, Account>;
  /** token -> {email, deviceId} (só os válidos). */
  devices: Map<string, { email: string; deviceId: string }>;
  /**
   * Login exige ALTCHA (simula "muitas tentativas"); `pauseDelayMs` atrasa só a resposta de /v1/me/building/pause;
   * `buildingFailures` faz as próximas N chamadas de /v1/me/building* responderem 503.
   */
  options: { loginNeedsAltcha: boolean; altchaMax: number; delayMs: number; pauseDelayMs: number; buildingFailures: number; maintenance: boolean };
  close(): Promise<void>;
}

const SECRET = 'fake-world-secret';
export const FAKE_CODE = '123456';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export async function startFakeWorld(): Promise<FakeWorld> {
  const requests: FakeRequest[] = [];
  const accounts = new Map<string, Account>();
  const devices = new Map<string, { email: string; deviceId: string }>();
  const options = { loginNeedsAltcha: false, altchaMax: 2_000, delayMs: 0, pauseDelayMs: 0, buildingFailures: 0, maintenance: false };
  let deviceSeq = 0;

  const send = (res: http.ServerResponse, status: number, body?: unknown) => {
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(data);
  };
  const error = (res: http.ServerResponse, status: number, code: string) => send(res, status, { error: { code, message: `fake ${code}` } });

  const altchaOk = (payload: unknown): boolean => {
    try {
      const p = JSON.parse(Buffer.from(String(payload), 'base64').toString('utf8')) as Record<string, unknown>;
      const signature = createHmac('sha256', SECRET).update(String(p.challenge)).digest('hex');
      return p.algorithm === 'SHA-256' && p.signature === signature && sha256(`${p.salt}${p.number}`) === p.challenge && typeof p.took === 'number';
    } catch {
      return false;
    }
  };
  const newDevice = (email: string) => {
    const token = randomBytes(32).toString('base64url');
    const deviceId = `dev_${++deviceSeq}`;
    devices.set(token, { email, deviceId });
    return { deviceId, token, access: accounts.get(email)!.access };
  };
  /** O nome (pela chave) já é de outra conta: reservado no cadastro ou de um personagem. */
  const nameTaken = (key: string, self: Account | undefined): boolean =>
    [...accounts.values()].some((o) => o !== self && (o.player ? playerNameKey(o.player.name) === key : o.reservedName !== undefined && playerNameKey(o.reservedName) === key));
  const me = (email: string, token: string) => {
    const a = accounts.get(email)!;
    const list = [...devices.entries()].filter(([, d]) => d.email === email);
    return {
      account: {
        emailMasked: `${email[0]}***${email.slice(email.indexOf('@'))}`,
        access: a.access,
        locale: a.locale,
        createdAt: '2026-10-15T00:00:00Z',
        reservedName: a.player ? null : (a.reservedName ?? null),
      },
      ...(a.player ? { player: a.player } : {}),
      left: !!a.left,
      devices: list.map(([t, d], i) => ({ id: d.deviceId, label: `Dispositivo ${i + 1}`, createdAt: '2026-10-15T00:00:00Z', lastSeenAt: '2026-10-15T00:00:00Z', current: t === token })),
      ...a.meExtra,
    };
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> | undefined;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        return error(res, 400, 'invalid');
      }
      const path = (req.url ?? '/').split('?')[0];
      const method = req.method ?? 'GET';
      requests.push({
        method,
        path,
        authorization: req.headers.authorization,
        userAgent: req.headers['user-agent'],
        contentType: req.headers['content-type'],
        body,
      });
      if (options.delayMs) await new Promise((ok) => setTimeout(ok, options.delayMs));
      if (options.maintenance) return error(res, 503, 'maintenance');
      const b = body ?? {};
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
      const device = bearer ? devices.get(bearer) : undefined;
      const needAuth = path.startsWith('/v1/me') || path === '/v1/auth/logout';
      if (needAuth && !device) return error(res, 401, 'unauthorized');

      if (method === 'GET' && path === '/v1/altcha') {
        const salt = `s${randomBytes(6).toString('hex')}?expires=${Date.now() + 600_000}`;
        const n = Math.floor(Math.random() * options.altchaMax);
        const challenge = sha256(`${salt}${n}`);
        return send(res, 200, { algorithm: 'SHA-256', challenge, salt, maxnumber: options.altchaMax, signature: createHmac('sha256', SECRET).update(challenge).digest('hex') });
      }
      if (method === 'POST' && path === '/v1/auth/register') {
        // O nome é conferido antes do ALTCHA e da senha; `name_taken` vale contra reservas e personagens de qualquer conta.
        const name = parsePlayerName(b.name);
        if (!name.ok) return error(res, 422, name.code);
        if (nameTaken(name.key, undefined)) return error(res, 409, 'name_taken');
        if (!altchaOk(b.altcha)) return error(res, 400, 'altcha_invalid');
        if (b.tos !== 'v1' || typeof b.email !== 'string' || typeof b.password !== 'string') return error(res, 400, 'invalid');
        if (!accounts.has(b.email)) {
          accounts.set(b.email, { email: b.email, password: b.password, verified: false, access: 'waiting', code: FAKE_CODE, locale: String(b.locale), invite: b.invite as string | undefined, reservedName: name.name });
        }
        return send(res, 202, {});
      }
      if (method === 'POST' && path === '/v1/auth/verify') {
        const a = accounts.get(String(b.email));
        if (!a || b.code !== a.code) return error(res, 400, 'invalid_code');
        a.verified = true;
        return send(res, 200, newDevice(a.email));
      }
      if (method === 'POST' && path === '/v1/auth/login') {
        if (options.loginNeedsAltcha && !altchaOk(b.altcha)) return error(res, 400, 'altcha_required');
        const a = accounts.get(String(b.email));
        if (!a || a.password !== b.password) return error(res, 401, 'invalid_credentials');
        if (!a.verified) return error(res, 403, 'email_not_verified');
        return send(res, 200, newDevice(a.email));
      }
      if (method === 'POST' && path === '/v1/auth/logout') {
        devices.delete(bearer!);
        return send(res, 204);
      }
      if (method === 'POST' && (path === '/v1/auth/resend' || path === '/v1/auth/password/forgot')) {
        return altchaOk(b.altcha) ? send(res, 202, {}) : error(res, 400, 'altcha_invalid');
      }
      if (method === 'POST' && path === '/v1/auth/password/reset') {
        const a = accounts.get(String(b.email));
        if (!a || b.code !== a.code) return error(res, 400, 'invalid_code');
        a.password = String(b.password);
        for (const [t, d] of devices) if (d.email === a.email) devices.delete(t);
        return send(res, 204);
      }
      if (method === 'GET' && path === '/v1/me') return send(res, 200, me(device!.email, bearer!));
      if (method === 'PUT' && path === '/v1/me/player') {
        const a = accounts.get(device!.email)!;
        const input = b as unknown as PlayerInput;
        // Criando com reserva: o nome É a reserva (o `name` do corpo é ignorado); sem reserva, o `name` é obrigatório.
        // Atualizando, `name` ausente mantém.
        const raw = !a.player && a.reservedName ? a.reservedName : input.name === undefined && a.player ? a.player.name : input.name;
        const name = parsePlayerName(raw);
        if (!name.ok) return error(res, 422, name.code);
        if (nameTaken(name.key, a)) return error(res, 409, 'name_taken');
        a.player = { ...input, name: name.name, visibility: a.player?.visibility ?? { ...VISIBILITY_DEFAULTS }, updatedAt: '2026-10-15T12:00:00Z', country: 'BR' };
        delete a.reservedName;
        return send(res, 200, { ...a.player, internalScore: 99 });
      }
      if (method === 'PUT' && path === '/v1/me/visibility') {
        const a = accounts.get(device!.email)!;
        const { notifyInactivity, ...rest } = b as unknown as Visibility;
        if (typeof notifyInactivity === 'boolean') a.notifyInactivity = notifyInactivity;
        // Como um servidor antigo, só devolve o aviso depois que alguém o mandou.
        const v: Visibility = { ...rest, ...(a.notifyInactivity !== undefined ? { notifyInactivity: a.notifyInactivity } : {}) };
        if (a.player) a.player.visibility = v;
        return send(res, 200, v);
      }
      if (method === 'POST' && path === '/v1/me/delete') {
        accounts.get(device!.email)!.deleteRequested = true;
        return send(res, 202, {});
      }
      if (method === 'POST' && path === '/v1/me/delete/confirm') {
        const email = device!.email;
        const a = accounts.get(email)!;
        if (!a.deleteRequested || b.code !== FAKE_CODE) return error(res, 400, 'invalid_code');
        accounts.delete(email);
        for (const [t, d] of devices) if (d.email === email) devices.delete(t);
        for (const c of ws.connections) if (c.open && c.email === email) c.goodbye('deleted');
        return send(res, 204);
      }
      if (method === 'GET' && path === '/v1/me/export') {
        const a = accounts.get(device!.email)!;
        a.exports = (a.exports ?? 0) + 1;
        if (a.exports > 1) {
          res.setHeader('Retry-After', '86400');
          return error(res, 429, 'rate_limited');
        }
        // No formato de WorldExport (protocol.ts), com o que o falso sabe.
        return send(res, 200, {
          format: 'habblaud-world-export',
          version: 1,
          exportedAt: '2026-10-15T12:00:00Z',
          account: {
            id: 'acc_1', email: a.email, locale: a.locale, access: a.access, createdAt: '2026-10-15T00:00:00Z', notifyInactivity: a.notifyInactivity ?? true,
            reservedName: a.player ? null : (a.reservedName ?? null), country: 'BR', signupIp: '127.0.0.1', lastLoginIp: '127.0.0.1', lastLoginAt: '2026-10-15T00:00:00Z',
          },
          player: a.player ?? null,
          visibility: a.player?.visibility ?? null,
          devices: [...devices.values()].filter((d) => d.email === a.email).map((_d, i) => ({ label: `Dispositivo ${i + 1}`, createdAt: '2026-10-15T00:00:00Z', lastSeenAt: '2026-10-15T00:00:00Z', revokedAt: null })),
          building: null,
          likesGiven: [],
          blocks: [],
          reportsMade: [],
          stampsReceived: [],
        });
      }
      if (path.startsWith('/v1/me/building') && options.buildingFailures > 0) {
        options.buildingFailures--;
        return error(res, 503, 'unavailable');
      }
      if (method === 'DELETE' && path === '/v1/me/building') {
        const a = accounts.get(device!.email)!;
        a.buildingLeft = (a.buildingLeft ?? 0) + 1;
        a.buildingPaused = false;
        a.left = true;
        return send(res, 204);
      }
      if (method === 'POST' && path === '/v1/me/building/join') {
        const a = accounts.get(device!.email)!;
        a.buildingJoined = (a.buildingJoined ?? 0) + 1;
        a.left = false;
        return send(res, 200, { state: 'joined' });
      }
      if (method === 'POST' && (path === '/v1/me/building/pause' || path === '/v1/me/building/resume')) {
        const a = accounts.get(device!.email)!;
        if (path.endsWith('/pause') && options.pauseDelayMs) await new Promise((ok) => setTimeout(ok, options.pauseDelayMs));
        a.buildingPaused = path.endsWith('/pause');
        return send(res, 200, { state: a.buildingPaused ? 'paused' : 'online' });
      }
      const revoke = /^\/v1\/me\/devices\/([^/]+)\/revoke$/.exec(path);
      if (method === 'POST' && revoke) {
        const found = [...devices.entries()].find(([, d]) => d.email === device!.email && d.deviceId === revoke[1]);
        if (!found) return error(res, 404, 'not_found');
        devices.delete(found[0]);
        return send(res, 204);
      }
      return error(res, 404, 'not_found');
    });
  });
  const ws = attachFakeSocket(server, { accounts, devices, options });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ws,
    requests,
    accounts,
    devices,
    options,
    close: () =>
      new Promise<void>((ok) => {
        for (const c of ws.connections) c.drop();
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// WebSocket (RFC 6455) mínimo
// ---------------------------------------------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

function attachFakeSocket(
  server: http.Server,
  world: { accounts: Map<string, Account>; devices: Map<string, { email: string; deviceId: string }>; options: { maintenance: boolean } },
): FakeSocket {
  const fake: FakeSocket = {
    connections: [],
    hellos: [],
    uplinks: [],
    pings: 0,
    options: { hello: 'auto', ack: 'ok', pong: true, answerClose: true },
    get open() {
      return this.connections.filter((c) => c.open);
    },
  };
  server.on('upgrade', (req: http.IncomingMessage, socket: Socket) => {
    const key = req.headers['sec-websocket-key'];
    if ((req.url ?? '').split('?')[0] !== '/v1/socket' || typeof key !== 'string') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    // Sem Sec-WebSocket-Extensions: o cliente oferece permessage-deflate, e aqui fica tudo sem compressão.
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    let buf = Buffer.alloc(0);
    let fragments: Buffer[] = [];
    let welcomed = false;
    let account: Account | undefined;
    const conn: FakeConnection = {
      id: fake.connections.length + 1,
      openedAt: Date.now(),
      url: req.url ?? '',
      headers: req.headers,
      open: true,
      messages: [],
      send: (msg) => {
        if (conn.open) socket.write(frame(0x1, Buffer.from(JSON.stringify(msg))));
      },
      goodbye: (reason) => {
        conn.send({ t: 'goodbye', reason });
        close(1000);
      },
      drop: () => {
        conn.open = false;
        conn.closedCleanly ??= false;
        socket.destroy();
      },
    };
    fake.connections.push(conn);
    const close = (code: number) => {
      if (!conn.open) return;
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      socket.write(frame(0x8, payload));
      conn.open = false;
      conn.closedCleanly = true;
      socket.end();
    };
    const onHello = (hello: HelloMessage) => {
      fake.hellos.push(hello);
      let answer = fake.options.hello;
      if (answer === 'silent') return;
      // Em manutenção, o servidor de verdade manda todo mundo embora com `deploy` (e o cliente tenta de novo, com espera).
      if (world.options.maintenance) return conn.goodbye('deploy');
      if (answer === 'auto') {
        const device = world.devices.get(String(hello.token));
        const account = device ? world.accounts.get(device.email) : undefined;
        answer = !account ? 'unauthorized' : account.access === 'waiting' ? 'waiting' : !account.player ? 'no_player' : 'welcome';
      }
      if (answer !== 'welcome') return conn.goodbye(answer);
      welcomed = true;
      const device = world.devices.get(String(hello.token));
      account = device ? world.accounts.get(device.email) : undefined;
      conn.email = device?.email;
      conn.send({
        t: 'welcome',
        me: { id: 'acc_1', name: 'Ana Pixel', look: 'f', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee', visibility: { ...VISIBILITY_DEFAULTS }, updatedAt: '2026-10-15T12:00:00Z' },
        access: 'approved',
        ...(fake.options.building ? { building: fake.options.building } : {}),
        city: { districts: ['centro'], lotSize: { w: 14, h: 12 }, blockSize: { w: 3, h: 2 } },
        greetings: [...GREETING_IDS],
        minVersion: '0.0.0',
        rev: 0,
      });
    };
    const onText = (text: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return close(1008);
      }
      conn.messages.push(msg);
      if (msg.t === 'hello') return onHello(msg as unknown as HelloMessage);
      if (msg.t === 'ping') {
        fake.pings++;
        if (fake.options.pong) conn.send({ t: 'pong' });
        return;
      }
      if (msg.t === 'uplink' && welcomed) {
        const uplink = msg.uplink as WorldUplink;
        const bytes = Buffer.byteLength(JSON.stringify(uplink));
        const at = Date.now();
        fake.uplinks.push({ conn: conn.id, uplink, bytes, at });
        if (account?.left) conn.send({ t: 'uplink.ack', error: 'left' });
        else if (fake.options.ack === 'ok') conn.send({ t: 'uplink.ack', at, bytes });
        else if (fake.options.ack !== 'silent') conn.send({ t: 'uplink.ack', error: fake.options.ack });
      }
    };
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const maskOff = off;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[maskOff + (i % 4)];
        buf = buf.subarray(off + len);
        if (opcode === 0x8) {
          if (fake.options.answerClose) return close(1000);
          continue;
        }
        if (opcode === 0x9) {
          socket.write(frame(0xa, payload));
          continue;
        }
        if (opcode === 0xa) continue;
        if (opcode === 0x1 || opcode === 0x0) {
          fragments.push(payload);
          if (!fin) continue;
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          onText(text);
        }
      }
    });
    const gone = () => {
      if (conn.open) {
        conn.open = false;
        conn.closedCleanly ??= false;
      }
    };
    socket.on('close', gone);
    socket.on('error', gone);
  });
  return fake;
}
