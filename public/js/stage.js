/**
 * MYSTIC WITCH LIVE — stage controller.
 *
 * Responsibilities:
 *   - keep the fixed 1080x1920 stage fitted to the viewport (OBS browser source);
 *   - speak JSON-RPC 2.0 over the existing /ws socket (fetch /rpc fallback);
 *   - reveal tarot readings pushed by the server through `tarot.reading`;
 *   - ambient spirits + reaction effects, reusing the existing DrinkShopFX
 *     particle engine for gift/like bursts;
 *   - play the existing server-side TTS clips delivered as `tts.play`.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const OBS_MODE = params.get('obs') === '1';
  if (OBS_MODE) document.body.classList.add('obs-mode');

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const dock = $('dock');
  const cardRow = $('cardRow');
  const questionEl = $('readingQuestion');
  const narrationEl = $('readingNarration');
  const bannerEl = $('banner');
  const tickerEl = $('ticker');

  // ---------------------------------------------------------------- scaling
  // The stage is a fixed 1080x1920 canvas scaled from its top-left corner. Its
  // .stage-frame wrapper is sized to the scaled result, so the flex layout
  // centres the real visual box and no part of the stage can be pushed off
  // screen (OBS browser source, desktop dock layout, small windows alike).
  const obsRoot = $('obsRoot');

  function fitStage() {
    const dockVisible = !OBS_MODE && dock && dock.offsetParent !== null;
    const stacked = dockVisible && getComputedStyle(obsRoot).flexDirection === 'column';
    const dockWidth = dockVisible && !stacked ? dock.offsetWidth + 32 : 0;
    const dockHeight = dockVisible && stacked ? dock.offsetHeight + 32 : 0;
    const availableWidth = Math.max(160, window.innerWidth - dockWidth);
    const availableHeight = Math.max(160, window.innerHeight - dockHeight);
    const scale = Math.min(availableWidth / 1080, availableHeight / 1920);
    document.documentElement.style.setProperty('--stage-scale', String(scale));
  }
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  window.addEventListener('load', fitStage);
  if (!OBS_MODE && dock && typeof ResizeObserver === 'function') {
    new ResizeObserver(fitStage).observe(dock);
  }
  fitStage();

  // ---------------------------------------------------------------- effects
  const fx = window.DrinkShopFX ? new window.DrinkShopFX($('fxCanvas')) : null;

  // Purple spirits live on their own canvas so they never fight DrinkShopFX
  // for the same context.
  const spiritCanvas = $('spiritCanvas');
  const sctx = spiritCanvas.getContext('2d');
  const spirits = [];
  const ambientTimer = { next: 0 };

  function spawnSpirit(options = {}) {
    const count = options.count || 1;
    for (let i = 0; i < count; i += 1) {
      if (spirits.length > 90) break;
      spirits.push({
        x: options.x != null ? options.x + (Math.random() - 0.5) * 340 : 140 + Math.random() * 800,
        y: options.y != null ? options.y + (Math.random() - 0.5) * 220 : 900 + Math.random() * 600,
        vx: (Math.random() - 0.5) * 26,
        vy: -22 - Math.random() * 42,
        r: 26 + Math.random() * 58,
        phase: Math.random() * Math.PI * 2,
        life: 1,
        decay: 0.10 + Math.random() * 0.16,
        bright: options.bright === true
      });
    }
  }

  function drawSpirits(dt) {
    sctx.clearRect(0, 0, 1080, 1920);
    sctx.globalCompositeOperation = 'lighter';

    for (let i = spirits.length - 1; i >= 0; i -= 1) {
      const s = spirits[i];
      s.phase += dt * 1.6;
      s.x += s.vx * dt + Math.sin(s.phase) * 14 * dt;
      s.y += s.vy * dt;
      s.life -= s.decay * dt;
      if (s.life <= 0) { spirits.splice(i, 1); continue; }

      const alpha = Math.max(0, Math.min(1, s.life)) * (s.bright ? 0.85 : 0.5);
      const gradient = sctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      gradient.addColorStop(0, `rgba(226, 210, 255, ${alpha})`);
      gradient.addColorStop(0.34, `rgba(168, 120, 255, ${alpha * 0.65})`);
      gradient.addColorStop(0.7, `rgba(110, 60, 210, ${alpha * 0.28})`);
      gradient.addColorStop(1, 'rgba(60, 20, 130, 0)');
      sctx.fillStyle = gradient;
      sctx.beginPath();
      sctx.ellipse(s.x, s.y, s.r * 0.72, s.r, Math.sin(s.phase) * 0.22, 0, Math.PI * 2);
      sctx.fill();

      // soft glowing "eyes" on the larger spirits
      if (s.r > 52) {
        sctx.fillStyle = `rgba(240, 232, 255, ${alpha * 0.8})`;
        sctx.beginPath();
        sctx.arc(s.x - s.r * 0.16, s.y - s.r * 0.12, 2.6, 0, Math.PI * 2);
        sctx.arc(s.x + s.r * 0.16, s.y - s.r * 0.12, 2.6, 0, Math.PI * 2);
        sctx.fill();
      }
    }
    sctx.globalCompositeOperation = 'source-over';
  }

  let lastSpiritTs = 0;
  function spiritLoop(ts) {
    requestAnimationFrame(spiritLoop);
    if (document.hidden) return;
    if (ts - lastSpiritTs < 1000 / 30) return;
    const dt = lastSpiritTs ? Math.min(0.08, (ts - lastSpiritTs) / 1000) : 0.033;
    lastSpiritTs = ts;

    // ambient drift so the chamber always feels inhabited
    if (ts > ambientTimer.next) {
      ambientTimer.next = ts + 1400 + Math.random() * 1600;
      spawnSpirit({ x: 120 + Math.random() * 840, y: 1380 + Math.random() * 300 });
    }
    drawSpirits(dt);
  }
  requestAnimationFrame(spiritLoop);

  // ---------------------------------------------------------------- helpers
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  const SIGILS = { cups: '☾', swords: '⚔', pentacles: '✧', wands: '✦' };

  function cardMarkup(card) {
    const sigil = card.arcana === 'major' ? '✦' : (SIGILS[card.suit] || '✦');
    const keywords = (card.keywords || []).slice(0, 3).join(' · ');
    return `
      <div class="card-slot">
        <div class="card-inner">
          <div class="card-back">✦</div>
          <div class="card-face${card.reversed ? ' reversed-card' : ''}">
            <div class="card-position">${escapeHtml(String(card.position || '').toUpperCase())}</div>
            <div class="card-sigil">${sigil}</div>
            <div class="card-name">${escapeHtml(card.name)}</div>
            <div class="card-orientation${card.reversed ? ' reversed' : ''}">${card.reversed ? 'REVERSED' : 'UPRIGHT'}</div>
            <div class="card-keywords">${escapeHtml(keywords)}</div>
          </div>
        </div>
      </div>`;
  }

  function showBanner(title, sub, ms = 4200) {
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub || '';
    bannerEl.classList.add('show');
    clearTimeout(showBanner.timer);
    showBanner.timer = setTimeout(() => bannerEl.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- audio
  // Clips are queued, not interrupted: a reading must never be cut off by the
  // next tts.play message, and a burst of gift readings must not overlap.
  const ttsQueue = [];
  let currentClip = null;
  let ttsPlaying = false;

  function pumpTts() {
    if (ttsPlaying || !ttsQueue.length) return;
    const clip = ttsQueue.shift();
    ttsPlaying = true;
    let audio;
    try {
      audio = new Audio(clip.url);
    } catch (_) {
      ttsPlaying = false;
      return pumpTts();
    }
    audio.volume = clip.volume;
    const finish = () => {
      if (currentClip === audio) currentClip = null;
      audio.onended = null;
      audio.onerror = null;
      ttsPlaying = false;
      pumpTts();
    };
    audio.onended = finish;
    audio.onerror = finish;
    currentClip = audio;
    const started = audio.play();
    if (started && typeof started.catch === 'function') started.catch(finish);
  }

  function playTts(url, volume) {
    if (!url) return;
    const level = Number(volume);
    if (ttsQueue.length >= 8) ttsQueue.shift();
    ttsQueue.push({ url, volume: Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0.9 });
    pumpTts();
  }

  // ---------------------------------------------------------------- readings
  let revealTimer = null;

  function showReading(reading) {
    if (!reading || !Array.isArray(reading.cards) || !reading.cards.length) return;
    clearTimeout(revealTimer);

    const cards = reading.cards.slice(0, 3);
    cardRow.classList.toggle('single', cards.length === 1);
    cardRow.innerHTML = cards.map(cardMarkup).join('');
    questionEl.textContent = reading.question && reading.question !== 'Gift reading'
      ? `“${reading.question}” — ${reading.user || 'a seeker'}`
      : `${reading.user || 'A seeker'} asks the cards`;
    narrationEl.textContent = '';
    narrationEl.classList.remove('show');

    const slots = [...cardRow.querySelectorAll('.card-slot')];
    slots.forEach((slot, index) => {
      revealTimer = setTimeout(() => {
        slot.classList.add('revealed');
        if (fx) {
          const rect = slot.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();
          const scale = stageRect.width / 1080;
          fx.sparkle((rect.left - stageRect.left + rect.width / 2) / scale, (rect.top - stageRect.top + rect.height / 2) / scale, 12);
        }
        spawnSpirit({ x: 300 + index * 240, y: 1180, count: 3, bright: true });
      }, 320 + index * 620);
    });

    revealTimer = setTimeout(() => {
      narrationEl.textContent = reading.narration || reading.summary || '';
      narrationEl.classList.add('show');
      if (fx) fx.confetti(cards.length === 3 ? 40 : 22);
    }, 320 + slots.length * 620 + 260);

    addTick(`${reading.user || 'Seeker'} · ${cards.map((c) => c.name).join(' / ')}`);
  }

  function addTick(text) {
    const el = document.createElement('div');
    el.className = 'tick';
    el.textContent = text;
    tickerEl.prepend(el);
    while (tickerEl.children.length > 3) tickerEl.lastChild.remove();
  }

  // ---------------------------------------------------------------- state
  let tarotEnabled = true;

  function applyState(state) {
    if (!state) return;
    const likes = Number(state.likes) || 0;
    const gifts = Number(state.gifts) || 0;
    $('countLikes').textContent = likes.toLocaleString('en-US');
    $('countGifts').textContent = gifts.toLocaleString('en-US');
    if (state.tarot) {
      $('countReadings').textContent = Number(state.tarot.total) || 0;
      tarotEnabled = state.tarot.enabled !== false;
      const btn = $('btnToggleTarot');
      if (btn) btn.textContent = tarotEnabled ? 'Tarot: ON' : 'Tarot: OFF';
      if (Array.isArray(state.tarot.history)) renderHistory(state.tarot.history);
    }
    document.body.classList.toggle('is-paused', Boolean(state.tarot && state.tarot.enabled === false));
    const tiktok = state.tiktok || {};
    const pill = $('livePill');
    const label = tiktok.connected ? 'LIVE' : tiktok.connecting ? 'CONNECTING' : tiktok.reconnecting ? 'RECONNECTING' : 'OFFLINE';
    $('liveStatusText').textContent = label;
    pill.classList.toggle('online', Boolean(tiktok.connected));
    const statusEl = $('tiktokState');
    if (statusEl) {
      statusEl.textContent = tiktok.connected
        ? `CONNECTED @${tiktok.username || ''} · ${tiktok.viewerCount || 0} viewers`
        : tiktok.lastError || label;
    }
  }

  function renderHistory(readings) {
    const host = $('dockHistory');
    if (!host) return;
    host.innerHTML = readings.slice(0, 8).map((reading) => {
      const names = (reading.cards || []).map((c) => `${escapeHtml(c.name)}${c.reversed ? ' ⟲' : ''}`).join(' · ');
      return `<div><strong>${escapeHtml(reading.user || 'Guest')}</strong> — ${escapeHtml(reading.spread)} · ${names}</div>`;
    }).join('') || '<div>No readings yet.</div>';
  }

  // ---------------------------------------------------------------- events
  function handleServerEvent(event) {
    if (!event || !event.type) return;
    switch (event.type) {
      case 'likeBurst':
        spawnSpirit({ x: 240 + Math.random() * 600, y: 1500, count: 6, bright: true });
        if (fx) fx.sparkle(540, 1450, 16);
        break;
      case 'giftOrder':
      case 'partyOrder':
        if (fx) fx.confetti(90);
        spawnSpirit({ x: 540, y: 1200, count: 8, bright: true });
        showBanner(`🎁 ${event.giftName || 'Gift'}`, `${event.user || 'A supporter'} feeds the flame`);
        break;
      case 'followGuest':
        showBanner(`✦ ${event.user || 'A new soul'} joined`, 'A new spirit enters the circle');
        spawnSpirit({ x: 540, y: 1000, count: 8, bright: true });
        if (fx) fx.fireworks(2);
        break;
      case 'tarotReading':
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- socket
  let socket = null;
  let rpcId = 1;
  const pending = new Map();

  function wsUrl() {
    const url = new URL('/ws', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }

  function connectSocket() {
    socket = new WebSocket(wsUrl());
    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }

      if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.resolve(msg);
        }
        return;
      }
      if (!msg.method) return;

      if (msg.method === 'temple.state') {
        applyState(msg.params);
      } else if (msg.method === 'tarot.state') {
        // The broadcast snapshot is the settings object itself, with no wrapper.
        applyState({ tarot: msg.params });
      } else if (msg.method === 'tarot.reading') {
        showReading(msg.params && msg.params.reading);
        if (msg.params && msg.params.tarot) applyState({ tarot: msg.params.tarot });
      } else if (msg.method === 'temple.event') {
        handleServerEvent(msg.params && msg.params.event);
      } else if (msg.method === 'mystic.fx') {
        const info = msg.params || {};
        if (info.kind === 'welcome') {
          showBanner(`✦ ${info.user || 'A new follower'}`, 'The spirits welcome you');
          spawnSpirit({ x: 540, y: 1100, count: 10, bright: true });
          if (fx) fx.fireworks(2);
        }
      } else if (msg.method === 'tts.play') {
        const p = msg.params || {};
        playTts(p.url, p.volume);
      }
    };
    socket.onclose = () => setTimeout(connectSocket, 2200);
    socket.onerror = () => {};
  }

  async function callRpc(method, rpcParams = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const id = rpcId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ error: { message: 'timeout' } });
        }, 20000);
        pending.set(id, {
          resolve: (data) => { clearTimeout(timer); resolve(data); }
        });
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: rpcParams }));
      });
    }
    try {
      const res = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params: rpcParams })
      });
      return await res.json();
    } catch (err) {
      return { error: { message: err.message } };
    }
  }

  // ---------------------------------------------------------------- dock
  function dockStatus(text) {
    const el = $('dockStatus');
    if (el) el.textContent = text;
  }

  function bindDock() {
    if (OBS_MODE) return;
    $('btnOne').addEventListener('click', async () => {
      dockStatus('Drawing one card…');
      const res = await callRpc('tarot.testOne', { theme: 'love' });
      dockStatus(res.error ? `Error: ${res.error.message}` : 'One-card reading drawn.');
    });
    $('btnThree').addEventListener('click', async () => {
      dockStatus('Drawing three cards…');
      const res = await callRpc('tarot.testThree', { question: 'What do the cards see for me?' });
      dockStatus(res.error ? `Error: ${res.error.message}` : 'Three-card reading drawn.');
    });
    $('btnLike').addEventListener('click', async () => {
      await callRpc('shop.like', { user: 'Test Viewer', count: 5 });
      dockStatus('Like burst sent.');
    });
    $('btnGift').addEventListener('click', async () => {
      await callRpc('shop.giftOrder', { user: 'Test Viewer', coins: 25, units: 1, giftName: 'Mystic Rose' });
      dockStatus('Gift sent.');
    });
    $('btnFollow').addEventListener('click', async () => {
      await callRpc('shop.follow', { user: 'A New Soul' });
      dockStatus('Follower welcomed.');
    });
    $('btnConnect').addEventListener('click', async () => {
      const username = $('inputTiktok').value.trim();
      if (!username) return dockStatus('Enter a TikTok username first.');
      dockStatus('Connecting…');
      const res = await callRpc('live.connect', { username });
      dockStatus(res.error ? res.error.message : 'Connected.');
    });
    $('btnDisconnect').addEventListener('click', async () => {
      await callRpc('live.disconnect', {});
      dockStatus('Disconnected.');
    });
    $('btnToggleTarot').addEventListener('click', async () => {
      const res = await callRpc('tarot.updateSettings', { enabled: !tarotEnabled });
      tarotEnabled = !tarotEnabled;
      dockStatus(`Tarot ${tarotEnabled ? 'enabled' : 'disabled'}.`);
      if (res.result) applyState(res.result.tarot ? { tarot: res.result.tarot } : res.result);
    });
  }

  // ---------------------------------------------------------------- boot
  connectSocket();
  bindDock();

  fetch('/api/state')
    .then((res) => res.json())
    .then((state) => applyState(state))
    .catch(() => {});

  // A quiet welcome so the chamber is never empty before the first reading.
  setTimeout(() => {
    showBanner('✦ MYSTIC WITCH LIVE ✦', 'Ask for a reading: TAROT · LOVE · CAREER · FUTURE');
    spawnSpirit({ x: 540, y: 1300, count: 6, bright: true });
  }, 900);
})();
