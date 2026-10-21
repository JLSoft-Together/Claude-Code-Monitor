// Instalador dos hooks do Codex (scripts/codex-install.ts): planos puros e o comando de verdade sobre hooks.json em
// pastas temporárias (HOME e CODEX_HOME FALSOS: nunca toca em ~/.codex). O ponto principal: os grupos de outros apps
// (ex.: o Orca) nunca mudam de posição nem de conteúdo — a confiança do Codex é guardada pela posição do grupo.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chooseNode,
  DEFAULT_WAIT_S,
  discoverCodexHomes,
  EVENTS,
  handlerFor,
  HOOK_SCRIPT,
  hookCommand,
  installState,
  isOurHandler,
  nodeMajor,
  parseArgs,
  planInstall,
  planUninstall,
  run,
  scriptPathOf,
  STATUS_MESSAGE,
  type RunOptions,
} from '../../scripts/codex-install';
import { posixShell, tempDir } from './fixtures';

const CMD = hookCommand('/repo/habblaud/mod/habblaud-codex/hook.mjs');
const SH = posixShell();

/** hooks.json (sintético) com grupos de outro app em alguns eventos, inclusive um que o Habblaud não usa. */
const ORCA = {
  description: 'Hooks de outro app',
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'orca-hook pre', timeout: 10 }] }],
    PermissionRequest: [{ hooks: [{ type: 'command', command: 'orca-hook perm' }] }, { matcher: 'apply_patch', hooks: [{ type: 'command', command: 'orca-hook patch' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'orca-hook stop', async: true }] }],
    PreCompact: [{ hooks: [{ type: 'command', command: 'orca-hook compact' }] }],
  },
};
const orcaAt = (file: { hooks?: Record<string, unknown[]> }, event: string, i: number) => file.hooks?.[event]?.[i];

describe('codex-install.ts (funções puras)', () => {
  it('comando sem opções e handlers fixos: observação em segundo plano, SessionEnd síncrono, PermissionRequest com a espera', () => {
    expect(CMD).toBe('node "/repo/habblaud/mod/habblaud-codex/hook.mjs"');
    expect(handlerFor('PreToolUse', CMD, 25)).toEqual({ type: 'command', command: CMD, async: true, timeout: 5 });
    expect(handlerFor('SessionEnd', CMD, 25)).toEqual({ type: 'command', command: CMD, timeout: 1 });
    expect(handlerFor('PermissionRequest', CMD, 25)).toEqual({ type: 'command', command: CMD, timeout: 35, statusMessage: STATUS_MESSAGE });
    expect(STATUS_MESSAGE).toBe('Aguardando resposta no Habblaud…');
    expect(isOurHandler({ command: CMD })).toBe(true);
    expect(isOurHandler({ command: 'node "C:\\x\\habblaud-codex\\hook.mjs"' })).toBe(true);
    expect(isOurHandler({ command: 'orca-hook perm' })).toBe(false);
    expect(scriptPathOf(CMD)).toBe('/repo/habblaud/mod/habblaud-codex/hook.mjs');
    expect(scriptPathOf("node '/a/it'\\''s/habblaud-codex/hook.mjs'")).toBe("/a/it's/habblaud-codex/hook.mjs");
  });

  it('install: acrescenta no FIM de cada evento, sem matcher; grupos alheios e o resto do arquivo intactos; idempotente', () => {
    const p = planInstall(ORCA, CMD, 25);
    expect(p.action).toBe('install');
    if (p.action !== 'install') return;
    const next = p.file as typeof ORCA & { hooks: Record<string, unknown[]> };
    expect(next.description).toBe(ORCA.description);
    expect(Object.keys(next).sort()).toEqual(['description', 'hooks']);
    for (const [event, list] of Object.entries(ORCA.hooks)) list.forEach((g, i) => expect(orcaAt(next, event, i), `${event}[${i}]`).toEqual(g));
    expect(next.hooks.PreCompact).toEqual(ORCA.hooks.PreCompact);
    for (const event of EVENTS) {
      const list = next.hooks[event];
      expect(list.at(-1), event).toEqual({ hooks: [handlerFor(event, CMD, 25)] });
      expect(list.length, event).toBe(((ORCA.hooks as Record<string, unknown[]>)[event]?.length ?? 0) + 1);
    }
    expect(p.approve.sort()).toEqual([...EVENTS].sort());
    expect(planInstall(next, CMD, 25)).toEqual({ action: 'none', message: 'já instalado' });
    expect(installState(next, CMD, 25)).toEqual({ ok: [...EVENTS], outdated: [], missing: [], paths: ['/repo/habblaud/mod/habblaud-codex/hook.mjs'] });
  });

  it('atualizar (outra espera, outro caminho): troca o handler NO MESMO lugar, mesmo com um grupo alheio acrescentado depois', () => {
    const first = planInstall(ORCA, CMD, 25);
    if (first.action !== 'install') throw new Error('esperado install');
    const installed = first.file as { hooks: Record<string, unknown[]> };
    // Outro app acrescenta um grupo DEPOIS do do Habblaud.
    const later = { hooks: [{ type: 'command', command: 'orca-hook depois' }] };
    installed.hooks.PermissionRequest = [...installed.hooks.PermissionRequest, later];
    const before = JSON.parse(JSON.stringify(installed));
    const upd = planInstall(installed, hookCommand('/novo/lugar/mod/habblaud-codex/hook.mjs'), 60);
    expect(upd.action).toBe('install');
    if (upd.action !== 'install') return;
    const next = upd.file as { hooks: Record<string, unknown[]> };
    expect(upd.approve.sort()).toEqual([...EVENTS].sort());
    for (const event of EVENTS) {
      expect(next.hooks[event].length, event).toBe(before.hooks[event].length);
      before.hooks[event].forEach((g: { hooks: unknown[] }, i: number) => {
        if (!isOurHandler(g.hooks[0])) expect(next.hooks[event][i], `${event}[${i}]`).toEqual(g);
      });
    }
    expect(next.hooks.PermissionRequest[2]).toEqual({ hooks: [handlerFor('PermissionRequest', hookCommand('/novo/lugar/mod/habblaud-codex/hook.mjs'), 60)] });
    expect(next.hooks.PermissionRequest[3]).toEqual(later);
    expect(installState(installed, CMD, 60)).toMatchObject({ outdated: ['PermissionRequest'], missing: [] });
  });

  it('uninstall: tira só os handlers do Habblaud; de volta ao original; avisa quando um grupo alheio muda de posição', () => {
    const p = planInstall(ORCA, CMD, 25);
    if (p.action !== 'install') throw new Error('esperado install');
    expect(planUninstall(p.file)).toEqual({ action: 'uninstall', file: ORCA, message: 'hooks do Habblaud removidos', shifted: [] });
    const withLater = JSON.parse(JSON.stringify(p.file));
    withLater.hooks.Stop.push({ hooks: [{ type: 'command', command: 'orca-hook depois' }] });
    const u = planUninstall(withLater);
    expect(u.action === 'uninstall' && u.shifted).toEqual(['Stop']);
    expect(planUninstall(ORCA)).toEqual({ action: 'none', message: 'não estava instalado' });
    // Arquivo que só tinha o Habblaud: volta a {}.
    const only = planInstall({}, CMD, 25);
    expect(only.action === 'install' && planUninstall(only.file)).toMatchObject({ action: 'uninstall', file: {} });
  });

  it('cópias repetidas saem; formatos desconhecidos não são tocados', () => {
    const dup = { hooks: { Stop: [{ hooks: [handlerFor('Stop', CMD, 25)] }, { hooks: [{ type: 'command', command: 'x' }, handlerFor('Stop', CMD, 25)] }] } };
    const p = planInstall(dup, CMD, 25);
    expect(p.action === 'install' && (p.file.hooks as Record<string, unknown[]>).Stop).toEqual([{ hooks: [handlerFor('Stop', CMD, 25)] }, { hooks: [{ type: 'command', command: 'x' }] }]);
    expect(planInstall({ hooks: [] }, CMD, 25).action).toBe('skip');
    expect(planInstall({ hooks: { Stop: {} } }, CMD, 25).action).toBe('skip');
    expect(planUninstall({ hooks: 'x' }).action).toBe('skip');
  });

  it('parseArgs', () => {
    expect(parseArgs(['install'], {})).toEqual({ command: 'install', dryRun: false, account: undefined, port: 4747, waitS: DEFAULT_WAIT_S });
    expect(parseArgs(['status', '--port', '4851', '--espera', '60', '--conta', '.codex', '--dry-run'], {})).toEqual({ command: 'status', dryRun: true, account: '.codex', port: 4851, waitS: 60 });
    expect(parseArgs(['install'], { HABBLAUD_PORT: '4848' })).toMatchObject({ port: 4848 });
    expect(parseArgs(['--help'], {})).toBe('help');
    expect(() => parseArgs([], {})).toThrow(/install, uninstall ou status/);
    expect(() => parseArgs(['install', '--espera', '4'], {})).toThrow(/--espera/);
    expect(() => parseArgs(['install', '--espera', '121'], {})).toThrow(/--espera/);
    expect(() => parseArgs(['install', '--conta'], {})).toThrow(/--conta/);
    expect(parseArgs(['install', '--node', '/opt/homebrew/bin/node'], {})).toMatchObject({ node: '/opt/homebrew/bin/node' });
    expect(() => parseArgs(['install', '--node', 'node'], {})).toThrow(/--node/);
  });

  it('Node dos hooks: o do shell de login se for 22+; senão o primeiro candidato 22+ com caminho absoluto', () => {
    expect(nodeMajor('v18.12.1')).toBe(18);
    expect(nodeMajor('v24.17.0\n')).toBe(24);
    expect(nodeMajor(undefined)).toBeUndefined();
    const versions: Record<string, string> = { login: 'v18.12.1', '/opt/homebrew/bin/node': 'v25.8.2', '/usr/local/bin/node': 'v18.12.1' };
    const probe = (bin: string | undefined) => versions[bin ?? 'login'];
    expect(chooseNode(probe, ['/usr/local/bin/node', '/opt/homebrew/bin/node'])).toEqual({ bin: '/opt/homebrew/bin/node', login: 'v18.12.1', chosen: 'v25.8.2' });
    versions.login = 'v22.12.0';
    expect(chooseNode(probe, ['/opt/homebrew/bin/node'])).toEqual({ login: 'v22.12.0' });
    // Nenhum 22+: `node` mesmo (o instalador avisa).
    expect(chooseNode(() => undefined, ['/x/node'])).toEqual({ login: undefined });
    expect(hookCommand('/repo/mod/habblaud-codex/hook.mjs', '/opt/homebrew/bin/node')).toBe('"/opt/homebrew/bin/node" "/repo/mod/habblaud-codex/hook.mjs"');
    expect(scriptPathOf('"/opt/homebrew/bin/node" "/repo/mod/habblaud-codex/hook.mjs"')).toBe('/repo/mod/habblaud-codex/hook.mjs');
  });
});

describe('codex-install.ts (arquivos, HOME falso)', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  let out: string[];
  const configToml = '[hooks.state."x"]\ntrusted_hash = "abc"\n';

  beforeEach(() => {
    tmp = tempDir();
    home = join(tmp.dir, 'home');
    out = [];
    // ~/.codex com hooks de outro app; ~/.codex-trabalho sem hooks.json; ~/.claude (do Claude Code) nunca entra.
    mkdirSync(join(home, '.codex', 'sessions', '2026'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), configToml);
    writeFileSync(join(home, '.codex', 'hooks.json'), `${JSON.stringify(ORCA, null, 2)}\n`);
    mkdirSync(join(home, '.codex-trabalho', 'thread-writer-locks'), { recursive: true });
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
  });
  afterEach(() => tmp.cleanup());

  const exec = (command: RunOptions['command'], extra: Partial<RunOptions> = {}, env: NodeJS.ProcessEnv = {}, health?: object) =>
    run(
      { command, dryRun: false, port: 4747, waitS: DEFAULT_WAIT_S, ...extra },
      { env: { HOME: home, ...env }, home, now: new Date(2026, 9, 9, 9, 30, 0), hookPath: HOOK_SCRIPT, out: (l) => out.push(l), health: async () => health },
    );
  const read = (acc: string) => JSON.parse(readFileSync(join(home, acc, 'hooks.json'), 'utf8'));
  const cmd = hookCommand(HOOK_SCRIPT);

  it('descobre ~/.codex* do Codex (e CODEX_HOME); HABBLAUD_CODEX_DIRS substitui e recusa pasta do Claude Code', () => {
    expect(discoverCodexHomes({}, home).dirs).toEqual([join(home, '.codex'), join(home, '.codex-trabalho')]);
    const extra = join(tmp.dir, 'outra-conta');
    mkdirSync(extra);
    // As mesmas pastas que o servidor acompanha: um CODEX_HOME sem cara de Codex (vazio) fica de fora.
    expect(discoverCodexHomes({ CODEX_HOME: extra }, home).dirs).toEqual([join(home, '.codex'), join(home, '.codex-trabalho')]);
    mkdirSync(join(extra, 'thread-writer-locks'));
    expect(discoverCodexHomes({ CODEX_HOME: extra }, home).dirs).toEqual([extra, join(home, '.codex'), join(home, '.codex-trabalho')]);
    expect(discoverCodexHomes({ HABBLAUD_CODEX_DIRS: `${extra}, ~/.claude, /nao/existe` }, home)).toEqual({ dirs: [extra], refused: [join(home, '.claude')] });
  });

  it('install: backup, grupos alheios intactos, config.toml intocado, ~/.habblaud/codex-hook.json gravado; de novo = nada a fazer', async () => {
    expect(await exec('install', { port: 4851, waitS: 40 })).toBe(0);
    const c = read('.codex');
    for (const [event, list] of Object.entries(ORCA.hooks)) list.forEach((g, i) => expect(c.hooks[event][i]).toEqual(g));
    expect(c.hooks.PermissionRequest[2]).toEqual({ hooks: [handlerFor('PermissionRequest', cmd, 40)] });
    expect(read('.codex-trabalho').hooks.SessionStart).toEqual([{ hooks: [handlerFor('SessionStart', cmd, 40)] }]);
    expect(JSON.parse(readFileSync(join(home, '.codex', 'hooks.json.habblaud-backup-20261009-093000'), 'utf8'))).toEqual(ORCA);
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toBe(configToml);
    expect(existsSync(join(home, '.codex-trabalho', 'config.toml'))).toBe(false);
    expect(existsSync(join(home, '.claude', 'hooks.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(home, '.habblaud', 'codex-hook.json'), 'utf8'))).toEqual({ port: 4851, permissionTimeoutS: 40 });
    const text = out.join('\n');
    expect(text).toContain('abra o Codex e aprove os hooks do Habblaud em /hooks');
    expect(text).not.toMatch(/trusted_hash/);

    out = [];
    expect(await exec('install', { port: 4851, waitS: 40 })).toBe(0);
    expect(out.join('\n')).toContain('já instalado');
    expect(out.join('\n')).not.toContain('em /hooks');
    expect(readdirSync(join(home, '.codex')).filter((f) => f.includes('backup'))).toHaveLength(1);
  });

  it('--conta, --dry-run, status (com o Habblaud no ar ou não) e uninstall devolvendo o original', async () => {
    const before = readFileSync(join(home, '.codex', 'hooks.json'), 'utf8');
    await exec('install', { dryRun: true });
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toBe(before);
    expect(existsSync(join(home, '.codex-trabalho', 'hooks.json'))).toBe(false);
    expect(existsSync(join(home, '.habblaud', 'codex-hook.json'))).toBe(false);
    expect(out.join('\n')).toContain('simulação');

    out = [];
    expect(await exec('install', { account: '.codex-trabalho' })).toBe(0);
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toBe(before);
    out = [];
    await exec('status', {}, {}, { codexEvents: true, permissions: true });
    let text = out.join('\n');
    expect(text).toMatch(/\.codex \(~\/\.codex\/hooks\.json\): não instalado/);
    expect(text).toMatch(/\.codex-trabalho \(.*\): instalado em 9 de 9 eventos/);
    expect(text).toContain('recebendo os eventos do Codex; aprovar pelo escritório ligado');
    expect(text).toContain('confira em /hooks');
    out = [];
    await exec('status');
    expect(out.join('\n')).toContain('fora do ar');

    out = [];
    expect(await exec('uninstall')).toBe(0);
    expect(read('.codex-trabalho')).toEqual({});
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toBe(before);
    expect(out.join('\n')).toContain('não estava instalado');
    expect(await exec('install', { account: '.nada' })).toBe(1);
  });

  it('--conta com outra espera: avisa das outras pastas que ficaram com a espera antiga (o arquivo de configuração é um só)', async () => {
    expect(await exec('install')).toBe(0);
    out = [];
    expect(await exec('install', { account: '.codex', waitS: 60 })).toBe(0);
    expect(out.join('\n')).toContain('! .codex-trabalho: o Habblaud está lá com outra espera; rode npm run codex:install sem --conta para alinhar.');
    out = [];
    expect(await exec('install', { waitS: 60 })).toBe(0);
    expect(out.join('\n')).not.toContain('outra espera');
  });

  it('JSON inválido nunca é sobrescrito', async () => {
    writeFileSync(join(home, '.codex-trabalho', 'hooks.json'), '{ quebrado');
    expect(await exec('install')).toBe(1);
    expect(readFileSync(join(home, '.codex-trabalho', 'hooks.json'), 'utf8')).toBe('{ quebrado');
    expect(out.join('\n')).toContain('JSON inválido');
  });

  it.skipIf(!SH)('o comando instalado roda de verdade: com o Habblaud fora do ar, sai rápido, com 0 e sem saída', async () => {
    await exec('install', { port: 1 });
    const command: string = read('.codex').hooks.PermissionRequest.at(-1).hooks[0].command;
    for (const event of ['PreToolUse', 'PermissionRequest']) {
      const input = JSON.stringify({ session_id: '0199b0c0-1234-7abc-8def-0123456789ab', hook_event_name: event, cwd: '/p', tool_name: 'Bash', tool_input: { command: 'ls' } });
      const t0 = Date.now();
      const r = spawnSync(SH!, ['-c', command], { input, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home }, timeout: 10_000 });
      expect(r.status, event).toBe(0);
      expect(r.stdout, event).toBe('');
      expect(Date.now() - t0).toBeLessThan(5_000);
    }
  });
});
