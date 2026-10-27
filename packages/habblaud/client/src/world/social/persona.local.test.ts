import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_WEIGHTS } from '../sim/behavior';
import { personaFor, setPersonaOverride, soloWeights, type Persona } from './persona';

afterEach(() => setPersonaOverride(null));

describe('local patch H: persona override', () => {
  it('without an override personaFor and soloWeights are upstream', () => {
    const p = personaFor(1234);
    expect(p.soloK).toBeUndefined();
    expect(personaFor(1234)).toBe(p);
    const w = soloWeights({ ...p, traits: [] });
    expect(w).toEqual({ ...IDLE_WEIGHTS });
  });

  it('an override replaces the persona for the seeds it answers, cached until the override changes', () => {
    const base = personaFor(77);
    const fn = vi.fn((seed: number, b: Persona): Persona | null => (seed === 77 ? { ...b, traits: ['cafeina'], soloK: { bathroom: 3, coffee: 2.5 } } : null));
    setPersonaOverride(fn);
    const p = personaFor(77);
    expect(p.traits).toEqual(['cafeina']);
    expect(personaFor(77)).toBe(p);
    expect(personaFor(78)).toBe(personaFor(78));
    expect(fn).toHaveBeenCalledTimes(2);
    setPersonaOverride(null);
    expect(personaFor(77)).toBe(base);
  });

  it('undefined means "not known yet": the base persona, asked again next time', () => {
    let known = false;
    setPersonaOverride((_s, b) => (known ? { ...b, soloK: { coffee: 2 } } : undefined));
    expect(personaFor(5).soloK).toBeUndefined();
    known = true;
    expect(personaFor(5).soloK).toEqual({ coffee: 2 });
  });

  it('soloK multiplies on top of the trait weights', () => {
    const p: Persona = { traits: ['cafeina'], sociability: 0.5, skill: 0.5, catchphrase: 'x', soloK: { bathroom: 3, coffee: 2.5 } };
    const w = soloWeights(p);
    expect(w.bathroom).toBeCloseTo(IDLE_WEIGHTS.bathroom * 3);
    expect(w.coffee).toBeCloseTo(IDLE_WEIGHTS.coffee * 3 * 2.5);
    expect(w.window).toBe(IDLE_WEIGHTS.window);
  });
});
