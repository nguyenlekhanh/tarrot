/**
 * MYSTIC WITCH LIVE — stage controller.
 *
 * Responsibilities:
 *   - keep the fixed 1080x1920 stage fitted to the viewport (OBS browser source);
 *   - speak JSON-RPC 2.0 over the existing /ws socket (fetch /rpc fallback);
 *   - run the tarot ceremony state machine (tarot-ceremony.js): announce the
 *     viewer, gather the spirits, reveal the cards, show the interpretation and
 *     close — each step advanced by real clip playback and animation timing;
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
        // The ceremony advances on these boundaries: a phase is over when its
        // last clip has actually finished playing, not when it was synthesised.
        onStart: (clip) => handleClipStart(clip),
        onEnd: (clip) => handleClipEnd(clip),
        onIdle: () => {
          // Ambient dialogue stays paused for the whole ceremony. Only the
          // closing phase may arm the final reset.
          const settled = !ceremony || ceremony.state === 'CLOSING' || ceremony.state === 'RESETTING';
          if (!settled) return;
          if (readingReset) readingReset.queueIdle();
          if (!ceremony && readingHold) {
            readingHold = false;
            if (conversation) conversation.notifyReading(false);
          }
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

  // ---------------------------------------------------------- ceremony flow
  // One state machine owns the whole ceremony. Visuals and audio are driven
  // from here; only real clip playback and animation completion move it
  // forward. Every timer carries `ceremonyEpoch`, so a late callback from an
  // earlier reading can never touch a newer one.
  const ceremonyEl = $('ceremony');
  const ceremonyKickerEl = $('ceremonyKicker');
  const ceremonyNameEl = $('ceremonyName');
  const ceremonyTopicEl = $('ceremonyTopic');
  const ceremonyMessageEl = $('ceremonyMessage');

  const PHASE_BY_STATE = {
    ANNOUNCING: 'announce',
    PREPARING: 'prepare',
    REVEALING: 'reveal',
    INTERPRETING: 'interpret',
    CLOSING: 'closing'
  };
  const MIN_PHASE_MS = { ANNOUNCING: 1400, PREPARING: 2400, REVEALING: 0, INTERPRETING: 2200, CLOSING: 2600 };
  const NO_AUDIO_MS = 1800;
  const PHASE_GUARD_MS = 45000;

  let ceremonyReading = null;
  let ceremonyPlan = { byPhase: {} };
  let ceremonyEpoch = 0;
  let phaseStartedAt = 0;
  let phaseExpected = 0;
  let phaseEnded = 0;
  let phasePlanned = false;
  let revealStarted = 0;
  let lastRevealAt = 0;
  let ceremonyHeardClip = false;
  let advanceTimer = null;
  let revealFallbackTimer = null;
  let phaseGuardTimer = null;
  let ceremonyResetTimer = null;
  const revealedSlots = new Set();
  const clipPools = new Map();
  const pendingReadings = [];

  const ceremony = window.TarotCeremony
    ? new window.TarotCeremony({ onEnter: handleCeremonyState })
    : null;
  // Exposed for diagnostics and the browser ceremony checks.
  window.mysticCeremony = ceremony;
  window.mysticPendingReadings = pendingReadings;

  function ceremonyBusy() {
    return Boolean(ceremony && ceremony.busy);
  }

  function showCeremonyPhase(phase) {
    if (!ceremonyEl) return;
    ceremonyEl.classList.add('show');
    ceremonyEl.classList.remove('phase-announce', 'phase-prepare', 'phase-reveal', 'phase-interpret', 'phase-closing');
    ceremonyEl.classList.add(`phase-${phase}`);
  }

  function hideCeremony() {
    if (!ceremonyEl) return;
    ceremonyEl.classList.remove('show', 'phase-announce', 'phase-prepare', 'phase-reveal', 'phase-interpret', 'phase-closing');
  }

  function clearCeremonyTimers() {
    clearTimeout(advanceTimer);
    advanceTimer = null;
    clearTimeout(revealFallbackTimer);
    revealFallbackTimer = null;
    clearTimeout(phaseGuardTimer);
    phaseGuardTimer = null;
    clearTimeout(ceremonyResetTimer);
    ceremonyResetTimer = null;
  }

  function phaseOf(state) {
    return PHASE_BY_STATE[state] || '';
  }

  function poolFor(readingId) {
    const key = String(readingId || '');
    if (!clipPools.has(key)) {
      clipPools.set(key, { announce: [], prepare: [], reveal: [], interpret: [], closing: [] });
    }
    return clipPools.get(key);
  }

  function dropPool(readingId) {
    clipPools.delete(String(readingId || ''));
  }

  // A reading that arrives mid-ceremony waits its turn; it is never merged into
  // the running ceremony and never interrupted by it.
  function queuePending(reading) {
    if (!reading || !Array.isArray(reading.cards) || !reading.cards.length) return;
    pendingReadings.push(reading);
    while (pendingReadings.length > 3) {
      const dropped = pendingReadings.shift();
      dropPool(dropped && dropped.id);
    }
  }

  function startNextPending() {
    if (ceremonyBusy() || !pendingReadings.length) return;
    startCeremony(pendingReadings.shift());
  }

  function pushClip(clip) {
    if (!speech || !clip || !clip.url) return false;
    speech.push({
      url: clip.url,
      volume: clip.volume,
      phase: clip.phase,
      order: clip.order,
      readingId: clip.readingId
    });
    return true;
  }

  function takePhaseClips(readingId, phase) {
    const pool = clipPools.get(String(readingId || ''));
    if (!pool || !pool[phase]) return [];
    const clips = pool[phase];
    pool[phase] = [];
    return clips.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }

  // Clips are buffered per reading and per phase: a clip for a phase that has
  // not started yet waits, and a clip for another reading never plays over this
  // one.
  function routeClip(clip) {
    if (!clip) return false;
    const readingId = String(clip.readingId || '');
    const phase = String(clip.phase || 'interpret');
    const pool = poolFor(readingId);
    if (!pool[phase]) pool.interpret.push(clip);
    else pool[phase].push(clip);
    if (!ceremonyReading || readingId !== String(ceremonyReading.id || '')) return false;
    if (!ceremony || phaseOf(ceremony.state) !== phase) return false;
    // The plan already counted every clip of this phase. Only a server that
    // sends no plan at all relies on counting the arrivals instead.
    if (!phasePlanned) phaseExpected += 1;
    return pushClip(clip);
  }

  function beginPhaseAudio(state, epoch) {
    clearTimeout(phaseGuardTimer);
    phaseStartedAt = Date.now();
    phaseExpected = Number((ceremonyPlan.byPhase || {})[phaseOf(state)] || 0);
    phasePlanned = phaseExpected > 0;
    phaseEnded = 0;
    const clips = ceremonyReading ? takePhaseClips(ceremonyReading.id, phaseOf(state)) : [];
    clips.forEach(pushClip);
    // No narration for this phase (TTS off): the animation itself moves on.
    if (!phaseExpected) scheduleAdvance(state, epoch, NO_AUDIO_MS);
    else {
      phaseGuardTimer = setTimeout(() => {
        if (!ceremony || !ceremony.isCurrent(epoch) || ceremony.state !== state) return;
        if (phaseEnded >= phaseExpected) return;
        // Audio never finished (blocked tab, dead clip): keep the ceremony alive.
        phaseEnded = phaseExpected;
        maybeAdvance(state, epoch);
      }, PHASE_GUARD_MS);
    }
  }

  function scheduleAdvance(state, epoch, ms) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      maybeAdvance(state, epoch);
    }, Math.max(60, Number(ms) || 0));
  }

  function maybeAdvance(state, epoch) {
    if (!ceremony || !ceremony.isCurrent(epoch) || ceremony.state !== state) return false;
    if (phaseEnded < phaseExpected) return false;
    const wait = (MIN_PHASE_MS[state] || 0) - (Date.now() - phaseStartedAt);
    if (wait > 0) {
      scheduleAdvance(state, epoch, wait + 50);
      return false;
    }
    if (state === 'REVEALING') {
      const total = ceremonyReading ? Math.min(3, ceremonyReading.cards.length) : 0;
      if (revealedSlots.size < total) return false;
      const settle = 900 - (Date.now() - lastRevealAt);
      if (settle > 0) {
        scheduleAdvance(state, epoch, settle + 50);
        return false;
      }
    }
    return ceremony.advance(state, epoch);
  }

  function handleClipStart(clip) {
    if (!clip || !ceremony || !ceremonyReading) return;
    if (clip.phase !== 'reveal' || ceremony.state !== 'REVEALING') return;
    const total = Math.min(3, ceremonyReading.cards.length);
    const index = Math.min(total - 1, revealStarted);
    revealStarted += 1;
    revealCard(index);
  }

  function handleClipEnd(clip) {
    if (!clip || !ceremony || !ceremonyReading) return;
    if (String(clip.readingId || '') !== String(ceremonyReading.id || '')) return;
    if (clip.phase !== phaseOf(ceremony.state)) return;
    phaseEnded += 1;
    maybeAdvance(ceremony.state, ceremonyEpoch);
  }

  function prepareCardRow(reading) {
    const cards = reading.cards.slice(0, 3);
    cardRow.classList.toggle('single', cards.length === 1);
    cardRow.innerHTML = cards.map(cardMarkup).join('');
    questionEl.textContent = reading.question && reading.question !== 'Gift reading'
      ? `“${reading.question}” — ${reading.user || 'a seeker'}`
      : `${reading.user || 'A seeker'} asks the cards`;
    narrationEl.textContent = '';
    narrationEl.classList.remove('show');
    revealedSlots.clear();
    revealStarted = 0;
    lastRevealAt = 0;
  }

  function revealCard(index) {
    const slots = cardRow.querySelectorAll('.card-slot');
    const slot = slots[index];
    if (!slot || revealedSlots.has(index)) return;
    revealedSlots.add(index);
    lastRevealAt = Date.now();
    slot.classList.add('revealed');
    if (fx) {
      const rect = slot.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const scale = stageRect.width / 1080;
      fx.sparkle((rect.left - stageRect.left + rect.width / 2) / scale, (rect.top - stageRect.top + rect.height / 2) / scale, 12);
    }
    spawnSpirit({ x: 300 + index * 240, y: 1180, count: 3, bright: true });
  }

  function revealAllCards() {
    const total = cardRow.querySelectorAll('.card-slot').length;
    for (let index = 0; index < total; index += 1) revealCard(index);
  }

  // When the reveal narration is missing, the cards still turn in order.
  function scheduleRevealFallback(epoch) {
    clearTimeout(revealFallbackTimer);
    revealFallbackTimer = setTimeout(() => {
      if (!ceremony || !ceremony.isCurrent(epoch) || ceremony.state !== 'REVEALING') return;
      if (revealStarted > 0) return;
      const total = ceremonyReading ? Math.min(3, ceremonyReading.cards.length) : 0;
      for (let index = 0; index < total; index += 1) {
        setTimeout(() => {
          if (!ceremony || !ceremony.isCurrent(epoch) || ceremony.state !== 'REVEALING') return;
          revealCard(index);
          if (revealedSlots.size >= total) maybeAdvance('REVEALING', epoch);
        }, index * 900);
      }
    }, 900);
  }

  function handleCeremonyState(state, info) {
    const epoch = info && info.epoch;
    const reading = ceremonyReading;
    switch (state) {
      case 'ANNOUNCING': {
        if (reading) {
          if (ceremonyKickerEl) ceremonyKickerEl.textContent = '🔮 YOUR TURN HAS ARRIVED';
          if (ceremonyNameEl) ceremonyNameEl.textContent = String(reading.user || 'Seeker').toUpperCase();
          if (ceremonyMessageEl) {
            ceremonyMessageEl.textContent = 'THE SPIRITS ARE GATHERING...';
          }
          if (ceremonyTopicEl) {
            const label = (reading.result && reading.result.topicLabel) || reading.topicLabel || 'Tarot Reading';
            ceremonyTopicEl.textContent = String(label).toUpperCase();
          }
        }
        showCeremonyPhase('announce');
        resultEl.classList.remove('show');
        stage.classList.remove('showing-result');
        // The ambient Oracle is silent for the entire ceremony.
        if (conversation) conversation.notifyReading(true, 180000);
        beginPhaseAudio(state, epoch);
        break;
      }
      case 'PREPARING':
        if (ceremonyMessageEl) ceremonyMessageEl.textContent = 'THE SPIRITS ARE GATHERING...';
        showCeremonyPhase('prepare');
        spawnSpirit({ x: 540, y: 1240, count: 16, bright: true });
        if (fx) fx.sparkle(540, 1240, 28);
        beginPhaseAudio(state, epoch);
        break;
      case 'REVEALING':
        hideCeremony();
        prepareCardRow(reading);
        beginPhaseAudio(state, epoch);
        scheduleRevealFallback(epoch);
        break;
      case 'INTERPRETING':
        hideCeremony();
        revealAllCards();
        showResult(reading);
        beginPhaseAudio(state, epoch);
        break;
      case 'CLOSING':
        if (ceremonyKickerEl) ceremonyKickerEl.textContent = '✦ YOUR READING IS COMPLETE ✦';
        if (ceremonyMessageEl) ceremonyMessageEl.textContent = 'May the spirits guide your path.';
        resultEl.classList.remove('show');
        stage.classList.remove('showing-result');
        showCeremonyPhase('closing');
        spawnSpirit({ x: 540, y: 1200, count: 12, bright: true });
        if (fx) fx.confetti(30);
        beginPhaseAudio(state, epoch);
        break;
      case 'RESETTING':
        // Nothing to play (TTS off): still arm the final 3 second reset.
        if (!ceremonyHeardClip && readingReset) {
          readingReset.heardClip(currentReadingId);
          readingReset.queueIdle();
        }
        // The ceremony owns this last step: 3 seconds after the closing audio,
        // the cards turn down, the stage clears and the ceremony goes idle. It
        // does not depend on a later queue-idle event arriving.
        clearTimeout(ceremonyResetTimer);
        ceremonyResetTimer = setTimeout(() => {
          ceremonyResetTimer = null;
          if (!ceremony || !ceremony.isCurrent(epoch) || ceremony.state !== 'RESETTING') return;
          resetReading(currentReadingId);
        }, cardResetDelayMs() + 150);
        break;
      case 'IDLE':
        hideCeremony();
        clearCeremonyTimers();
        dropPool(currentReadingId);
        ceremonyReading = null;
        ceremonyPlan = { byPhase: {} };
        readingHold = false;
        if (conversation) conversation.notifyReading(false);
        startNextPending();
        break;
      default:
        break;
    }
  }

  function startCeremony(reading) {
    if (!reading || !Array.isArray(reading.cards) || !reading.cards.length) return false;
    if (!ceremony) {
      showReadingLegacy(reading);
      return true;
    }
    if (ceremonyBusy()) {
      queuePending(reading);
      return false;
    }
    ceremonyReading = reading;
    ceremonyPlan = reading.ceremony && reading.ceremony.byPhase ? reading.ceremony : { byPhase: {} };
    ceremonyHeardClip = false;
    readingGeneration += 1;
    currentReadingId = String(reading.id || reading.readingId || `stage-${Date.now()}`);
    if (!ceremony.begin(currentReadingId)) return false;
    ceremonyEpoch = ceremony.epoch;
    clearTimeout(resultHideTimer);
    clearTimeout(cardClearTimer);
    clearTimeout(revealTimer);
    clearCeremonyTimers();
    resultEl.classList.remove('show');
    stage.classList.remove('showing-result');
    narrationEl.classList.remove('show');
    cardRow.classList.remove('single');
    cardRow.innerHTML = IDLE_CARD_ROW;
    if (readingReset) readingReset.begin(currentReadingId);
    addTick(`${reading.user || 'Seeker'} · ${reading.cards.slice(0, 3).map((c) => c.name).join(' / ')}`);
    return true;
  }

  // Fallback for an older page that does not load the ceremony module.
  function showReadingLegacy(reading) {
    if (!reading || !Array.isArray(reading.cards) || !reading.cards.length) return;
    clearTimeout(revealTimer);
    readingGeneration += 1;
    currentReadingId = String(reading.id || reading.readingId || `stage-${Date.now()}`);
    prepareCardRow(reading);
    const slots = [...cardRow.querySelectorAll('.card-slot')];
    slots.forEach((slot, index) => {
      revealTimer = setTimeout(() => {
        slot.classList.add('revealed');
        if (fx) fx.sparkle(540, 1100, 12);
        spawnSpirit({ x: 300 + index * 240, y: 1180, count: 3, bright: true });
      }, 320 + index * 620);
    });
    revealTimer = setTimeout(() => {
      narrationEl.textContent = reading.narration || reading.summary || '';
      narrationEl.classList.add('show');
      showResult(reading);
      if (fx) fx.confetti(slots.length === 3 ? 40 : 22);
    }, 320 + slots.length * 620 + 260);
  }

  // Flip the cards face-down, then clear the finished reading from the stage.
  function resetReading(readingId) {
    // A stale reset from a finished reading never touches the live table.
    if (readingId && readingId !== currentReadingId) return;
    // The ceremony owns its own ending: a legacy reset request (the old 25 s
    // narration fallback) may never cut an announcement, reveal or
    // interpretation short. Only the closing phases release the table.
    if (ceremony && ceremony.busy && ceremony.state !== 'CLOSING' && ceremony.state !== 'RESETTING') return;
    const epoch = ceremonyEpoch;
    currentReadingId = '';
    clearTimeout(resultHideTimer);
    clearTimeout(cardClearTimer);
    clearTimeout(revealTimer);
    clearCeremonyTimers();
    const generation = readingGeneration;
    // Removing .revealed runs the same 0.85s turn as the reveal, in reverse.
    cardRow.querySelectorAll('.card-slot.revealed').forEach((slot) => slot.classList.remove('revealed'));
    resultEl.classList.remove('show');
    stage.classList.remove('showing-result');
    narrationEl.classList.remove('show');
    hideCeremony();
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
      if (!ceremony) return;
      // Idle only after the table is clear, so the next viewer never sees the
      // previous reading's cards.
      if (!ceremony.finish(epoch)) ceremony.abort();
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

  function addTick(text) {
    const el = document.createElement('div');
    el.className = 'tick';
    el.textContent = text;
    tickerEl.prepend(el);
    while (tickerEl.children.length > 3) tickerEl.lastChild.remove();
  }

  // A hidden tab pauses audio; when it comes back the ceremony must not stall on
  // clips that were reported as playing forever.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !ceremony || !ceremony.busy) return;
    if (phaseEnded < phaseExpected && (!speech || (!speech.busy && speech.size === 0))) {
      phaseEnded = phaseExpected;
    }
    maybeAdvance(ceremony.state, ceremonyEpoch);
  });

  // ------------------------------------------------------------ live tarot UI
  const queueCurrentEl = $('queueCurrent');
  const queueCountEl = $('queueCount');
  const queueNextEl = $('queueNext');
  const queueMoveEl = $('queueMovement');
  const queuePromoEl = $('queuePromo');
  const queueRecentEl = $('queueRecent');
  const destinyColumnsEl = $('destinyColumns');
  const resultEl = $('readingResult');
  const resultSectionsEl = $('resultSections');
  const moveLineEls = [$('moveLineA'), $('moveLineB')];

  let tarotState = null;
  let topicsCache = [];
  let rotationConfig = { rotationSeconds: 6, rows: 3 };
  let rotationStep = -1;
  let rotationTimer = null;
  let resultHideTimer = null;
  let movementIndex = 0;
  let lastMovementId = '';

  // Shrink the promotion until it fits its row on a single line.
  function fitQueuePromo() {
    if (!queuePromoEl || !queueMoveEl || queuePromoEl.classList.contains('is-hidden')) return;
    const available = Math.max(120, queueMoveEl.clientWidth);
    let size = Math.min(17, available / 52);
    queuePromoEl.style.fontSize = `${size}px`;
    let guard = 0;
    // Icons are em-sized, so the labels and artwork shrink together.
    while (size > 9 && queuePromoEl.scrollWidth > available && guard < 40) {
      size -= 0.5;
      queuePromoEl.style.fontSize = `${size}px`;
      guard += 1;
    }
  }

  function renderQueue(queue) {
    if (!queue || !queue.lines) return;
    if (queueCurrentEl) queueCurrentEl.textContent = queue.lines.current;
    if (queueCountEl) queueCountEl.textContent = queue.lines.count;
    if (queueNextEl) queueNextEl.textContent = queue.lines.next;
    // The promotion only owns the row while the line is empty.
    const empty = window.QueuePromo
      ? !window.QueuePromo.hasWaiting(queue)
      : !(Number(queue.count) > 0);
    if (queuePromoEl) queuePromoEl.classList.toggle('is-hidden', !empty);
    if (queueRecentEl) {
      const recentText = queue.lines.recent || '';
      queueRecentEl.textContent = recentText;
      queueRecentEl.classList.toggle('is-hidden', empty || !recentText);
    }
    if (empty) fitQueuePromo();
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
    renderResultSections(result);
    $('resultClosing').textContent = result.closing || '';
    resultEl.classList.add('show');
    stage.classList.add('showing-result');
    clearTimeout(resultHideTimer);
    const seconds = Number(tarotState && tarotState.result && tarotState.result.displaySeconds) || 45;
    resultHideTimer = setTimeout(() => {
      // While the ceremony (or its narration) is still running the reset owns
      // the panel: it must stay up until the ceremony closes.
      if (readingReset && readingReset.pending) return;
      if (ceremonyBusy()) return;
      resultEl.classList.remove('show');
      stage.classList.remove('showing-result');
    }, Math.max(5000, seconds * 1000));
  }

  // Every topic ships its own labelled sections; the flat message is only the
  // fallback for an older reading that has none.
  function renderResultSections(result) {
    const oracle = $('oracleText');
    const sections = Array.isArray(result && result.sections)
      ? result.sections.filter((section) => section && section.label && section.text)
      : [];
    if (resultSectionsEl) {
      resultSectionsEl.innerHTML = sections
        .map((section) => `<div class="result-section"><div class="result-section-label">${escapeHtml(section.label)}</div><div class="result-section-text">${escapeHtml(section.text)}</div></div>`)
        .join('');
      resultSectionsEl.classList.toggle('is-hidden', !sections.length);
      if (sections.length) fitResultSections();
    }
    if (oracle) {
      oracle.classList.toggle('is-hidden', Boolean(sections.length));
      if (!sections.length) oracle.textContent = (result && result.oracleMessage) || '';
    }
  }

  // Shrink the section text until the whole interpretation fits the result box,
  // so a long reading stays readable on the 1080x1920 stage instead of clipping.
  function fitResultSections() {
    if (!resultSectionsEl || resultSectionsEl.classList.contains('is-hidden')) return;
    let size = 16;
    resultSectionsEl.style.fontSize = `${size}px`;
    let guard = 0;
    while (size > 11 && resultSectionsEl.scrollHeight > resultSectionsEl.clientHeight && guard < 20) {
      size -= 0.5;
      resultSectionsEl.style.fontSize = `${size}px`;
      guard += 1;
    }
  }

  // One movement at a time per ticker line, animated upward and expired by the
  // animation itself, so the DOM never accumulates old messages.
  function pushMovement(movement) {
    if (!movement || movement.id === lastMovementId) return;
    lastMovementId = movement.id;
    // The row itself is markup now (promotion or live movement); only the text
    // span changes, and renderQueue decides which of the two is visible.
    if (queueRecentEl) queueRecentEl.textContent = movement.message || '';
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
        const reading = msg.params && msg.params.reading;
        if (msg.params && msg.params.tarot) applyState({ tarot: msg.params.tarot });
        if (reading && msg.params.ceremony) reading.ceremony = msg.params.ceremony;
        // The ceremony owns the voice and holds ambient dialogue for its whole run.
        readingHold = true;
        if (conversation) conversation.notifyReading(true, 180000);
        startCeremony(reading);
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
        // Clips carry their ceremony phase; they are buffered per reading so a
        // queued viewer's narration can never play over the current ceremony.
        routeClip(p);
        if (readingReset) readingReset.heardClip(p.readingId);
        if (String(p.readingId || '') === currentReadingId) ceremonyHeardClip = true;
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
