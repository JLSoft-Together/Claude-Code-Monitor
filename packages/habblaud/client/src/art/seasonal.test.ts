import { describe, expect, it } from 'vitest';
import { appearanceFromSeed } from './character/appearance';
import { POSE_FRAMES, renderCharacter } from './character/render';
import type { Dir, Pose } from './api';
import { renderSeasonalProp } from './seasonal';

describe('acessórios sazonais', () => {
  it('mantém a aparência original e desenha os acessórios em todas as poses e direções', () => {
    const appearance = appearanceFromSeed(42);
    const original = { ...appearance };
    for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) {
      for (const pose of Object.keys(POSE_FRAMES) as Pose[]) {
        for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
          const req = { appearance, dir, pose, frame };
          const plain = renderCharacter(req);
          for (const costume of ['santa', 'witch', 'pumpkin', 'vampire'] as const) {
            const dressed = renderCharacter({ ...req, costume });
            expect(dressed.buf.data.some((byte, i) => byte !== plain.buf.data[i])).toBe(true);
            expect([dressed.ax, dressed.ay]).toEqual([plain.ax, plain.ay]);
          }
        }
      }
    }
    expect(appearance).toEqual(original);
  });
  it('mantém decorações dentro das folhas de desenho, com margem transparente', () => {
    for (const kind of ['tree', 'gift', 'pumpkin', 'ghost', 'wreath', 'bat'] as const) {
      const { buf } = renderSeasonalProp(kind);
      const bounds = buf.bounds()!;
      expect(buf.countOpaque()).toBeGreaterThan(40);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.y).toBeGreaterThan(0);
      expect(bounds.x + bounds.w).toBeLessThan(buf.w);
      expect(bounds.y + bounds.h).toBeLessThan(buf.h);
    }
  });
});
