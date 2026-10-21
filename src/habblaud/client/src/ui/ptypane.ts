// Tela do terminal interativo (xterm.js) ligada a um pty do servidor (server/pty/manager.ts): saída pelo SSE
// GET /api/pty/:id/stream (reset | data | exit) e teclas/tamanho por POST. Carregado sob demanda (import
// dinâmico em ui/pty.ts): o xterm só entra quando alguém abre um terminal interativo.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { postPty } from './ptyapi';
import { tr } from '../../../shared/i18n';

const RESIZE_DEBOUNCE_MS = 120;

export class PtyPane {
  readonly el: HTMLElement;
  private term: Terminal;
  private fit: FitAddon;
  private es: EventSource | null = null;
  private id: string | null = null;
  private exited = false;
  /** Entrada ainda não enviada e a fila de envio (mantém a ordem das teclas). */
  private pending = '';
  private sending: Promise<void> = Promise.resolve();
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private ro: ResizeObserver;

  constructor(private onExit: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'ui-pty__screen';
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Cascadia Mono', Consolas, Menlo, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: { background: '#0a0c12', foreground: '#d5dceb', cursor: '#ffb547', selectionBackground: '#3a4a6b' },
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.el);
    this.term.onData((d) => this.send(d));
    this.term.onResize(({ cols, rows }) => this.scheduleResize(cols, rows));
    this.ro = new ResizeObserver(() => this.refit());
    this.ro.observe(this.el);
  }

  get ptyId(): string | null {
    return this.id;
  }

  /** Liga a tela a um pty do servidor (outro pty = tela nova). */
  attach(id: string): void {
    if (this.id === id && this.es) return;
    this.detach();
    this.id = id;
    this.exited = false;
    this.term.reset();
    const es = new EventSource(`/api/pty/${encodeURIComponent(id)}/stream`);
    this.es = es;
    es.addEventListener('reset', (e) => {
      this.term.reset();
      this.term.write(parse(e));
      this.refit(true);
    });
    es.addEventListener('data', (e) => this.term.write(parse(e)));
    es.addEventListener('exit', (e) => {
      this.exited = true;
      let code = 0;
      try {
        code = (JSON.parse((e as MessageEvent<string>).data) as { code?: number }).code ?? 0;
      } catch {
        // sem código
      }
      this.term.write(`\r\n\x1b[2m[${code ? tr('Claude Code encerrado (código {0})', [code]) : tr('Claude Code encerrado')}]\x1b[0m\r\n`);
      es.close();
      this.onExit();
    });
  }

  detach(): void {
    this.es?.close();
    this.es = null;
    this.id = null;
  }

  focus(): void {
    this.term.focus();
  }

  /** Reajusta colunas/linhas ao tamanho do elemento (`force` reenvia ao servidor mesmo sem mudança). */
  refit(force = false): void {
    if (!this.el.isConnected || this.el.clientWidth < 40 || this.el.clientHeight < 40) return;
    const before = `${this.term.cols}x${this.term.rows}`;
    try {
      this.fit.fit();
    } catch {
      return;
    }
    if (force && before === `${this.term.cols}x${this.term.rows}`) this.scheduleResize(this.term.cols, this.term.rows);
  }

  private send(data: string): void {
    if (!this.id || this.exited) return;
    this.pending += data;
    const id = this.id;
    this.sending = this.sending.then(async () => {
      if (!this.pending) return;
      const chunk = this.pending;
      this.pending = '';
      await postPty(`/api/pty/${encodeURIComponent(id)}/input`, { data: chunk }).catch(() => undefined);
    });
  }

  private scheduleResize(cols: number, rows: number): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      if (this.id && !this.exited) void postPty(`/api/pty/${encodeURIComponent(this.id)}/resize`, { cols, rows }).catch(() => undefined);
    }, RESIZE_DEBOUNCE_MS);
  }
}

function parse(e: Event): string {
  try {
    const v = JSON.parse((e as MessageEvent<string>).data) as unknown;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}
