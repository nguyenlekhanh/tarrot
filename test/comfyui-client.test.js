'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  ComfyUIError,
  ComfyUIClient,
  normalizeBaseUrl,
  normalizeQueue,
  toWebSocketUrl
} = require('../comfyui-client');

/** Local fixture server; no ComfyUI and no network access required. */
function startFixture(routes) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const route = routes[pathname];
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const { status = 200, body = null, raw = null } = route;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(raw !== null ? raw : JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Minimal WebSocket stand-in that speaks the injected-message contract. */
class FakeSocket {
  constructor(url, behaviour) {
    this.url = url;
    this.closed = false;
    this.behaviour = behaviour || {};
    FakeSocket.last = this;
    setTimeout(() => {
      if (this.behaviour.silent) return;
      if (this.behaviour.fail) {
        if (this.onerror) this.onerror(new Error('connection refused'));
        return;
      }
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(this.behaviour.message || {
          type: 'status',
          data: { status: { exec_info: { queue_remaining: 3 } } }
        }) });
      }
    }, 1);
  }

  close() {
    this.closed = true;
  }
}

test('normalizeBaseUrl trims slashes and rejects non-http protocols', () => {
  assert.equal(normalizeBaseUrl('http://10.0.0.142:8188/'), 'http://10.0.0.142:8188');
  assert.equal(normalizeBaseUrl('http://10.0.0.142:8188///'), 'http://10.0.0.142:8188');
  assert.equal(normalizeBaseUrl(''), 'http://10.0.0.142:8188');
  assert.throws(() => normalizeBaseUrl('ftp://host:21'), ComfyUIError);
});

test('toWebSocketUrl derives a ws url with the client id', () => {
  assert.equal(
    toWebSocketUrl('http://10.0.0.142:8188', 'abc-123'),
    'ws://10.0.0.142:8188/ws?clientId=abc-123'
  );
  assert.equal(toWebSocketUrl('https://gpu.local:8188', 'x'), 'wss://gpu.local:8188/ws?clientId=x');
  assert.equal(toWebSocketUrl('http://gpu.local:8188'), 'ws://gpu.local:8188/ws');
});

test('normalizeQueue tolerates empty and populated queues', () => {
  const empty = normalizeQueue({ queue_running: [], queue_pending: [] });
  assert.equal(empty.runningCount, 0);
  assert.equal(empty.pendingCount, 0);

  const busy = normalizeQueue({
    queue_running: [[0, 'prompt-running', {}, {}, []]],
    queue_pending: [[1, 'prompt-waiting', {}, {}, []]]
  });
  assert.equal(busy.total, 2);
  assert.deepEqual(busy.running[0], { promptId: 'prompt-running', number: 0 });
  assert.equal(busy.pending[0].promptId, 'prompt-waiting');

  // A malformed payload must not throw.
  assert.equal(normalizeQueue(null).total, 0);
  assert.equal(normalizeQueue({ queue_running: 'nope' }).runningCount, 0);
});

test('systemStats and getQueue read the real endpoints', async () => {
  const { server, baseUrl } = await startFixture({
    '/system_stats': {
      body: {
        system: { os: 'win32', ram_total: 85582462976, ram_free: 70297530368, comfyui_version: '0.34.0' },
        devices: [{ name: 'cuda:0' }]
      }
    },
    '/queue': { body: { queue_running: [], queue_pending: [] } }
  });
  try {
    const client = new ComfyUIClient({ baseUrl });
    const stats = await client.systemStats();
    assert.equal(stats.system.comfyui_version, '0.34.0');
    const queue = await client.getQueue();
    assert.equal(queue.total, 0);
  } finally {
    server.close();
  }
});

test('HTTP errors surface as ComfyUIError with status and path', async () => {
  const { server, baseUrl } = await startFixture({
    '/system_stats': { status: 500, body: { error: 'boom' } }
  });
  try {
    const client = new ComfyUIClient({ baseUrl });
    await assert.rejects(() => client.systemStats(), (error) => {
      assert.ok(error instanceof ComfyUIError);
      assert.equal(error.status, 500);
      assert.equal(error.path, '/system_stats');
      return true;
    });
  } finally {
    server.close();
  }
});

test('invalid JSON is reported, not silently swallowed', async () => {
  const { server, baseUrl } = await startFixture({ '/queue': { raw: '<html>oops</html>' } });
  try {
    const client = new ComfyUIClient({ baseUrl });
    await assert.rejects(() => client.getQueue(), /invalid JSON/);
  } finally {
    server.close();
  }
});

test('probeWebSocket resolves with the first message and closes the socket', async () => {
  const client = new ComfyUIClient({ baseUrl: 'http://10.0.0.142:8188', WebSocketImpl: FakeSocket });
  const result = await client.probeWebSocket({ timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.firstMessageType, 'status');
  assert.equal(result.queueRemaining, 3);
  assert.equal(result.url, client.webSocketUrl);
  assert.equal(FakeSocket.last.closed, true);
});

test('probeWebSocket rejects when the socket errors or stays silent', async () => {
  const failing = new ComfyUIClient({
    baseUrl: 'http://10.0.0.142:8188',
    WebSocketImpl: class extends FakeSocket { constructor(url) { super(url, { fail: true }); } }
  });
  await assert.rejects(() => failing.probeWebSocket({ timeoutMs: 1000 }), /failed|closed/);

  const silent = new ComfyUIClient({
    baseUrl: 'http://10.0.0.142:8188',
    WebSocketImpl: class extends FakeSocket { constructor(url) { super(url, { silent: true }); } }
  });
  await assert.rejects(() => silent.probeWebSocket({ timeoutMs: 30 }), /no message/);
});

test('checkHealth reports each step independently', async () => {
  const { server, baseUrl } = await startFixture({
    '/system_stats': { body: { system: { comfyui_version: '0.34.0' }, devices: [] } },
    '/queue': { status: 503, body: { error: 'busy' } }
  });
  try {
    const client = new ComfyUIClient({ baseUrl, WebSocketImpl: FakeSocket });
    const report = await client.checkHealth({ webSocketTimeoutMs: 500 });
    assert.equal(report.systemStats.ok, true);
    assert.equal(report.queue.ok, false);
    assert.equal(report.webSocket.ok, true);
    assert.equal(report.ok, false);
  } finally {
    server.close();
  }
});
