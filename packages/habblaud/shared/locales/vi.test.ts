import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from './en';
import { VI } from './vi';

const ROOT = join(import.meta.dirname, '..', '..');
// What the Orrery office renders: the copied world/art/audio/timeline client code and the shared texts it reaches
// (activity descriptions, traits, default agent names).
const SCOPE = [
  'client/src/world',
  'client/src/art',
  'client/src/audio',
  'client/src/net/timeline.ts',
  'shared/activity.ts',
  'shared/world/traits.ts',
  'shared/world/office-from-world.ts',
];

// Same regex as upstream scripts/i18n-check.ts.
const RE = /\btr\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function unescapeJs(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e === 'n') return '\n';
    if (e === 't') return '\t';
    if (e.startsWith('u{')) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return e;
  });
}

function collect(): Map<string, string> {
  const keys = new Map<string, string>();
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const n of readdirSync(p)) if (n !== 'node_modules' && n !== 'locales') walk(join(p, n));
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
      for (const m of readFileSync(p, 'utf8').matchAll(RE)) keys.set(unescapeJs(m[2]), p.slice(ROOT.length + 1));
    }
  };
  for (const s of SCOPE) walk(join(ROOT, s));
  return keys;
}

const holes = (s: string) => [...s.matchAll(/\{[^}]*\}/g)].map((m) => m[0]).sort();

describe('vi dictionary', () => {
  const keys = collect();

  it('scans a plausible number of office strings', () => {
    expect(keys.size).toBeGreaterThan(400);
  });

  it('vi covers every office string', () => {
    const missing = [...keys].filter(([k]) => !(k in VI)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it('every scanned key is also in EN', () => {
    const missing = [...keys.keys()].filter((k) => !(k in EN));
    expect(missing).toEqual([]);
  });

  it('keeps the {0}/{name} placeholders of the source text', () => {
    const bad = Object.entries(VI)
      .filter(([k, v]) => holes(k).join() !== holes(v).join())
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('has no empty or untranslated-looking entries and no stale keys', () => {
    expect(Object.values(VI).filter((v) => !v.trim())).toEqual([]);
    expect(Object.keys(VI).filter((k) => !keys.has(k))).toEqual([]);
  });
});
