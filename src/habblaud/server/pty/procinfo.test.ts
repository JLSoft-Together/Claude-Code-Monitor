import { describe, expect, it } from 'vitest';
import { looksLikeClaude, parsePs, parseWindows, sameProcess } from './procinfo';

const STARTED = 1_791_557_339_236;

describe('procinfo', () => {
  it('lê o FILETIME e o nome do PowerShell', () => {
    const info = parseWindows('134360309381229341\r\nclaude\r\n');
    expect(info).toEqual({ startMs: 1_791_557_338_122, name: 'claude', fileTime: '134360309381229341' });
    expect(parseWindows('erro')).toBeUndefined();
  });

  it('lê o lstart e o comando do ps', () => {
    const info = parsePs('Mon Oct 12 22:46:14 2026     /usr/local/bin/node\n');
    expect(info?.name).toBe('node');
    expect(info?.startMs).toBe(new Date(2026, 9, 12, 22, 46, 14).getTime());
    expect(parsePs('')).toBeUndefined();
  });

  it('reconhece o executável do Claude Code', () => {
    for (const n of ['claude', 'claude.exe', 'node', 'node.exe', 'bun', '2.1.295', '/home/u/.local/share/claude/versions/2.1.295']) expect(looksLikeClaude(n)).toBe(true);
    for (const n of ['chrome', 'bash', 'claude-helper', 'python3']) expect(looksLikeClaude(n)).toBe(false);
  });

  it('mesmo processo: início perto do registro e executável certo', () => {
    expect(sameProcess({ startedAt: STARTED }, { startMs: STARTED - 1_200, name: 'claude' })).toBe(true);
    expect(sameProcess({ startedAt: STARTED }, { startMs: STARTED - 10 * 60_000, name: 'claude' })).toBe(false);
    expect(sameProcess({ startedAt: STARTED }, { startMs: STARTED + 60_000, name: 'claude' })).toBe(false);
    expect(sameProcess({ startedAt: STARTED }, { startMs: STARTED, name: 'explorer' })).toBe(false);
    expect(sameProcess({}, { startMs: STARTED, name: 'claude' })).toBe(false);
  });

  it('com FILETIME dos dois lados, vale só o exato', () => {
    const reg = { startedAt: STARTED, procStart: '134360309381229341' };
    expect(sameProcess(reg, { startMs: STARTED - 1_114, name: 'claude', fileTime: '134360309381229341' })).toBe(true);
    expect(sameProcess(reg, { startMs: STARTED - 1_114, name: 'claude', fileTime: '134360309381229999' })).toBe(false);
  });
});
