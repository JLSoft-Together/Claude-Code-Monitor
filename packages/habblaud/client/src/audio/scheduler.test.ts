// Agendador dos sons (puro): preferência geral, categorias, volume, aba oculta e limites de frequência.
import { describe, expect, it } from 'vitest';
import { CATEGORY_OF, DEFAULT_SOUND_SETTINGS, masterGain, MAX_PER_SECOND, MIN_GAP_MS, sanitizeSoundSettings, SoundScheduler, type SoundKind } from './scheduler';

const on = (patch: Partial<typeof DEFAULT_SOUND_SETTINGS> = {}) => {
  const s = new SoundScheduler();
  s.configure(true, { ...DEFAULT_SOUND_SETTINGS, ...patch });
  return s;
};

describe('agendador de sons', () => {
  it('desligado por padrão: nada toca até ligar', () => {
    const s = new SoundScheduler();
    expect(s.decide('chime', 0)).toBeNull();
    s.configure(true, DEFAULT_SOUND_SETTINGS);
    expect(s.decide('chime', 0)).not.toBeNull();
    s.configure(false, DEFAULT_SOUND_SETTINGS);
    expect(s.decide('chime', 10_000)).toBeNull();
  });

  it('respeita as categorias desligadas', () => {
    const s = on({ keys: false, social: false });
    expect(s.decide('keys', 0)).toBeNull();
    expect(s.decide('pingpong', 0)).toBeNull();
    expect(s.decide('table', 0)).toBeNull();
    expect(s.decide('arcade', 0)).toBeNull();
    expect(s.decide('elevator', 0)).not.toBeNull();
    expect(s.decide('chime', 0)).not.toBeNull();
    expect(s.allowed('keys')).toBe(false);
    expect(on({ alerts: false }).decide('pop', 0)).toBeNull();
    // toda categoria existe nas preferências
    for (const k of Object.keys(CATEGORY_OF) as SoundKind[]) expect(DEFAULT_SOUND_SETTINGS[CATEGORY_OF[k]]).toBe(true);
  });

  it('volume mestre: curva perceptual, zero emudece, proximidade atenua', () => {
    expect(masterGain(0)).toBe(0);
    expect(masterGain(1)).toBe(1);
    expect(masterGain(0.5)).toBeCloseTo(0.25);
    expect(masterGain(2)).toBe(1);
    expect(on({ volume: 0 }).decide('chime', 0)).toBeNull();
    expect(on({ volume: 1 }).decide('elevator', 0)).toBe(1);
    expect(on({ volume: 0.5 }).decide('elevator', 0)).toBeCloseTo(0.25);
    expect(on({ volume: 1 }).decide('elevator', 0, { gain: 0.5 })).toBeCloseTo(0.5);
    expect(on({ volume: 1 }).decide('keys', 0, { gain: 7 })).toBe(1);
    expect(on({ volume: 1 }).decide('keys', 0, { gain: 0 })).toBeNull();
  });

  it('limite de frequência por canal (sino e estalo dividem o mesmo)', () => {
    const s = on();
    expect(s.decide('keys', 1_000)).not.toBeNull();
    expect(s.decide('keys', 1_000 + MIN_GAP_MS.keys - 1)).toBeNull();
    expect(s.decide('keys', 1_000 + MIN_GAP_MS.keys)).not.toBeNull();
    expect(s.decide('chime', 5_000)).not.toBeNull();
    expect(s.decide('pop', 5_500)).toBeNull();
    expect(s.decide('pop', 5_000 + MIN_GAP_MS.chime)).not.toBeNull();
    // raquetada e quique dividem o canal do pingue-pongue
    expect(s.decide('pingpong', 9_000)).not.toBeNull();
    expect(s.decide('table', 9_050)).toBeNull();
    expect(s.decide('elevator', 9_050)).not.toBeNull();
  });

  it('teto global de sons por segundo (o sino de alerta sempre passa)', () => {
    const s = on();
    const kinds: SoundKind[] = ['keys', 'elevator', 'pingpong', 'arcade'];
    let played = 0;
    for (let t = 0; t < 1_000; t += 10) for (const k of kinds) if (s.decide(k, t) !== null) played++;
    expect(played).toBeLessThanOrEqual(MAX_PER_SECOND);
    expect(s.decide('chime', 999)).not.toBeNull();
    // passada a janela de 1 s, volta a tocar
    expect(s.decide('elevator', 2_600)).not.toBeNull();
  });

  it('com a aba oculta, só o sino de "precisa de você"', () => {
    const s = on();
    expect(s.decide('pop', 0, { hidden: true })).toBeNull();
    expect(s.decide('keys', 0, { hidden: true })).toBeNull();
    expect(s.decide('elevator', 0, { hidden: true })).toBeNull();
    expect(s.decide('chime', 0, { hidden: true })).not.toBeNull();
  });

  it('um som recusado não consome o intervalo', () => {
    const s = on();
    expect(s.decide('pop', 0, { hidden: true })).toBeNull();
    expect(s.decide('pop', 10)).not.toBeNull();
  });

  it('valida as preferências de som', () => {
    expect(sanitizeSoundSettings(undefined)).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(sanitizeSoundSettings({ volume: 0.3, keys: false })).toEqual({ ...DEFAULT_SOUND_SETTINGS, volume: 0.3, keys: false });
    expect(sanitizeSoundSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_SOUND_SETTINGS.volume);
    expect(sanitizeSoundSettings({ volume: 9 }).volume).toBe(1);
  });
});
