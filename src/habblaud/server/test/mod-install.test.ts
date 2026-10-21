// Instalador do mod (scripts/mod-install.ts): funções puras e o comando inteiro contra um CLI FALSO do Claude
// Code, com HOME e contas FALSOS em pastas temporárias (nunca chama o `claude` de verdade nem toca em ~/.claude*).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modHint } from '../../scripts/docker-up';
import { hookCommand, hookEntry } from '../../scripts/hooks-install';
import {
  accountEnv,
  cliMessage,
  cliSteps,
  describeStatus,
  LEGACY_PLUGINS,
  MESSAGES_HINT,
  MESSAGES_PLUGIN,
  MOD_PLUGIN,
  parseArgs,
  parseJsonOutput,
  parseMarketplaceList,
  parsePluginList,
  parseVersion,
  PERMISSIONS_PLUGIN,
  planInstall,
  planMigration,
  planUninstall,
  planUpdate,
  run,
  updateInstalledMods,
  verifyInstall,
  versionAtLeast,
  type AccountState,
  type ClaudeResult,
  type ClaudeRunner,
  type HealthInfo,
  type PluginInfo,
  type RunOptions,
} from '../../scripts/mod-install';
import { wrapCommand } from '../../scripts/statusline-install';
import { tempDir } from './fixtures';

const ROOT = '/repo/habblaud';
const same = (a: string, b: string) => a === b;
const plugin = (id: string, extra: Partial<PluginInfo> = {}): PluginInfo => ({ id, version: '0.2.0', scope: 'user', enabled: true, errors: [], ...extra });
const stateOf = (plugins: PluginInfo[] = [], path: string | null = ROOT, legacyPath?: string): AccountState => ({
  marketplace: path ? { name: 'habblaud', source: 'directory', path } : undefined,
  legacyMarketplace: legacyPath ? { name: 'codetown', source: 'directory', path: legacyPath } : undefined,
  plugins,
});
// O que o mod:install da 0.3 (nome antigo, CodeTown) deixou: o marketplace codetown nesta pasta e os dois plugins.
const OLD_MOD = 'codetown@codetown';
const OLD_PERM = 'codetown-permissoes@codetown';
const legacyState = (plugins: PluginInfo[] = [], path: string | null = null) =>
  stateOf([plugin(OLD_MOD, { version: '0.3.2' }), plugin(OLD_PERM, { version: '0.3.2' }), ...plugins], path, ROOT);
const argsOf = (plan: ReturnType<typeof planInstall>) => cliSteps(plan).map((s) => s.args.join(' '));

// Saídas reais do `claude plugin list --json` e `claude plugin marketplace list --json` (Claude Code 2.1.293),
// copiadas de um CLAUDE_CONFIG_DIR temporário com um marketplace de brinquedo.
const REAL_PLUGIN_LIST = `[
  {
    "id": "habblaud@habblaud",
    "version": "0.2.0",
    "scope": "user",
    "enabled": true,
    "installPath": "/tmp/t/cfg/plugins/cache/habblaud/habblaud/0.2.0",
    "readFromFolder": "/tmp/t/mkt/mod/habblaud",
    "folderVersion": "0.3.0",
    "installedAt": "2026-10-08T10:36:58.924Z",
    "lastUpdated": "2026-10-08T10:36:58.924Z",
    "projectEnabled": false
  },
  {
    "id": "habblaud-permissoes@habblaud",
    "version": "0.2.0",
    "scope": "user",
    "enabled": false,
    "installPath": "/tmp/t/cfg/plugins/cache/habblaud/habblaud-permissoes/0.2.0",
    "errors": ["Marketplace habblaud failed to load: cache-miss"],
    "errorDetails": [{ "type": "marketplace-load-failed", "marketplace": "habblaud" }],
    "projectEnabled": false
  }
]`;
const REAL_MARKETPLACE_LIST = `[
  {
    "name": "habblaud",
    "source": "directory",
    "path": "/tmp/t/mkt",
    "installLocation": "/tmp/t/mkt"
  }
]`;

describe('mod-install.ts (funções puras)', () => {
  it('versão do Claude Code: lê "2.1.293 (Claude Code)" e compara com o mínimo', () => {
    expect(parseVersion('2.1.293 (Claude Code)')).toEqual([2, 1, 293]);
    expect(parseVersion('Claude Code')).toBeUndefined();
    expect(versionAtLeast('2.1.293', '2.1.287')).toBe(true);
    expect(versionAtLeast('2.1.287', '2.1.287')).toBe(true);
    expect(versionAtLeast('2.1.286', '2.1.287')).toBe(false);
    expect(versionAtLeast('2.0.999', '2.1.287')).toBe(false);
    expect(versionAtLeast('2.2.0', '2.1.287')).toBe(true);
    expect(versionAtLeast('3.0.0', '2.1.287')).toBe(true);
    expect(versionAtLeast('x', '2.1.287')).toBe(false);
  });

  it('JSON da saída do CLI, com tolerância a avisos antes e à linha de resultado no fim', () => {
    expect(parseJsonOutput('[1, 2]\n')).toEqual([1, 2]);
    expect(parseJsonOutput('Aviso: algo\n[\n  {"id": "a"}\n]')).toEqual([{ id: 'a' }]);
    expect(parseJsonOutput('Installing…\n{"command":"install","outcome":"ok"}')).toEqual({ command: 'install', outcome: 'ok' });
    expect(parseJsonOutput('\x1b[32m[]\x1b[0m')).toEqual([]);
    expect(parseJsonOutput('nada aqui')).toBeUndefined();
    expect(parseJsonOutput('')).toBeUndefined();
  });

  it('lista de plugins e de marketplaces no formato real do CLI', () => {
    expect(parsePluginList(REAL_PLUGIN_LIST)).toEqual([
      { id: MOD_PLUGIN, version: '0.2.0', scope: 'user', enabled: true, readFromFolder: '/tmp/t/mkt/mod/habblaud', folderVersion: '0.3.0', errors: [] },
      { id: PERMISSIONS_PLUGIN, version: '0.2.0', scope: 'user', enabled: false, readFromFolder: undefined, folderVersion: undefined, errors: ['Marketplace habblaud failed to load: cache-miss'] },
    ]);
    // `--available` devolve um objeto; itens sem id são ignorados; lixo = undefined (não "nada instalado").
    expect(parsePluginList(JSON.stringify({ installed: [{ id: 'x@y' }, { version: '1' }], available: [] }))).toEqual([
      { id: 'x@y', version: undefined, scope: undefined, enabled: true, readFromFolder: undefined, folderVersion: undefined, errors: [] },
    ]);
    expect(parsePluginList('[]')).toEqual([]);
    expect(parsePluginList('No plugins installed.')).toBeUndefined();
    expect(parseMarketplaceList(REAL_MARKETPLACE_LIST)).toEqual([{ name: 'habblaud', source: 'directory', path: '/tmp/t/mkt' }]);
    expect(parseMarketplaceList('[{"name":"oficial","source":"github","repo":"a/b","installLocation":"/x"}]')).toEqual([{ name: 'oficial', source: 'github' }]);
    expect(parseMarketplaceList('{}')).toBeUndefined();
  });

  it('ambiente por conta: a padrão roda sem CLAUDE_CONFIG_DIR (mesmo herdado); as outras, com a pasta delas', () => {
    const env = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/h/.claude-conta2' };
    expect(accountEnv(env, '/h/.claude', '/h')).toEqual({ PATH: '/bin' });
    expect(accountEnv(env, '/h/.claude-conta2', '/h')).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/h/.claude-conta2' });
    expect(accountEnv({ PATH: '/bin' }, '/h/.claude-x', '/h')).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/h/.claude-x' });
    expect(env.CLAUDE_CONFIG_DIR).toBe('/h/.claude-conta2');
  });

  it('install: do zero adiciona o marketplace e os três plugins (escopo user); --sem-permissoes e --sem-mensagens deixam o seu de fora', () => {
    const base = { root: ROOT, version: '0.2.0', sameDir: same };
    const all = planInstall(stateOf([], null), { ...base, permissions: true, messages: true });
    expect(argsOf(all)).toEqual([
      `plugin marketplace add ${ROOT}`,
      `plugin install ${MOD_PLUGIN} --scope user`,
      `plugin install ${PERMISSIONS_PLUGIN} --scope user`,
      `plugin install ${MESSAGES_PLUGIN} --scope user`,
    ]);
    expect(all.plugins).toEqual([MOD_PLUGIN, PERMISSIONS_PLUGIN, MESSAGES_PLUGIN]);
    expect(cliSteps(all)[3].message).toBe('habblaud-mensagens: instalado');
    const solo = planInstall(stateOf([], null), { ...base, permissions: false, messages: false });
    expect(argsOf(solo)).toEqual([`plugin marketplace add ${ROOT}`, `plugin install ${MOD_PLUGIN} --scope user`]);
    expect(solo.notes).toEqual([]);
    expect(argsOf(planInstall(stateOf([], null), { ...base, permissions: true, messages: false })).slice(1)).toEqual([
      `plugin install ${MOD_PLUGIN} --scope user`,
      `plugin install ${PERMISSIONS_PLUGIN} --scope user`,
    ]);
    expect(argsOf(planInstall(stateOf([], null), { ...base, permissions: false, messages: true })).slice(1)).toEqual([
      `plugin install ${MOD_PLUGIN} --scope user`,
      `plugin install ${MESSAGES_PLUGIN} --scope user`,
    ]);
  });

  it('install: já instalado relê o catálogo e nada mais; desligado religa; versão diferente atualiza; faltando, instala', () => {
    const base = { root: ROOT, version: '0.2.0', permissions: true, messages: true, sameDir: same };
    const ok = planInstall(stateOf([plugin(MOD_PLUGIN), plugin(PERMISSIONS_PLUGIN), plugin(MESSAGES_PLUGIN)]), base);
    expect(argsOf(ok)).toEqual(['plugin marketplace update habblaud']);
    expect(ok.items.filter((i) => 'unchanged' in i)).toEqual([
      { unchanged: 'habblaud: já instalado na versão 0.2.0' },
      { unchanged: 'habblaud-permissoes: já instalado na versão 0.2.0' },
      { unchanged: 'habblaud-mensagens: já instalado na versão 0.2.0' },
    ]);
    // Quem instalou antes do plugin de mensagens: o mod:install de sempre o acrescenta.
    const mixed = planInstall(stateOf([plugin(MOD_PLUGIN, { enabled: false }), plugin(PERMISSIONS_PLUGIN, { version: '0.1.0' })]), base);
    expect(argsOf(mixed)).toEqual([
      'plugin marketplace update habblaud',
      `plugin enable ${MOD_PLUGIN} --scope user`,
      `plugin update ${PERMISSIONS_PLUGIN} --scope user`,
      `plugin install ${MESSAGES_PLUGIN} --scope user`,
    ]);
    expect(cliSteps(mixed)[2].message).toBe('habblaud-permissoes: atualizado de 0.1.0 para 0.2.0');
    // Instalado só no escopo de um projeto: o do usuário ainda falta.
    expect(argsOf(planInstall(stateOf([plugin(MOD_PLUGIN, { scope: 'project' })]), { ...base, permissions: false }))).toContain(`plugin install ${MOD_PLUGIN} --scope user`);
  });

  it('install: marketplace de outra pasta passa a apontar para esta; --sem-permissoes e --sem-mensagens mantêm (e atualizam) o que já estava', () => {
    const moved = planInstall(stateOf([plugin(MOD_PLUGIN)], '/antigo/habblaud'), { root: ROOT, version: '0.2.0', permissions: false, messages: false, sameDir: same });
    expect(argsOf(moved)).toEqual([`plugin marketplace add ${ROOT}`]);
    expect(cliSteps(moved)[0].message).toContain('antes: /antigo/habblaud');
    const keep = planInstall(stateOf([plugin(MOD_PLUGIN, { version: '0.3.0' }), plugin(PERMISSIONS_PLUGIN)]), { root: ROOT, version: '0.3.0', permissions: false, messages: false, sameDir: same });
    expect(argsOf(keep)).toEqual(['plugin marketplace update habblaud', `plugin update ${PERMISSIONS_PLUGIN} --scope user`]);
    expect(keep.plugins).toEqual([MOD_PLUGIN, PERMISSIONS_PLUGIN]);
    expect(keep.notes[0]).toMatch(/continua.*claude plugin uninstall habblaud-permissoes@habblaud/);
    const keepMsg = planInstall(stateOf([plugin(MOD_PLUGIN, { version: '0.3.0' }), plugin(MESSAGES_PLUGIN)]), { root: ROOT, version: '0.3.0', permissions: true, messages: false, sameDir: same });
    expect(argsOf(keepMsg)).toEqual(['plugin marketplace update habblaud', `plugin install ${PERMISSIONS_PLUGIN} --scope user`, `plugin update ${MESSAGES_PLUGIN} --scope user`]);
    expect(keepMsg.plugins).toEqual([MOD_PLUGIN, PERMISSIONS_PLUGIN, MESSAGES_PLUGIN]);
    expect(keepMsg.notes).toEqual(['habblaud-mensagens já estava instalado e continua (--sem-mensagens não o remove; para tirar: claude plugin uninstall habblaud-mensagens@habblaud)']);
  });

  it('uninstall: tira só o que existe, na ordem plugins → marketplace', () => {
    expect(argsOf(planUninstall(stateOf([plugin(MOD_PLUGIN), plugin(PERMISSIONS_PLUGIN), plugin(MESSAGES_PLUGIN)])))).toEqual([
      `plugin uninstall ${MOD_PLUGIN} --scope user`,
      `plugin uninstall ${PERMISSIONS_PLUGIN} --scope user`,
      `plugin uninstall ${MESSAGES_PLUGIN} --scope user`,
      'plugin marketplace remove habblaud',
    ]);
    const none = planUninstall(stateOf([], null));
    expect(cliSteps(none)).toEqual([]);
    expect(none.items).toHaveLength(4);
  });

  describe('nome antigo (codetown, até a 0.3.2)', () => {
    it('os registros antigos derivam do nome antigo', () => {
      expect(LEGACY_PLUGINS).toEqual([OLD_MOD, OLD_PERM]);
    });

    it('install: tira os plugins antigos e o marketplace codetown ANTES de adicionar o habblaud (mesma pasta)', () => {
      const plan = planInstall(legacyState(), { root: ROOT, version: '0.4.0', permissions: true, messages: true, sameDir: same });
      expect(argsOf(plan)).toEqual([
        `plugin uninstall ${OLD_MOD} --scope user`,
        `plugin uninstall ${OLD_PERM} --scope user`,
        'plugin marketplace remove codetown',
        `plugin marketplace add ${ROOT}`,
        `plugin install ${MOD_PLUGIN} --scope user`,
        `plugin install ${PERMISSIONS_PLUGIN} --scope user`,
        `plugin install ${MESSAGES_PLUGIN} --scope user`,
      ]);
      const steps = cliSteps(plan);
      expect(steps.slice(0, 3).map((s) => s.message)).toEqual(['codetown (nome antigo): removido', 'codetown-permissoes (nome antigo): removido', 'marketplace codetown (nome antigo): removido']);
      // Plugin antigo que não sai não segura a instalação (o marketplace o leva junto); o marketplace segura.
      expect(steps.slice(0, 3).map((s) => !!s.keepGoing)).toEqual([true, true, false]);
      expect(steps.slice(0, 3).some((s) => s.plugin)).toBe(false);
      expect(plan.plugins).toEqual([MOD_PLUGIN, PERMISSIONS_PLUGIN, MESSAGES_PLUGIN]);
      // Só o marketplace sobrou (ou outra pasta, de um clone antigo): sai do mesmo jeito. Plugin antigo num escopo
      // de projeto não é deste script.
      expect(argsOf(planInstall(stateOf([plugin(OLD_MOD, { scope: 'project' })], null, '/clone/antigo'), { root: ROOT, version: '0.4.0', permissions: false, messages: false, sameDir: same }))).toEqual([
        'plugin marketplace remove codetown',
        `plugin marketplace add ${ROOT}`,
        `plugin install ${MOD_PLUGIN} --scope user`,
      ]);
      // Migração pela metade (habblaud já instalado, plugin antigo ainda lá): tira o antigo e segue como sempre.
      expect(argsOf(planInstall(stateOf([plugin(MOD_PLUGIN, { version: '0.4.0' }), plugin(OLD_MOD)]), { root: ROOT, version: '0.4.0', permissions: false, messages: false, sameDir: same }))).toEqual([
        `plugin uninstall ${OLD_MOD} --scope user`,
        'plugin marketplace update habblaud',
      ]);
    });

    it('uninstall: tira também os restos antigos; sem eles, nada muda', () => {
      expect(argsOf(planUninstall(legacyState([plugin(MOD_PLUGIN)], ROOT)))).toEqual([
        `plugin uninstall ${OLD_MOD} --scope user`,
        `plugin uninstall ${OLD_PERM} --scope user`,
        'plugin marketplace remove codetown',
        `plugin uninstall ${MOD_PLUGIN} --scope user`,
        'plugin marketplace remove habblaud',
      ]);
      const onlyOld = planUninstall(legacyState());
      expect(argsOf(onlyOld)).toEqual([`plugin uninstall ${OLD_MOD} --scope user`, `plugin uninstall ${OLD_PERM} --scope user`, 'plugin marketplace remove codetown']);
      expect(onlyOld.items.filter((i) => 'unchanged' in i)).toHaveLength(4);
    });

    it('docker:up: com restos antigos só avisa (nunca migra sozinho) e conta como instalado', () => {
      const o = { root: ROOT, version: '0.4.0', sameDir: same };
      const warn = planUpdate(legacyState(), o);
      expect(warn).toEqual({
        action: 'warn',
        message: 'ainda com o nome antigo (marketplace codetown, codetown@codetown 0.3.2, codetown-permissoes@codetown 0.3.2); o docker:up não troca sozinho: rode npm run mod:install',
      });
      // Mesmo com o habblaud em dia, ou só com o marketplace antigo: aviso, nenhum passo.
      expect(planUpdate(stateOf([plugin(MOD_PLUGIN, { version: '0.4.0' })], ROOT, ROOT), o)).toEqual({
        action: 'warn',
        message: 'ainda com o nome antigo (marketplace codetown); o docker:up não troca sozinho: rode npm run mod:install',
      });
      expect(modHint({ installed: true, unavailable: false })).toEqual([]);
    });

    it('status: mostra os restos antigos e manda rodar npm run mod:install', () => {
      const lines = describeStatus(legacyState(), {}, { root: ROOT, version: '0.4.0', home: '/h', sameDir: same });
      expect(lines).toEqual([
        'marketplace habblaud: não adicionado',
        'habblaud: não instalado',
        'habblaud-permissoes: não instalado',
        'habblaud-mensagens: não instalado',
        '! nome antigo ainda registrado: marketplace codetown (esta pasta), codetown@codetown 0.3.2, codetown-permissoes@codetown 0.3.2; npm run mod:install troca pelo habblaud',
      ]);
      const elsewhere = describeStatus(stateOf([], null, '/h/clone/codetown'), {}, { root: ROOT, version: '0.4.0', home: '/h', sameDir: same });
      expect(elsewhere[4]).toBe('! nome antigo ainda registrado: marketplace codetown (~/clone/codetown); npm run mod:install troca pelo habblaud');
      expect(describeStatus(stateOf([]), {}, { root: ROOT, version: '0.4.0', home: '/h', sameDir: same }).join('\n')).not.toContain('nome antigo');
    });

    it('migração do jeito antigo: hook e tap de uma pasta com o nome antigo também são reconhecidos', () => {
      const tap = wrapCommand('node', '/x/codetown/scripts/statusline-tap.mjs', 'ccstatusline');
      const hook = hookEntry(hookCommand('node', '/x/codetown/mod/codetown-permissoes/hooks/permission-hook.mjs', { port: 4747, timeoutS: 300 }), { port: 4747, timeoutS: 300 });
      const m = planMigration({ statusLine: { type: 'command', command: tap }, hooks: { PermissionRequest: [{ matcher: '*', hooks: [hook] }] } }, { modInstalled: true, permissionsInstalled: true, permissions: true });
      expect(m.settings).toEqual({ statusLine: { type: 'command', command: 'ccstatusline' } });
      expect(m.done).toHaveLength(2);
    });
  });

  describe('migração do jeito antigo', () => {
    const tap = wrapCommand('node', '/repo/habblaud/scripts/statusline-tap.mjs', 'npx -y ccstatusline');
    const hook = hookEntry(hookCommand('node', '/repo/habblaud/scripts/permission-hook.mjs', { port: 4747, timeoutS: 300 }), { port: 4747, timeoutS: 300 });
    const mine = { type: 'command', command: 'meu-hook' };
    const settings = {
      model: 'opus',
      statusLine: { type: 'command', command: tap, padding: 0 },
      hooks: { PermissionRequest: [{ matcher: '*', hooks: [mine, hook] }], Stop: [{ hooks: [mine] }] },
      enabledPlugins: { [MOD_PLUGIN]: true },
    };

    it('com os dois plugins instalados: devolve o statusline original e tira só o hook do Habblaud, numa gravação', () => {
      const m = planMigration(settings, { modInstalled: true, permissionsInstalled: true, permissions: true });
      expect(m.settings).toEqual({
        model: 'opus',
        statusLine: { type: 'command', command: 'npx -y ccstatusline', padding: 0 },
        hooks: { PermissionRequest: [{ matcher: '*', hooks: [mine] }], Stop: [{ hooks: [mine] }] },
        enabledPlugins: { [MOD_PLUGIN]: true },
      });
      expect(m.done).toHaveLength(2);
      expect(m.done[0]).toContain('restaurado: npx -y ccstatusline');
    });

    it('--sem-permissoes mantém o hook; plugin que não ficou instalado não leva o antigo embora', () => {
      const semPerm = planMigration(settings, { modInstalled: true, permissionsInstalled: false, permissions: false });
      expect((semPerm.settings?.hooks as Record<string, unknown>).PermissionRequest).toEqual(settings.hooks.PermissionRequest);
      expect(semPerm.kept).toEqual(['hook de permissão antigo mantido (--sem-permissoes)']);
      const falhou = planMigration(settings, { modInstalled: false, permissionsInstalled: false, permissions: true });
      expect(falhou.settings).toBeUndefined();
      expect(falhou.kept).toHaveLength(2);
      // Nada do jeito antigo: nada a fazer.
      expect(planMigration({ model: 'opus' }, { modInstalled: true, permissionsInstalled: true, permissions: true })).toEqual({ done: [], kept: [], warnings: [] });
    });

    it('formato inesperado: avisa e não mexe', () => {
      const m = planMigration({ statusLine: { type: 'command', command: 'echo statusline-tap.mjs quebrado' } }, { modInstalled: true, permissionsInstalled: true, permissions: true });
      expect(m.settings).toBeUndefined();
      expect(m.warnings[0]).toMatch(/usage:uninstall/);
    });
  });

  it('docker:up: atualiza só o que já está instalado e só a partir desta pasta', () => {
    const o = { root: ROOT, version: '0.3.0', sameDir: same };
    expect(planUpdate(stateOf([]), o)).toEqual({ action: 'none', installed: false });
    expect(planUpdate(stateOf([plugin(MOD_PLUGIN, { version: '0.3.0' }), plugin(MESSAGES_PLUGIN, { version: '0.3.0' })]), o)).toEqual({ action: 'none', installed: true });
    // O mod sem o plugin de mensagens (instalado antes dele): nada a instalar, só a dica.
    expect(planUpdate(stateOf([plugin(MOD_PLUGIN, { version: '0.3.0' })]), o)).toEqual({ action: 'none', installed: true, hint: MESSAGES_HINT });
    expect(MESSAGES_HINT).toBe('rode npm run mod:install para mandar mensagens pelo escritório (plugin habblaud-mensagens)');
    const up = planUpdate(stateOf([plugin(MOD_PLUGIN), plugin(PERMISSIONS_PLUGIN, { version: '0.3.0' })]), o);
    expect(up.action === 'update' && up.steps.map((s) => s.args.join(' '))).toEqual(['plugin marketplace update habblaud', `plugin update ${MOD_PLUGIN} --scope user`]);
    expect(up.action === 'update' && up.hint).toBe(MESSAGES_HINT);
    // O de mensagens instalado acompanha a versão como os outros; sem o mod, nenhuma dica.
    const msg = planUpdate(stateOf([plugin(MOD_PLUGIN, { version: '0.3.0' }), plugin(MESSAGES_PLUGIN)]), o);
    expect(msg).toEqual({ action: 'update', steps: [expect.objectContaining({ args: ['plugin', 'marketplace', 'update', 'habblaud'] }), expect.objectContaining({ args: ['plugin', 'update', MESSAGES_PLUGIN, '--scope', 'user'], plugin: MESSAGES_PLUGIN })] });
    expect(planUpdate(stateOf([plugin(PERMISSIONS_PLUGIN, { version: '0.3.0' })]), o)).toEqual({ action: 'none', installed: true });
    const elsewhere = planUpdate(stateOf([plugin(MOD_PLUGIN)], '/outro/clone'), o);
    expect(elsewhere.action === 'warn' && elsewhere.message).toMatch(/outra pasta \(\/outro\/clone\).*npm run mod:install/);
    expect(planUpdate(stateOf([plugin(MOD_PLUGIN)], null), o).action).toBe('warn');
    // A dica do fim do docker:up só aparece quando ninguém instalou (e dá para saber).
    expect(modHint({ installed: false, unavailable: false }).join('\n')).toMatch(/npm run mod:install.*2\.1\.287\+[\s\S]*usage:install e npm run hooks:install/);
    expect(modHint({ installed: true, unavailable: false })).toEqual([]);
    expect(modHint({ installed: false, unavailable: true })).toEqual([]);
  });

  it('conferência depois de instalar, mensagem de falha do CLI e status', () => {
    const after = stateOf([plugin(MOD_PLUGIN, { version: '0.1.0' }), plugin(PERMISSIONS_PLUGIN, { enabled: false, errors: ['boom'] })]);
    expect(verifyInstall(after, [MOD_PLUGIN, PERMISSIONS_PLUGIN, 'outro@habblaud'], '0.2.0')).toEqual([
      'habblaud: o Claude Code registra a versão 0.1.0, não a 0.2.0 (o manifesto em mod/ está com outra versão?)',
      `habblaud-permissoes: instalado, mas desligado (claude plugin enable ${PERMISSIONS_PLUGIN})`,
      'habblaud-permissoes: boom',
      'outro: não aparece instalado na lista do Claude Code',
    ]);
    expect(cliMessage({ code: 1, stdout: 'Installing…\n', stderr: '\x1b[31m✘ Failed to install plugin "x": not found\x1b[0m\n' })).toBe('Installing… · Failed to install plugin "x": not found');
    expect(cliMessage({ code: null, stdout: '', stderr: '', error: 'sem claude' })).toBe('sem claude');
    expect(cliMessage({ code: 2, stdout: '', stderr: '' })).toBe('saiu com código 2');

    const tap = wrapCommand('node', '/r/scripts/statusline-tap.mjs', 'ccstatusline');
    const lines = describeStatus(stateOf([plugin(MOD_PLUGIN, { version: '0.1.0', folderVersion: '0.2.0', readFromFolder: '/h/x' })]), { statusLine: { command: tap }, disableAllHooks: true }, { root: ROOT, version: '0.2.0', home: '/h', sameDir: same });
    expect(lines).toEqual([
      'marketplace habblaud: esta pasta',
      'habblaud: instalado, ligado, versão 0.1.0 (esta pasta: 0.2.0; npm run mod:install ou npm run docker:up atualiza), carrega 0.2.0 de ~/x',
      'habblaud-permissoes: não instalado',
      'habblaud-mensagens: não instalado',
      '! tap de statusline antigo ainda instalado junto com o mod: npm run mod:install tira (ou npm run usage:uninstall)',
      '! disableAllHooks está ligado no settings.json desta conta: nenhum mod (nem hook) roda',
    ]);
  });

  it('parseArgs', () => {
    expect(parseArgs(['install'])).toEqual({ command: 'install', dryRun: false, permissions: true, messages: true, accounts: [], claudeCmd: undefined });
    expect(parseArgs(['install', '--sem-mensagens'])).toMatchObject({ permissions: true, messages: false });
    expect(parseArgs(['install', '--sem-permissoes', '--sem-mensagens', '--conta', '~/.claude-conta2', '--conta', '/x', '--dry-run', '--claude', '/opt/claude'])).toEqual({
      command: 'install',
      dryRun: true,
      permissions: false,
      messages: false,
      accounts: ['~/.claude-conta2', '/x'],
      claudeCmd: '/opt/claude',
    });
    expect(parseArgs(['-h'])).toBe('help');
    expect(() => parseArgs([])).toThrow(/install, uninstall ou status/);
    expect(() => parseArgs(['install', '--conta'])).toThrow(/--conta/);
    expect(() => parseArgs(['install', '--xyz'])).toThrow(/opção desconhecida/);
  });
});

// ---------------------------------------------------------------------------------------------
// CLI falso: guarda marketplace e plugins por CLAUDE_CONFIG_DIR, como o de verdade
// ---------------------------------------------------------------------------------------------

interface FakeAccount {
  /** Marketplaces por nome → pasta. */
  marketplaces: Map<string, string>;
  plugins: Map<string, { version: string; enabled: boolean }>;
}

class FakeClaude {
  version = '2.1.293 (Claude Code)';
  /** Versão dos manifestos em mod/ (o que install/update registram). */
  folderVersion = '0.2.0';
  missing = false;
  fail?: (args: string[]) => boolean;
  calls: Array<{ args: string[]; configDir: string }> = [];
  accounts = new Map<string, FakeAccount>();

  constructor(private home: string) {}

  account(configDir: string): FakeAccount {
    let a = this.accounts.get(configDir);
    if (!a) this.accounts.set(configDir, (a = { marketplaces: new Map(), plugins: new Map() }));
    return a;
  }

  get mutating(): string[] {
    return this.calls.filter((c) => !c.args.includes('--json') && c.args[0] !== '--version').map((c) => c.args.join(' '));
  }

  runner: ClaudeRunner = (args, env): ClaudeResult => {
    const configDir = env.CLAUDE_CONFIG_DIR ?? join(this.home, '.claude');
    this.calls.push({ args, configDir });
    if (this.missing) return { code: null, stdout: '', stderr: '', error: 'o comando "claude" não foi encontrado no PATH' };
    if (this.fail?.(args)) return { code: 1, stdout: '', stderr: '✘ Failed: boom\n' };
    const ok = (stdout = 'ok\n'): ClaudeResult => ({ code: 0, stdout, stderr: '' });
    const no = (stderr: string): ClaudeResult => ({ code: 1, stdout: '', stderr });
    const a = this.account(configDir);
    const cmd = args.join(' ');
    if (cmd === '--version') return ok(`${this.version}\n`);
    if (cmd === 'plugin marketplace list --json') {
      return ok(JSON.stringify([...a.marketplaces].map(([name, path]) => ({ name, source: 'directory', path, installLocation: path }))));
    }
    if (cmd === 'plugin list --json') {
      return ok(
        JSON.stringify(
          [...a.plugins].map(([id, p]) => ({ id, version: p.version, scope: 'user', enabled: p.enabled, installPath: '/cache', readFromFolder: `${a.marketplaces.get(id.split('@')[1])}/mod`, folderVersion: this.folderVersion })),
        ),
      );
    }
    const [, sub, third, fourth] = args;
    if (sub === 'marketplace') {
      if (third === 'add') {
        // Como o de verdade: o nome vem do manifesto da pasta (o mesmo nome só troca a origem).
        let name: string | undefined;
        try {
          name = (JSON.parse(readFileSync(join(fourth, '.claude-plugin', 'marketplace.json'), 'utf8')) as { name?: string }).name;
        } catch {
          name = undefined;
        }
        if (!name) return no(`✘ No marketplace.json in ${fourth}\n`);
        a.marketplaces.set(name, fourth);
        return ok(`✔ Successfully added marketplace: ${name}\n`);
      }
      if (!a.marketplaces.has(fourth)) return no(`✘ Marketplace '${fourth}' not found\n`);
      if (third === 'update') return ok();
      if (third === 'remove') {
        // Tirar o marketplace leva junto os plugins que vieram dele.
        a.marketplaces.delete(fourth);
        for (const id of [...a.plugins.keys()]) if (id.endsWith(`@${fourth}`)) a.plugins.delete(id);
        return ok();
      }
    }
    if (sub === 'install') {
      if (!a.marketplaces.has(third.split('@')[1])) return no(`✘ Plugin "${third}" not found in any marketplace\n`);
      a.plugins.set(third, { version: this.folderVersion, enabled: true });
      return ok();
    }
    const p = a.plugins.get(third);
    if (!p) return no(`✘ Plugin "${third}" not found in installed plugins\n`);
    if (sub === 'enable') p.enabled = true;
    else if (sub === 'update') p.version = this.folderVersion;
    else if (sub === 'uninstall') a.plugins.delete(third);
    else return no(`comando desconhecido: ${cmd}`);
    return ok();
  };
}

describe('mod-install.ts (CLI falso, HOME falso)', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  let root: string;
  let usageDir: string;
  let out: string[];
  let fake: FakeClaude;
  const tap = wrapCommand('node', '/x/habblaud/scripts/statusline-tap.mjs', 'npx -y ccstatusline');
  const hook = hookEntry(hookCommand('node', '/x/habblaud/scripts/permission-hook.mjs', { port: 4747, timeoutS: 300 }), { port: 4747, timeoutS: 300 });
  const original = {
    model: 'opus',
    statusLine: { type: 'command', command: tap },
    hooks: { PermissionRequest: [{ matcher: '*', hooks: [hook] }], Stop: [{ hooks: [{ type: 'command', command: 'say pronto' }] }] },
  };

  beforeEach(() => {
    tmp = tempDir();
    home = join(tmp.dir, 'home');
    root = join(tmp.dir, 'habblaud');
    usageDir = join(tmp.dir, 'usage');
    out = [];
    fake = new FakeClaude(home);
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    mkdirSync(join(home, '.claude-conta2', 'sessions'), { recursive: true });
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), '{"name":"habblaud","plugins":[]}');
    writeFileSync(join(home, '.claude', 'settings.json'), `${JSON.stringify(original, null, 2)}\n`);
  });
  afterEach(() => tmp.cleanup());

  // CLAUDE_CONFIG_DIR herdado, como quando o comando roda de dentro de uma sessão da conta 2.
  const exec = (command: RunOptions['command'], extra: Partial<RunOptions> = {}, health?: HealthInfo, env: NodeJS.ProcessEnv = {}) =>
    run(
      { command, dryRun: false, permissions: true, messages: true, accounts: [], ...extra },
      {
        env: { HOME: home, PATH: '/usr/bin', HABBLAUD_USAGE_DIR: usageDir, CLAUDE_CONFIG_DIR: join(home, '.claude-conta2'), ...env },
        home,
        now: new Date(2026, 9, 8, 9, 30, 0),
        root,
        version: '0.2.0',
        claude: fake.runner,
        out: (l) => out.push(l),
        // Nunca consulta a porta de verdade.
        health: async () => health,
      },
    );
  const read = (acc: string) => JSON.parse(readFileSync(join(home, acc, 'settings.json'), 'utf8'));
  const installed = (acc: string) => Object.fromEntries(fake.account(join(home, acc)).plugins);

  it('install: as duas contas, cada uma com a sua pasta; migra o tap e o hook com backup; de novo = nada a fazer', async () => {
    expect(await exec('install')).toBe(0);
    for (const acc of ['.claude', '.claude-conta2']) {
      expect(Object.fromEntries(fake.account(join(home, acc)).marketplaces)).toEqual({ habblaud: root });
      expect(installed(acc)).toEqual({
        [MOD_PLUGIN]: { version: '0.2.0', enabled: true },
        [PERMISSIONS_PLUGIN]: { version: '0.2.0', enabled: true },
        [MESSAGES_PLUGIN]: { version: '0.2.0', enabled: true },
      });
    }
    // A conta padrão nunca recebe o CLAUDE_CONFIG_DIR herdado da outra.
    expect(fake.accounts.size).toBe(2);
    expect(fake.calls.filter((c) => c.args[1] === 'install' && c.args[2] === MOD_PLUGIN).map((c) => c.configDir)).toEqual([join(home, '.claude'), join(home, '.claude-conta2')]);
    expect(read('.claude')).toEqual({ model: 'opus', statusLine: { type: 'command', command: 'npx -y ccstatusline' }, hooks: { Stop: original.hooks.Stop } });
    expect(JSON.parse(readFileSync(join(home, '.claude', 'settings.json.habblaud-backup-20261008-093000'), 'utf8'))).toEqual(original);
    // Conta sem nada do jeito antigo: o settings.json nem é criado.
    expect(existsSync(join(home, '.claude-conta2', 'settings.json'))).toBe(false);
    expect(existsSync(usageDir)).toBe(true);
    const text = out.join('\n');
    expect(text).toContain('tap de statusline antigo removido');
    expect(text).toContain('hook de permissão antigo removido');
    expect(text).toContain('/reload-plugins');

    out = [];
    fake.calls = [];
    expect(await exec('install')).toBe(0);
    expect(fake.mutating).toEqual(['plugin marketplace update habblaud', 'plugin marketplace update habblaud']);
    expect(out.join('\n')).toContain('habblaud: já instalado na versão 0.2.0');
    expect(readdirSync(join(home, '.claude')).filter((f) => f.includes('backup'))).toHaveLength(1);
  });

  it('--sem-permissoes e --sem-mensagens: só o mod; o hook antigo fica; --conta limita a uma conta', async () => {
    expect(await exec('install', { permissions: false, messages: false, accounts: [join(home, '.claude')] })).toBe(0);
    expect(installed('.claude')).toEqual({ [MOD_PLUGIN]: { version: '0.2.0', enabled: true } });
    expect(fake.calls.filter((c) => c.args[0] === 'plugin' && c.configDir === join(home, '.claude-conta2'))).toEqual([]);
    const s = read('.claude');
    expect(s.statusLine).toEqual({ type: 'command', command: 'npx -y ccstatusline' });
    expect(s.hooks.PermissionRequest).toEqual(original.hooks.PermissionRequest);
    expect(out.join('\n')).toContain('hook de permissão antigo mantido (--sem-permissoes)');
    await expect(exec('install', { accounts: [join(home, 'nao-existe')] })).rejects.toThrow(/pasta não encontrada/);
  });

  it('Claude Code antigo: explica, sugere o jeito antigo e não mexe em nada', async () => {
    fake.version = '2.1.286 (Claude Code)';
    expect(await exec('install')).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('precisa do Claude Code 2.1.287 ou mais novo, e este é o 2.1.286');
    expect(text).toContain('npm run usage:install');
    expect(text).toContain('npm run hooks:install');
    expect(fake.mutating).toEqual([]);
    expect(read('.claude')).toEqual(original);
    expect(existsSync(usageDir)).toBe(false);
  });

  it('sem o claude no PATH, ou sem o marketplace nesta pasta: erro claro, nada alterado', async () => {
    fake.missing = true;
    expect(await exec('install')).toBe(1);
    expect(out.join('\n')).toContain('não foi encontrado no PATH');
    fake.missing = false;
    out = [];
    fake.calls = [];
    rmSync(join(root, '.claude-plugin', 'marketplace.json'));
    expect(await exec('install')).toBe(1);
    expect(out.join('\n')).toContain(join('.claude-plugin', 'marketplace.json'));
    expect(fake.calls).toEqual([]);
    expect(read('.claude')).toEqual(original);
  });

  it('--dry-run: só consulta (listas), não instala, não grava nem cria a pasta do uso', async () => {
    expect(await exec('install', { dryRun: true })).toBe(0);
    expect(fake.mutating).toEqual([]);
    expect(read('.claude')).toEqual(original);
    expect(existsSync(usageDir)).toBe(false);
    const text = out.join('\n');
    expect(text).toContain(`~ marketplace habblaud: adicionado (esta pasta) (simulação: claude plugin marketplace add ${root})`);
    expect(text).toContain('~ tap de statusline antigo removido');
  });

  it('falha do CLI: a conta para ali, sai com erro e o jeito antigo continua (não fica sem nenhum dos dois)', async () => {
    fake.fail = (args) => args[1] === 'install' && args[2] === MOD_PLUGIN;
    expect(await exec('install', { accounts: [join(home, '.claude')] })).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('✗ habblaud: falhou (Failed: boom)');
    expect(fake.mutating).toEqual([`plugin marketplace add ${root}`, `plugin install ${MOD_PLUGIN} --scope user`]);
    expect(read('.claude')).toEqual(original);
    expect(text).toContain('tap de statusline antigo mantido');
    expect(text).not.toContain('Pronto.');
  });

  it('status e uninstall', async () => {
    await exec('install', { permissions: false });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(original));
    mkdirSync(usageDir, { recursive: true });
    writeFileSync(join(usageDir, '.claude.json'), JSON.stringify({ fetchedAt: new Date(2026, 9, 8, 9, 25, 0).getTime(), source: 'mod' }));
    out = [];
    expect(await exec('status')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('Claude Code 2.1.293 · Habblaud 0.2.0');
    expect(text).toMatch(
      /• \.claude \(~\/\.claude\)\n {4}marketplace habblaud: esta pasta\n {4}habblaud: instalado, ligado, versão 0.2.0\n {4}habblaud-permissoes: não instalado\n {4}habblaud-mensagens: instalado, ligado, versão 0.2.0\n/,
    );
    expect(text).toContain('! tap de statusline antigo ainda instalado junto com o mod');
    expect(text).toContain('hook de permissão antigo instalado (jeito antigo');
    expect(text).toContain('último uso capturado há 5 min (pelo mod)');
    expect(text).toContain('Habblaud em http://127.0.0.1:4747: fora do ar');
    expect(text).not.toContain('Mensagens pelo escritório');
    out = [];
    await exec('status', {}, { permissions: true, messages: true });
    expect(out.join('\n')).toContain('Habblaud em http://127.0.0.1:4747: no ar e respondendo pedidos de permissão');
    expect(out.join('\n')).toContain('Mensagens pelo escritório: ligadas (chegam às sessões abertas com o plugin habblaud-mensagens).');
    out = [];
    await exec('status', {}, { permissions: true, messages: false });
    expect(out.at(-1)).toBe('Mensagens pelo escritório: desligadas no Habblaud (porta exposta na rede, HABBLAUD_TERMINAL=0 ou HABBLAUD_MENSAGENS=0).');
    // Um Habblaud de antes das mensagens (sem o campo no /api/health): nada sobre elas.
    out = [];
    await exec('status', {}, { permissions: true });
    expect(out.join('\n')).not.toContain('Mensagens pelo escritório');
    const installs = [`plugin marketplace add ${root}`, `plugin install ${MOD_PLUGIN} --scope user`, `plugin install ${MESSAGES_PLUGIN} --scope user`];
    expect(fake.mutating).toEqual([...installs, ...installs]);

    out = [];
    fake.calls = [];
    expect(await exec('uninstall')).toBe(0);
    const removes = [`plugin uninstall ${MOD_PLUGIN} --scope user`, `plugin uninstall ${MESSAGES_PLUGIN} --scope user`, 'plugin marketplace remove habblaud'];
    expect(fake.mutating).toEqual([...removes, ...removes]);
    expect(installed('.claude')).toEqual({});
    expect(fake.account(join(home, '.claude')).marketplaces.size).toBe(0);
    // O desinstalador não mexe no settings.json (o tap e o hook antigos são do usage/hooks:uninstall).
    expect(read('.claude')).toEqual(original);
    expect(out.join('\n')).toContain('npm run usage:install e npm run hooks:install');
    out = [];
    expect(await exec('uninstall')).toBe(0);
    expect(out.join('\n')).toContain('= marketplace habblaud: não estava adicionado');
  });

  describe('nome antigo (codetown): o que o mod:install da 0.3 deixou', () => {
    const oldHook = hookEntry(hookCommand('node', '/x/codetown/mod/codetown-permissoes/hooks/permission-hook.mjs', { port: 4747, timeoutS: 300 }), { port: 4747, timeoutS: 300 });
    const oldSettings = { model: 'opus', hooks: { PermissionRequest: [{ matcher: '*', hooks: [oldHook] }] } };
    const OLD = ['plugin uninstall codetown@codetown --scope user', 'plugin uninstall codetown-permissoes@codetown --scope user', 'plugin marketplace remove codetown'];

    beforeEach(() => {
      // Conta padrão: marketplace codetown NESTA pasta, os dois plugins antigos, um hook de settings do caminho
      // antigo (hooks:install da 0.3) e o uso em ~/.codetown. A conta 2 não tem nada.
      const acc = fake.account(join(home, '.claude'));
      acc.marketplaces.set('codetown', root);
      acc.plugins.set('codetown@codetown', { version: '0.3.2', enabled: true });
      acc.plugins.set('codetown-permissoes@codetown', { version: '0.3.2', enabled: true });
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(oldSettings));
      mkdirSync(join(home, '.codetown', 'usage'), { recursive: true });
      writeFileSync(join(home, '.codetown', 'usage', '.claude.json'), '{"source":"mod"}');
    });

    it('install: tira os antigos ANTES de adicionar o habblaud, leva ~/.codetown para ~/.habblaud e tira o hook antigo', async () => {
      expect(await exec('install')).toBe(0);
      expect(fake.mutating).toEqual([
        ...OLD,
        `plugin marketplace add ${root}`,
        `plugin install ${MOD_PLUGIN} --scope user`,
        `plugin install ${PERMISSIONS_PLUGIN} --scope user`,
        `plugin install ${MESSAGES_PLUGIN} --scope user`,
        // Conta 2, sem restos.
        `plugin marketplace add ${root}`,
        `plugin install ${MOD_PLUGIN} --scope user`,
        `plugin install ${PERMISSIONS_PLUGIN} --scope user`,
        `plugin install ${MESSAGES_PLUGIN} --scope user`,
      ]);
      expect(Object.fromEntries(fake.account(join(home, '.claude')).marketplaces)).toEqual({ habblaud: root });
      expect(Object.keys(installed('.claude'))).toEqual([MOD_PLUGIN, PERMISSIONS_PLUGIN, MESSAGES_PLUGIN]);
      expect(read('.claude')).toEqual({ model: 'opus' });
      // A pasta de estado muda de nome mesmo com HABBLAUD_USAGE_DIR em outro lugar (criada à parte).
      expect(existsSync(join(home, '.codetown'))).toBe(false);
      expect(readFileSync(join(home, '.habblaud', 'usage', '.claude.json'), 'utf8')).toBe('{"source":"mod"}');
      expect(existsSync(usageDir)).toBe(true);
      const text = out.join('\n');
      expect(text.split('\n')[0]).toBe('✓ ~/.codetown (nome antigo) agora é ~/.habblaud.');
      expect(text).toContain(
        [
          '.claude (~/.claude):',
          '  ✓ codetown (nome antigo): removido',
          '  ✓ codetown-permissoes (nome antigo): removido',
          '  ✓ marketplace codetown (nome antigo): removido',
          '  ✓ marketplace habblaud: adicionado (esta pasta)',
          '  ✓ habblaud: instalado',
          '  ✓ habblaud-permissoes: instalado',
          '  ✓ habblaud-mensagens: instalado',
          '  ✓ hook de permissão antigo removido: o plugin habblaud-permissoes responde no lugar dele',
        ].join('\n'),
      );
      expect(text).not.toContain('ainda registrado');
      expect(text).toContain('Pronto.');

      // De novo: nada mais do nome antigo.
      out = [];
      fake.calls = [];
      expect(await exec('install')).toBe(0);
      expect(fake.mutating).toEqual(['plugin marketplace update habblaud', 'plugin marketplace update habblaud']);
      expect(out.join('\n')).not.toContain('nome antigo');
    });

    it('sem HABBLAUD_USAGE_DIR: o uso antigo já vira a pasta do uso; com ~/.habblaud existente, só o que falta vai', async () => {
      mkdirSync(join(home, '.habblaud'), { recursive: true });
      writeFileSync(join(home, '.habblaud', 'names.json'), '{}');
      expect(await exec('install', { accounts: [join(home, '.claude')] }, undefined, { HABBLAUD_USAGE_DIR: undefined })).toBe(0);
      expect(readFileSync(join(home, '.habblaud', 'usage', '.claude.json'), 'utf8')).toBe('{"source":"mod"}');
      expect(readFileSync(join(home, '.habblaud', 'names.json'), 'utf8')).toBe('{}');
      expect(existsSync(join(home, '.codetown'))).toBe(false);
      const text = out.join('\n');
      expect(text).toContain('✓ de ~/.codetown (nome antigo) para ~/.habblaud: usage.');
      expect(text).not.toContain('pasta do uso criada');
    });

    it('plugin antigo que não sai não segura a instalação: o marketplace codetown o leva junto (mas a falha conta)', async () => {
      fake.fail = (args) => args[1] === 'uninstall' && args[2] === 'codetown@codetown';
      expect(await exec('install', { accounts: [join(home, '.claude')] })).toBe(1);
      expect(fake.mutating).toEqual([
        ...OLD,
        `plugin marketplace add ${root}`,
        `plugin install ${MOD_PLUGIN} --scope user`,
        `plugin install ${PERMISSIONS_PLUGIN} --scope user`,
        `plugin install ${MESSAGES_PLUGIN} --scope user`,
      ]);
      expect(Object.keys(installed('.claude'))).toEqual([MOD_PLUGIN, PERMISSIONS_PLUGIN, MESSAGES_PLUGIN]);
      expect(read('.claude')).toEqual({ model: 'opus' });
      const text = out.join('\n');
      expect(text).toContain('  ✗ codetown (nome antigo): falhou (Failed: boom)');
      expect(text).not.toContain('ainda registrado');
      expect(text).not.toContain('Pronto.');
    });

    it('marketplace codetown que não sai: para ali (nunca dois nomes para a mesma pasta), avisa e o hook antigo fica', async () => {
      fake.fail = (args) => args.join(' ') === 'plugin marketplace remove codetown';
      expect(await exec('install', { accounts: [join(home, '.claude')] })).toBe(1);
      expect(fake.mutating).toEqual(OLD);
      expect(Object.fromEntries(fake.account(join(home, '.claude')).marketplaces)).toEqual({ codetown: root });
      expect(read('.claude')).toEqual(oldSettings);
      const text = out.join('\n');
      expect(text).toContain('  ✗ marketplace codetown (nome antigo): falhou (Failed: boom)');
      expect(text).toContain('  ! nome antigo ainda registrado: marketplace codetown; rode npm run mod:install de novo');
      expect(text).toContain('hook de permissão antigo mantido (o plugin de permissões não ficou instalado)');
    });

    it('--dry-run: mostra a limpeza e a pasta que mudaria, sem mexer em nada', async () => {
      expect(await exec('install', { dryRun: true, accounts: [join(home, '.claude')] })).toBe(0);
      expect(fake.mutating).toEqual([]);
      expect(existsSync(join(home, '.codetown', 'usage', '.claude.json'))).toBe(true);
      expect(existsSync(join(home, '.habblaud'))).toBe(false);
      expect(read('.claude')).toEqual(oldSettings);
      const text = out.join('\n');
      expect(text).toContain('~ ~/.codetown (nome antigo) vai para ~/.habblaud (simulação: nada movido)');
      expect(text).toContain('  ~ codetown (nome antigo): removido (simulação: claude plugin uninstall codetown@codetown --scope user)');
      expect(text).toContain('  ~ marketplace codetown (nome antigo): removido (simulação: claude plugin marketplace remove codetown)');
    });

    it('status mostra os restos antigos; uninstall tira também eles (e não mexe na pasta de estado)', async () => {
      expect(await exec('status', { accounts: [join(home, '.claude')] })).toBe(0);
      let text = out.join('\n');
      expect(text).toContain('    ! nome antigo ainda registrado: marketplace codetown (esta pasta), codetown@codetown 0.3.2, codetown-permissoes@codetown 0.3.2; npm run mod:install troca pelo habblaud');
      expect(text).toContain('    hook de permissão antigo instalado (jeito antigo');
      expect(fake.mutating).toEqual([]);

      out = [];
      expect(await exec('uninstall', { accounts: [join(home, '.claude')] })).toBe(0);
      expect(fake.mutating).toEqual(OLD);
      expect(fake.account(join(home, '.claude')).marketplaces.size).toBe(0);
      expect(installed('.claude')).toEqual({});
      text = out.join('\n');
      expect(text).toContain('  ✓ marketplace codetown (nome antigo): removido');
      expect(text).toContain('  = habblaud: não estava instalado');
      expect(text).toContain('Pronto.');
      expect(existsSync(join(home, '.codetown', 'usage', '.claude.json'))).toBe(true);
    });

    it('docker:up: só avisa, não troca nada sozinho e não mostra a dica de instalar do zero', () => {
      const accounts = [
        { dir: join(home, '.claude'), label: 'Conta C' },
        { dir: join(home, '.claude-conta2'), label: 'Conta D' },
      ];
      const res = updateInstalledMods(accounts, { env: { HOME: home }, home, root, version: '0.4.0', claude: fake.runner });
      expect(res).toEqual({
        installed: true,
        unavailable: false,
        lines: [
          {
            level: 'warn',
            text: 'mod na Conta C: ainda com o nome antigo (marketplace codetown, codetown@codetown 0.3.2, codetown-permissoes@codetown 0.3.2); o docker:up não troca sozinho: rode npm run mod:install',
          },
        ],
      });
      expect(fake.mutating).toEqual([]);
      expect(modHint(res)).toEqual([]);
      expect(existsSync(join(home, '.codetown'))).toBe(true);
    });
  });

  it('docker:up: atualiza para a versão nova só quem tem o mod; nunca instala; nunca lança', async () => {
    const accounts = [
      { dir: join(home, '.claude'), label: 'Conta C' },
      { dir: join(home, '.claude-conta2'), label: 'Conta D' },
    ];
    const ctx = { env: { HOME: home }, home, root, claude: fake.runner };
    expect(updateInstalledMods(accounts, { ...ctx, version: '0.2.0' })).toEqual({ installed: false, unavailable: false, lines: [] });
    expect(fake.mutating).toEqual([]);

    await exec('install', { accounts: [join(home, '.claude-conta2')] });
    fake.calls = [];
    expect(updateInstalledMods(accounts, { ...ctx, version: '0.2.0' })).toEqual({ installed: true, unavailable: false, lines: [] });
    expect(fake.mutating).toEqual([]);

    // git pull: os manifestos em mod/ e o package.json passam para 0.3.0.
    fake.folderVersion = '0.3.0';
    const res = updateInstalledMods(accounts, { ...ctx, version: '0.3.0' });
    expect(res.lines).toEqual([{ level: 'info', text: 'Mod atualizado para 0.3.0 na Conta D; sessões abertas: /reload-plugins' }]);
    expect(fake.mutating).toEqual([
      'plugin marketplace update habblaud',
      `plugin update ${MOD_PLUGIN} --scope user`,
      `plugin update ${PERMISSIONS_PLUGIN} --scope user`,
      `plugin update ${MESSAGES_PLUGIN} --scope user`,
    ]);
    expect(installed('.claude-conta2')[MOD_PLUGIN]).toEqual({ version: '0.3.0', enabled: true });
    expect(installed('.claude')).toEqual({});

    // O update "dá certo" mas a versão não muda (manifesto atrasado): aviso, não "atualizado".
    const stuck = updateInstalledMods(accounts, { ...ctx, version: '0.4.0' });
    expect(stuck.lines[0].level).toBe('warn');
    expect(stuck.lines[0].text).toMatch(/Conta D: habblaud: o Claude Code registra a versão 0.3.0, não a 0.4.0/);

    // Sem o claude, ou com o runner lançando: um aviso só e nada de exceção.
    fake.missing = true;
    expect(updateInstalledMods(accounts, { ...ctx, version: '0.4.0' })).toEqual({
      installed: false,
      unavailable: true,
      lines: [{ level: 'warn', text: 'não consegui consultar o Claude Code (o comando "claude" não foi encontrado no PATH); o mod não foi conferido.' }],
    });
    const boom: ClaudeRunner = () => {
      throw new Error('explodiu');
    };
    expect(updateInstalledMods(accounts, { ...ctx, version: '0.4.0', claude: boom }).unavailable).toBe(true);
  });

  it('docker:up: conta com o mod e sem o plugin de mensagens: não instala nada, só dá a dica (também ao atualizar)', async () => {
    const accounts = [
      { dir: join(home, '.claude'), label: 'Conta C' },
      { dir: join(home, '.claude-conta2'), label: 'Conta D' },
    ];
    const ctx = { env: { HOME: home }, home, root, claude: fake.runner };
    // Instalado com --sem-mensagens (ou antes de o plugin existir), só na conta 2.
    await exec('install', { messages: false, accounts: [join(home, '.claude-conta2')] });
    fake.calls = [];
    const hint = { level: 'info', text: 'Dica para a Conta D: rode npm run mod:install para mandar mensagens pelo escritório (plugin habblaud-mensagens)' };
    expect(updateInstalledMods(accounts, { ...ctx, version: '0.2.0' })).toEqual({ installed: true, unavailable: false, lines: [hint] });
    expect(fake.mutating).toEqual([]);

    fake.folderVersion = '0.3.0';
    const res = updateInstalledMods(accounts, { ...ctx, version: '0.3.0' });
    expect(res.lines).toEqual([{ level: 'info', text: 'Mod atualizado para 0.3.0 na Conta D; sessões abertas: /reload-plugins' }, hint]);
    expect(fake.mutating).toEqual(['plugin marketplace update habblaud', `plugin update ${MOD_PLUGIN} --scope user`, `plugin update ${PERMISSIONS_PLUGIN} --scope user`]);
    expect(installed('.claude-conta2')[MESSAGES_PLUGIN]).toBeUndefined();
    expect(modHint(res)).toEqual([]);
  });
});
