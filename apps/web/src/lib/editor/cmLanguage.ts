import type { Extension } from '@codemirror/state'

/** shiki grammar id (`lib/codeView.ts` `grammarFor`) → CodeMirror language, loaded on demand; null = plain text. */
export async function languageFor(grammar: string | null): Promise<Extension | null> {
  const legacy = async (load: () => Promise<object>, name: string): Promise<Extension> => {
    const [{ StreamLanguage }, mod] = await Promise.all([import('@codemirror/language'), load()])
    return StreamLanguage.define((mod as Record<string, unknown>)[name] as Parameters<typeof StreamLanguage.define>[0])
  }
  switch (grammar) {
    case 'javascript':
    case 'jsx':
    case 'typescript':
    case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: grammar === 'jsx' || grammar === 'tsx', typescript: grammar === 'typescript' || grammar === 'tsx' })
    case 'html':
    case 'vue':
    case 'svelte':
    case 'astro':
      return (await import('@codemirror/lang-html')).html()
    case 'css':
    case 'scss':
    case 'less':
      return (await import('@codemirror/lang-css')).css()
    case 'json':
    case 'jsonc':
      return (await import('@codemirror/lang-json')).json()
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'python':
      return (await import('@codemirror/lang-python')).python()
    case 'java':
      return (await import('@codemirror/lang-java')).java()
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml()
    case 'kotlin':
    case 'dart':
    case 'csharp':
    case 'c':
    case 'cpp':
      return legacy(() => import('@codemirror/legacy-modes/mode/clike'), grammar)
    case 'shellscript':
      return legacy(() => import('@codemirror/legacy-modes/mode/shell'), 'shell')
    case 'powershell':
      return legacy(() => import('@codemirror/legacy-modes/mode/powershell'), 'powerShell')
    case 'toml':
      return legacy(() => import('@codemirror/legacy-modes/mode/toml'), 'toml')
    case 'go':
      return legacy(() => import('@codemirror/legacy-modes/mode/go'), 'go')
    case 'rust':
      return legacy(() => import('@codemirror/legacy-modes/mode/rust'), 'rust')
    case 'swift':
      return legacy(() => import('@codemirror/legacy-modes/mode/swift'), 'swift')
    case 'sql':
      return legacy(() => import('@codemirror/legacy-modes/mode/sql'), 'standardSQL')
    case 'lua':
      return legacy(() => import('@codemirror/legacy-modes/mode/lua'), 'lua')
    case 'ruby':
      return legacy(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby')
    case 'groovy':
      return legacy(() => import('@codemirror/legacy-modes/mode/groovy'), 'groovy')
    case 'dockerfile':
      return legacy(() => import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile')
    case 'diff':
      return legacy(() => import('@codemirror/legacy-modes/mode/diff'), 'diff')
    case 'ini':
      return legacy(() => import('@codemirror/legacy-modes/mode/properties'), 'properties')
    default:
      return null
  }
}
