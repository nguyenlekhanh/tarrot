/* Server-side LLM provider manager UI. Keys are never populated from the API. */
var llmUIState = null;

const LLM_HEALTH_LABELS = {
  healthy: 'HEALTHY',
  degraded: 'DEGRADED',
  error: 'ERROR',
  not_tested: 'NOT TESTED',
  disabled: 'DISABLED',
  missing_key: 'KEY MISSING',
  not_configured: 'NOT CONFIGURED'
};

function llmProviderById(id) {
  return llmUIState && Array.isArray(llmUIState.providers)
    ? llmUIState.providers.find((provider) => provider.id === id) || null
    : null;
}

function llmDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function llmRoleLabel(provider) {
  if (provider.role === 'primary') return 'PRIMARY';
  if (provider.role === 'fallback') return `FALLBACK ${Number(provider.fallbackIndex) + 1}`;
  return 'UNASSIGNED';
}

function llmHealthLabel(health) {
  return LLM_HEALTH_LABELS[health] || String(health || 'unknown').toUpperCase();
}

function llmProviderCard(provider) {
  const health = String(provider.health || 'not_tested');
  const role = llmRoleLabel(provider);
  const headers = provider.headers && Object.keys(provider.headers).length
    ? Object.keys(provider.headers).join(', ')
    : 'None';
  const keyDetail = provider.keyConfigured
    ? `${provider.keyMask}${provider.keyEnv ? ` · ${provider.keyEnv}` : ''}`
    : provider.requiresKey ? 'Missing' : 'Not required';
  const lastError = provider.lastError
    ? `<div class="llm-error" title="${escapeHtml(provider.lastError)}">${escapeHtml(String(provider.lastError).slice(0, 160))}</div>`
    : '';
  return `<article class="llm-provider-card ${provider.role === 'primary' ? 'primary' : ''} ${provider.enabled ? '' : 'disabled'}" data-llm-id="${escapeHtml(provider.id)}">
    <div class="llm-provider-head">
      <strong>${escapeHtml(provider.name)}</strong>
      <span class="llm-role">${escapeHtml(role)}</span>
      <span class="llm-health ${escapeHtml(health)}">${escapeHtml(llmHealthLabel(health))}</span>
    </div>
    <div class="llm-kv">
      <span>Model</span><span>${escapeHtml(provider.model || '—')}</span>
      <span>Base URL</span><span>${escapeHtml(provider.baseUrl || '—')}</span>
      <span>Endpoint</span><span>${escapeHtml(provider.endpoint || '—')}</span>
      <span>API key</span><span>${escapeHtml(keyDetail)}</span>
      <span>State</span><span>${provider.enabled ? 'Enabled' : 'Disabled'} · ${provider.requiresKey ? 'key required' : 'key optional'}</span>
      <span>Last HTTP</span><span>${provider.lastHttpStatus == null ? '—' : Number(provider.lastHttpStatus)}</span>
      <span>Latency</span><span>${provider.lastLatencyMs == null ? '—' : `${Number(provider.lastLatencyMs)} ms`}${provider.averageLatencyMs == null ? '' : ` · avg ${Number(provider.averageLatencyMs)} ms`}</span>
      <span>Last success</span><span>${escapeHtml(llmDate(provider.lastSuccessAt))}</span>
      <span>Last test</span><span>${escapeHtml(llmDate(provider.lastTestAt))}</span>
      <span>Last successful test</span><span>${escapeHtml(llmDate(provider.lastSuccessfulTest))}</span>
      <span>Success / failed</span><span>${Number(provider.successfulRequests || 0)} / ${Number(provider.failedRequests || 0)}</span>
      <span>Fallback count</span><span>${Number(provider.fallbackCount || 0)}</span>
      <span>Headers</span><span>${escapeHtml(headers)}</span>
    </div>
    ${lastError}
    <div class="llm-actions">
      <button class="btn" data-llm-action="test" type="button">🔌 Test</button>
      <button class="btn" data-llm-action="edit" type="button">✏️ Edit</button>
      <button class="btn" data-llm-action="toggle" type="button">${provider.enabled ? '⏸ Disable' : '▶ Enable'}</button>
      <button class="btn" data-llm-action="primary" type="button" ${provider.role === 'primary' ? 'disabled' : ''}>★ Set Primary</button>
      <button class="btn" data-llm-action="fallback" type="button" ${provider.role === 'primary' ? 'disabled' : ''}>↳ Set Fallback</button>
      <button class="btn" data-llm-action="models" type="button">🔎 Models</button>
      ${provider.keySource === 'stored' ? '<button class="btn danger" data-llm-action="deleteKey" type="button">🗑 Saved Key</button>' : ''}
      <button class="btn danger" data-llm-action="delete" type="button">🗑 Delete</button>
    </div>
  </article>`;
}

function renderLlmManager(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.providers)) return;
  llmUIState = snapshot;
  const activeName = document.getElementById('llmActiveName');
  const activeMeta = document.getElementById('llmActiveMeta');
  if (activeName) activeName.textContent = snapshot.activeProvider || 'No active provider';
  if (activeMeta) {
    activeMeta.textContent = snapshot.activeProvider
      ? `${snapshot.activeModel || 'no model'} · ${llmHealthLabel(snapshot.activeHealth)} · ${snapshot.activeEndpoint || 'not configured'}`
      : 'No provider is enabled or configured.';
  }
  const maxAttempts = document.getElementById('llmMaxAttempts');
  if (maxAttempts && document.activeElement !== maxAttempts) maxAttempts.value = String(snapshot.maxAttempts || 3);
  const grid = document.getElementById('llmProviderGrid');
  if (grid) {
    grid.innerHTML = snapshot.providers.length
      ? snapshot.providers.map(llmProviderCard).join('')
      : '<div class="hint">No providers yet. Add one above.</div>';
  }
}

function llmEditorResult(value) {
  const output = document.getElementById('llmEditorResult');
  if (output) output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function llmProviderResult(value) {
  const output = document.getElementById('llmProviderResult');
  if (output) output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function llmSetEditorMessage(value, isError) {
  const hint = document.getElementById('llmManagerHint');
  if (hint) {
    hint.textContent = value;
    hint.classList.toggle('llm-error', Boolean(isError));
  }
}

function llmOpenEditor(id) {
  const provider = id ? llmProviderById(id) : null;
  const editor = document.getElementById('llmProviderEditor');
  const title = document.getElementById('llmEditorTitle');
  if (!editor) return;
  const set = (field, value) => {
    const el = document.getElementById(field);
    if (el) el.value = value == null ? '' : String(value);
  };
  const check = (field, value) => {
    const el = document.getElementById(field);
    if (el) el.checked = Boolean(value);
  };
  set('llmFormId', provider ? provider.id : '');
  set('llmFormName', provider ? provider.name : '');
  set('llmFormBase', provider ? provider.baseUrl : '');
  set('llmFormPath', provider ? provider.endpointPath : '/chat/completions');
  set('llmFormModel', provider ? provider.model : '');
  set('llmFormKey', '');
  set('llmFormTimeout', provider ? provider.timeoutMs : 8000);
  set('llmFormMaxTokens', provider ? provider.maxTokens : 600);
  set('llmFormReasoning', provider ? provider.reasoningMode : 'auto');
  set('llmFormHeaders', provider && Object.keys(provider.headers || {}).length ? JSON.stringify(provider.headers, null, 2) : '');
  check('llmFormJson', provider ? provider.jsonMode !== false : true);
  check('llmFormRequiresKey', provider ? provider.requiresKey !== false : true);
  check('llmFormEnabled', provider ? provider.enabled !== false : true);
  const key = document.getElementById('llmFormKey');
  if (key) key.placeholder = provider ? 'Leave blank to keep the current key' : 'Encrypted on the server';
  const deleteKey = document.getElementById('btnLlmDeleteKey');
  if (deleteKey) deleteKey.disabled = !provider || provider.keySource !== 'stored';
  const fetchModels = document.getElementById('btnLlmFetchModels');
  if (fetchModels) fetchModels.disabled = !provider;
  const models = document.getElementById('llmModelOptions');
  if (models) { models.hidden = true; models.innerHTML = ''; }
  if (title) title.textContent = provider ? `✏️ Edit ${provider.name}` : '➕ Add provider';
  editor.open = true;
  llmEditorResult('No provider test yet.');
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function llmRpc(method, params) {
  try {
    const data = await sendRpc(method, params || {});
    return data && data.result ? data.result : { ok: false, error: (data && data.error && data.error.message) || 'No RPC response' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'RPC request failed' };
  }
}

function llmApplyResult(result) {
  if (result && result.llm) renderLlmManager(result.llm);
  if (result && result.reactive) renderReactive(result.reactive);
}

async function llmAction(action, id) {
  const provider = llmProviderById(id);
  if (!provider) return;
  let result;
  if (action === 'edit') {
    llmOpenEditor(id);
    return;
  }
  if (action === 'test') {
    llmProviderResult('Testing provider with a real structured request…');
    result = await llmRpc('llm.test', { id });
    llmProviderResult({
      ok: result.ok,
      notTested: result.notTested,
      message: result.message,
      error: result.error,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      model: result.model,
      endpoint: result.endpoint,
      sample: result.sample
    });
    llmSetEditorMessage(result.ok ? `${provider.name} connection successful.` : result.error || 'Provider test failed.', !result.ok);
  } else if (action === 'toggle') {
    result = await llmRpc('llm.toggleProvider', { id, enabled: !provider.enabled });
  } else if (action === 'primary') {
    result = await llmRpc('llm.setPrimary', { id });
  } else if (action === 'fallback') {
    result = await llmRpc('llm.setFallback', { id });
  } else if (action === 'delete') {
    if (!confirm(`Delete ${provider.name}? Its saved key and health statistics will also be removed.`)) return;
    result = await llmRpc('llm.deleteProvider', { id });
  } else if (action === 'deleteKey') {
    if (!confirm(`Delete the saved key for ${provider.name}?`)) return;
    result = await llmRpc('llm.deleteKey', { id });
  } else if (action === 'models') {
    llmProviderResult('Fetching models…');
    result = await llmRpc('llm.fetchModels', { id });
    llmProviderResult(result);
    llmSetEditorMessage(result.ok ? `${provider.name}: ${result.count} models returned.` : result.error || 'Model fetch failed.', !result.ok);
    return;
  }
  if (!result) return;
  if (!result.ok) llmSetEditorMessage(result.error || 'Provider action failed.', true);
  else llmSetEditorMessage('Provider manager updated.', false);
  llmApplyResult(result);
}

async function llmSaveProvider() {
  const value = (id) => document.getElementById(id);
  const headersText = value('llmFormHeaders').value.trim();
  let headers = {};
  if (headersText) {
    try {
      headers = JSON.parse(headersText);
    } catch (_) {
      llmEditorResult({ ok: false, error: 'Custom headers must be valid JSON.' });
      return;
    }
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      llmEditorResult({ ok: false, error: 'Custom headers must be a JSON object.' });
      return;
    }
  }
  const provider = {
    id: value('llmFormId').value.trim() || undefined,
    name: value('llmFormName').value.trim(),
    baseUrl: value('llmFormBase').value.trim(),
    endpointPath: value('llmFormPath').value.trim(),
    model: value('llmFormModel').value.trim(),
    timeoutMs: Number(value('llmFormTimeout').value),
    maxTokens: Number(value('llmFormMaxTokens').value),
    reasoningMode: value('llmFormReasoning').value,
    jsonMode: value('llmFormJson').checked,
    requiresKey: value('llmFormRequiresKey').checked,
    enabled: value('llmFormEnabled').checked,
    headers
  };
  const apiKey = value('llmFormKey').value;
  if (!provider.name || !provider.baseUrl || !provider.model) {
    llmEditorResult({ ok: false, error: 'Provider name, base URL and model are required.' });
    return;
  }
  const result = await llmRpc('llm.saveProvider', { provider, apiKey });
  llmEditorResult({
    ok: result.ok,
    error: result.error,
    provider: result.provider
  });
  if (result.ok) {
    value('llmFormKey').value = '';
    if (result.provider && result.provider.id) value('llmFormId').value = result.provider.id;
    llmSetEditorMessage(result.provider ? `${result.provider.name} saved.` : 'Provider saved.', false);
    llmApplyResult(result);
    const saved = result.provider ? llmProviderById(result.provider.id) : null;
    if (saved) {
      document.getElementById('llmEditorTitle').textContent = `✏️ Edit ${saved.name}`;
      const deleteKey = document.getElementById('btnLlmDeleteKey');
      if (deleteKey) deleteKey.disabled = saved.keySource !== 'stored';
      const fetchModels = document.getElementById('btnLlmFetchModels');
      if (fetchModels) fetchModels.disabled = false;
    }
  } else {
    llmSetEditorMessage(result.error || 'Provider save failed.', true);
  }
}

async function llmFetchEditorModels() {
  const id = document.getElementById('llmFormId').value.trim();
  if (!id) {
    llmEditorResult({ ok: false, error: 'Save the provider before fetching models.' });
    return;
  }
  llmEditorResult('Fetching models…');
  const result = await llmRpc('llm.fetchModels', { id });
  llmEditorResult({
    ok: result.ok,
    notTested: result.notTested,
    error: result.error,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    count: result.count,
    currentModelAvailable: result.currentModelAvailable,
    models: result.models ? result.models.slice(0, 40) : undefined
  });
  if (result.ok) {
    const options = document.getElementById('llmModelOptions');
    if (options) {
      options.innerHTML = '<option value="">Select a listed model…</option>' + result.models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('');
      options.hidden = false;
    }
    llmSetEditorMessage(`${result.count} models returned. Current model ${result.currentModelAvailable ? 'is' : 'is not'} listed.`, false);
  } else {
    llmSetEditorMessage(result.error || 'Model fetch failed.', true);
  }
}

(function wireLlmManager() {
  const grid = document.getElementById('llmProviderGrid');
  if (grid) {
    grid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-llm-action]');
      const card = event.target.closest('[data-llm-id]');
      if (!button || !card) return;
      llmAction(button.getAttribute('data-llm-action'), card.getAttribute('data-llm-id'));
    });
  }
  document.getElementById('btnLlmAdd')?.addEventListener('click', () => llmOpenEditor(''));
  document.getElementById('btnOpenLlmManager')?.addEventListener('click', () => {
    document.getElementById('llmManagerSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('btnLlmCancel')?.addEventListener('click', () => {
    const editor = document.getElementById('llmProviderEditor');
    if (editor) editor.open = false;
  });
  document.getElementById('btnLlmSave')?.addEventListener('click', llmSaveProvider);
  document.getElementById('btnLlmFetchModels')?.addEventListener('click', llmFetchEditorModels);
  document.getElementById('btnLlmDeleteKey')?.addEventListener('click', async () => {
    const id = document.getElementById('llmFormId').value.trim();
    if (!id) return;
    if (!confirm('Delete the saved key for this provider?')) return;
    const result = await llmRpc('llm.deleteKey', { id });
    llmEditorResult(result);
    llmApplyResult(result);
  });
  document.getElementById('btnLlmSaveSettings')?.addEventListener('click', async () => {
    const result = await llmRpc('llm.updateSettings', { maxAttempts: Number(document.getElementById('llmMaxAttempts').value) });
    llmApplyResult(result);
    llmSetEditorMessage(result.ok ? 'Manager settings saved.' : result.error || 'Could not save manager settings.', !result.ok);
  });
  document.getElementById('btnLlmTestChain')?.addEventListener('click', async () => {
    llmProviderResult('Testing the primary and fallback chain with real requests…');
    const result = await llmRpc('llm.testChain');
    llmProviderResult({
      ok: result.ok,
      error: result.error,
      attempts: result.attempts
    });
    llmApplyResult(result);
    llmSetEditorMessage(result.ok ? 'Fallback chain reached a working provider.' : 'No provider in the chain completed the test.', !result.ok);
  });
  const modelOptions = document.getElementById('llmModelOptions');
  if (modelOptions) {
    modelOptions.addEventListener('change', () => {
      if (!modelOptions.value) return;
      document.getElementById('llmFormModel').value = modelOptions.value;
      llmSetEditorMessage('Model selected. Save the provider to apply it.', false);
    });
  }
})();