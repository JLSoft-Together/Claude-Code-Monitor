import type { HighlighterCore, LanguageRegistration } from 'shiki/core'

type LangModule = Promise<{ default: LanguageRegistration[] }>

const LOADERS: Record<string, () => LangModule> = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  astro: () => import('shiki/langs/astro.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  bat: () => import('shiki/langs/bat.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  makefile: () => import('shiki/langs/makefile.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
}

const THEME = 'ccm'
// Big files render plain: even in the worker, 2 MB takes seconds before any colour shows.
export const HIGHLIGHT_MAX_CHARS = 400_000

let core: Promise<HighlighterCore> | null = null
const loaded = new Map<string, Promise<boolean>>()

function highlighter(): Promise<HighlighterCore> {
  // JS regex engine, not oniguruma: the app CSP has no 'wasm-unsafe-eval'.
  core ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--shiki-', fontStyle: true })],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  })()
  return core
}

function ensureLang(hl: HighlighterCore, lang: string): Promise<boolean> {
  let job = loaded.get(lang)
  if (!job) {
    const load = LOADERS[lang]
    job = load
      ? load()
          .then((mod) => hl.loadLanguage(...mod.default))
          .then(() => true)
          .catch(() => false)
      : Promise.resolve(false)
    loaded.set(lang, job)
  }
  return job
}

/**
 * Tokens of `code` packed for a transferable message: per line its token count, per token (length, palette index + 1
 * or 0, fontStyle). null when the grammar is unknown / file too big / loading failed (render plain).
 */
export interface PackedTokens {
  palette: string[]
  counts: Uint32Array
  toks: Uint32Array
}

export async function tokenizePacked(code: string, lang: string | null): Promise<PackedTokens | null> {
  if (!lang || code.length > HIGHLIGHT_MAX_CHARS) return null
  try {
    const hl = await highlighter()
    if (!(await ensureLang(hl, lang))) return null
    const lines = hl.codeToTokensBase(code, { lang, theme: THEME })
    const palette: string[] = []
    const index = new Map<string, number>()
    let total = 0
    for (const line of lines) total += line.length
    const counts = new Uint32Array(lines.length)
    const toks = new Uint32Array(total * 3)
    let k = 0
    lines.forEach((line, li) => {
      counts[li] = line.length
      for (const t of line) {
        let c = 0
        if (t.color) {
          c = index.get(t.color) ?? 0
          if (!c) {
            palette.push(t.color)
            c = palette.length
            index.set(t.color, c)
          }
        }
        toks[k++] = t.content.length
        toks[k++] = c
        toks[k++] = Math.max(0, t.fontStyle ?? 0)
      }
    })
    return { palette, counts, toks }
  } catch {
    return null
  }
}
