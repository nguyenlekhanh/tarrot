'use strict';

/**
 * Mystic Witch Live — reusable ComfyUI API client.
 *
 * Scope: transport only. It exposes ComfyUI's HTTP endpoints (`/system_stats`,
 * `/queue`, `/history`, `/object_info`, `/prompt`, `/interrupt`) and its `/ws`
 * event socket. It deliberately does NOT build, validate or run any workflow:
 * image generation is wired up in a later phase.
 *
 * Design notes:
 *   - Plain CommonJS, no new dependencies. `http`/`https` are built in and the
 *     project's existing `ws` package is loaded lazily, only when a WebSocket is
 *     actually opened, so requiring this module never fails in a bare checkout.
 *   - Every error is a ComfyUIError carrying `status`/`path`/`code` so callers
 *     (admin panel, CLI, later the tarot renderer) can report the real reason.
 *   - A socket implementation can be injected (`WebSocketImpl`) which keeps the
 *     unit tests network-free.
 */

const http = require('http');
const https = require('https');
const { randomUUID } = require('crypto');

const DEFAULT_BASE_URL = 'http://10.0.0.142:8188';
const DEFAULT_TIMEOUT_MS = 10000;

class ComfyUIError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ComfyUIError';
    if (details.cause) this.cause = details.cause;
    if (details.status !== undefined) this.status = details.status;
    if (details.path !== undefined) this.path = details.path;
    if (details.code !== undefined) this.code = details.code;
    if (details.body !== undefined) this.body = details.body;
  }
}

/** Trim trailing slashes and reject anything that is not plain http(s). */
function normalizeBaseUrl(baseUrl, fallback = DEFAULT_BASE_URL) {
  const raw = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : fallback;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new ComfyUIError(`Invalid ComfyUI base URL: ${raw}`, { cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ComfyUIError(`ComfyUI base URL must use http or https, got ${parsed.protocol}`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

/** http(s)://host:port[/base] -> ws(s)://host:port[/base]/ws?clientId=... */
function toWebSocketUrl(baseUrl, clientId) {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = new URL(`${normalized}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (clientId) url.searchParams.set('clientId', clientId);
  return url.toString();
}

function loadWebSocket() {
  try {
    // eslint-disable-next-line global-require
    return require('ws');
  } catch (error) {
    throw new ComfyUIError(
      'The "ws" package is required to open a ComfyUI WebSocket. Run the project install (bun install / npm ci) first.',
      { cause: error, code: 'WS_MISSING' }
    );
  }
}

function requestJson(baseUrl, pathname, options = {}) {
  const { method = 'GET', body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(`${normalizeBaseUrl(baseUrl)}${pathname}`);
    } catch (error) {
      reject(error);
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const headers = payload
      ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
      : { Accept: 'application/json' };

    const req = transport.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new ComfyUIError(`ComfyUI ${method} ${pathname} failed with HTTP ${res.statusCode}`, {
            status: res.statusCode,
            path: pathname,
            body: text.slice(0, 500)
          }));
          return;
        }
        if (!text) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new ComfyUIError(`ComfyUI ${pathname} returned invalid JSON`, {
            cause: error,
            path: pathname,
            body: text.slice(0, 500)
          }));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new ComfyUIError(`ComfyUI ${method} ${pathname} timed out after ${timeoutMs} ms`, {
        path: pathname,
        code: 'ETIMEDOUT'
      }));
    });
    req.on('error', (error) => {
      reject(error instanceof ComfyUIError
        ? error
        : new ComfyUIError(`ComfyUI ${pathname} request failed: ${error.message}`, {
          cause: error,
          path: pathname,
          code: error.code
        }));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** A stable, queue-shaped view of /queue regardless of server version. */
function normalizeQueue(payload) {
  const running = Array.isArray(payload && payload.queue_running) ? payload.queue_running : [];
  const pending = Array.isArray(payload && payload.queue_pending) ? payload.queue_pending : [];
  // ComfyUI queue entries are [number, prompt_id, prompt, extra_data, outputs].
  const describe = (entry) => {
    if (!Array.isArray(entry)) {
      return { promptId: entry && entry.prompt_id ? entry.prompt_id : null, number: null };
    }
    const rawId = entry[1];
    const promptId = typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0] || null
        : null;
    return { promptId, number: Number.isFinite(entry[0]) ? entry[0] : null };
  };
  return {
    running: running.map(describe),
    pending: pending.map(describe),
    runningCount: running.length,
    pendingCount: pending.length,
    total: running.length + pending.length
  };
}

function extractQueueRemaining(message) {
  const status = message && message.data && message.data.status;
  const remaining = status && status.exec_info && status.exec_info.queue_remaining;
  return Number.isFinite(remaining) ? remaining : null;
}

class ComfyUIClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.COMFYUI_BASE_URL, DEFAULT_BASE_URL);
    this.clientId = options.clientId || randomUUID();
    this.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    this.WebSocketImpl = options.WebSocketImpl || null;
  }

  /** Raw JSON request against the configured origin. */
  request(pathname, options = {}) {
    return requestJson(this.baseUrl, pathname, { timeoutMs: this.timeoutMs, ...options });
  }

  async systemStats() {
    return this.request('/system_stats');
  }

  /** ComfyUI keeps its queue in pollable state; there is no dedicated action. */
  async getQueue() {
    return normalizeQueue(await this.request('/queue'));
  }

  async getHistory(promptId) {
    return this.request(promptId ? `/history/${encodeURIComponent(promptId)}` : '/history');
  }

  async objectInfo() {
    return this.request('/object_info');
  }

  /**
   * Queue a workflow. Not called anywhere yet — Phase 1.5 only verifies
   * connectivity, image generation is enabled in a later phase.
   */
  async enqueuePrompt(workflow, options = {}) {
    const clientId = options.clientId || this.clientId;
    const payload = await this.request('/prompt', {
      method: 'POST',
      body: { prompt: workflow, client_id: clientId }
    });
    return { ...payload, clientId };
  }

  async interrupt() {
    return this.request('/interrupt', { method: 'POST', body: {} });
  }

  get webSocketUrl() {
    return toWebSocketUrl(this.baseUrl, this.clientId);
  }

  /**
   * Open `/ws`, wait for the first message (ComfyUI sends `status` with
   * queue_remaining on connect) and close again.
   */
  probeWebSocket(options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : Math.min(this.timeoutMs, 5000);
    const WebSocketCtor = this.WebSocketImpl || loadWebSocket();
    const url = this.webSocketUrl;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      let settled = false;
      let socket = null;
      const messages = [];

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket && typeof socket.close === 'function') {
          try { socket.close(); } catch (error) { /* already gone */ }
        }
        fn(value);
      };

      const timer = setTimeout(() => {
        finish(reject, new ComfyUIError(`ComfyUI WebSocket ${url} sent no message within ${timeoutMs} ms`, {
          code: 'ETIMEDOUT'
        }));
      }, timeoutMs);

      try {
        socket = new WebSocketCtor(url);
      } catch (error) {
        finish(reject, new ComfyUIError(`ComfyUI WebSocket ${url} could not be opened: ${error.message}`, {
          cause: error
        }));
        return;
      }

      const handleMessage = (raw) => {
        const data = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
        let text = data;
        if (data && typeof data === 'object' && typeof data.toString === 'function') text = data.toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (error) { parsed = null; }
        if (parsed) messages.push(parsed);
        finish(resolve, {
          ok: true,
          url,
          latencyMs: Date.now() - startedAt,
          firstMessageType: parsed && parsed.type ? parsed.type : null,
          queueRemaining: extractQueueRemaining(parsed),
          messages
        });
      };

      const handleError = (error) => {
        finish(reject, new ComfyUIError(`ComfyUI WebSocket ${url} failed: ${(error && error.message) || error}`, {
          cause: error
        }));
      };

      if (typeof socket.on === 'function') {
        socket.on('message', handleMessage);
        socket.on('error', handleError);
        socket.on('close', () => finish(reject, new ComfyUIError(`ComfyUI WebSocket ${url} closed before sending a message`)));
      } else {
        socket.onmessage = (event) => handleMessage(event && event.data !== undefined ? event.data : event);
        socket.onerror = handleError;
        socket.onclose = () => finish(reject, new ComfyUIError(`ComfyUI WebSocket ${url} closed before sending a message`));
      }
    });
  }

  /** One-shot readiness report used by the CLI and (later) the admin panel. */
  async checkHealth(options = {}) {
    const report = {
      baseUrl: this.baseUrl,
      webSocketUrl: this.webSocketUrl,
      checkedAt: new Date().toISOString(),
      systemStats: { ok: false },
      queue: { ok: false },
      webSocket: { ok: false },
      ok: false
    };

    try {
      const stats = await this.systemStats();
      const system = (stats && stats.system) || {};
      report.systemStats = {
        ok: true,
        comfyuiVersion: system.comfyui_version || null,
        os: system.os || null,
        ramTotal: Number.isFinite(system.ram_total) ? system.ram_total : null,
        ramFree: Number.isFinite(system.ram_free) ? system.ram_free : null,
        devices: Array.isArray(stats && stats.devices) ? stats.devices.length : 0
      };
    } catch (error) {
      report.systemStats = { ok: false, error: error.message, code: error.code || null };
    }

    try {
      const queue = await this.getQueue();
      report.queue = { ok: true, ...queue };
    } catch (error) {
      report.queue = { ok: false, error: error.message, code: error.code || null };
    }

    try {
      const socket = await this.probeWebSocket({ timeoutMs: options.webSocketTimeoutMs });
      report.webSocket = {
        ok: true,
        latencyMs: socket.latencyMs,
        firstMessageType: socket.firstMessageType,
        queueRemaining: socket.queueRemaining
      };
    } catch (error) {
      report.webSocket = { ok: false, error: error.message, code: error.code || null };
    }

    report.ok = report.systemStats.ok && report.queue.ok && report.webSocket.ok;
    return report;
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  ComfyUIError,
  ComfyUIClient,
  normalizeBaseUrl,
  normalizeQueue,
  toWebSocketUrl,
  extractQueueRemaining
};
