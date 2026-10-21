// Confere as traduções: lista os textos passados a tr() sem tradução e as traduções que sobraram
// (o texto em PT mudou ou saiu do código). Uso: npm run i18n:check [-- en|es|fr]
// Não falha o build: um texto sem tradução simplesmente aparece em PT.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EN } from '../shared/locales/en';
import { ES } from '../shared/locales/es';
import { FR } from '../shared/locales/fr';

const ROOT = join(import.meta.dirname, '..');
const DIRS = ['client/src', 'shared', 'server', 'scripts'];
const DICTS: Record<string, Readonly<Record<string, string>>> = { en: EN, es: ES, fr: FR };

/** Primeiro argumento literal de cada tr('...') do código (sem os testes). */
export function collectKeys(root = ROOT): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  const re = /\btr\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'node_modules' && name !== 'dist' && name !== 'locales') walk(p);
      } else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && name !== 'i18n-check.ts') {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(re)) {
          const key = unescapeJs(m[2]);
          const line = src.slice(0, m.index).split('\n').length;
          keys.set(key, [...(keys.get(key) ?? []), `${relative(root, p)}:${line}`]);
        }
      }
    }
  };
  for (const d of DIRS) walk(join(root, d));
  return keys;
}

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

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('i18n-check.ts')) {
  const only = process.argv[2];
  const keys = collectKeys();
  for (const [lang, dict] of Object.entries(DICTS)) {
    if (only && only !== lang) continue;
    const missing = [...keys.keys()].filter((k) => !(k in dict));
    const stale = Object.keys(dict).filter((k) => !keys.has(k));
    console.log(`${lang}: ${keys.size - missing.length}/${keys.size} textos traduzidos`);
    for (const k of missing) console.log(`  sem tradução: ${JSON.stringify(k)}  (${keys.get(k)![0]})`);
    for (const k of stale) console.log(`  sobrando:     ${JSON.stringify(k)}`);
  }
}
