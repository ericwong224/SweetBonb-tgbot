import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import { runtimeLog, type RuntimeLogEntry } from './runtime-log.js';

function resolveLogToken(config: AppConfig): string {
  return config.OPS_LOG_TOKEN ?? config.TELEGRAM_WEBHOOK_SECRET;
}

function isAuthorized(c: Context, config: AppConfig): boolean {
  if (!config.OPS_LOG_ENABLED) return false;
  const expected = resolveLogToken(config);
  const q = c.req.query('token');
  const auth = c.req.header('Authorization');
  if (q && q === expected) return true;
  if (auth?.startsWith('Bearer ') && auth.slice(7) === expected) return true;
  return false;
}

function formatLine(entry: RuntimeLogEntry): string {
  const data = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  return `[${entry.ts}] [${entry.level}] [${entry.category}] ${entry.message}${data}`;
}

const LOG_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SweetBonb Bot — Live Log</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #0d1117; color: #c9d1d9; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    header { padding: 12px 16px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    header h1 { margin: 0; font-size: 15px; font-weight: 600; color: #58a6ff; }
    #status { color: #8b949e; }
    #status.ok { color: #3fb950; }
    #status.err { color: #f85149; }
    #log { padding: 12px 16px; white-space: pre-wrap; word-break: break-word; min-height: calc(100vh - 52px); }
    .line { margin: 0 0 4px; }
    .debug { color: #8b949e; }
    .info { color: #c9d1d9; }
    .warn { color: #d29922; }
    .error { color: #f85149; }
  </style>
</head>
<body>
  <header>
    <h1>SweetBonb Bot Live Log</h1>
    <span id="status">connecting…</span>
  </header>
  <div id="log"></div>
  <script>
    const params = new URLSearchParams(location.search);
    const token = params.get('token') || '';
    const logEl = document.getElementById('log');
    const statusEl = document.getElementById('status');
    function append(entry) {
      const div = document.createElement('div');
      div.className = 'line ' + entry.level;
      const data = entry.data ? ' ' + JSON.stringify(entry.data) : '';
      div.textContent = '[' + entry.ts + '] [' + entry.level + '] [' + entry.category + '] ' + entry.message + data;
      logEl.appendChild(div);
      while (logEl.childNodes.length > 500) logEl.removeChild(logEl.firstChild);
      window.scrollTo(0, document.body.scrollHeight);
    }
    fetch('/ops/logs/recent?token=' + encodeURIComponent(token))
      .then(r => r.json())
      .then(rows => rows.forEach(append))
      .catch(() => {});
    const es = new EventSource('/ops/logs/stream?token=' + encodeURIComponent(token));
    es.onopen = () => { statusEl.textContent = 'live'; statusEl.className = 'ok'; };
    es.onmessage = (e) => { try { append(JSON.parse(e.data)); } catch {} };
    es.onerror = () => { statusEl.textContent = 'disconnected — retrying…'; statusEl.className = 'err'; };
  </script>
</body>
</html>`;

export function createLogRoutes(config: AppConfig): Hono {
  const app = new Hono();

  app.get('/ops/logs', (c) => {
    if (!isAuthorized(c, config)) return c.text('Unauthorized', 401);
    return c.html(LOG_PAGE_HTML);
  });

  app.get('/ops/logs/recent', (c) => {
    if (!isAuthorized(c, config)) return c.json({ error: 'Unauthorized' }, 401);
    const limit = Math.min(Number(c.req.query('limit') ?? 200), 500);
    return c.json(runtimeLog.getRecent(limit));
  });

  app.get('/ops/logs/stream', (c) => {
    if (!isAuthorized(c, config)) return c.text('Unauthorized', 401);

    let ping: ReturnType<typeof setInterval> | null = null;
    let onEntry: ((entry: RuntimeLogEntry) => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        onEntry = (entry: RuntimeLogEntry) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
        };
        runtimeLog.on('entry', onEntry);
        controller.enqueue(encoder.encode(': connected\n\n'));
        ping = setInterval(() => {
          controller.enqueue(encoder.encode(': ping\n\n'));
        }, 25_000);
      },
      cancel() {
        if (ping) clearInterval(ping);
        if (onEntry) runtimeLog.off('entry', onEntry);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  return app;
}
