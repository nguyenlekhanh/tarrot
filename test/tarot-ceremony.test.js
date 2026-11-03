'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DECK } = require('../tarot-engine');
const { buildReadingResult, buildCeremonyClips, CEREMONY_CLOSING_TEXT } = require('../tarot-reading-library');
const { TarotCeremony, TAROT_CEREMONY } = require('../public/js/tarot-ceremony');
const { TtsQueue } = require('../public/js/tts-queue');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function card(name, reversed = false, position = 'Guidance') {
  const data = DECK.find((entry) => entry.name === name);
  assert.ok(data, `unknown card ${name}`);
  return {
    ...data,
    position,
    orientation: reversed ? 'reversed' : 'upright',
    reversed,
    meaning: reversed ? data.reversed : data.upright
  };
}

function reading(cards, options = {}) {
  return {
    id: options.id || 'reading-1',
    user: options.user || 'Emily',
    theme: options.theme || 'family',
    topicId: options.topicId || 'family_reading',
    topicLabel: options.topicLabel || 'Family Reading',
    question: options.question || 'How is my family?',
    spread: cards.length === 1 ? 'one' : 'three',
    cards
  };
}

const ONE = [card('The Star', false, 'Guidance')];
const THREE = [card('The Hermit', false, 'Past'), card('Seven of Swords', true, 'Present'), card('The Sun', false, 'Future')];

// ------------------------------------------------------------ state machine

test('a ceremony walks IDLE to IDLE exactly once, in order', () => {
  const seen = [];
  const machine = new TarotCeremony({ onEnter: (state) => seen.push(state) });
  assert.equal(machine.state, TAROT_CEREMONY.IDLE);
  assert.equal(machine.busy, false);

  assert.equal(machine.begin('r1'), true);
  assert.equal(machine.busy, true);
  assert.equal(machine.readingId, 'r1');
  const epoch = machine.epoch;

  for (const expected of ['ANNOUNCING', 'PREPARING', 'REVEALING', 'INTERPRETING', 'CLOSING']) {
    assert.equal(machine.state, expected);
    assert.equal(machine.advance(expected, epoch), true, `failed to leave ${expected}`);
  }
  assert.equal(machine.state, 'RESETTING');
  assert.equal(machine.finish(epoch), true);
  assert.equal(machine.state, TAROT_CEREMONY.IDLE);
  assert.equal(machine.busy, false);
  assert.equal(machine.readingId, '');
  assert.deepEqual(seen, [
    'ANNOUNCING', 'PREPARING', 'REVEALING', 'INTERPRETING', 'CLOSING', 'RESETTING', 'IDLE'
  ]);
});

test('finish is refused everywhere except RESETTING', () => {
  const machine = new TarotCeremony();
  machine.begin('r1');
  const epoch = machine.epoch;
  assert.equal(machine.finish(epoch), false);
  assert.equal(machine.state, 'ANNOUNCING');
  machine.advance('ANNOUNCING', epoch);
  machine.advance('PREPARING', epoch);
  machine.advance('REVEALING', epoch);
  machine.advance('INTERPRETING', epoch);
  assert.equal(machine.state, 'CLOSING');
  assert.equal(machine.finish(epoch), false, 'the closing ceremony is not finished yet');
  assert.equal(machine.state, 'CLOSING');
  machine.advance('CLOSING', epoch);
  assert.equal(machine.state, 'RESETTING');
});

test('a second reading can never open a second ceremony', () => {
  let rejected = null;
  const machine = new TarotCeremony({ onReject: (info) => { rejected = info; } });
  assert.equal(machine.begin('r1'), true);
  assert.equal(machine.begin('r2'), false);
  assert.equal(machine.readingId, 'r1');
  assert.equal(rejected.reason, 'busy');
  assert.equal(rejected.readingId, 'r2');
});

test('callbacks from an older reading cannot drive the new one', () => {
  const machine = new TarotCeremony();
  machine.begin('r1');
  const staleEpoch = machine.epoch;
  machine.abort();
  machine.begin('r2');
  assert.notEqual(machine.epoch, staleEpoch);

  // A late timer from r1 tries to advance: it is dropped.
  assert.equal(machine.advance('ANNOUNCING', staleEpoch), false);
  assert.equal(machine.state, 'ANNOUNCING');
  assert.equal(machine.isCurrent(staleEpoch), false);
  assert.equal(machine.isCurrent(machine.epoch), true);
});

test('a transition from the wrong phase is ignored', () => {
  const machine = new TarotCeremony();
  machine.begin('r1');
  const epoch = machine.epoch;
  assert.equal(machine.advance('PREPARING', epoch), false, 'cannot skip ANNOUNCING');
  assert.equal(machine.advance('ANNOUNCING', epoch), true);
  assert.equal(machine.state, 'PREPARING');
  assert.equal(machine.advance('ANNOUNCING', epoch), false, 'ANNOUNCING is already done');
  assert.equal(machine.state, 'PREPARING');
});

test('abort invalidates timers and returns to idle', () => {
  const machine = new TarotCeremony();
  machine.begin('r1');
  const epoch = machine.epoch;
  machine.abort();
  assert.equal(machine.state, 'IDLE');
  assert.equal(machine.busy, false);
  assert.equal(machine.advance('ANNOUNCING', epoch), false);
});

// ------------------------------------------------------------- clip plan

test('the ceremony plan covers announce, prepare, reveal, interpret and closing', () => {
  const draw = reading(THREE);
  const result = buildReadingResult(draw);
  const clips = buildCeremonyClips(draw, result);

  // The closing line is synthesised early (right after the preparation), so the
  // phase order in the plan is announce, prepare, closing, reveal, interpret.
  assert.deepEqual([...new Set(clips.map((clip) => clip.phase))], ['announce', 'prepare', 'closing', 'reveal', 'interpret']);
  assert.equal(clips[0].phase, 'announce');
  assert.equal(clips[0].phase, 'announce');
  // The name is its own short clip so the constant sentence stays cacheable.
  assert.equal(clips[0].text, 'Emily,');
  assert.equal(clips[1].phase, 'announce');
  assert.match(clips[1].text, /^your turn has arrived\./);
  assert.match(clips[1].text, /The cards are ready to reveal your destiny\./);
  assert.match(clips.find((clip) => clip.phase === 'prepare').text, /Take a deep breath\./);
  // The closing line is queued early so its (cached) audio is ready in time.
  const closing = clips.filter((clip) => clip.phase === 'closing');
  assert.equal(closing.length, 1);
  assert.equal(closing[0].text, CEREMONY_CLOSING_TEXT);
  assert.equal(clips[3].phase, 'closing');

  const reveal = clips.filter((clip) => clip.phase === 'reveal');
  assert.equal(reveal.length, 3);
  assert.match(reveal[0].text, /^The first card is The Hermit, in the past\.$/);
  assert.match(reveal[1].text, /Seven of Swords, reversed, in the present\./);
  assert.match(reveal[2].text, /^The final card is The Sun, in the future\.$/);

  const interpret = clips.filter((clip) => clip.phase === 'interpret');
  assert.ok(interpret.length >= 5, 'the verdict and every section are spoken');
  assert.match(interpret[0].text, /percent good fortune/);
  for (const section of result.sections) {
    assert.ok(interpret.some((clip) => clip.text.startsWith(`${section.label}.`)), `${section.label} is not narrated`);
  }
  // Orders are unique and ascending.
  assert.deepEqual(clips.map((clip) => clip.order), clips.map((_, index) => index));
});

test('a one-card ceremony reveals one card and never invents another', () => {
  const draw = reading(ONE, { user: 'Maya', topicLabel: 'Love Reading', theme: 'love', topicId: 'love_reading' });
  const result = buildReadingResult(draw);
  const clips = buildCeremonyClips(draw, result);
  const reveal = clips.filter((clip) => clip.phase === 'reveal');
  assert.equal(reveal.length, 1);
  assert.match(reveal[0].text, /^The card is The Star, in the guidance\.$/);
  assert.match(clips[0].text, /^Maya,$/);
  assert.match(clips[1].text, /^your turn has arrived\./);
  assert.equal(clips.filter((clip) => clip.phase === 'closing').length, 1);
  assert.ok(clips.length <= 20);
});

test('the ceremony plan is derivable from the reading result alone', () => {
  const draw = reading(THREE);
  const result = buildReadingResult(draw);
  const fromResult = buildCeremonyClips({ ...draw, cards: result.cards }, result);
  assert.ok(fromResult.length > 0);
  assert.equal(buildCeremonyClips(draw, null).length, 0);
});

// ------------------------------------------------------------ tts boundaries

test('the clip queue reports the start and the end of every clip', () => {
  const events = [];
  const audios = [];
  const queue = new TtsQueue({
    create: (clip) => {
      const audio = {
        play: () => Promise.resolve(),
        pause() {},
        finish() { if (audio.onended) audio.onended(); }
      };
      audios.push(audio);
      return audio;
    },
    onStart: (clip) => events.push(`start:${clip.id}`),
    onEnd: (clip) => events.push(`end:${clip.id}`)
  });
  queue.push({ id: 'a', url: 'a.wav' });
  queue.push({ id: 'b', url: 'b.wav' });
  assert.deepEqual(events, ['start:a']);
  audios[0].finish();
  assert.deepEqual(events, ['start:a', 'end:a', 'start:b']);
  audios[1].finish();
  assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b']);
});

test('a failing clip still ends once and unblocks the queue', () => {
  const events = [];
  const queue = new TtsQueue({
    create: () => ({ play: () => Promise.reject(new Error('blocked')), pause() {} }),
    onStart: (clip) => events.push(`start:${clip.id}`),
    onEnd: (clip) => events.push(`end:${clip.id}`)
  });
  queue.push({ id: 'a', url: 'a.wav' });
  return Promise.resolve().then(() => {
    assert.deepEqual(events, ['start:a', 'end:a']);
    assert.equal(queue.busy, false);
  });
});

// ------------------------------------------------------------ stage wiring

test('the stage owns one ceremony and queues readings instead of overlapping', () => {
  const js = read('public/js/stage.js');
  assert.match(js, /new window\.TarotCeremony\(\{ onEnter: handleCeremonyState \}\)/);
  assert.match(js, /function startCeremony\(reading\)/);
  assert.match(js, /if \(ceremonyBusy\(\)\) \{\n\s+queuePending\(reading\);/);
  assert.match(js, /function startNextPending\(\)/);
  assert.match(js, /function routeClip\(clip\)/);
  assert.match(js, /function maybeAdvance\(state, epoch\)/);
  assert.match(js, /function handleClipStart\(clip\)/);
  assert.match(js, /function handleClipEnd\(clip\)/);
  assert.match(js, /onStart: \(clip\) => handleClipStart\(clip\)/);
  assert.match(js, /onEnd: \(clip\) => handleClipEnd\(clip\)/);
  assert.match(js, /document\.addEventListener\('visibilitychange'/);
  // Ambient conversation is paused for the ceremony and resumed only at IDLE.
  assert.match(js, /conversation\.notifyReading\(true, 180000\)/);
  assert.match(js, /case 'IDLE':[\s\S]*?conversation\.notifyReading\(false\)/);
  // Existing music ducking and the single shared queue are untouched.
  assert.match(js, /music\.setDuck\(playing \|\| size > 0\)/);
  assert.equal((js.match(/new window\.TtsQueue\(/g) || []).length, 1);
  assert.equal((js.match(/new window\.ReadingResetTimer\(/g) || []).length, 1);
  // A legacy reset may not end a ceremony that is still mid-flow.
  assert.match(js, /if \(ceremony && ceremony\.busy && ceremony\.state !== 'CLOSING' && ceremony\.state !== 'RESETTING'\) return;/);
  // The reset still turns the cards down and returns the table to idle.
  assert.match(js, /classList\.remove\('revealed'\)/);
  assert.match(js, /function cardResetDelayMs\(\)/);
  assert.match(js, /return 3000;/);
});

test('the stage shows each ceremony screen from its phase', () => {
  const js = read('public/js/stage.js');
  assert.match(js, /ceremonyKickerEl\.textContent = '🔮 YOUR TURN HAS ARRIVED'/);
  assert.match(js, /ceremonyNameEl\.textContent = String\(reading\.user \|\| 'Seeker'\)\.toUpperCase\(\)/);
  assert.match(js, /ceremonyTopicEl\.textContent = String\(label\)\.toUpperCase\(\)/);
  assert.match(js, /ceremonyMessageEl\.textContent = 'THE SPIRITS ARE GATHERING\.\.\.'/);
  assert.match(js, /ceremonyKickerEl\.textContent = '✦ YOUR READING IS COMPLETE ✦'/);
  assert.match(js, /ceremonyMessageEl\.textContent = 'May the spirits guide your path\.'/);
  assert.match(js, /case 'REVEALING':[\s\S]*?prepareCardRow\(reading\)/);
  assert.match(js, /case 'INTERPRETING':[\s\S]*?revealAllCards\(\);[\s\S]*?showResult\(reading\)/);
});

test('the ceremony markup, styles and module load before the controller', () => {
  const html = read('public/index.html');
  for (const id of ['ceremony', 'ceremonyIcon', 'ceremonyKicker', 'ceremonyName', 'ceremonyTopic', 'ceremonyDeck', 'ceremonyMessage']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /YOUR TURN HAS ARRIVED/);
  assert.match(html, /THE SPIRITS ARE GATHERING\.\.\./);
  const css = html.indexOf('/css/stage-ceremony.css');
  const tarotCss = html.indexOf('/css/stage-tarot.css');
  const module = html.indexOf('/js/tarot-ceremony.js');
  const stage = html.indexOf('/js/stage.js');
  assert.ok(css > tarotCss, 'ceremony styles must load after the tarot layer');
  assert.ok(module > 0 && module < stage, 'tarot-ceremony.js must load before stage.js');

  const styles = read('public/css/stage-ceremony.css');
  assert.match(styles, /\.ceremony \{[\s\S]*?position: absolute;/);
  assert.match(styles, /\.ceremony\.phase-announce \.ceremony-name/);
  assert.match(styles, /\.ceremony\.phase-prepare \.ceremony-deck/);
  assert.match(styles, /\.ceremony\.phase-closing \.ceremony-message/);
  assert.match(styles, /@keyframes deckSmoke/);
  assert.match(styles, /width: 780px;/);
});

// ------------------------------------------------------------ server wiring

test('the server sends the ceremony plan and phase-tagged clips', () => {
  const server = read('server.js');
  assert.match(server, /const \{ buildReadingResult, applyAiInterpretation, buildCeremonyClips, CEREMONY_ANNOUNCE_LINE, CEREMONY_PREPARE_LINE, CEREMONY_CLOSING_TEXT \} = require\('\.\/tarot-reading-library'\);/);
  assert.match(server, /const ceremonyClips = request\.announce === true && state\.settings\.ttsEnabled !== false/);
  assert.match(server, /broadcastNotification\('tarot\.reading', \{ reading, tarot: tarotSnapshot\(\), ceremony: ceremonyPlan \}\);/);
  assert.match(server, /announceTarotReading\(reading, result, ceremonyClips\)/);
  assert.match(server, /const MAX_CEREMONY_PARTS = 20;/);
  assert.match(server, /phase: clip\.phase,/);
  assert.match(server, /order: clip\.order,/);
});
