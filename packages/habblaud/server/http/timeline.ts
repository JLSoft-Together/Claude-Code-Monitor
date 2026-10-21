// Rotas do timelapse (linha do tempo gravada por history/timeline.ts):
//   GET /api/timeline/days    -> {recording, days: [{day, bytes, from, to}]} (do mais recente ao mais antigo)
//   GET /api/timeline/:dia    -> o arquivo do dia (JSONL, formato em shared/timeline.ts), com gzip se aceito
// Mesma exposição do /api/snapshot (resumos de atividade): vale com qualquer bind, sem a trava local do
// terminal. O dia só é aceito no formato AAAA-MM-DD de uma data válida: o caminho do arquivo nunca leva
// texto vindo da URL (nada de "..", barras ou bytes estranhos).
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';
import { listTimelineDays, timelineFile } from '../history/timeline';
import { sendJson } from './app';
import { tr } from '../../shared/i18n';

const DAYS_PATH = '/api/timeline/days';
const DAY_ROUTE = /^\/api\/timeline\/([^/]+)$/;

export interface TimelineRoutesOptions {
  /** Pasta dos arquivos (<dataDir>/timeline). */
  dir: string;
  /** O servidor está gravando (HABBLAUD_TIMELINE não desligou). */
  recording: boolean;
}

/** Devolve um handler que trata /api/timeline/* e responde false para o resto. */
export function createTimelineHandler(opts: TimelineRoutesOptions): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  return (req, res, url) => {
    const path = url.pathname;
    if (path !== '/api/timeline' && !path.startsWith('/api/timeline/')) return false;
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: tr('método não permitido') });
      return true;
    }
    if (path === DAYS_PATH) {
      sendJson(res, 200, { recording: opts.recording, days: listTimelineDays(opts.dir) });
      return true;
    }
    const m = DAY_ROUTE.exec(path);
    let day = '';
    try {
      day = m ? decodeURIComponent(m[1]) : '';
    } catch {
      day = '';
    }
    const file = timelineFile(opts.dir, day);
    if (!file) {
      sendJson(res, 400, { error: tr('dia inválido: use AAAA-MM-DD') });
      return true;
    }
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error(tr('não é arquivo'));
      size = st.size;
    } catch {
      sendJson(res, 404, { error: tr('nada gravado neste dia') });
      return true;
    }
    sendDay(req, res, file, size, method === 'HEAD');
    return true;
  };
}

/** Transmite o arquivo até o tamanho visto agora (o resto, ainda sendo gravado, fica para a próxima). */
function sendDay(req: IncomingMessage, res: ServerResponse, file: string, size: number, head: boolean): void {
  const gzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''));
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    Vary: 'Accept-Encoding',
  };
  if (gzip) headers['Content-Encoding'] = 'gzip';
  else headers['Content-Length'] = size;
  res.writeHead(200, headers);
  if (head || size === 0) {
    if (gzip && !head) createGzip().end().pipe(res);
    else res.end();
    return;
  }
  const src = createReadStream(file, { start: 0, end: size - 1 });
  const done = (err: NodeJS.ErrnoException | null) => {
    if (err && !res.writableEnded) res.destroy();
  };
  if (gzip) pipeline(src, createGzip(), res, done);
  else pipeline(src, res, done);
}
