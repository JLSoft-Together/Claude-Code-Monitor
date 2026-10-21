// Contas do Codex: descoberta das pastas, letra (alias de shell ou derivada), cor, nome e os metadados vindos do host.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_COLORS, discoverClaudeDirs, detectAccounts, parseToolAliases } from '../../accounts/detect';
import { tempDir } from '../../test/fixtures';
import { codexPlanLabel, detectCodexAccounts, discoverCodexDirs } from './accounts';

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

function home() {
  const tmp = tempDir();
  cleanups.push(tmp.cleanup);
  const codex = (name: string, marker: 'locks' | 'year' | 'none' = 'locks') => {
    const dir = join(tmp.dir, name);
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    if (marker === 'locks') mkdirSync(join(dir, 'thread-writer-locks'));
    if (marker === 'year') mkdirSync(join(dir, 'sessions', '2026'));
    return dir;
  };
  return { dir: tmp.dir, codex };
}

describe('contas do Codex', () => {
  it('descoberta: ~/.codex* com cara de Codex (a padrão primeiro), CODEX_HOME e HABBLAUD_CODEX_DIRS', () => {
    const h = home();
    const main = h.codex('.codex');
    const work = h.codex('.codex-trabalho', 'year');
    h.codex('.codex-vazia', 'none');
    mkdirSync(join(h.dir, '.claude', 'projects'), { recursive: true });
    expect(discoverCodexDirs({}, h.dir)).toEqual([main, work]);
    const other = h.codex('outra-pasta');
    expect(discoverCodexDirs({ CODEX_HOME: other }, h.dir)).toEqual([other, main, work]);
    // A lista explícita vale como veio (só precisa existir).
    expect(discoverCodexDirs({ HABBLAUD_CODEX_DIRS: `~/.codex-vazia, ${other}, /nao/existe` }, h.dir)).toEqual([join(h.dir, '.codex-vazia'), other]);
  });

  it('letra pelo alias de shell (CODEX_HOME), derivada sem colidir com o Claude Code; cor sem repetir', () => {
    const h = home();
    const main = h.codex('.codex');
    const work = h.codex('.codex-trabalho');
    const third = h.codex('.codex-x');
    writeFileSync(
      join(h.dir, '.zshrc'),
      // Caminho com `/`, como no .bashrc do Git Bash (entre aspas duplas, a `\` do Windows seria um escape).
      ["alias cx='codex'", `alias cw="CODEX_HOME=${work.replaceAll('\\', '/')} codex --search"`, "alias c='claude'", 'export CODEX_HOME=/x # não é alias'].join('\n'),
    );
    expect(parseToolAliases("alias cx='codex'\nalias c='claude'", h.dir, 'codex')).toEqual([{ name: 'cx' }]);
    const accs = detectCodexAccounts([main, work, third], { home: h.dir, env: {}, taken: { shorts: ['C', 'X'], colors: [ACCOUNT_COLORS[0]] } });
    expect(accs.map((a) => [a.id, a.provider, a.short, a.name, a.configDir])).toEqual([
      ['.codex', 'codex', 'CX', 'Codex CX', main],
      ['.codex-trabalho', 'codex', 'CW', 'Codex CW', work],
      // Sem alias: a inicial do sufixo (X) já é do Claude Code: a próxima livre.
      ['.codex-x', 'codex', 'Y', 'Codex Y', third],
    ]);
    expect(accs.map((a) => a.color)).toEqual([ACCOUNT_COLORS[1], ACCOUNT_COLORS[2], ACCOUNT_COLORS[3]]);
    // Uma conta só: "Codex".
    expect(detectCodexAccounts([main], { home: h.dir, env: {} })[0]).toMatchObject({ short: 'CX', name: 'Codex' });
    expect(detectCodexAccounts([third], { home: h.dir, env: {} })[0]).toMatchObject({ short: 'X', name: 'Codex' });
  });

  it('Docker: metadados vindos do host (configDir do host, letra, cor, nome) casados pela pasta montada', () => {
    const h = home();
    const mounted = h.codex('.codex');
    const env = {
      HABBLAUD_ACCOUNTS: JSON.stringify([
        { id: '.claude', configDir: '/Users/fulano/.claude', mountDir: '/claude/.claude', short: 'C', name: 'Conta C', color: '#111111' },
        { id: '.codex', provider: 'codex', configDir: '/Users/fulano/.codex', mountDir: mounted, short: 'CX', name: 'Codex', color: '#222222', plan: 'Plus' },
      ]),
    };
    expect(detectCodexAccounts([mounted], { home: '/nao/existe', env })).toEqual([
      { id: '.codex', provider: 'codex', configDir: '/Users/fulano/.codex', short: 'CX', name: 'Codex', color: '#222222', plan: 'Plus' },
    ]);
    // As contas do Claude Code não pegam o override do Codex (nem pela pasta montada).
    expect(discoverClaudeDirs(env, h.dir)).not.toContain(mounted);
    expect(detectAccounts([join(h.dir, '.codex-claude')], { home: h.dir, env: { HABBLAUD_ACCOUNTS: JSON.stringify([{ id: '.codex-claude', provider: 'codex', name: 'Codex' }]) } })[0].name).toBe('Conta A');
  });

  it('plano do rate_limits para exibir', () => {
    expect(codexPlanLabel('plus')).toBe('Plus');
    expect(codexPlanLabel('prolite')).toBe('Pro Lite');
    expect(codexPlanLabel('self_serve_business_usage_based')).toBe('Self Serve Business Usage Based');
    expect(codexPlanLabel('unknown')).toBeUndefined();
    expect(codexPlanLabel(null)).toBeUndefined();
  });
});
