import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, intlLocale, normalizeLocale, registerDictionary, setLocale, tr } from './i18n';

describe('local patch: vi locale', () => {
  afterEach(() => setLocale('pt-BR'));

  it('normalizes vi and vi-VN to vi', () => {
    expect(normalizeLocale('vi')).toBe('vi');
    expect(normalizeLocale('vi-VN')).toBe('vi');
    expect(normalizeLocale('VI_vn')).toBe('vi');
  });

  it('setLocale switches the locale used by getLocale and tr', () => {
    setLocale('vi');
    registerDictionary('vi', { 'Lendo arquivo': 'Đang đọc tệp' });
    expect(getLocale()).toBe('vi');
    expect(tr('Lendo arquivo')).toBe('Đang đọc tệp');
    expect(tr('texto sem tradução')).toBe('texto sem tradução');
    expect(intlLocale()).toBe('vi-VN');
  });
});
