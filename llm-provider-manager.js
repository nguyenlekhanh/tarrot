const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ENDPOINT_PATH = '/chat/completions';
const REASONING_MODES = ['auto', 'off'];
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE = 400;
const DENIED_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|host|content-length|content-type|connection|transfer-encoding|api-key|x-api-key|.*(?:token|secret|password).*)$/i;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = 'openrouter/free';
const TOKENROUTER_BASE_URL = 'https://api.tokenrouter.com/v1';
const TOKENROUTER_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';

function nowIso() {
  return new Date().toISOString();
}

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(min, number)));
}

function safeUrl(value) {
  const raw = String(value || '').trim().slice(0, 300);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function endpointPath(value) {
  let raw = String(value == null ? DEFAULT_ENDPOINT_PATH : value).trim();
  if (!raw) raw = DEFAULT_ENDPOINT_PATH;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      raw = parsed.pathname || DEFAULT_ENDPOINT_PATH;
    } catch (_) {
      return '';
    }
  }
  if (!raw.startsWith('/')) raw = `/${raw}`;
  if (raw.length > 160 || raw.includes('?') || raw.includes('#') || raw.includes('..') || raw.includes('//')) return '';
  raw = raw.replace(/\/+$/, '');
  return raw || '/';
}

function splitBaseAndPath(value, requestedPath) {
  const normalized = safeUrl(value);
  if (!normalized) return { baseUrl: '', endpointPath: endpointPath(requestedPath) };
  if (/\/chat\/completions$/i.test(normalized)) {
    return {
      baseUrl: normalized.replace(/\/chat\/completions$/i, '').replace(/\/+$/, ''),
      endpointPath: endpointPath(requestedPath || DEFAULT_ENDPOINT_PATH)
    };
  }
  return { baseUrl: normalized, endpointPath: endpointPath(requestedPath) };
}

function cleanModel(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:/-]/g, '').slice(0, 120);
}

function cleanName(value, fallback = 'LLM Provider') {
  return String(value || fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{2,64}$/.test(id) ? id : '';
}

function safeHeaders(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const headers = {};
  let count = 0;
  for (const [rawName, rawValue] of Object.entries(source)) {
    if (count >= MAX_HEADERS) break;
    const name = String(rawName || '').trim();
    const value = String(rawValue == null ? '' : rawValue).trim();
    if (!HEADER_NAME_RE.test(name) || DENIED_HEADER_RE.test(name)) continue;
    if (!value || value.length > MAX_HEADER_VALUE || /[\r\n]/.test(value)) continue;
    headers[name] = value;
    count += 1;
  }
  return headers;
}

function slugId(name, existingIds) {
  const base = String(name || 'provider')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') 
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'provider';
  let id = base;
  let index = 2;
  while (existingIds.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function defaultProvider(overrides = {}) {
  const id = cleanId(overrides.id) || 'provider';
  return {
    id,
    name: cleanName(overrides.name, id),
    baseUrl: '',
    endpointPath: DEFAULT_ENDPOINT_PATH,
    model: '',
    enabled: true,
    requiresKey: true,
    timeoutMs: 8000,
    maxTokens: 600,
    jsonMode: true,
    reasoningMode: 'auto',
    headers: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides
  };
}

function initialProviders(legacyProvider = 'openrouter') {
  const openrouter = defaultProvider({
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: OPENROUTER_BASE_URL,
    model: OPENROUTER_MODEL,
    enabled: true,
    timeoutMs: 8000,
    maxTokens: 2000,
    jsonMode: true,
    reasoningMode: 'auto'
  });
  const tokenrouter = defaultProvider({
    id: 'tokenrouter',
    name: 'TokenRouter',
    baseUrl: TOKENROUTER_BASE_URL,
    model: TOKENROUTER_MODEL,
    enabled: true,
    timeoutMs: 15000,
    maxTokens: 1200,
    jsonMode: true,
    reasoningMode: 'auto'
  });
  const providers = [openrouter, tokenrouter];
  let primaryProviderId = 'openrouter';
  const fallbackProviderIds = ['tokenrouter'];

  if (legacyProvider === 'openai') {
    providers.unshift(defaultProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      enabled: true,
      timeoutMs: 8000,
      maxTokens: 600,
      jsonMode: true,
      reasoningMode: 'auto'
    }));
    primaryProviderId = 'openai';
    fallbackProviderIds.unshift('openrouter');
  } else if (legacyProvider === 'ollama') {
    providers.unshift(defaultProvider({
      id: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2',
      enabled: true,
      requiresKey: false,
      timeoutMs: 15000,
      maxTokens: 600,
      jsonMode: false,
      reasoningMode: 'auto'
    }));
    primaryProviderId = 'ollama';
    fallbackProviderIds.unshift('openrouter');
  }
  return { providers, primaryProviderId, fallbackProviderIds };
}

class LlmProviderManager {
  constructor({ state, dataDir, env = process.env, saveState = () => {} }) {
    this.state = state;
    this.dataDir = dataDir;
    this.env = env;
    this.saveState = saveState;
    this.secretsFile = path.join(dataDir, 'llm-secrets.json');
    this.healthFile = path.join(dataDir, 'llm-health.json');
    this.secrets = this._readJson(this.secretsFile, { version: 1, providers: {} });
    this.health = this._readJson(this.healthFile, { version: 1, providers: {}, fallbackEvents: 0 });
    if (!this.secrets.providers || typeof this.secrets.providers !== 'object') this.secrets = { version: 1, providers: {} };
    if (!this.health.providers || typeof this.health.providers !== 'object') this.health = { version: 1, providers: {}, fallbackEvents: 0 };
    this.ensure();
  }

  _readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (err) {
      console.warn(`[LLM] Could not read ${path.basename(file)}:`, err.message);
      return fallback;
    }
  }

  _writeJson(file, value, mode) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode });
      fs.renameSync(temp, file);
    } catch (err) {
      console.error(`[LLM] Could not write ${path.basename(file)}:`, err.message);
    }
  }

  get manager() {
    if (!this.state.reactive || typeof this.state.reactive !== 'object') this.state.reactive = {};
    if (!this.state.reactive.llmManager || typeof this.state.reactive.llmManager !== 'object') {
      this._seed();
    }
    return this.state.reactive.llmManager;
  }

  _seed(legacyProvider) {
    const legacy = legacyProvider || (this.state.reactive && this.state.reactive.settings && this.state.reactive.settings.provider) || 'openrouter';
    const initial = initialProviders(legacy);
    this.state.reactive.llmManager = {
      version: 1,
      providers: initial.providers,
      primaryProviderId: initial.primaryProviderId,
      fallbackProviderIds: initial.fallbackProviderIds,
      maxAttempts: 3,
      seededAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  ensure() {
    if (!this.state.reactive || typeof this.state.reactive !== 'object') this.state.reactive = {};
    if (!this.state.reactive.llmManager || typeof this.state.reactive.llmManager !== 'object') this._seed();
    let manager = this.state.reactive.llmManager;
    const ids = new Set();
    const providers = [];
    for (const raw of Array.isArray(manager.providers) ? manager.providers : []) {
      const normalized = this.normalizeProvider(raw);
      if (!normalized || ids.has(normalized.id)) continue;
      ids.add(normalized.id);
      providers.push(normalized);
    }
    if (!providers.length) {
      this._seed();
      manager = this.state.reactive.llmManager;
    } else {
      manager.providers = providers;
    }
    const validIds = new Set(manager.providers.map((provider) => provider.id));
    if (!validIds.has(manager.primaryProviderId)) {
      manager.primaryProviderId = manager.providers.find((provider) => provider.enabled)?.id || manager.providers[0]?.id || null;
    }
    manager.fallbackProviderIds = [...new Set(Array.isArray(manager.fallbackProviderIds) ? manager.fallbackProviderIds : [])]
      .filter((id) => id !== manager.primaryProviderId && validIds.has(id));
    for (const provider of manager.providers) {
      if (provider.id !== manager.primaryProviderId && !manager.fallbackProviderIds.includes(provider.id)) {
        manager.fallbackProviderIds.push(provider.id);
      }
    }
    manager.maxAttempts = integer(manager.maxAttempts, 3, 1, 10);
    manager.updatedAt = manager.updatedAt || nowIso();
    return manager;
  }

  normalizeProvider(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = cleanId(raw.id);
    if (!id) return null;
    const baseAndPath = splitBaseAndPath(raw.baseUrl, raw.endpointPath);
    const pathValue = baseAndPath.endpointPath;
    if (!pathValue) return null;
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(?::|\/|$)/i.test(baseAndPath.baseUrl);
    return {
      id,
      name: cleanName(raw.name, id),
      baseUrl: baseAndPath.baseUrl,
      endpointPath: pathValue,
      model: cleanModel(raw.model),
      enabled: raw.enabled !== false,
      requiresKey: raw.requiresKey !== false && id !== 'ollama' && !isLocal ? true : raw.requiresKey === true,
      timeoutMs: integer(raw.timeoutMs, id === 'tokenrouter' ? 15000 : 8000, 3000, 60000),
      maxTokens: integer(raw.maxTokens, id === 'tokenrouter' ? 1200 : 600, 128, 8000),
      jsonMode: raw.jsonMode !== false,
      reasoningMode: REASONING_MODES.includes(raw.reasoningMode) ? raw.reasoningMode : (id === 'openrouter' ? 'off' : 'auto'),
      headers: safeHeaders(raw.headers),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
      updatedAt: nowIso()
    };
  }

  _keyEnvNames(provider) {
    if (!provider || provider.requiresKey === false) return [];
    if (provider.id === 'openrouter') return ['REACTIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'];
    if (provider.id === 'tokenrouter') return ['TOKENROUTER_API_KEY'];
    if (provider.id === 'openai') return ['OPENAI_API_KEY'];
    return [`LLM_${provider.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`];
  }

  _masterKey() {
    const secret = String(this.env.LLM_SECRETS_MASTER_KEY || '').trim();
    if (!secret) return null;
    return crypto.createHash('sha256').update(secret).digest();
  }

  get hasMasterSecret() {
    return Boolean(this._masterKey());
  }

  _storedSecret(id) {
    const record = this.secrets.providers && this.secrets.providers[id];
    if (!record) return '';
    const master = this._masterKey();
    if (!master) return '';
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', master, Buffer.from(record.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8').trim();
    } catch (err) {
      console.warn('[LLM] Stored key could not be decrypted for', id);
      return '';
    }
  }

  keyFor(provider) {
    if (!provider) return { key: '', source: 'none', envName: '' };
    const stored = this._storedSecret(provider.id);
    if (stored) return { key: stored, source: 'stored', envName: '' };
    for (const envName of this._keyEnvNames(provider)) {
      const key = String(this.env[envName] || '').trim();
      if (key) return { key, source: 'environment', envName };
    }
    return { key: '', source: provider.requiresKey === false ? 'not_required' : 'none', envName: '' };
  }

  saveKey(id, value) {
    const provider = this.get(id);
    if (!provider) return { ok: false, error: 'Provider not found' };
    const key = String(value || '').trim();
    if (!key) return { ok: false, error: 'API key is empty' };
    if (key.length > 4096 || /[\r\n]/.test(key)) return { ok: false, error: 'API key is invalid' };
    const master = this._masterKey();
    if (!master) return { ok: false, error: 'LLM_SECRETS_MASTER_KEY is not set on the server; refusing to store a key.' };
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', master, iv);
      const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
      this.secrets.providers[id] = {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64'),
        savedAt: nowIso()
      };
      this._writeJson(this.secretsFile, this.secrets, 0o600);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Could not encrypt the API key' };
    }
  }

  deleteKey(id) {
    if (!this.secrets.providers || !this.secrets.providers[id]) return { ok: false, error: 'No saved key for this provider' };
    delete this.secrets.providers[id];
    this._writeJson(this.secretsFile, this.secrets, 0o600);
    return { ok: true };
  }

  get(id) {
    return this.ensure().providers.find((provider) => provider.id === id) || null;
  }

  list() {
    return this.ensure().providers;
  }

  isConfigured(provider) {
    if (!provider || !provider.baseUrl || !provider.model || !provider.endpointPath) return false;
    if (provider.requiresKey && !this.keyFor(provider).key) return false;
    return true;
  }

  endpoint(provider) {
    if (!provider || !provider.baseUrl) return '';
    return `${provider.baseUrl}${provider.endpointPath === '/' ? '' : provider.endpointPath}`;
  }

  modelsEndpoint(provider) {
    if (!provider || !provider.baseUrl) return '';
    return `${provider.baseUrl}/models`;
  }

  _healthEntry(id) {
    if (!this.health.providers[id]) {
      this.health.providers[id] = {
        attempts: 0,
        successfulRequests: 0,
        failedRequests: 0,
        fallbackCount: 0,
        totalLatencyMs: 0,
        latencySamples: 0,
        lastHttpStatus: null,
        lastLatencyMs: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastTestAt: null,
        lastSuccessfulTest: null,
        lastError: '',
        lastModel: ''
      };
    }
    return this.health.providers[id];
  }

  recordAttempt(id, result = {}) {
    const entry = this._healthEntry(id);
    entry.attempts += 1;
    if (result.httpStatus !== null && result.httpStatus !== undefined && Number.isFinite(Number(result.httpStatus)) && Number(result.httpStatus) > 0) {
      entry.lastHttpStatus = Number(result.httpStatus);
    }
    if (Number.isFinite(Number(result.latencyMs))) {
      entry.lastLatencyMs = Math.max(0, Math.round(Number(result.latencyMs)));
      entry.totalLatencyMs += entry.lastLatencyMs;
      entry.latencySamples += 1;
    }
    if (result.model) entry.lastModel = String(result.model).slice(0, 120);
    if (result.test) entry.lastTestAt = nowIso();
    if (result.ok) {
      entry.successfulRequests += 1;
      entry.lastSuccessAt = nowIso();
      if (result.test) entry.lastSuccessfulTest = entry.lastSuccessAt;
      if (result.fallback) entry.fallbackCount += 1;
    } else {
      entry.failedRequests += 1;
      entry.lastErrorAt = nowIso();
      entry.lastError = String(result.error || 'Provider request failed').slice(0, 220);
    }
    this._writeJson(this.healthFile, this.health, 0o600);
  }

  recordFallbackEvent() {
    this.health.fallbackEvents = Number(this.health.fallbackEvents || 0) + 1;
    this._writeJson(this.healthFile, this.health, 0o600);
  }

  _healthFor(provider, key) {
    const entry = this._healthEntry(provider.id);
    let status = 'not_tested';
    if (!provider.enabled) status = 'disabled';
    else if (!provider.baseUrl || !provider.model) status = 'not_configured';
    else if (provider.requiresKey && !key) status = 'missing_key';
    else if (entry.attempts > 0) {
      const lastErrorAt = entry.lastErrorAt ? Date.parse(entry.lastErrorAt) : 0;
      const lastSuccessAt = entry.lastSuccessAt ? Date.parse(entry.lastSuccessAt) : 0;
      if (entry.lastError && (!lastSuccessAt || lastErrorAt > lastSuccessAt)) status = 'error';
      else if (entry.successfulRequests > 0) status = 'healthy';
      else if (entry.lastError) status = 'degraded';
      else status = 'error';
    }
    return {
      status,
      attempts: entry.attempts,
      successfulRequests: entry.successfulRequests,
      failedRequests: entry.failedRequests,
      fallbackCount: entry.fallbackCount,
      averageLatencyMs: entry.latencySamples ? Math.round(entry.totalLatencyMs / entry.latencySamples) : null,
      lastHttpStatus: entry.lastHttpStatus,
      lastLatencyMs: entry.lastLatencyMs,
      lastSuccessAt: entry.lastSuccessAt,
      lastErrorAt: entry.lastErrorAt,
      lastTestAt: entry.lastTestAt,
      lastSuccessfulTest: entry.lastSuccessfulTest,
      lastError: entry.lastError,
      lastModel: entry.lastModel
    };
  }

  publicProvider(provider) {
    if (!provider) return null;
    const key = this.keyFor(provider);
    const health = this._healthFor(provider, key.key);
    const manager = this.ensure();
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      endpointPath: provider.endpointPath,
      endpoint: this.endpoint(provider),
      model: provider.model,
      enabled: provider.enabled,
      requiresKey: provider.requiresKey,
      timeoutMs: provider.timeoutMs,
      maxTokens: provider.maxTokens,
      jsonMode: provider.jsonMode,
      reasoningMode: provider.reasoningMode,
      headers: { ...provider.headers },
      role: provider.id === manager.primaryProviderId ? 'primary' : manager.fallbackProviderIds.includes(provider.id) ? 'fallback' : 'unassigned',
      fallbackIndex: manager.fallbackProviderIds.indexOf(provider.id),
      keyConfigured: Boolean(key.key),
      keySource: key.source,
      keyEnv: key.envName || '',
      keyMask: key.key ? '•••••••• configured' : provider.requiresKey ? 'Missing' : 'Not required',
      health: health.status,
      ...health,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    };
  }

  primaryProvider() {
    const manager = this.ensure();
    return this.get(manager.primaryProviderId);
  }

  activeProvider() {
    const manager = this.ensure();
    const primary = this.get(manager.primaryProviderId);
    if (primary && primary.enabled) return primary;
    for (const id of manager.fallbackProviderIds) {
      const provider = this.get(id);
      if (provider && provider.enabled) return provider;
    }
    return primary || this.list()[0] || null;
  }

  candidates() {
    const manager = this.ensure();
    const ordered = [];
    const primary = this.get(manager.primaryProviderId);
    if (primary && primary.enabled) ordered.push(primary);
    for (const id of manager.fallbackProviderIds) {
      const provider = this.get(id);
      if (provider && provider.enabled && !ordered.some((item) => item.id === provider.id)) ordered.push(provider);
    }
    if (!ordered.length) {
      const fallback = this.list().find((provider) => provider.enabled);
      if (fallback) ordered.push(fallback);
    }
    // A missing credential on the first provider must be reported, never hidden
    // by silently switching credentials. Later missing-key fallbacks are skipped.
    const first = ordered[0];
    const usable = first && !this.isConfigured(first) ? [first] : ordered.filter((provider) => this.isConfigured(provider));
    return usable.slice(0, manager.maxAttempts);
  }

  snapshot() {
    const manager = this.ensure();
    const providers = manager.providers.map((provider) => this.publicProvider(provider));
    const active = this.activeProvider();
    const activePublic = active ? this.publicProvider(active) : null;
    return {
      providers,
      primaryProviderId: manager.primaryProviderId,
      fallbackProviderIds: [...manager.fallbackProviderIds],
      activeProviderId: active ? active.id : null,
      activeProvider: activePublic ? activePublic.name : '',
      activeModel: activePublic ? activePublic.model : '',
      activeHealth: activePublic ? activePublic.health : 'not_configured',
      activeEndpoint: activePublic ? activePublic.endpoint : '',
      maxAttempts: manager.maxAttempts,
      fallbackEvents: Number(this.health.fallbackEvents || 0),
      secretsEncryptionAvailable: this.hasMasterSecret,
      updatedAt: manager.updatedAt || null
    };
  }

  saveProvider(raw = {}, apiKey) {
    const manager = this.ensure();
    const source = raw && typeof raw === 'object' ? raw : {};
    if (String(apiKey || '').trim() && !this.hasMasterSecret) {
      return { ok: false, error: 'LLM_SECRETS_MASTER_KEY is not set on the server; refusing to store a key.' };
    }
    const existing = source.id ? this.get(cleanId(source.id)) : null;
    const existingIds = new Set(manager.providers.map((provider) => provider.id));
    const name = cleanName(source.name, existing ? existing.name : 'New Provider');
    const id = existing ? existing.id : slugId(name, existingIds);
    const split = splitBaseAndPath(source.baseUrl, source.endpointPath);
    if (!split.baseUrl) return { ok: false, error: 'Base URL must be a valid http(s) URL without credentials, a query or a fragment.' };
    if (!split.endpointPath) return { ok: false, error: 'Endpoint path is invalid.' };
    const model = cleanModel(source.model);
    if (!model) return { ok: false, error: 'Model ID is required.' };
    const config = this.normalizeProvider({
      ...(existing || {}),
      ...source,
      id,
      name,
      baseUrl: split.baseUrl,
      endpointPath: split.endpointPath,
      model,
      createdAt: existing ? existing.createdAt : nowIso()
    });
    if (!config) return { ok: false, error: 'Provider configuration is invalid.' };
    if (existing) {
      const index = manager.providers.findIndex((provider) => provider.id === id);
      manager.providers[index] = config;
    } else {
      manager.providers.push(config);
      manager.fallbackProviderIds.push(id);
    }
    if (String(apiKey || '').trim()) {
      const saved = this.saveKey(id, apiKey);
      if (!saved.ok) return saved;
    }
    manager.updatedAt = nowIso();
    this.saveState();
    return { ok: true, provider: this.publicProvider(config) };
  }

  deleteProvider(id) {
    const manager = this.ensure();
    const provider = this.get(cleanId(id));
    if (!provider) return { ok: false, error: 'Provider not found' };
    manager.providers = manager.providers.filter((item) => item.id !== provider.id);
    manager.fallbackProviderIds = manager.fallbackProviderIds.filter((item) => item !== provider.id);
    if (this.secrets.providers && this.secrets.providers[provider.id]) {
      delete this.secrets.providers[provider.id];
      this._writeJson(this.secretsFile, this.secrets, 0o600);
    }
    if (this.health.providers && this.health.providers[provider.id]) {
      delete this.health.providers[provider.id];
      this._writeJson(this.healthFile, this.health, 0o600);
    }
    if (manager.primaryProviderId === provider.id) {
      manager.primaryProviderId = this.list().find((item) => item.enabled)?.id || this.list()[0]?.id || null;
      manager.fallbackProviderIds = manager.fallbackProviderIds.filter((item) => item !== manager.primaryProviderId);
    }
    manager.updatedAt = nowIso();
    this.saveState();
    return { ok: true };
  }

  setPrimary(id) {
    const manager = this.ensure();
    const provider = this.get(cleanId(id));
    if (!provider) return { ok: false, error: 'Provider not found' };
    const previous = manager.primaryProviderId;
    if (previous !== provider.id && previous) {
      manager.fallbackProviderIds = [previous, ...manager.fallbackProviderIds.filter((item) => item !== previous && item !== provider.id)];
    }
    manager.primaryProviderId = provider.id;
    provider.enabled = true;
    manager.fallbackProviderIds = [...new Set(manager.fallbackProviderIds.filter((item) => item !== provider.id))];
    manager.updatedAt = nowIso();
    this.saveState();
    return { ok: true };
  }

  setFallback(id) {
    const manager = this.ensure();
    const provider = this.get(cleanId(id));
    if (!provider) return { ok: false, error: 'Provider not found' };
    if (manager.primaryProviderId === provider.id) return { ok: false, error: 'Choose another provider as Primary before moving this one to Fallback.' };
    provider.enabled = true;
    manager.fallbackProviderIds = [...new Set([...manager.fallbackProviderIds, provider.id])];
    manager.updatedAt = nowIso();
    this.saveState();
    return { ok: true };
  }

  toggle(id, enabled) {
    const provider = this.get(cleanId(id));
    if (!provider) return { ok: false, error: 'Provider not found' };
    provider.enabled = Boolean(enabled);
    provider.updatedAt = nowIso();
    this.ensure().updatedAt = nowIso();
    this.saveState();
    return { ok: true };
  }

  updateSettings(raw = {}) {
    const manager = this.ensure();
    if (raw.maxAttempts !== undefined) manager.maxAttempts = integer(raw.maxAttempts, manager.maxAttempts, 1, 10);
    manager.updatedAt = nowIso();
    this.saveState();
    return { ok: true };
  }

  touchActiveLegacy(settings) {
    if (!settings) return;
    const active = this.activeProvider();
    if (!active) return;
    settings.provider = ['openrouter', 'openai', 'ollama'].includes(active.id) ? active.id : 'openai';
    settings.baseUrl = active.baseUrl;
    settings.model = active.model;
    settings.timeoutMs = active.timeoutMs;
  }
}

module.exports = {
  LlmProviderManager,
  DEFAULT_ENDPOINT_PATH,
  REASONING_MODES,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  TOKENROUTER_BASE_URL,
  TOKENROUTER_MODEL,
  safeHeaders,
  endpointPath
};