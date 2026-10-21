import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { parseWorldSession, WorldSettingsStore } from './settings';

setQuiet(true);

const TOKEN = 'T0k3n_secreto-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SESSION = { deviceId: 'dev_1', token: TOKEN, email: 'ana@exemplo.com', access: 'waiting' as const };

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  setQuiet(true);
});

function store(now = () => 1_000) {
  const tmp = tempDir();
  cleanups.push(tmp.cleanup);
  const file = join(tmp.dir, 'data', 'world.json');
  return { file, dir: join(tmp.dir, 'data'), store: new WorldSettingsStore(file, now) };
}

describe('WorldSettingsStore', () => {
  it('grava com modo 600 (sem temporário sobrando) e relê igual', () => {
    const { file, dir, store: s } = store();
    expect(s.load()).toBeUndefined();
    expect(s.save(SESSION)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['world.json']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...SESSION, updatedAt: 1_000 });
    expect(new WorldSettingsStore(file).load()).toEqual({ ...SESSION, updatedAt: 1_000 });
  });

  it('fecha a permissão de um arquivo aberto demais ao ler', () => {
    const { file, store: s } = store();
    s.save(SESSION);
    chmodSync(file, 0o644);
    expect(new WorldSettingsStore(file).load()?.token).toBe(TOKEN);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('o 600 vale também por cima de um temporário velho com outra permissão', () => {
    const { file, dir, store: s } = store();
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${file}.${process.pid}.tmp`, 'velho', { mode: 0o644 });
    s.save(SESSION);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('update muda só acesso e personagem; clear apaga o arquivo', () => {
    let now = 1_000;
    const { file, store: s } = store(() => now);
    expect(s.update({ access: 'approved' })).toBe(false); // sem sessão, nada
    s.save(SESSION);
    now = 2_000;
    s.update({ access: 'approved' });
    expect(s.get()).toEqual({ ...SESSION, access: 'approved', updatedAt: 2_000 });
    s.clear();
    expect(s.get()).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  it('tema: fica no world.json com ou sem sessão e sobrevive a sair; só o tema não é arquivo estragado', () => {
    const { file, store: s } = store();
    expect(s.getTheme()).toBe('auto');
    s.setTheme('halloween');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'halloween' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    s.save(SESSION);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...SESSION, updatedAt: 1_000, theme: 'halloween' });
    s.clear();
    expect(s.get()).toBeUndefined();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'halloween' });
    setQuiet(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const again = new WorldSettingsStore(file);
    expect(again.load()).toBeUndefined();
    expect(again.getTheme()).toBe('halloween');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    // De volta ao automático e sem sessão: o arquivo some.
    again.setTheme('auto');
    expect(existsSync(file)).toBe(false);
  });

  it('conta excluída (erase): o world.json some inteiro, tema junto; de novo, nada quebra', () => {
    const { file, store: s } = store();
    s.save(SESSION);
    s.setTheme('christmas');
    expect(s.erase()).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(s.get()).toBeUndefined();
    expect(s.getTheme()).toBe('auto');
    expect(s.erase()).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('pausa: fica na sessão e sai com undefined', () => {
    const { file, store: s } = store();
    s.save(SESSION);
    s.update({ paused: true });
    expect(new WorldSettingsStore(file).load()?.paused).toBe(true);
    s.update({ paused: undefined });
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('paused');
    expect(new WorldSettingsStore(file).load()?.paused).toBeUndefined();
  });

  it('arquivo estragado ou fora do formato: ignorado, e o log nunca mostra o conteúdo', () => {
    const { file, dir, store: s } = store();
    mkdirSync(dir, { recursive: true });
    setQuiet(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(file, `{"token": "${TOKEN}", lixo`, { mode: 0o600 });
    expect(s.load()).toBeUndefined();
    writeFileSync(file, JSON.stringify({ ...SESSION, access: 'banido' }), { mode: 0o600 });
    expect(s.load()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    warn.mockRestore();
  });

  it('disco que recusa: a sessão vale na memória e o aviso não leva o token', () => {
    const { dir, store: _ } = store();
    mkdirSync(dir, { recursive: true });
    // Um arquivo no lugar da pasta: o mkdir/rename falham.
    const blocker = join(dir, 'bloqueio');
    writeFileSync(blocker, '');
    const s = new WorldSettingsStore(join(blocker, 'world.json'));
    setQuiet(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(s.save(SESSION)).toBe(false);
    expect(s.get()?.token).toBe(TOKEN);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    warn.mockRestore();
  });
});

describe('parseWorldSession', () => {
  it('confere cada campo', () => {
    expect(parseWorldSession({ ...SESSION, updatedAt: 5 })).toEqual({ ...SESSION, updatedAt: 5 });
    expect(parseWorldSession({ ...SESSION, token: 'curto' })).toBeUndefined();
    expect(parseWorldSession({ ...SESSION, deviceId: '../x' })).toBeUndefined();
    expect(parseWorldSession({ ...SESSION, email: 'sem-arroba' })).toBeUndefined();
    expect(parseWorldSession({ ...SESSION, access: 'banned' })).toBeUndefined();
    expect(parseWorldSession([SESSION])).toBeUndefined();
    expect(parseWorldSession({ ...SESSION, player: 'x' })).toEqual({ ...SESSION, updatedAt: 0 });
  });
});
