import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { accountIds, codexDirsRefused, discoverClaudeDirs, detectAccounts, isClaudeDir, isCodexHome, parseClaudeAliases, shortcutsByDir } from './detect';
import { AccountsService } from './service';
import { rollover, STALE_AFTER_MS, usageFromCache, usageFromWindows, UsageStore } from './usage';

setQuiet(true);

// Raiz absoluta também no Windows (lá o resolve põe a letra do drive).
const H = resolve('/Users/fulano');

describe('aliases de shell', () => {
  it('só linhas alias que invocam o claude; CLAUDE_CONFIG_DIR expandido', () => {
    const rc = [
      'export OPENAI_API_KEY="sk-segredo"',
      "alias ll='ls -la'",
      "alias claude2='CLAUDE_CONFIG_DIR=\"$HOME/.claude-conta2\" claude --permission-mode auto'",
      "alias c='claude --permission-mode auto'",
      "alias f='claude --permission-mode auto --agent frinus'",
      "alias d='CLAUDE_CONFIG_DIR=\"$HOME/.claude-conta2\" claude --permission-mode auto'",
      'alias e="CLAUDE_CONFIG_DIR=~/.claude-trabalho/ claude"',
      "alias sq='claude-squad'",
      "  # alias x='claude'",
      "alias w='cd ~/.claude && ls'",
    ].join('\n');
    expect(parseClaudeAliases(rc, H)).toEqual([
      { name: 'claude2', configDir: join(H, '.claude-conta2') },
      { name: 'c' },
      { name: 'f' },
      { name: 'd', configDir: join(H, '.claude-conta2') },
      { name: 'e', configDir: join(H, '.claude-trabalho') },
    ]);
  });

  it('prefere o alias mais curto (empate: o primeiro) e usa maiúscula', () => {
    const m = shortcutsByDir(
      [{ name: 'claude2', configDir: join(H, '.claude-conta2') }, { name: 'c' }, { name: 'f' }, { name: 'd', configDir: join(H, '.claude-conta2') }],
      H,
    );
    expect(m.get(join(H, '.claude'))).toBe('C');
    expect(m.get(join(H, '.claude-conta2'))).toBe('D');
  });

  it('ids desambiguados quando dois dirs têm o mesmo basename', () => {
    expect(accountIds(['/a/.claude', '/b/.claude', '/c/.claude-x'])).toEqual(['.claude', '.claude~2', '.claude-x']);
  });
});

describe('detecção de contas', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  beforeEach(() => {
    tmp = tempDir();
    home = tmp.dir;
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    mkdirSync(join(home, '.claude-conta2', 'sessions'), { recursive: true });
    mkdirSync(join(home, '.claude-vazio'), { recursive: true });
    writeFileSync(join(home, '.claude.json'), '{}');
    writeFileSync(
      join(home, '.zshrc'),
      "alias c='claude'\nalias d='CLAUDE_CONFIG_DIR=\"$HOME/.claude-conta2\" claude'\nexport TOKEN=nao-leia\n",
    );
  });
  afterEach(() => tmp.cleanup());

  it('descobre $HOME/.claude* com projects/ ou sessions/, padrão primeiro', () => {
    expect(discoverClaudeDirs({}, home)).toEqual([join(home, '.claude'), join(home, '.claude-conta2')]);
    const extra = join(home, 'outra');
    mkdirSync(extra);
    expect(discoverClaudeDirs({ CLAUDE_CONFIG_DIR: extra }, home)).toContain(extra);
    expect(discoverClaudeDirs({ HABBLAUD_CLAUDE_DIRS: ' /x/a , ~/b ' }, home)).toEqual([resolve('/x/a'), join(home, 'b')]);
  });

  it('pasta do Codex (CODEX_HOME) não vira conta do Claude Code, por nenhum caminho', () => {
    // Um CODEX_HOME sintético: sessions/AAAA/MM/DD (rollouts), locks, config.toml e auth.json (nunca abertos).
    const codex = join(home, '.codex');
    mkdirSync(join(codex, 'sessions', '2026', '10', '09'), { recursive: true });
    mkdirSync(join(codex, 'thread-writer-locks'), { recursive: true });
    writeFileSync(join(codex, 'config.toml'), 'model = "x"\n');
    writeFileSync(join(codex, 'auth.json'), '{}');
    // CODEX_HOME com nome que a busca em $HOME pega (.claude*): só com sessions/AAAA/.
    const disfarcado = join(home, '.claude-codex');
    mkdirSync(join(disfarcado, 'sessions', '2026'), { recursive: true });
    for (const marca of ['thread-writer-locks', 'archived_sessions', 'config.toml', 'auth.json', 'sessions/2026']) {
      const p = join(home, `codex-${marca.replace('/', '-')}`);
      if (marca.includes('.')) {
        mkdirSync(join(p, 'sessions'), { recursive: true });
        writeFileSync(join(p, marca), '');
      } else mkdirSync(join(p, marca), { recursive: true });
      expect(isCodexHome(p), marca).toBe(true);
      expect(isClaudeDir(p), marca).toBe(false);
    }
    // Contas do Claude Code continuam valendo: sessions/ vazio ou com <pid>.json, e projects/ sempre vence.
    writeFileSync(join(home, '.claude-conta2', 'sessions', '123.json'), '{}');
    for (const p of [join(home, '.claude'), join(home, '.claude-conta2')]) expect(isClaudeDir(p)).toBe(true);
    const misto = join(home, '.claude-misto');
    mkdirSync(join(misto, 'projects'), { recursive: true });
    writeFileSync(join(misto, 'config.toml'), '');
    expect(isCodexHome(misto)).toBe(false);
    expect(isCodexHome(join(home, 'nao-existe'))).toBe(false);
    expect(isCodexHome(join(home, '.claude-vazio'))).toBe(false);

    expect(discoverClaudeDirs({}, home)).toEqual([join(home, '.claude'), join(home, '.claude-conta2'), misto]);
    expect(codexDirsRefused({}, home)).toEqual([disfarcado]);
    // CLAUDE_CONFIG_DIR e HABBLAUD_CLAUDE_DIRS apontando para o Codex: fora (o resto da lista segue igual).
    expect(discoverClaudeDirs({ CLAUDE_CONFIG_DIR: codex }, home)).not.toContain(codex);
    expect(codexDirsRefused({ CLAUDE_CONFIG_DIR: codex }, home)).toEqual([disfarcado, codex]);
    expect(discoverClaudeDirs({ HABBLAUD_CLAUDE_DIRS: `~/.claude,~/.codex,/x/a` }, home)).toEqual([join(home, '.claude'), resolve('/x/a')]);
    expect(codexDirsRefused({ HABBLAUD_CLAUDE_DIRS: `~/.claude,~/.codex,/x/a` }, home)).toEqual([codex]);
    const env = { HABBLAUD_ACCOUNTS: JSON.stringify([{ id: '.codex', mountDir: codex }]) };
    expect(discoverClaudeDirs(env, home)).not.toContain(codex);
  });

  it('lê só os campos permitidos do .claude.json, atalhos e cores', () => {
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        oauthAccount: { emailAddress: 'a@empresa.com', organizationName: 'Empresa', displayName: 'A', billingType: 'x', accountUuid: 'nao' },
        mcpServers: { s: { env: { SECRET: 'nao-pode-vazar' } } },
      }),
    );
    writeFileSync(
      join(home, '.claude-conta2', '.claude.json'),
      JSON.stringify({
        oauthAccount: { emailAddress: 'b@pessoal.com' },
        cachedUsageUtilization: { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 10, resets_at: null } } },
      }),
    );
    const accs = detectAccounts([join(home, '.claude'), join(home, '.claude-conta2'), join(home, '.claude-vazio')], { home, env: {} });
    expect(accs).toEqual([
      { id: '.claude', configDir: join(home, '.claude'), short: 'C', name: 'Conta C', color: '#f08a3c', email: 'a@empresa.com', organization: 'Empresa' },
      {
        id: '.claude-conta2',
        configDir: join(home, '.claude-conta2'),
        short: 'D',
        name: 'Conta D',
        color: '#4aa8e8',
        email: 'b@pessoal.com',
        cachedUsage: { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 10, resets_at: null } } },
      },
      { id: '.claude-vazio', configDir: join(home, '.claude-vazio'), short: 'A', name: 'Conta A', color: '#5cc97b' },
    ]);
    expect(JSON.stringify(accs)).not.toContain('nao-pode-vazar');
  });

  it('HABBLAUD_ACCOUNTS (Docker) sobrepõe metadados casando por id ou mountDir', () => {
    const env = {
      HABBLAUD_ACCOUNTS: JSON.stringify([
        { id: '.claude', configDir: '/Users/x/.claude', mountDir: join(home, '.claude'), short: 'C', email: 'host@x.com', plan: 'Max', color: '#000000' },
        { mountDir: join(home, '.claude-conta2'), configDir: '/Users/x/.claude-conta2', short: 'D', name: 'Pessoal', cachedUsage: { fetchedAtMs: 5 } },
      ]),
    };
    const accs = detectAccounts([join(home, '.claude'), join(home, '.claude-conta2')], { home: '/nenhum', env });
    expect(accs[0]).toMatchObject({ id: '.claude', configDir: '/Users/x/.claude', short: 'C', name: 'Conta C', email: 'host@x.com', plan: 'Max', color: '#000000' });
    expect(accs[1]).toMatchObject({ id: '.claude-conta2', configDir: '/Users/x/.claude-conta2', short: 'D', name: 'Pessoal', cachedUsage: { fetchedAtMs: 5 } });
  });
});

describe('uso (5h e semanal)', () => {
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const windows = {
    five_hour: { utilization: 42.5, resets_at: '2026-10-06T14:00:00.123+00:00' },
    seven_day: { utilization: 15, resets_at: '2026-10-09T23:00:00Z' },
    seven_day_opus: null,
    seven_day_sonnet: { utilization: 3, resets_at: null },
    extra_usage: { is_enabled: false },
  };

  it('normaliza as janelas no formato do Claude Code', () => {
    expect(usageFromWindows(windows, 'cache', NOW)).toEqual({
      source: 'cache',
      fetchedAt: NOW,
      fiveHour: { utilization: 42.5, resetsAt: Date.parse('2026-10-06T14:00:00.123Z') },
      sevenDay: { utilization: 15, resetsAt: Date.parse('2026-10-09T23:00:00Z') },
      sevenDaySonnet: { utilization: 3 },
    });
    expect(usageFromWindows({}, 'cache', NOW)).toBeUndefined();
  });

  it('cache: fetchedAtMs vira fetchedAt; antigo = stale; sem nada = disabled', () => {
    const store = new UsageStore();
    expect(store.view('x', NOW).status).toBe('disabled');
    store.set('x', usageFromCache({ fetchedAtMs: NOW - 5 * 60_000, utilization: windows })!);
    expect(store.view('x', NOW).status).toBe('ok');
    expect(store.view('x', NOW + STALE_AFTER_MS).status).toBe('stale');
  });

  it('janelas cujo reinício já passou ficam sem dados (nunca um 0% inventado)', () => {
    const u = usageFromWindows(windows, 'cache', NOW)!;
    // Antes do reinício da semana, mas depois do da sessão de 5h.
    const r = rollover(u, Date.parse('2026-10-06T15:00:00Z'));
    expect(r.fiveHour).toBeUndefined();
    expect(r.sevenDay).toEqual({ utilization: 15, resetsAt: Date.parse('2026-10-09T23:00:00Z') });
    // Sem horário de reinício: continua valendo.
    expect(r.sevenDaySonnet).toEqual({ utilization: 3 });
    const later = rollover(u, Date.parse('2026-10-10T00:00:00Z'));
    expect(later.fiveHour).toBeUndefined();
    expect(later.sevenDay).toBeUndefined();
    expect(later).toMatchObject({ source: 'cache', fetchedAt: NOW });
    // O original não é alterado.
    expect(u.fiveHour?.utilization).toBe(42.5);
  });

  it('vale a fonte com números mais recentes; limpar uma fonte devolve a outra', () => {
    const store = new UsageStore();
    store.set('x', usageFromWindows(windows, 'cache', NOW - 3_600_000)!);
    store.set('x', usageFromWindows({ ...windows, five_hour: { utilization: 77, resets_at: null } }, 'statusline', NOW - 60_000)!);
    expect(store.view('x', NOW)).toMatchObject({ status: 'ok', usage: { source: 'statusline', fiveHour: { utilization: 77 } } });
    expect(store.clear('x', 'statusline')).toBe(true);
    expect(store.view('x', NOW)).toMatchObject({ status: 'stale', usage: { source: 'cache' } });
  });

  it('AccountsService: contas de outra ferramenta (lista vinda de fora), ids únicos e uso empurrado', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.claude');
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      let changes = 0;
      let now = NOW;
      const svc = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => changes++, now: () => now });
      const det = (id: string) => ({ id, configDir: `/Users/x/${id}`, short: 'X', name: 'Codex', color: '#10a37f' });
      changes = 0;
      const set = svc.setProviderAccounts('codex', [
        { dir: join(tmp.dir, '.codex'), detected: det('.codex') },
        { dir: join(tmp.dir, 'b', '.codex'), detected: det('.codex') },
        // Mesmo id de uma conta do Claude Code: desambiguado.
        { dir: join(tmp.dir, 'c', '.claude'), detected: det('.claude') },
      ]);
      expect(set.map((e) => [e.id, e.provider, e.detected.id, e.detected.provider])).toEqual([
        ['.codex', 'codex', '.codex', 'codex'],
        ['.codex~2', 'codex', '.codex~2', 'codex'],
        ['.claude~2', 'codex', '.claude~2', 'codex'],
      ]);
      expect(changes).toBe(1);
      // Mesma lista de novo: mesmos ids, sem aviso de mudança.
      expect(svc.setProviderAccounts('codex', set.map((e) => ({ dir: e.dir, detected: det(basename(e.dir)) }))).map((e) => e.id)).toEqual([
        '.codex',
        '.codex~2',
        '.claude~2',
      ]);
      expect(changes).toBe(1);
      // entries() = só o Claude Code (watcher, histórico e statusline); o resto vê todas.
      expect(svc.entries().map((e) => [e.id, e.provider])).toEqual([['.claude', 'claude']]);
      expect(svc.entriesOf('codex').map((e) => e.id)).toEqual(['.codex', '.codex~2', '.claude~2']);
      expect(svc.allEntries().map((e) => e.id)).toEqual(['.claude', '.codex', '.codex~2', '.claude~2']);
      expect(svc.find('.codex~2')?.dir).toBe(join(tmp.dir, 'b', '.codex'));
      expect(svc.idForDir(join(tmp.dir, '.codex'))).toBe('.codex');
      const infos = svc.list(new Map([['.codex', 2]]));
      expect(infos[0]).not.toHaveProperty('provider');
      expect(infos[1]).toMatchObject({ id: '.codex', provider: 'codex', sessions: 2, usageStatus: 'disabled', configDir: '/Users/x/.codex' });

      // Uso empurrado pela fonte (origem 'codex'), com a conta sem cota.
      changes = 0;
      expect(svc.setUsage('.codex', { source: 'codex', fetchedAt: NOW - 60_000, fiveHour: { utilization: 12.5, resetsAt: NOW + 3_600_000 } })).toBe(true);
      expect(changes).toBe(1);
      expect(svc.setUsage('.codex', { source: 'codex', fetchedAt: NOW - 60_000, fiveHour: { utilization: 12.5, resetsAt: NOW + 3_600_000 } })).toBe(false);
      expect(changes).toBe(1);
      svc.setUsage('.codex~2', { source: 'codex', fetchedAt: NOW, noQuota: true });
      expect(svc.list(new Map()).find((a) => a.id === '.codex')).toMatchObject({ usageStatus: 'ok', usage: { source: 'codex', fiveHour: { utilization: 12.5 } } });
      expect(svc.list(new Map()).find((a) => a.id === '.codex~2')?.usage).toEqual({ source: 'codex', fetchedAt: NOW, noQuota: true });
      // Envelhece como as outras origens (o refresh periódico percebe e avisa).
      now = NOW + STALE_AFTER_MS;
      changes = 0;
      svc.refresh();
      expect(changes).toBe(1);
      expect(svc.usageView('.codex').status).toBe('stale');
      expect(svc.clearUsage('.codex', 'codex')).toBe(true);
      expect(svc.usageView('.codex').status).toBe('disabled');

      // Conta que saiu perde o uso guardado; lista vazia tira a ferramenta.
      svc.setProviderAccounts('codex', [{ dir: join(tmp.dir, '.codex'), detected: det('.codex') }]);
      expect(svc.usageView('.codex~2').status).toBe('disabled');
      svc.setProviderAccounts('codex', []);
      expect(svc.allEntries().map((e) => e.id)).toEqual(['.claude']);
      expect(svc.list(new Map()).map((a) => a.id)).toEqual(['.claude']);
    } finally {
      tmp.cleanup();
    }
  });

  it('AccountsService lê o cache do /usage do .claude.json da conta', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.claude-conta2');
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      let changes = 0;
      const svc = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => changes++, now: () => NOW });
      expect(svc.list(new Map())[0].usageStatus).toBe('disabled');
      writeFileSync(join(dir, '.claude.json'), JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: NOW - 60_000, utilization: windows } }));
      svc.refresh();
      const info = svc.list(new Map([['.claude-conta2', 3]]))[0];
      expect(info).toMatchObject({ id: '.claude-conta2', sessions: 3, usageStatus: 'ok', usage: { source: 'cache', fiveHour: { utilization: 42.5 } } });
      expect(changes).toBeGreaterThan(0);
    } finally {
      tmp.cleanup();
    }
  });
});
