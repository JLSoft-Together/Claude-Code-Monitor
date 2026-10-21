// scripts/release.ts (funções puras) e a regra de que cada versão tem a sua seção no CHANGELOG.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changelogSection, parseReleaseArgs, unwrapMarkdown } from '../../scripts/release';

const ROOT = join(import.meta.dirname, '..', '..');

const SAMPLE = `# Novidades

## [Não lançado]

## [0.3.0] - 2026-11-01

### Adicionado

- Coisa nova.

## [0.2.0] - 2026-10-08

- Primeira.

## [0.1.0]

[Não lançado]: https://github.com/a/b/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/a/b/releases/tag/v0.3.0
`;

describe('changelogSection', () => {
  it('pega só o texto da versão pedida', () => {
    expect(changelogSection(SAMPLE, '0.3.0')).toBe('### Adicionado\n\n- Coisa nova.');
    expect(changelogSection(SAMPLE, '0.2.0')).toBe('- Primeira.');
  });

  it('sem seção ou com seção vazia: undefined', () => {
    expect(changelogSection(SAMPLE, '0.4.0')).toBeUndefined();
    expect(changelogSection(SAMPLE, '0.1.0')).toBeUndefined();
    // "0.2.0" não casa com "0.2.01", e o ponto não vira curinga.
    expect(changelogSection('## [0.2.01]\n\n- não', '0.2.0')).toBeUndefined();
    expect(changelogSection('## [0x2y0]\n\n- não', '0.2.0')).toBeUndefined();
  });
});

describe('unwrapMarkdown', () => {
  it('junta as linhas de um mesmo item ou parágrafo', () => {
    const md = ['Primeira versão', 'publicada.', '', '### Adicionado', '', '- **A:** uma frase', '  que continua.', '- B', '  1. sub', '     continua'].join('\n');
    expect(unwrapMarkdown(md)).toBe(['Primeira versão publicada.', '', '### Adicionado', '', '- **A:** uma frase que continua.', '- B', '  1. sub continua'].join('\n'));
  });

  it('não mexe em títulos, tabelas, citações e blocos de código', () => {
    const md = ['## Título', 'texto', '| a | b |', '| - | - |', '> citação', '```bash', 'git pull', 'npm install', '```', 'fim'].join('\n');
    expect(unwrapMarkdown(md)).toBe(['## Título', 'texto', '| a | b |', '| - | - |', '> citação', '```bash', 'git pull', 'npm install', '```', 'fim'].join('\n'));
  });
});

describe('parseReleaseArgs', () => {
  it('lê as opções', () => {
    expect(parseReleaseArgs([])).toEqual({ dryRun: false, help: false });
    expect(parseReleaseArgs(['--dry-run'])).toEqual({ dryRun: true, help: false });
    expect(() => parseReleaseArgs(['--force'])).toThrow(/opção desconhecida/);
  });
});

describe('CHANGELOG.md', () => {
  it('tem a seção da versão do package.json (toda versão precisa dizer o que entrou)', () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    const notes = changelogSection(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
    expect(notes, `escreva a seção "## [${version}]" no CHANGELOG.md`).toBeTruthy();
  });
});
