// Pedidos de aprovação do Codex (hook PermissionRequest de mod/habblaud-codex/hook.mjs): título, resumo e argumentos
// pelos nomes de ferramenta que o Codex manda no hook (0.162):
// - Bash: {command, description?}. O acesso à rede também chega como Bash, com description "network-access <alvo>";
// - apply_patch: {command: <o patch>} ("*** Begin Patch", "*** Update File: <caminho>", linhas -/+): vai como diff;
// - request_permissions: {reason, permissions};
// - mcp__<servidor>__<ferramenta>: os argumentos da ferramenta MCP;
// - write_stdin: {session_id, chars, ...}. Aqui `session_id` é o id de um PROCESSO (o terminal em que o agente
//   digita), não o da sessão; `chars` pode ser uma senha digitada num prompt: o título só diz o tamanho e o texto
//   (mascarado) fica no detalhe, que só sai por GET /api/permissions/:id.
// Tudo mascarado (maskSecrets) e cortado como no terminal.
import { basename, describeTool, maskSecrets, truncate } from '../../shared/activity';
import type { TerminalInputKind } from '../../shared/types';
import { TITLE_ARG_MAX, toolView } from '../sources/terminal';
import { tr } from '../../shared/i18n';

/** Resumo de um pedido do Codex: o que vai em PermissionRequestInfo (title, text, icon, input, inputKind). */
export interface CodexToolView {
  title: string;
  text: string;
  icon: string;
  input?: string;
  inputKind?: TerminalInputKind;
}

type Rec = Record<string, unknown>;

/** Tamanho do resumo (o mesmo das atividades). */
const TEXT_MAX = 46;
/** Prefixo da description do Bash num pedido de acesso à rede. */
const NETWORK = /^network-access\s+(\S[\s\S]*)$/;
const PATCH_FILE = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** Uma linha mascarada e cortada. */
function line(s: string, max: number): string {
  return truncate(maskSecrets(s.slice(0, max * 8)), max);
}

/** Texto mascarado e cortado como o terminal mostra os argumentos (o mesmo tratamento do comando do Bash). */
function shown(raw: string | undefined, inputKind: TerminalInputKind): Pick<CodexToolView, 'input' | 'inputKind'> {
  const input = raw?.trim() ? toolView('Bash', { command: raw }).input : undefined;
  return input ? { input, inputKind } : {};
}

function relPath(p: string, cwd: string | undefined): string {
  if (!cwd || !p.startsWith('/')) return p;
  const base = cwd.replace(/\/+$/, '');
  return base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
}

/** Arquivos de um patch do apply_patch, na ordem. */
export function patchFiles(patch: string | undefined): Array<{ op: 'Add' | 'Update' | 'Delete'; path: string }> {
  if (!patch) return [];
  return [...patch.slice(0, 200_000).matchAll(PATCH_FILE)].map((m) => ({ op: m[1] as 'Add' | 'Update' | 'Delete', path: m[2].trim() }));
}

/** Texto do write_stdin com os caracteres de controle visíveis ("y\n", "\u0003"). */
function escaped(chars: string): string {
  return JSON.stringify(chars.slice(0, 2_000)).slice(1, -1);
}

/** Título, resumo e argumentos de um pedido do Codex. */
export function codexToolView(tool: string, input: Rec, cwd?: string): CodexToolView {
  switch (tool) {
    case 'Bash': {
      const command = str(input.command);
      const target = NETWORK.exec(str(input.description)?.trim() ?? '')?.[1];
      if (target) return { title: tr('Rede({0})', [line(target, TITLE_ARG_MAX)]), text: line(tr('Acessar a rede: {0}', [target]), TEXT_MAX), icon: '🌐', ...shown(command, 'command') };
      const view = toolView('Bash', { command: command ?? '' }, cwd);
      const desc = describeTool('Bash', { command: command ?? '', description: str(input.description) });
      return { title: view.title, text: desc.text, icon: desc.icon, ...shown(command, 'command') };
    }
    case 'apply_patch': {
      const patch = str(input.command) ?? str(input.patch) ?? str(input.input);
      const files = patchFiles(patch);
      const first = files[0];
      const more = files.length > 1 ? ` +${files.length - 1}` : '';
      const title = first ? `apply_patch(${line(relPath(first.path, cwd), TITLE_ARG_MAX)}${more})` : 'apply_patch';
      const name = first ? line(basename(first.path), TEXT_MAX) : '';
      const [text, icon] =
        files.length > 1
          ? [tr('Editando {0} arquivos', [files.length]), '✏️']
          : first?.op === 'Add'
            ? [tr('Criando {0}', [name]), '📝']
            : first?.op === 'Delete'
              ? [tr('Apagando {0}', [name]), '🗑️']
              : [first ? tr('Editando {0}', [name]) : tr('Aplicando um patch'), '✏️'];
      return { title, text: truncate(text, TEXT_MAX), icon, ...shown(patch, 'diff') };
    }
    case 'request_permissions': {
      const view = toolView(tool, input, cwd);
      return { ...view, text: tr('Pedindo mais permissões'), icon: '🔐' };
    }
    case 'write_stdin': {
      const chars = typeof input.chars === 'string' ? input.chars : '';
      const title = chars ? `write_stdin(${chars.length} caractere${chars.length === 1 ? '' : 's'})` : 'write_stdin';
      return { title, text: tr('Digitando num processo do terminal'), icon: '⌨️', ...shown(chars ? escaped(chars) : undefined, 'text') };
    }
    default: {
      const view = toolView(tool, input, cwd);
      const desc = describeTool(tool, input);
      return { ...view, text: desc.text, icon: desc.icon };
    }
  }
}
