import { afterEach, describe, expect, it } from 'vitest';
import { THEME_COUNT, parseRoomThemes, roomTheme, setRoomThemes } from './theme';

const ROOM = { carpet: '#c9d1dc', carpet2: '#bdc6d3', wall: { base: '#eef1f4', trim: '#9fb0c4', pattern: 'plain' }, accent: '#3f7fd8', deskVariant: 'white', chairVariant: 'blue' };
const ROOM2 = { ...ROOM, carpet: '#111111', accent: '#222222', wall: { base: '#f0f0f0' } };

describe('local patch E: room palettes from a theme pack', () => {
  afterEach(() => {
    setRoomThemes(null);
  });

  it('uses the classic list by default', () => {
    expect(roomTheme(0).carpet).toBe('#c9d1dc');
    expect(roomTheme(THEME_COUNT)).toEqual(roomTheme(0));
  });

  it('cycles through the pack rooms once set, and back to classic on null', () => {
    const classic1 = roomTheme(1);
    expect(setRoomThemes([ROOM, ROOM2])).toBe(true);
    expect(roomTheme(1).carpet).toBe('#111111');
    expect(roomTheme(2).carpet).toBe('#c9d1dc');
    expect(roomTheme(-1).carpet).toBe('#111111');
    expect(roomTheme(1).wall).toEqual({ base: '#f0f0f0' });
    setRoomThemes(null);
    expect(roomTheme(1)).toEqual(classic1);
  });

  it('returns copies, so callers cannot change the active list', () => {
    setRoomThemes([ROOM]);
    roomTheme(0).wall.base = '#000000';
    expect(roomTheme(0).wall.base).toBe('#eef1f4');
  });

  it('rejects an invalid list as a whole and keeps the classic rooms', () => {
    const bad = [
      [],
      'rooms',
      [{ ...ROOM, carpet: 'red' }],
      [{ ...ROOM, wall: { base: '#fff' } }],
      [{ ...ROOM, wall: { ...ROOM.wall, pattern: 'zigzag' } }],
      [{ ...ROOM, deskVariant: 'glass' }],
      [{ ...ROOM, chairVariant: 'pink' }],
      [ROOM, { ...ROOM, accent: undefined }],
      Array.from({ length: 33 }, () => ROOM),
    ];
    for (const b of bad) {
      expect(parseRoomThemes(b)).toBeNull();
      expect(setRoomThemes(b)).toBe(false);
      expect(roomTheme(0).carpet).toBe('#c9d1dc');
    }
  });

  it('drops unknown fields', () => {
    expect(parseRoomThemes([{ ...ROOM, extra: 1, wall: { ...ROOM.wall, exterior: true } }])).toEqual([ROOM]);
  });
});
