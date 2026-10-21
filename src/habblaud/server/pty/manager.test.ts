import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ptyRequestProblem } from '../http/pty';
import {
  claudeBinFrom,
  findExecutable,
  fixSpawnHelper,
  isExecutableFile,
  MAX_PTYS,
  PtyError,
  PtyManager,
  spawnProblem,
  type PtyAgentRef,
  type PtyManagerOptions,
  type PtyProcess,
  type PtyScreen,
  type SpawnPty,
} from './manager';
import type { ProcInfo } from './procinfo';

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PID = 4242;
const STARTED = 1_791_557_339_236;

class FakeProc implements PtyProcess {
  data: (d: string) => void = () => {};
  exit: (e: { exitCode: number }) => void = () => {};
  written: string[] = [];
  constructor(readonly pid: number) {}
  onData(cb: (d: string) => void) {
    this.data = cb;
  }
  onExit(cb: (e: { exitCode: number }) => void) {
    this.exit = cb;
  }
  write(d: string) {
    this.written.push(d);
  }
  resize() {}
  kill() {
    this.exit({ exitCode: 0 });
  }
}

interface Setup {
  manager: PtyManager;
  spawned: { args: string[]; cwd: string }[];
  alive: Set<number>;
  killPid: ReturnType<typeof vi.fn>;
  forceKill: ReturnType<typeof vi.fn>;
}

/** Gerenciador com tudo de fora trocado: um agente "acc:4242" aberto noutro terminal, vivo e conferido. */
function setup(over: Partial<Omit<PtyManagerOptions, 'agent'>> & { agent?: Partial<PtyAgentRef>; proc?: ProcInfo | undefined; session?: unknown } = {}): Setup {
  const { agent: agentOver, proc: procOver, session, ...opts } = over;
  const alive = new Set([PID]);
  const spawned: Setup['spawned'] = [];
  let nextPid = 9000;
  const agent: PtyAgentRef = { id: `acc:${PID}`, kind: 'main', account: 'acc', sessionId: SESSION, cwd: tmpdir(), ...agentOver };
  const proc = 'proc' in over ? procOver : { startMs: STARTED - 800, name: 'claude' };
  const killPid = vi.fn((pid: number) => void alive.delete(pid));
  const forceKill = vi.fn((pid: number) => void alive.delete(pid));
  const manager = new PtyManager({
    spawn: (_file, args, o) => {
      spawned.push({ args, cwd: o.cwd });
      return new FakeProc(++nextPid);
    },
    claudeBin: process.execPath,
    accounts: () => [{ id: 'acc', dir: join(tmpdir(), 'conta'), isDefault: true }],
    agent: (id) => (id === agent.id ? agent : undefined),
    onChange: () => {},
    readSession: () => session ?? { sessionId: SESSION, startedAt: STARTED },
    procInfo: async (pid) => (alive.has(pid) ? proc : undefined),
    isAlive: (pid) => alive.has(pid),
    sleep: async () => {},
    killPid,
    forceKill,
    ...opts,
  });
  return { manager, spawned, alive, killPid, forceKill };
}

async function rejects(p: Promise<unknown>, status: number): Promise<PtyError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PtyError);
  expect((err as PtyError).status).toBe(status);
  return err as PtyError;
}

describe('PtyManager: conferir o processo antes de encerrar', () => {
  it('encerra quando registro, início e executável batem', async () => {
    const s = setup();
    await s.manager.stop(`acc:${PID}`);
    expect(s.killPid).toHaveBeenCalledWith(PID, expect.objectContaining({ name: 'claude' }));
  });

  it('recusa quando o registro é de outra sessão', async () => {
    const s = setup({ session: { sessionId: 'outra', startedAt: STARTED } });
    await rejects(s.manager.stop(`acc:${PID}`), 409);
    expect(s.killPid).not.toHaveBeenCalled();
  });

  it('recusa um PID reaproveitado (o processo vivo começou bem depois do registro)', async () => {
    const s = setup({ proc: { startMs: STARTED + 3_600_000, name: 'claude' } });
    await rejects(s.manager.stop(`acc:${PID}`), 409);
    expect(s.killPid).not.toHaveBeenCalled();
  });

  it('recusa quando o executável não é o Claude Code', async () => {
    const s = setup({ proc: { startMs: STARTED - 800, name: 'chrome' } });
    await rejects(s.manager.stop(`acc:${PID}`), 409);
    expect(s.killPid).not.toHaveBeenCalled();
  });

  it('no Windows, o FILETIME do registro tem de ser o exato', async () => {
    const reg = { sessionId: SESSION, startedAt: STARTED, procStart: '134360309381229341' };
    const other = setup({ session: reg, proc: { startMs: STARTED - 800, name: 'claude', fileTime: '134360309381229342' } });
    await rejects(other.manager.stop(`acc:${PID}`), 409);
    const same = setup({ session: reg, proc: { startMs: STARTED - 800, name: 'claude', fileTime: '134360309381229341' } });
    await same.manager.stop(`acc:${PID}`);
    expect(same.killPid).toHaveBeenCalledOnce();
  });

  it('recusa quando não dá para saber nada do processo', async () => {
    const s = setup({ proc: undefined });
    await rejects(s.manager.stop(`acc:${PID}`), 409);
    expect(s.killPid).not.toHaveBeenCalled();
  });
});

describe('PtyManager: assumir', () => {
  it('encerra lá e retoma a mesma conversa aqui', async () => {
    const s = setup();
    const info = await s.manager.takeover(`acc:${PID}`);
    expect(s.killPid).toHaveBeenCalledOnce();
    expect(s.spawned).toEqual([{ args: ['--resume', SESSION], cwd: tmpdir() }]);
    expect(info).toMatchObject({ resumed: SESSION, fromAgent: `acc:${PID}` });
  });

  it('pasta que não existe: recusa antes de encerrar a sessão de lá', async () => {
    const s = setup({ agent: { cwd: join(tmpdir(), 'nao-existe-habblaud-teste') } });
    await rejects(s.manager.takeover(`acc:${PID}`), 400);
    expect(s.killPid).not.toHaveBeenCalled();
    expect(s.alive.has(PID)).toBe(true);
  });

  it('conta desconhecida: recusa antes de encerrar', async () => {
    const s = setup({ agent: { account: 'sumiu', id: `sumiu:${PID}` } });
    await rejects(s.manager.takeover(`sumiu:${PID}`), 400);
    expect(s.killPid).not.toHaveBeenCalled();
  });

  it('limite de terminais: recusa antes de encerrar', async () => {
    const s = setup();
    for (let i = 0; i < MAX_PTYS; i++) s.manager.create({ cwd: tmpdir() });
    await rejects(s.manager.takeover(`acc:${PID}`), 429);
    expect(s.killPid).not.toHaveBeenCalled();
  });

  it('a última vaga fica com a tomada em andamento', async () => {
    const s = setup();
    for (let i = 0; i < MAX_PTYS - 1; i++) s.manager.create({ cwd: tmpdir() });
    const run = s.manager.takeover(`acc:${PID}`);
    expect(() => s.manager.create({ cwd: tmpdir() })).toThrow(/limite/);
    await run;
    expect(s.spawned).toHaveLength(MAX_PTYS);
  });

  it('pedidos simultâneos do mesmo agente abrem um terminal só', async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.manager.takeover(`acc:${PID}`), s.manager.takeover(`acc:${PID}`)]);
    expect(a.id).toBe(b.id);
    expect(s.killPid).toHaveBeenCalledOnce();
    expect(s.spawned).toHaveLength(1);
  });

  it('não saiu a tempo: encerra à força e segue com o --resume', async () => {
    const s = setup({ killPid: vi.fn() });
    await s.manager.takeover(`acc:${PID}`);
    expect(s.forceKill).toHaveBeenCalledWith(PID);
    expect(s.spawned).toHaveLength(1);
  });

  it('nem à força: erro, sem abrir a segunda cópia da conversa', async () => {
    const s = setup({ killPid: vi.fn(), forceKill: vi.fn() });
    const err = await rejects(s.manager.takeover(`acc:${PID}`), 500);
    expect(err.message).toMatch(/continua aberta/);
    expect(s.spawned).toHaveLength(0);
  });

  it('claude que não roda: recusa antes de encerrar', async () => {
    const s = setup({ claudeBin: join(tmpdir(), 'nao-existe-habblaud-claude') });
    await rejects(s.manager.takeover(`acc:${PID}`), 503);
    expect(s.killPid).not.toHaveBeenCalled();
    expect(s.alive.has(PID)).toBe(true);
  });

  it('não abriu aqui depois de encerrar lá: o erro diz como continuar a conversa', async () => {
    const s = setup({
      spawn: () => {
        throw new Error('posix_spawnp failed.');
      },
    });
    const err = await rejects(s.manager.takeover(`acc:${PID}`), 500);
    expect(err.message).toContain(`claude --resume ${SESSION}`);
    expect(err.message).toContain('posix_spawnp failed');
  });

  it('registro antigo (PID reaproveitado): não encerra ninguém', async () => {
    const s = setup({ proc: { startMs: STARTED + 86_400_000, name: 'node' } });
    await rejects(s.manager.takeover(`acc:${PID}`), 409);
    expect(s.killPid).not.toHaveBeenCalled();
    expect(s.spawned).toHaveLength(0);
  });
});

/** Resposta SSE de mentira: guarda o que foi escrito. */
function fakeStream(): { req: IncomingMessage; res: ServerResponse; out: string[] } {
  const out: string[] = [];
  const req = Object.assign(new EventEmitter(), { socket: { setTimeout() {}, setNoDelay() {} } }) as unknown as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead() {},
    write(chunk: string) {
      out.push(chunk);
      return true;
    },
    end() {
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  }) as unknown as ServerResponse;
  return { req, res, out };
}

describe('PtyManager: tela para quem conecta', () => {
  it('manda a tela montada e, depois, a saída que chegou enquanto ela terminava de processar', () => {
    const pendingWrites: (() => void)[] = [];
    let content = '';
    const screen: PtyScreen = {
      write(data, done) {
        // Processa depois, como o xterm.
        pendingWrites.push(() => {
          content += data;
          done?.();
        });
      },
      resize() {},
      serialize: () => `[tela:${content}]`,
      dispose() {},
    };
    let proc: FakeProc | undefined;
    const manager = new PtyManager({
      spawn: () => (proc = new FakeProc(77)),
      claudeBin: process.execPath,
      accounts: () => [{ id: 'acc', dir: tmpdir(), isDefault: true }],
      agent: () => undefined,
      onChange: () => {},
      createScreen: () => screen,
    });
    const info = manager.create({ cwd: tmpdir() });
    proc!.data('antes ');
    const { req, res, out } = fakeStream();
    manager.attach(info.id, req, res);
    proc!.data('durante');
    // Nada além do cabeçalho até a tela processar o que veio antes.
    expect(out.join('')).not.toContain('tela');
    for (const w of pendingWrites.splice(0)) w();
    const text = out.join('');
    expect(text.indexOf('[tela:antes ]')).toBeGreaterThan(-1);
    expect(text.indexOf('durante')).toBeGreaterThan(text.indexOf('[tela:antes ]'));
    proc!.data('depois');
    expect(out.join('')).toContain('depois');
  });
});

describe('ptyRequestProblem', () => {
  const req = (h: Record<string, string>, addr = '127.0.0.1') => ({ socket: { remoteAddress: addr }, headers: h }) as unknown as IncomingMessage;

  it('aceita o próprio computador, mesma origem', () => {
    expect(ptyRequestProblem(req({ host: 'localhost:4747', origin: 'http://localhost:4747', 'sec-fetch-site': 'same-origin' }))).toBeNull();
    expect(ptyRequestProblem(req({ host: '127.0.0.1:4747' }, '::ffff:127.0.0.1'))).toBeNull();
  });

  it('recusa conexão de fora, Host da rede, outra origem e pedido de outro site', () => {
    expect(ptyRequestProblem(req({ host: 'localhost:4747' }, '192.168.0.9'))).toMatch(/próprio computador/);
    expect(ptyRequestProblem(req({ host: 'meu-mac.local:4747' }))).toMatch(/localhost/);
    expect(ptyRequestProblem(req({ host: 'localhost:4747', origin: 'http://evil.example' }))).toMatch(/origem/);
    expect(ptyRequestProblem(req({ host: 'localhost:4747', 'sec-fetch-site': 'same-site' }))).toMatch(/origem/);
    expect(ptyRequestProblem(req({ host: 'localhost:4747', 'sec-fetch-site': 'cross-site' }))).toMatch(/origem/);
  });
});

describe('carregar o node-pty e achar o claude', () => {
  const unix = process.platform !== 'win32';

  /** Pasta temporária, apagada no fim. */
  function withDir(fn: (dir: string) => void | Promise<void>) {
    return async () => {
      const dir = mkdtempSync(join(tmpdir(), 'habblaud-pty-'));
      try {
        await fn(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
  }

  it.runIf(unix)(
    'devolve a permissão de execução ao spawn-helper (o node-pty 1.1.0 publica sem)',
    withDir((dir) => {
      const sub = join(dir, 'prebuilds', 'darwin-arm64');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, 'spawn-helper'), '');
      chmodSync(join(sub, 'spawn-helper'), 0o644);
      fixSpawnHelper(dir, 'darwin', 'arm64');
      expect(statSync(join(sub, 'spawn-helper')).mode & 0o777).toBe(0o755);
      // Sem spawn-helper nenhum: nada a fazer, sem erro.
      expect(() => fixSpawnHelper(join(dir, 'vazia'), 'darwin', 'arm64')).not.toThrow();
    }),
  );

  it('terminal de teste: aponta o motivo quando o spawn falha ou o processo sai com erro', async () => {
    const failing: SpawnPty = () => {
      throw new Error('posix_spawnp failed.');
    };
    expect(await spawnProblem(failing)).toMatch(/posix_spawnp failed/);
    const exiting = (code: number): SpawnPty => () => {
      const p = new FakeProc(1);
      queueMicrotask(() => p.exit({ exitCode: code }));
      return p;
    };
    expect(await spawnProblem(exiting(0))).toBeNull();
    expect(await spawnProblem(exiting(1))).toMatch(/código 1/);
  });

  it.runIf(unix)(
    'executável: precisa existir e poder rodar; o PATH pula o que não roda',
    withDir((dir) => {
      const a = join(dir, 'a');
      const b = join(dir, 'b');
      mkdirSync(a);
      mkdirSync(b);
      writeFileSync(join(a, 'claude'), '#!/bin/sh\n');
      chmodSync(join(a, 'claude'), 0o644);
      writeFileSync(join(b, 'claude'), '#!/bin/sh\n');
      chmodSync(join(b, 'claude'), 0o755);
      expect(isExecutableFile(join(a, 'claude'))).toBe(false);
      expect(isExecutableFile(join(b, 'claude'))).toBe(true);
      expect(isExecutableFile(dir)).toBe(false);
      const env = { PATH: `${a}:${b}` };
      expect(findExecutable('claude', env)).toBe(join(b, 'claude'));
      expect(claudeBinFrom(env)).toBe(join(b, 'claude'));
      // HABBLAUD_CLAUDE_BIN: um caminho vale como está; um nome é procurado no PATH.
      expect(claudeBinFrom({ ...env, HABBLAUD_CLAUDE_BIN: join(a, 'claude') })).toBe(join(a, 'claude'));
      expect(claudeBinFrom({ ...env, HABBLAUD_CLAUDE_BIN: 'claude' })).toBe(join(b, 'claude'));
      expect(claudeBinFrom({ ...env, HABBLAUD_CLAUDE_BIN: 'outro' })).toBeUndefined();
    }),
  );
});
