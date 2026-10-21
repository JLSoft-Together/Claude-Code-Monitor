// Ditado: botão de microfone que grava no navegador (MediaRecorder), manda o áudio ao Habblaud (POST /api/dictation)
// e devolve o texto transcrito pelo Whisper local do Mac, com o idioma detectado sozinho (português ou inglês; ver
// server/dictation/whisper.ts). Fica no "Novo agente" e na caixa de mensagem (gaveta e terminal). O microfone só existe
// em página segura (HTTPS ou localhost): fora disso o botão some.
import { tr } from '../../../shared/i18n';
import { h, setText } from './dom';
import { ICONS } from './icons';

export const MAX_RECORD_MS = 180_000;
const POLL_MS = 600;
const WAIT_MS = 150_000;
/** Formatos em ordem de preferência: o Safari do iPhone grava mp4 (AAC); Chrome e Firefox, webm/ogg (Opus). */
const MIME_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** Aviso de ditado pronto, com o idioma reconhecido (uma frase inteira por idioma, para traduzir). */
export function dictationDone(lang: string | undefined): string {
  if (lang === 'pt') return tr('Ditado em português: confira o texto.');
  if (lang === 'en') return tr('Ditado em inglês: confira o texto.');
  if (lang === 'es') return tr('Ditado em espanhol: confira o texto.');
  return tr('Ditado pronto: confira o texto.');
}

export interface DictationText {
  text: string;
  lang?: string;
}

type State = 'idle' | 'recording' | 'working';

interface DictationReply {
  id: string;
  status: 'queued' | 'sent' | 'done' | 'failed';
  text?: string;
  lang?: string;
  error?: string;
}

/** Junta o texto ditado ao que já está no campo, na posição do cursor, com espaço/linha certos. */
export function insertDictation(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  const t = text.trim();
  if (!t) return { value, caret: end };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const next = `${before}${lead}${t}${trail}${after}`;
  return { value: next, caret: before.length + lead.length + t.length };
}

export function pickMimeType(isSupported: (t: string) => boolean): string | undefined {
  return MIME_TYPES.find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  });
}

export function canRecord(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => fail(new Error(tr('não deu para ler a gravação')));
    r.readAsDataURL(blob);
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? tr('erro {0}', [res.status]));
  return body;
}

const AVAILABLE_TTL_MS = 30_000;
let availableCache: { at: number; value: Promise<boolean> } | null = null;

/** O ditado funciona daqui (navegador grava e o Mac tem o Whisper)? Uma consulta a cada 30 s, dividida entre as caixas. */
export function dictationAvailable(now = Date.now()): Promise<boolean> {
  if (!canRecord()) return Promise.resolve(false);
  if (availableCache && now - availableCache.at < AVAILABLE_TTL_MS) return availableCache.value;
  const value = api<{ available: boolean }>('/api/dictation').then(
    (r) => r.available === true,
    () => false,
  );
  availableCache = { at: now, value };
  return value;
}

export interface DictationButtonOptions {
  /** Só o ícone (caixa de mensagem); gravando, mostra o tempo. */
  compact?: boolean;
  /** Chamado quando a gravação começa (a caixa guarda para qual agente era o ditado). */
  onStart?: () => void;
}

export class DictationButton {
  readonly el: HTMLButtonElement;
  private readonly label: HTMLElement;
  private state: State = 'idle';
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private cancelled = false;

  constructor(
    private readonly onText: (t: DictationText) => void,
    private readonly say: (text: string, error?: boolean) => void,
    private readonly opts: DictationButtonOptions = {},
  ) {
    this.label = h('span', { class: 'ui-dictate__label', text: opts.compact ? '' : tr('Ditar') });
    this.el = h('button', {
      class: `ui-btn ui-dictate${opts.compact ? ' ui-dictate--compact' : ''}`,
      type: 'button',
      attrs: { 'aria-pressed': 'false', 'aria-label': tr('Ditar'), title: tr('Ditar (português ou inglês, o idioma é detectado sozinho)') },
      on: { click: () => void this.toggle() },
    });
    const icon = h('span', { class: 'ui-dictate__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = ICONS.mic;
    this.el.append(icon, this.label);
  }

  get busy(): boolean {
    return this.state !== 'idle';
  }

  /** Para a gravação sem transcrever (painel fechado). */
  cancel(): void {
    if (this.state !== 'recording') return;
    this.cancelled = true;
    this.stopRecorder();
  }

  private async toggle(): Promise<void> {
    if (this.state === 'recording') return this.stopRecorder();
    if (this.state === 'working') return;
    await this.start();
  }

  private async start(): Promise<void> {
    if (!canRecord()) return this.say(tr('Este navegador não deixa gravar áudio aqui (precisa de HTTPS).'), true);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const denied = (err as DOMException)?.name === 'NotAllowedError';
      return this.say(denied ? tr('Sem permissão para o microfone: libere nas configurações do navegador e tente de novo.') : tr('Não deu para abrir o microfone.'), true);
    }
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    try {
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    } catch {
      this.release();
      return this.say(tr('Este navegador não grava áudio.'), true);
    }
    this.chunks = [];
    this.cancelled = false;
    this.recorder.addEventListener('dataavailable', (e) => {
      if (e.data.size) this.chunks.push(e.data);
    });
    this.recorder.addEventListener('stop', () => void this.finish(), { once: true });
    this.recorder.start(1_000);
    this.startedAt = Date.now();
    this.opts.onStart?.();
    this.set('recording');
    this.say(this.opts.compact ? tr('Gravando… toque no microfone de novo para parar.') : tr('Gravando… fale em português ou inglês e toque em Parar.'));
    this.timer = setInterval(() => {
      const ms = Date.now() - this.startedAt;
      const s = Math.floor(ms / 1000);
      const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(this.label, this.opts.compact ? clock : tr('Parar {0}', [clock]));
      if (ms >= MAX_RECORD_MS) this.stopRecorder();
    }, 250);
  }

  private stopRecorder(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    } catch {
      // já parado
    }
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private async finish(): Promise<void> {
    const type = this.recorder?.mimeType || this.chunks[0]?.type || 'audio/mp4';
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    this.recorder = null;
    this.release();
    if (this.cancelled) {
      this.cancelled = false;
      return this.set('idle');
    }
    if (blob.size < 512) {
      this.set('idle');
      return this.say(tr('Não ouvi nada: tente de novo, mais perto do microfone.'), true);
    }
    this.set('working');
    this.say(tr('Transcrevendo no computador…'));
    try {
      let r = await api<DictationReply>('/api/dictation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type.split(';')[0], data: await blobToBase64(blob) }),
      });
      const end = Date.now() + WAIT_MS;
      while ((r.status === 'queued' || r.status === 'sent') && Date.now() < end) {
        await new Promise((ok) => setTimeout(ok, POLL_MS));
        r = await api<DictationReply>(`/api/dictation/${encodeURIComponent(r.id)}`);
      }
      if (r.status !== 'done') throw new Error(r.error || tr('o computador não respondeu a tempo'));
      if (!r.text?.trim()) this.say(tr('Não entendi nada na gravação: tente de novo.'), true);
      else {
        this.onText({ text: r.text, lang: r.lang });
        this.say(dictationDone(r.lang));
      }
    } catch (err) {
      this.say(tr('Ditado falhou: {0}', [(err as Error).message]), true);
    } finally {
      this.set('idle');
    }
  }

  private set(state: State): void {
    this.state = state;
    this.el.classList.toggle('is-recording', state === 'recording');
    this.el.classList.toggle('is-working', state === 'working');
    this.el.setAttribute('aria-pressed', String(state === 'recording'));
    this.el.disabled = state === 'working';
    const icon = this.el.querySelector('.ui-dictate__icon');
    if (icon) icon.innerHTML = state === 'recording' ? ICONS.stopRec : ICONS.mic;
    this.el.setAttribute('aria-label', state === 'recording' ? tr('Parar o ditado') : state === 'working' ? tr('Transcrevendo') : tr('Ditar'));
    if (this.opts.compact) setText(this.label, state === 'recording' ? '0:00' : state === 'working' ? '…' : '');
    else setText(this.label, state === 'recording' ? tr('Parar {0}', ['0:00']) : state === 'working' ? tr('Transcrevendo…') : tr('Ditar'));
  }
}
