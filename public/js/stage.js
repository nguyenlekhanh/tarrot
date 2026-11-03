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

  // ---------------------------------------------------------------- music
  // The playlist player owns the single background <audio> element. The stage
  // starts it, and every narration clip ducks it while the Witch speaks.
  const music = window.ShopMusicPlayer
    ? new window.ShopMusicPlayer({ role: 'stage' })
    : null;
  let musicEnabled = true;
  let musicVolume = null;
  let musicInitialized = false;

  function applyMusicSettings(settings) {
    if (!music || !settings) return;
    const vol = Number(settings.musicVolume);
    if (Number.isFinite(vol) && vol !== musicVolume) {
      musicVolume = vol;
      music.setVolume(vol);
    }
    const enabled = settings.bgMusicEnabled !== false;
    if (musicInitialized && enabled === musicEnabled) return;
    musicInitialized = true;
    musicEnabled = enabled;
    // Only a settings change may restart playback, so a manual pause sticks.
    music.setEnabled(enabled);
  }

  if (music) {
    music.initSync();
    setTimeout(() => {
      if (!musicInitialized) music.setEnabled(true);
    }, 1500);
    // Exposed for the stage's diagnostics and the browser tests.
    window.mysticMusic = music;
  }

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

  // Card markup lives in its own module so a reversed draw can rotate only the
  // artwork layer while every text node stays upright.
  const cardView = window.TarotCardView || null;

  function cardMarkup(card) {
    return cardView && cardView.cardMarkup ? cardView.cardMarkup(card) : '';
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
  let readingHold = false;
  let readingReset = null;

  // One shared clip queue: a reading must never be cut off by the next tts.play
  // message, and a burst of gift lines must never overlap.
  const speech = window.TtsQueue
    ? new window.TtsQueue({
        limit: 16,
        create: (clip) => {
          const audio = new Audio(clip.url);
          const level = Number(clip.volume);
          audio.volume = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0.9;
          return audio;
        },
        onChange: ({ size, playing }) => {
          if (music) music.setDuck(playing || size > 0);
        },
        onIdle: () => {
          // The reading is over once its narration has drained: ambient dialogue
          // resumes on its own relaxed interval.
          if (readingHold) {
            readingHold = false;
            if (conversation) conversation.notifyReading(false);
          }
          // Real playback has finished (not just TTS generation): the cards may
          // now start their way back to the idle table.
          if (readingReset) readingReset.queueIdle();
        }
      })
    : null;

  function playTts(url, volume) {
    if (!speech || !url) return;
    speech.push({ url, volume });
  }

  // ------------------------------------------------------- mystic dialogue
  // The Oracle speaks between readings. It never queues behind anything: a line
  // only starts when the TTS queue is empty, so narration clips cannot stack.
  const conversation = window.MysticConversationEngine
    ? new window.MysticConversationEngine({
        speak: (entry) =>
          callRpc('conversation.speak', { id: entry.id, improvise: true }).then((res) =>
            res && res.result
              ? res.result
              : { ok: false, error: (res && res.error && res.error.message) || 'rpc failed' }
          ),
        isBusy: () => (speech ? speech.busy || speech.size > 0 : false),
        getContext: () => ({ viewers: currentViewers }),
        onStatus: (status) => {
          callRpc('conversation.status', {
            status: status.status,
            phase: status.phase,
            currentId: status.currentId,
            category: status.category,
            nextAt: status.nextAt,
            queue: status.queue,
            reading: status.reading,
            reason: status.reason
          });
        },
        onRecord: (record) => {
          callRpc('conversation.record', {
            conversationId: record.conversationId,
            category: record.category,
            status: record.status === 'spoken' ? 'spoken' : 'failed',
            text: record.text
          });
        }
      })
    : null;
  window.mysticConversation = conversation;

  // ---------------------------------------------------------------- readings
  let revealTimer = null;
  let readingGeneration = 0;
  let currentReadingId = '';
  let cardClearTimer = null;

  // The idle table: three face-down cards, the same markup index.html ships.
  const IDLE_CARD_ROW = '<div class="card-slot" data-slot="0"><div class="card-back">✦</div></div>'
    + '<div class="card-slot" data-slot="1"><div class="card-back">✦</div></div>'
    + '<div class="card-slot" data-slot="2"><div class="card-back">✦</div></div>';

  // Seconds to wait after the last narrated clip before the cards flip back.
  function cardResetDelayMs() {
    const fromWindow = Number(window.MYSTIC_CARD_RESET_SECONDS);
    if (Number.isFinite(fromWindow) && fromWindow >= 0) return fromWindow * 1000;
    const fromUrl = params.get('cardReset');
    if (fromUrl !== null) {
      const seconds = Number(fromUrl);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
    const fromState = Number(tarotState && tarotState.result && tarotState.result.cardResetSeconds);
    if (Number.isFinite(fromState) && fromState >= 0) return fromState * 1000;
    return 3000;
  }

  // Flip the cards face-down, then clear the finished reading from the stage.
  function resetReading(readingId) {
    if (readingId && currentReadingId && readingId !== currentReadingId) return;
    currentReadingId = '';
    clearTimeout(resultHideTimer);
    clearTimeout(cardClearTimer);
    const generation = readingGeneration;
    // Removing .revealed runs the same 0.85s turn as the reveal, in reverse.
    cardRow.querySelectorAll('.card-slot.revealed').forEach((slot) => slot.classList.remove('revealed'));
    resultEl.classList.remove('show');
    stage.classList.remove('showing-result');
    narrationEl.classList.remove('show');
    cardClearTimer = setTimeout(() => {
      // A new reading arrived during the flip: leave its cards alone.
      if (generation !== readingGeneration) return;
      cardRow.classList.remove('single');
      cardRow.innerHTML = IDLE_CARD_ROW;
      narrationEl.textContent = '';
      questionEl.textContent = 'Speak your question in the chat…';
      const headline = $('resultHeadline');
      if (headline) headline.textContent = '';
      const cardsBox = $('resultCards');
      if (cardsBox) cardsBox.innerHTML = '';
    }, 950);
  }

  readingReset = window.ReadingResetTimer
    ? new window.ReadingResetTimer({
        delayMs: cardResetDelayMs,
        fallbackMs: 25000,
        isQueueIdle: () => !speech || (!speech.busy && speech.size === 0),
        onReset: (readingId) => resetReading(readingId)
      })
    : null;

  function showReading(reading) {
    if (!reading || !Array.isArray(reading.cards) || !reading.cards.length) return;
    clearTimeout(revealTimer);
    readingGeneration += 1;
    currentReadingId = String(reading.id || reading.readingId || `stage-${Date.now()}`);

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

  // ------------------------------------------------------------ live tarot UI
  const queueCurrentEl = $('queueCurrent');
  const queueCountEl = $('queueCount');
  const queueNextEl = $('queueNext');
  const queueMoveEl = $('queueMovement');
  const destinyColumnsEl = $('destinyColumns');
  const resultEl = $('readingResult');
  const moveLineEls = [$('moveLineA'), $('moveLineB')];

  let tarotState = null;
  let topicsCache = [];
  let rotationConfig = { rotationSeconds: 6, rows: 3 };
  let rotationStep = -1;
  let rotationTimer = null;
  let resultHideTimer = null;
  let movementIndex = 0;
  let lastMovementId = '';

  function renderQueue(queue) {
    if (!queue || !queue.lines) return;
    if (queueCurrentEl) queueCurrentEl.textContent = queue.lines.current;
    if (queueCountEl) queueCountEl.textContent = queue.lines.count;
    if (queueNextEl) queueNextEl.textContent = queue.lines.next;
    if (queueMoveEl && queue.lines.recent) queueMoveEl.textContent = queue.lines.recent;
  }

  // Two rotating columns of topics, one step per configured interval.
  function paintTopics() {
    if (!destinyColumnsEl || !topicsCache.length) return;
    const stepMs = Math.max(1000, (Number(rotationConfig.rotationSeconds) || 6) * 1000);
    const step = Math.floor(Date.now() / stepMs) % topicsCache.length;
    if (step === rotationStep && destinyColumnsEl.children.length) return;
    rotationStep = step;
    const rows = Math.max(1, Number(rotationConfig.rows) || 3);
    const columns = [[], []];
    for (let index = 0; index < rows * 2; index += 1) {
      const topic = topicsCache[(step + index) % topicsCache.length];
      if (topic) columns[index < rows ? 0 : 1].push(topic.label);
    }
    destinyColumnsEl.innerHTML = columns
      .map((items) => `<div class="destiny-column">${items
        .map((label) => `<span class="destiny-topic">${escapeHtml(label)}</span>`)
        .join('')}</div>`)
      .join('');
  }

  function applyTarotState(tarot) {
    if (!tarot) return;
    tarotState = tarot;
    renderQueue(tarot.queue);
    if (Array.isArray(tarot.topics)) {
      topicsCache = tarot.topics.filter((topic) => topic && topic.enabled !== false);
      rotationConfig = {
        rotationSeconds: Number(tarot.topicSettings && tarot.topicSettings.rotationSeconds) || 6,
        rows: Number(tarot.topicSettings && tarot.topicSettings.rows) || 3
      };
      rotationStep = -1;
      paintTopics();
      if (!rotationTimer) rotationTimer = setInterval(paintTopics, 500);
    }
  }

  function showResult(reading) {
    const result = reading && reading.result;
    if (!result || !resultEl) return;
    $('resultHeadline').textContent = result.headline || '';
    $('resultCards').innerHTML = cardView && cardView.resultCardsMarkup
      ? cardView.resultCardsMarkup(result.cards)
      : '';
    const showFortune = !(tarotState && tarotState.result && tarotState.result.showFortune === false);
    resultEl.classList.toggle('no-fortune', !showFortune);
    $('fortuneValue').textContent = `${result.fortune}%`;
    $('cautionValue').textContent = `${result.caution}%`;
    $('fortuneBar').style.width = `${result.fortune}%`;
    $('cautionBar').style.width = `${result.caution}%`;
    $('oracleText').textContent = result.oracleMessage || '';
    $('resultClosing').textContent = result.closing || '';
    resultEl.classList.add('show');
    stage.classList.add('showing-result');
    clearTimeout(resultHideTimer);
    const seconds = Number(tarotState && tarotState.result && tarotState.result.displaySeconds) || 45;
    resultHideTimer = setTimeout(() => {
      // While the narration is still playing the reset owns the table: the panel
      // must stay up until the last spoken clip has finished.
      if (readingReset && readingReset.pending) return;
      resultEl.classList.remove('show');
      stage.classList.remove('showing-result');
    }, Math.max(5000, seconds * 1000));
  }

  // One movement at a time per ticker line, animated upward and expired by the
  // animation itself, so the DOM never accumulates old messages.
  function pushMovement(movement) {
    if (!movement || movement.id === lastMovementId) return;
    lastMovementId = movement.id;
    if (queueMoveEl) queueMoveEl.textContent = movement.message || '';
    if (tarotState && tarotState.ticker && tarotState.ticker.enabled === false) return;
    const el = moveLineEls[movementIndex % moveLineEls.length];
    movementIndex += 1;
    if (!el) return;
    const speed = Number(tarotState && tarotState.ticker && tarotState.ticker.speedMs) || 900;
    el.textContent = movement.ticker || movement.message || '';
    el.style.animationDuration = `${Math.max(600, speed * 4)}ms`;
    el.classList.remove('rise');
    void el.offsetWidth;
    el.classList.add('rise');
  }

  // ---------------------------------------------------------------- state
  let tarotEnabled = true;
  let currentViewers = 0;

  function applyState(state) {
    if (!state) return;
    applyMusicSettings(state.settings);
    if (state.conversations && conversation) conversation.applySnapshot(state.conversations);
    if (conversation && state.settings) {
      conversation.setPaused(Boolean(state.settings.paused) || state.settings.running === false);
    }
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
      applyTarotState(state.tarot);
    }
    document.body.classList.toggle('is-paused', Boolean(state.tarot && state.tarot.enabled === false));
    const tiktok = state.tiktok || {};
    currentViewers = Number(tiktok.viewerCount) || 0;
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
        if (conversation) conversation.notifyGift();
        if (fx) fx.confetti(90);
        spawnSpirit({ x: 540, y: 1200, count: 8, bright: true });
        showBanner(`🎁 ${event.giftName || 'Gift'}`, `${event.user || 'A supporter'} feeds the flame`);
        break;
      case 'followGuest':
        if (conversation) conversation.notifyFollow();
        showBanner(`✦ ${event.user || 'A new soul'} joined`, 'A new spirit enters the circle');
        spawnSpirit({ x: 540, y: 1000, count: 8, bright: true });
        if (fx) fx.fireworks(2);
        break;
      case 'tarotReading':
        break;
      case 'viewerJoin':
        if (conversation) conversation.notifyViewerJoin(event.user);
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
      } else if (msg.method === 'tarot.queue.move') {
        pushMovement(msg.params && msg.params.movement);
      } else if (msg.method === 'tarot.reading') {
        // The reading owns the voice; ambient dialogue holds until it drains.
        readingHold = true;
        if (conversation) conversation.notifyReading(true, 25000);
        if (msg.params && msg.params.tarot) applyState({ tarot: msg.params.tarot });
        showReading(msg.params && msg.params.reading);
        showResult(msg.params && msg.params.reading);
        // The cards flip back only after this reading's clips have finished
        // playing and the shared queue reports idle, then a short delay.
        if (readingReset) readingReset.begin(currentReadingId);
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
        // Only this reading's own narration may arm the reset.
        if (readingReset) readingReset.heardClip(p.readingId);
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
