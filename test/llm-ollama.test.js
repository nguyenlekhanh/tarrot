const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { LlmProviderManager, isLocalHostUrl, isOllamaNative } = require('../llm-provider-manager');

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mystic-llm-'));
}

function newManager(state = { reactive: {} }, dataDir = tempDir()) {
  return new LlmProviderManager({ state, dataDir, env: {}, saveState: () => {} });
}

function mockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        lastRequest: () => server.__last || null,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve(null);
      }
    });
  });
}

const OLLAMA_URL = 'http://10.0.0.142:11434';

test('Ollama and private-LAN providers never require an API key', () => {
  const manager = newManager();
  const ollama = manager.normalizeProvider({
    id: 'ollama',
    name: 'Ollama',
    baseUrl: OLLAMA_URL,
    endpointPath: '/chat/completions',
    model: 'llama3.2:latest',
    requiresKey: true
  });
  assert.equal(ollama.requiresKey, false);
  // A base URL without /v1 must still produce the OpenAI-compatible endpoint.
  assert.equal(ollama.baseUrl, `${OLLAMA_URL}/v1`);
  assert.equal(manager.endpoint(ollama), `${OLLAMA_URL}/v1/chat/completions`);
  assert.equal(manager.isConfigured(ollama), true);

  const lab = manager.normalizeProvider({ id: 'lab', name: 'Lab box', baseUrl: 'http://192.168.1.20:8000/v1', model: 'mistral' });
  assert.equal(lab.requiresKey, false);
  assert.equal(manager.isConfigured(lab), true);

  const remote = manager.normalizeProvider({ id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' });
  assert.equal(remote.requiresKey, true);
  assert.equal(manager.isConfigured(remote), false);
});

test('host detection recognises loopback, LAN and .local names only', () => {
  assert.equal(isLocalHostUrl('http://127.0.0.1:11434'), true);
  assert.equal(isLocalHostUrl('http://localhost:11434/v1'), true);
  assert.equal(isLocalHostUrl('http://10.0.0.142:11434'), true);
  assert.equal(isLocalHostUrl('http://172.20.1.5:11434'), true);
  assert.equal(isLocalHostUrl('http://ollama.local:11434'), true);
  assert.equal(isLocalHostUrl('https://openrouter.ai/api/v1'), false);
  assert.equal(isLocalHostUrl('http://172.40.1.5:11434'), false);
});

test('native Ollama endpoints keep the root base URL and list models from /api/tags', () => {
  const manager = newManager();
  const native = manager.normalizeProvider({
    id: 'ollama',
    baseUrl: `${OLLAMA_URL}/v1`,
    endpointPath: '/api/chat',
    model: 'llama3.2:latest'
  });
  assert.equal(native.baseUrl, OLLAMA_URL);
  assert.equal(manager.endpoint(native), `${OLLAMA_URL}/api/chat`);
  assert.equal(manager.modelsEndpoint(native), `${OLLAMA_URL}/api/tags`);
  assert.equal(isOllamaNative(native), true);

  const compatible = manager.normalizeProvider({ id: 'ollama', baseUrl: OLLAMA_URL, endpointPath: '/chat/completions', model: 'llama3.2:latest' });
  assert.equal(manager.modelsEndpoint(compatible), `${OLLAMA_URL}/v1/models`);
  assert.equal(isOllamaNative(compatible), false);
});

test('chat bodies match each API family', () => {
  const manager = newManager();
  const messages = [{ role: 'user', content: 'hello' }];
  const native = manager.normalizeProvider({ id: 'ollama', baseUrl: OLLAMA_URL, endpointPath: '/api/chat', model: 'llama3.2' });
  const nativeBody = manager.buildChatBody(native, { messages, maxTokens: 700, json: true, temperature: 0.4 });
  assert.equal(nativeBody.options.num_predict, 700);
  assert.equal(nativeBody.options.temperature, 0.4);
  assert.equal(nativeBody.format, 'json');
  assert.equal(nativeBody.max_tokens, undefined);
  assert.equal(nativeBody.response_format, undefined);

  const compatible = manager.normalizeProvider({ id: 'ollama', baseUrl: OLLAMA_URL, endpointPath: '/chat/completions', model: 'llama3.2' });
  const openAiBody = manager.buildChatBody(compatible, { messages, maxTokens: 500, json: true });
  assert.equal(openAiBody.max_tokens, 500);
  assert.deepEqual(openAiBody.response_format, { type: 'json_object' });
  assert.equal(openAiBody.options, undefined);
});

test('chat replies are read from either response shape', () => {
  const manager = newManager();
  const native = manager.normalizeProvider({ id: 'ollama', baseUrl: OLLAMA_URL, endpointPath: '/api/chat', model: 'llama3.2' });
  assert.deepEqual(
    manager.chatMessage(native, { message: { content: 'native text', reasoning: 'why' } }),
    { content: 'native text', reasoning: 'why' }
  );
  const compatible = manager.normalizeProvider({ id: 'ollama', baseUrl: OLLAMA_URL, endpointPath: '/chat/completions', model: 'llama3.2' });
  assert.deepEqual(
    manager.chatMessage(compatible, { choices: [{ message: { content: 'openai text', reasoning_content: 'hidden' } }] }),
    { content: 'openai text', reasoning: 'hidden' }
  );
});

test('model discovery lists Ollama models from /v1/models and /api/tags', async () => {
  const manager = newManager();
  const openai = await mockServer((req, res) => {
    res.writeHead(req.url === '/v1/models' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'llama3.2:latest' }, { id: 'qwen3:8b' }] }));
  });
  const native = await mockServer((req, res) => {
    res.writeHead(req.url === '/api/tags' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:8b' }] }));
  });
  try {
    const compatible = manager.normalizeProvider({ id: 'ollama', baseUrl: openai.url, endpointPath: '/chat/completions', model: 'llama3.2:latest' });
    const listA = await manager.listModels(compatible);
    assert.equal(listA.ok, true);
    assert.deepEqual(listA.models, ['llama3.2:latest', 'qwen3:8b']);
    assert.equal(listA.currentModelAvailable, true);

    const nativeProvider = manager.normalizeProvider({ id: 'ollama', baseUrl: native.url, endpointPath: '/api/chat', model: 'missing:model' });
    const listB = await manager.listModels(nativeProvider);
    assert.equal(listB.ok, true);
    assert.deepEqual(listB.models, ['llama3.2:latest', 'qwen3:8b']);
    assert.equal(listB.currentModelAvailable, false);
  } finally {
    await openai.close();
    await native.close();
  }
});

test('model discovery reports HTTP errors, timeouts and unreachable hosts', async () => {
  const manager = newManager();
  const failing = await mockServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'model not found' }));
  });
  const slow = await mockServer(() => {});
  const provider = (url) => manager.normalizeProvider({ id: 'ollama', baseUrl: url, endpointPath: '/chat/completions', model: 'llama3.2' });
  try {
    const missing = await manager.listModels(provider(failing.url));
    assert.equal(missing.ok, false);
    assert.equal(missing.httpStatus, 404);
    assert.match(missing.error, /HTTP 404/);

    const timeout = await manager.listModels(provider(slow.url), { timeoutMs: 200 });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.timeout, true);
    assert.match(timeout.error, /timed out/);

    const closed = await mockServer(() => {});
    const closedUrl = closed.url;
    await closed.close();
    const refused = await manager.listModels(provider(closedUrl));
    assert.equal(refused.ok, false);
    assert.match(refused.error, /unreachable/);
  } finally {
    await failing.close();
    await slow.close();
  }
});

test('Ollama becomes primary and survives a manager restart', () => {
  const state = { reactive: {} };
  const dataDir = tempDir();
  const manager = newManager(state, dataDir);
  const saved = manager.saveProvider({
    id: 'ollama',
    name: 'Ollama',
    baseUrl: OLLAMA_URL,
    endpointPath: '/chat/completions',
    model: 'llama3.2:latest',
    requiresKey: true,
    timeoutMs: 45000,
    maxTokens: 1800
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.provider.requiresKey, false);
  assert.equal(saved.provider.endpoint, `${OLLAMA_URL}/v1/chat/completions`);
  assert.equal(manager.setPrimary('ollama').ok, true);
  manager.toggle('openrouter', false);

  const restarted = newManager(state, dataDir);
  const publicOllama = restarted.publicProvider(restarted.get('ollama'));
  assert.equal(publicOllama.keyMask, 'Not required');
  assert.equal(publicOllama.requiresKey, false);
  assert.equal(restarted.primaryProvider().id, 'ollama');
  assert.equal(restarted.get('ollama').enabled, true);
  assert.equal(restarted.get('openrouter').enabled, false);
  assert.equal(restarted.get('openrouter').baseUrl, 'https://openrouter.ai/api/v1');
  assert.deepEqual(restarted.candidates().map((item) => item.id), ['ollama']);
});

test('a failing primary still leaves the next configured provider in the chain', () => {
  const state = { reactive: {} };
  const manager = newManager(state, tempDir());
  manager.saveProvider({ id: 'ollama', name: 'Ollama', baseUrl: OLLAMA_URL, endpointPath: '/chat/completions', model: 'llama3.2:latest' });
  // A provider saved without an existing id gets a slug of its name.
  manager.saveProvider({ name: 'lab', baseUrl: 'http://192.168.1.20:8000/v1', model: 'mistral' });
  manager.setPrimary('ollama');
  assert.deepEqual(manager.candidates().map((item) => item.id).slice(0, 2), ['ollama', 'lab']);
});

test('Tarot gives a slow local model more than the seller reply budget', () => {
  const start = SERVER_SOURCE.indexOf('async function tarotAiNarration');
  const end = SERVER_SOURCE.indexOf('const MAX_CEREMONY_PARTS', start);
  const block = SERVER_SOURCE.slice(start, end);
  const match = block.match(/const timeoutMs = Math\.min\((\d+), Math\.max\((\d+)/);
  assert.ok(match, 'tarot AI timeout expression is missing');
  assert.ok(Number(match[1]) >= 45000, `tarot cap ${match[1]}ms is too low for a local model`);
  assert.ok(Number(match[2]) >= 15000);
});

test('server sends Ollama through the provider manager, not a hard-coded OpenAI body', () => {
  assert.match(SERVER_SOURCE, /llmProviders\.buildChatBody\(providerConfig/);
  assert.match(SERVER_SOURCE, /llmProviders\.chatMessage\(providerConfig, data\)/);
  assert.match(SERVER_SOURCE, /llmProviders\.listModels\(provider/);
  const tarotStart = SERVER_SOURCE.indexOf('async function tarotAiNarration');
  const tarotEnd = SERVER_SOURCE.indexOf('const MAX_CEREMONY_PARTS', tarotStart);
  const tarotBlock = SERVER_SOURCE.slice(tarotStart, tarotEnd);
  assert.ok(tarotStart > -1 && tarotEnd > tarotStart);
  assert.match(tarotBlock, /llmProviders\.buildChatBody\(providerConfig/);
  assert.ok(!/data\.choices\[0\]\.message\.content/.test(tarotBlock));
  // Local models need the exact line format spelled out, or they drop labels.
  assert.match(tarotBlock, /Output format is mandatory/);
  assert.match(tarotBlock, /content: prompt \+ formatRule/);
  // An invented card earns one repair attempt before the built-in fallback.
  assert.match(tarotBlock, /Your previous answer was rejected/);
  assert.match(tarotBlock, /unknown_card\|missing_sections\|orientation_conflict/);
  // Conversation retries the strict JSON contract once.
  assert.match(SERVER_SOURCE, /strict: true/);
  assert.match(SERVER_SOURCE, /Return ONLY one valid JSON object/);
});
