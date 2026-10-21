// Modo demonstração: eventos do GitHub fictícios (PR, merge, CI, release) com festa e alarme nas salas.
import { describe, expect, it } from 'vitest';
import { GITHUB_TOOL, PARTY_MS } from '../github';
import { mulberry32 } from '../hash';
import { demoGitHubEvent } from './github';
import { DemoSimulator } from './simulator';

describe('demo: eventos do GitHub', () => {
  it('sala com alarme tende a ver o CI voltar a passar', () => {
    const rng = mulberry32(42);
    const kinds = Array.from({ length: 200 }, () => demoGitHubEvent(rng, { branch: 'main', alarm: true, pr: 10 }).kind);
    expect(kinds.filter((k) => k === 'ci_passed').length).toBeGreaterThan(120);
    const free = Array.from({ length: 400 }, () => demoGitHubEvent(rng, { alarm: false, pr: 10 }).kind);
    for (const k of ['pr_opened', 'pr_merged', 'ci_failed', 'ci_passed', 'release']) expect(free).toContain(k);
  });

  it('de tempos em tempos: avisos, atividades e festa/alarme nas salas (o alarme acaba)', () => {
    const sim = new DemoSimulator({ seed: 5, speed: 4, sessions: 5 }, 0);
    const seen = { party: 0, alarm: 0, recovered: 0, notices: 0, feed: 0 };
    let first = Infinity;
    for (let t = 0; t < 1_800_000 / 4; t += 250) {
      const r = sim.tick(t);
      seen.notices += r.notices.filter((n) => /^(🎉|🚨|✅ CI)/.test(n.text)).length;
      seen.feed += r.feed.filter((f) => f.activity.tool === GITHUB_TOOL).length;
      if (!r.changed) continue;
      for (const room of sim.snapshot(t).rooms) {
        const fx = room.effect;
        if (!fx) continue;
        first = Math.min(first, t);
        expect(fx.until).toBeGreaterThan(t);
        if (fx.kind === 'party') {
          seen.party++;
          expect(fx.until - fx.at).toBe(PARTY_MS);
          if (fx.text === 'CI verde de novo!') seen.recovered++;
        } else seen.alarm++;
      }
    }
    expect(first).toBeLessThan(25_000);
    expect(seen.party).toBeGreaterThan(0);
    expect(seen.alarm).toBeGreaterThan(0);
    expect(seen.recovered).toBeGreaterThan(0);
    expect(seen.notices).toBeGreaterThan(5);
    expect(seen.feed).toBe(seen.notices);
  });
});
