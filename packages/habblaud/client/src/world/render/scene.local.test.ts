// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { appearanceFromSeed, characterSprite, spriteBounds } from '../../art';
import { opaqueBounds } from './scene';

describe('local patch J: sprite bounds without pixel read-back', () => {
  it('registers the opaque box of a character sprite from its pixel buffer', () => {
    const s = characterSprite({ appearance: appearanceFromSeed(7), dir: 'down', pose: 'stand', frame: 0 });
    const box = spriteBounds.get(s.canvas as HTMLCanvasElement);
    expect(box).toBeDefined();
    expect(box!.w).toBeGreaterThan(0);
    expect(box!.h).toBeGreaterThan(0);
    expect(box!.x + box!.w).toBeLessThanOrEqual(s.canvas.width);
    expect(box!.y + box!.h).toBeLessThanOrEqual(s.canvas.height);
  });

  it('answers opaqueBounds from the registry, never from getImageData', () => {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 34;
    const getContext = vi.spyOn(c, 'getContext');
    spriteBounds.set(c, { x: 3, y: 2, w: 18, h: 30 });
    expect(opaqueBounds(c)).toEqual({ x: 3, y: 2, w: 18, h: 30 });
    expect(getContext).not.toHaveBeenCalled();
  });
});
