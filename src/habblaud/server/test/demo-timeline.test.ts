// Gerador do timelapse fictício (scripts/demo-timeline.ts): importar o módulo não roda nada.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyChanges, frameOf, parseTimeline, type TimelineDelta, type TimelineKeyframe } from '../../shared/timeline';
import { generateDemoTimeline, parseArgs, sessionsAt } from '../../scripts/demo-timeline';
import { setQuiet } from '../log';
import { tempDir } from './fixtures';

setQuiet(true);

describe('demo-timeline', () => {
  let tmp: { dir: string; cleanup: () => void };
  beforeEach(() => {
    tmp = tempDir('habblaud-demotl-');
  });
  afterEach(() => tmp.cleanup());

  it('argumentos', () => {
    const now = new Date(2026, 9, 8, 15).getTime();
    const o = parseArgs([], now);
    expect(o).toMatchObject({ date: '2026-10-07', startMin: 540, hours: 10, sessions: 6, pace: 0.25, seed: 1, force: false });
    expect(parseArgs(['--date', '2026-10-01', '--start', '8:30', '--hours', '2', '--sessions', '3', '--force', '--data-dir', 'x'], now)).toMatchObject({
      date: '2026-10-01',
      startMin: 510,
      hours: 2,
      sessions: 3,
      force: true,
    });
    expect(() => parseArgs(['--date', '2026-02-30'])).toThrow(/AAAA-MM-DD/);
    expect(() => parseArgs(['--start', '25'])).toThrow(/--start/);
    expect(() => parseArgs(['--hours', '0'])).toThrow(/--hours/);
    expect(() => parseArgs(['--xyz'])).toThrow(/opção desconhecida/);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('formato do dia: começa e termina vazio, com pico de manhã e à tarde', () => {
    expect(sessionsAt(0, 6)).toBe(1);
    expect(sessionsAt(1, 6)).toBe(0);
    expect(sessionsAt(0.2, 6)).toBe(6);
    expect(sessionsAt(0.44, 6)).toBeLessThan(sessionsAt(0.68, 6));
    expect(sessionsAt(-1, 6)).toBe(sessionsAt(0, 6));
  });

  it('grava um dia fictício só com agentes marcados como demonstração', () => {
    const opts = { date: '2026-10-07', startMin: 9 * 60, hours: 3, sessions: 4, pace: 0.5, seed: 7, dataDir: tmp.dir, force: false };
    const r = generateDemoTimeline(opts);
    const file = join(tmp.dir, 'timeline', '2026-10-07.jsonl');
    expect(r.files).toEqual([file]);
    expect(r.from).toBe(new Date(2026, 9, 7, 9).getTime());
    const recs = parseTimeline(readFileSync(file, 'utf8'));
    expect(recs[0]).toMatchObject({ t: 'k', at: r.from, boot: true });
    expect(recs.at(-1)).toEqual({ t: 'end', at: r.to });
    expect(recs.filter((x) => x.t === 'k').length).toBeGreaterThanOrEqual(3 * 12); // keyframe a cada 5 min
    // Reconstrói o dia inteiro: houve gente, sub-agentes e todos marcados como demonstração.
    const frame = frameOf(recs[0] as TimelineKeyframe);
    let maxAgents = 0;
    let subs = 0;
    for (const rec of recs.slice(1)) {
      if (rec.t === 'k') {
        const f = frameOf(rec);
        frame.agents = f.agents;
        frame.rooms = f.rooms;
        frame.accounts = f.accounts;
      } else if (rec.t === 'd') applyChanges(frame, rec as TimelineDelta);
      maxAgents = Math.max(maxAgents, frame.agents.size);
      for (const a of frame.agents.values()) {
        expect(a.demo).toBe(true);
        if (a.kind === 'sub') subs++;
      }
      for (const room of frame.rooms.values()) expect(room.demo).toBe(true);
    }
    expect(maxAgents).toBeGreaterThanOrEqual(3);
    expect(subs).toBeGreaterThan(0);
    // Mesma semente, mesmo dia; sem --force não sobrescreve.
    expect(() => generateDemoTimeline(opts)).toThrow(/já existe/);
    const again = generateDemoTimeline({ ...opts, force: true });
    expect(readFileSync(again.files[0], 'utf8')).toBe(readFileSync(file, 'utf8'));
    // Duas gravações de 3 h simuladas, uma linha por vez: no Windows passa dos 5 s padrão.
  }, 30_000);
});
