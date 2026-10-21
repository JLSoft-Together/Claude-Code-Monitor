import { describe, expect, it } from 'vitest';
import { AUDIO_MAX_BYTES, DictationService, HOST_PRESENCE_MS, parseAudio } from './dictation';

const audio = (n = 2_000) => ({ type: 'audio/mp4', data: Buffer.alloc(n, 1).toString('base64') });

describe('ditado', () => {
  it('parseAudio: só áudio, base64 válido, nem curto nem longo demais', () => {
    expect(parseAudio(audio())).toMatchObject({ type: 'audio/mp4' });
    expect(parseAudio({ type: 'audio/webm;codecs=opus', data: audio().data })).toMatchObject({ type: 'audio/webm;codecs=opus' });
    expect(parseAudio({ type: 'video/mp4', data: audio().data })).toHaveProperty('error');
    expect(parseAudio({ type: 'audio/mp4', data: 'xx!' })).toHaveProperty('error');
    expect(parseAudio(audio(10))).toHaveProperty('error');
    expect(parseAudio(audio(AUDIO_MAX_BYTES + 1))).toHaveProperty('error');
  });

  it('modo Node: transcreve aqui e guarda texto e idioma', async () => {
    const s = new DictationService({ transcriber: async () => ({ text: 'olá mundo', lang: 'pt' }), newId: () => 'd1' });
    expect(s.available()).toBe(true);
    expect(s.submit(audio())).toMatchObject({ dictation: { id: 'd1' } });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(s.get('d1')).toEqual({ id: 'd1', status: 'done', text: 'olá mundo', lang: 'pt' });
  });

  it('modo Node: erro do Whisper vira falha legível', async () => {
    const s = new DictationService({ transcriber: async () => { throw new Error('o Whisper falhou (x)'); }, newId: () => 'd2' });
    s.submit(audio());
    await new Promise((ok) => setTimeout(ok, 0));
    expect(s.get('d2')).toMatchObject({ status: 'failed', error: 'o Whisper falhou (x)' });
  });

  it('Docker: só aceita com o auxiliar presente; o áudio sai da memória no poll; o ack traz o texto', () => {
    let now = 1_000;
    const s = new DictationService({ now: () => now, newId: () => 'd3' });
    expect(s.submit(audio())).toMatchObject({ error: 'unavailable' });
    s.poll();
    expect(s.submit(audio())).toMatchObject({ dictation: { id: 'd3', status: 'queued' } });
    const [p] = s.poll();
    expect(p).toMatchObject({ id: 'd3', type: 'audio/mp4' });
    expect(s.poll()).toEqual([]);
    s.ack({ results: [{ id: 'd3', ok: true, text: 'create an agent', lang: 'en' }] });
    expect(s.get('d3')).toMatchObject({ status: 'done', text: 'create an agent', lang: 'en' });
    now += HOST_PRESENCE_MS + 1;
    expect(s.available()).toBe(false);
  });

  it('Docker: auxiliar que some deixa o pedido falhar com motivo', () => {
    let now = 0;
    const s = new DictationService({ now: () => now, newId: () => 'd4' });
    s.poll();
    s.submit(audio());
    now += 31_000;
    expect(s.get('d4')).toMatchObject({ status: 'failed', error: 'o auxiliar do computador não buscou o áudio' });
  });
});
