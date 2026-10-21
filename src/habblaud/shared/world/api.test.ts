import { describe, expect, it } from 'vitest';
import { WORLD_KNOWN_ERROR_CODES, WORLD_LOCAL_ERROR_CODES, isWorldKnownErrorCode, worldLastError } from './api';
import { WORLD_ERROR_CODES } from './protocol';

describe('códigos de erro do World', () => {
  it('os do servidor do mundo incluem os que o servidor privado manda além do contrato', () => {
    for (const code of ['no_player', 'unavailable', 'invalid_json', 'too_large', 'unsupported_media_type', 'method_not_allowed', 'name_cooldown', 'device_limit', 'internal']) {
      expect(WORLD_ERROR_CODES as readonly string[], code).toContain(code);
    }
  });

  it('a lista conhecida junta as duas, sem repetir', () => {
    expect(new Set(WORLD_KNOWN_ERROR_CODES).size).toBe(WORLD_KNOWN_ERROR_CODES.length);
    for (const c of [...WORLD_ERROR_CODES, ...WORLD_LOCAL_ERROR_CODES]) expect(isWorldKnownErrorCode(c), c).toBe(true);
    expect(isWorldKnownErrorCode('algo_novo')).toBe(false);
    expect(isWorldKnownErrorCode(undefined)).toBe(false);
  });

  it('lastError: rede vira network; resposta torta, erro sem código e código novo viram unknown', () => {
    expect(worldLastError('world_unreachable')).toBe('network');
    expect(worldLastError('world_timeout')).toBe('network');
    expect(worldLastError('world_bad_response')).toBe('unknown');
    expect(worldLastError('world_error')).toBe('unknown');
    expect(worldLastError('algo_novo')).toBe('unknown');
    for (const c of ['session_expired', 'storage_failed', 'terminal_off', 'rate_limited', 'unavailable', 'banned', 'internal']) expect(worldLastError(c)).toBe(c);
  });
});
