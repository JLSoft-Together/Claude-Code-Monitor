import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBuildReader, readBuildInfo } from './build';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('createBuildReader', () => {
  it('lê o nome do bundle do index.html e acompanha um build novo', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-build-'));
    dirs.push(root);
    const read = createBuildReader(root);
    expect(read()).toBeUndefined();
    const html = join(root, 'dist', 'client', 'index.html');
    mkdirSync(join(root, 'dist', 'client'), { recursive: true });
    writeFileSync(html, '<script type="module" crossorigin src="/bundle/main-AAA111.js"></script>');
    expect(read()).toBe('main-AAA111');
    writeFileSync(html, '<script type="module" crossorigin src="/bundle/main-BBB222.js"></script>');
    utimesSync(html, new Date(), new Date(Date.now() + 5_000));
    expect(read()).toBe('main-BBB222');
  });
});

describe('readBuildInfo e scripts/build-info.mjs', () => {
  const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'build-info.mjs');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@exemplo.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
  const run = (cwd: string, env: NodeJS.ProcessEnv = {}) => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(readFileSync(join(cwd, 'dist', 'build.json'), 'utf8')) as { commit: string; dirty: boolean; builtAt: string };
  };

  it('sem arquivo ou com ele estragado: commit "unknown"', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-build-'));
    dirs.push(root);
    expect(readBuildInfo(root)).toEqual({ commit: 'unknown', dirty: false });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'build.json'), '{"commit": "rm -rf", "dirty": false}');
    expect(readBuildInfo(root)).toEqual({ commit: 'unknown', dirty: false });
    writeFileSync(join(root, 'dist', 'build.json'), 'lixo');
    expect(readBuildInfo(root)).toEqual({ commit: 'unknown', dirty: false });
  });

  it('commit do git, "dirty" só com arquivo versionado modificado, e o arquivo lido de volta', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-build-'));
    dirs.push(root);
    git(root, 'init', '-q');
    writeFileSync(join(root, 'a.txt'), 'um');
    git(root, 'add', 'a.txt');
    git(root, 'commit', '-q', '-m', 'primeiro');
    const head = git(root, 'rev-parse', 'HEAD');
    const clean = run(root);
    expect(clean).toEqual({ commit: head, dirty: false, builtAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(readBuildInfo(root)).toEqual(clean);
    // Arquivo fora do git (como o dist/ recém-criado, um .env ou um link do node_modules) não conta.
    writeFileSync(join(root, 'solto.txt'), 'x');
    expect(run(root).dirty).toBe(false);
    writeFileSync(join(root, 'a.txt'), 'dois');
    expect(run(root)).toMatchObject({ commit: head, dirty: true });
  });

  it('sem git: "unknown"; HABBLAUD_BUILD_COMMIT/DIRTY substituem o git', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-build-'));
    dirs.push(root);
    // GIT_CEILING_DIRECTORIES: não sobe até um repositório acima da pasta temporária.
    expect(run(root, { GIT_CEILING_DIRECTORIES: dirname(root) })).toMatchObject({ commit: 'unknown', dirty: false });
    const sha = 'a'.repeat(40);
    expect(run(root, { HABBLAUD_BUILD_COMMIT: sha, HABBLAUD_BUILD_DIRTY: '1' })).toMatchObject({ commit: sha, dirty: true });
    expect(run(root, { HABBLAUD_BUILD_COMMIT: 'não-é-sha' })).toMatchObject({ commit: 'unknown', dirty: false });
  });
});
