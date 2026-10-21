import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot, UpdateStatus } from '../../../shared/types';
import { safeGithubUrl, updateStatusLine, versionChipTitle, versionInfo } from './version';

const NOW = Date.parse('2026-10-08T15:00:00Z');
const HOUR = 3_600_000;

function snap(version: string, updates?: UpdateStatus): OfficeSnapshot {
  return { rev: 1, serverTime: NOW, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: 0, version, updates } };
}

const ok = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({ state: 'ok', repo: 'marmottajr/habblaud', checkedAt: NOW - 2 * HOUR, available: false, ...patch });

describe('versionInfo', () => {
  it('só versões de verdade (o ?mock=1 manda "demo" e o timelapse "timelapse")', () => {
    expect(versionInfo(snap('0.2.0'))).toEqual({ version: '0.2.0', updates: undefined });
    expect(versionInfo(snap('demo'))).toBeNull();
    expect(versionInfo(snap('timelapse'))).toBeNull();
    expect(versionInfo(null)).toBeNull();
  });
});

describe('safeGithubUrl', () => {
  it('aceita só páginas do GitHub', () => {
    expect(safeGithubUrl('https://github.com/marmottajr/habblaud/releases/tag/v0.3.0')).toBe('https://github.com/marmottajr/habblaud/releases/tag/v0.3.0');
    expect(safeGithubUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeGithubUrl('https://github.com.evil.io/x')).toBeUndefined();
    expect(safeGithubUrl('http://github.com/x')).toBeUndefined();
    expect(safeGithubUrl(undefined)).toBeUndefined();
  });
});

describe('updateStatusLine', () => {
  it('na mais recente, com a hora da verificação', () => {
    expect(updateStatusLine('0.2.0', ok({ latest: '0.2.0' }), NOW)).toEqual({ tone: 'ok', text: 'Você está na versão mais recente · verificado há 2 h.' });
  });

  it('versão nova, com a data de publicação', () => {
    const line = updateStatusLine('0.2.0', ok({ latest: '0.3.0', available: true, publishedAt: NOW - HOUR }), NOW);
    expect(line.tone).toBe('new');
    expect(line.text).toMatch(/^Nova versão disponível: v0\.3\.0, publicada em /);
  });

  it('nenhuma release, à frente da última, verificando, desligado e falha', () => {
    expect(updateStatusLine('0.2.0', ok(), NOW).text).toBe('Nenhuma versão publicada no GitHub ainda · verificado há 2 h.');
    expect(updateStatusLine('0.3.0-dev', ok({ latest: '0.2.0' }), NOW).text).toMatch(/à frente da última versão publicada \(v0\.2\.0\)/);
    expect(updateStatusLine('0.2.0', { state: 'pending', available: false }, NOW)).toEqual({ tone: 'pending', text: 'Verificando se há versão nova…' });
    expect(updateStatusLine('0.2.0', { state: 'off', repo: 'a/b', available: false }, NOW).text).toMatch(/HABBLAUD_UPDATE_CHECK=0/);
    expect(updateStatusLine('0.2.0', { state: 'off', available: false }, NOW).text).toMatch(/package\.json/);
    expect(updateStatusLine('0.2.0', ok({ state: 'error', error: 'sem conexão com o GitHub' }), NOW)).toEqual({
      tone: 'warn',
      text: 'Não deu para verificar agora: sem conexão com o GitHub · última verificação há 2 h.',
    });
    expect(updateStatusLine('0.2.0', undefined, NOW).tone).toBe('off');
  });

  it('a falha não esconde uma versão nova já conhecida', () => {
    const line = updateStatusLine('0.2.0', ok({ state: 'error', error: 'o GitHub respondeu 502', latest: '0.3.0', available: true }), NOW);
    expect(line).toEqual({ tone: 'new', text: 'Nova versão disponível: v0.3.0. A última verificação falhou (o GitHub respondeu 502).' });
  });
});

describe('versionChipTitle', () => {
  it('diz as duas versões quando há novidade', () => {
    expect(versionChipTitle('0.2.0', ok({ latest: '0.3.0', available: true }), NOW)).toBe(
      'Nova versão do Habblaud: v0.3.0 (você usa a v0.2.0). Clique para ver as novidades e como atualizar.',
    );
    expect(versionChipTitle('0.2.0', ok({ latest: '0.2.0' }), NOW)).toBe('Habblaud v0.2.0. Você está na versão mais recente · verificado há 2 h. Clique para ver detalhes.');
  });
});
