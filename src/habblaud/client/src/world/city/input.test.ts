// Teclado da cidade: setas e WASD (maiúsculas com Shift e pelo código da tecla), diagonais e corrida.
import { describe, expect, it } from 'vitest';
import { intentFrom, moveKeyOf } from './input';

describe('teclas de andar', () => {
  it('soma as direções e corre com Shift', () => {
    expect(intentFrom(new Set(['w']), false)).toEqual({ dx: 0, dy: -1, run: false });
    expect(intentFrom(new Set(['ArrowRight', 's']), true)).toEqual({ dx: 1, dy: 1, run: true });
    expect(intentFrom(new Set(['a', 'd']), false)).toEqual({ dx: 0, dy: 0, run: false });
    expect(intentFrom(new Set(['x']), false)).toEqual({ dx: 0, dy: 0, run: false });
  });

  it('WASD com Shift (maiúscula) e em outros layouts (pelo código da tecla)', () => {
    expect(moveKeyOf({ key: 'W' })).toBe('w');
    expect(moveKeyOf({ key: 'ArrowLeft' })).toBe('ArrowLeft');
    expect(moveKeyOf({ key: 'z', code: 'KeyW' })).toBe('w');
    expect(moveKeyOf({ key: 'e', code: 'KeyE' })).toBeNull();
  });
});
