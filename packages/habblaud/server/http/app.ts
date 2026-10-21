// LOCAL SHIM (not upstream, see UPSTREAM.md): upstream's server/http/app.ts is the whole Habblaud API router and drags in
// the sessions, pty, permissions, spawn and dictation servers. server/http/timeline.ts only needs sendJson, copied
// here unchanged.
import type { ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // A API só é lida pela própria página: nada de leitura "no-cors" por outras origens.
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
}
