const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'music.js'), 'utf8');

/**
 * Loads public/js/music.js in a sandbox with a fake Audio element and a
 * localStorage stub, so playlist behaviour can be asserted without a browser.
 */
function createHarness(seed = {}) {
  const store = new Map(Object.entries(seed));
  const elements = [];

  class FakeAudio {
    constructor() {
      this.src = '';
      this.volume = 1;
      this.currentTime = 0;
      this.duration = 100;
      this.muted = false;
      this.paused = true;
      this.listeners = {};
      elements.push(this);
    }

    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    }

    emit(type) {
      (this.listeners[type] || []).forEach((handler) => handler({ type }));
    }

    play() {
      this.paused = false;
      this.emit('play');
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
      this.emit('pause');
    }

    load() {}
  }

  const sandbox = {
    window: {},
    console,
    Audio: FakeAudio,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Promise,
    parseInt,
    parseFloat,
    isFinite,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value))
    },
    document: { addEventListener: () => {} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const player = new sandbox.window.ShopMusicPlayer({ role: 'stage' });
  return { player, elements, store, playlist: sandbox.window.SHOP_MUSIC_PLAYLIST };
}

test('music: the playlist lists every bundled track', () => {
  const { playlist } = createHarness();
  assert.equal(playlist.length, 10);
  for (const track of playlist) {
    assert.match(track.url, /^\/assets\/music\/[\w-]+\.mp3$/);
    assert.ok(track.title.length > 0);
  }
  const files = fs.readdirSync(path.join(__dirname, '..', 'public', 'assets', 'music'));
  assert.equal(files.filter((name) => name.endsWith('.mp3')).length, playlist.length);
  // The café collection must never come back into the active playlist.
  for (const stale of ['sunny-morning', 'summer-lemonade', 'happy-cafe', 'coffee-break']) {
    assert.ok(!playlist.some((track) => track.id === stale), `${stale} is not part of the soundtrack`);
  }
});

test('music: next and previous move through the list and persist the track', async () => {
  const { player, store, playlist } = createHarness();
  player.index = 0;
  await player.next();
  assert.equal(player.index, 1);
  assert.equal(store.get('shop_music_track'), '1');

  await player.previous();
  assert.equal(player.index, 0);

  await player.previous();
  assert.equal(player.index, playlist.length - 1, 'previous wraps to the last track');
});

test('music: a finished track advances to the next one', async () => {
  const { player } = createHarness();
  player.index = 2;
  player.repeat = true;
  const audio = player.ensureAudio();
  audio.src = player.track.url;
  audio.emit('ended');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(player.index, 3);
});

test('music: repeat off stops at the end of the playlist', async () => {
  const { player } = createHarness();
  player.repeat = false;
  player.shuffle = false;
  player.index = player.playlist.length - 1;
  const audio = player.ensureAudio();
  audio.src = player.track.url;
  audio.paused = false;
  player.playing = true;
  audio.emit('ended');
  assert.equal(player.index, player.playlist.length - 1);
  assert.equal(player.playing, false);
});

test('music: repeat on wraps from the last track to the first', async () => {
  const { player } = createHarness();
  player.repeat = true;
  player.shuffle = false;
  player.index = player.playlist.length - 1;
  const audio = player.ensureAudio();
  audio.src = player.track.url;
  audio.emit('ended');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(player.index, 0);
});

test('music: shuffle never repeats the current track and is remembered', () => {
  const { player, store } = createHarness();
  player.setShuffle(true);
  assert.equal(player.shuffle, true);
  assert.equal(store.get('shop_music_shuffle'), '1');

  for (let i = 0; i < 30; i += 1) {
    const next = player.stepIndex(1);
    assert.notEqual(next, player.index, 'shuffle must pick a different track');
    assert.ok(next >= 0 && next < player.playlist.length);
    player.index = next;
  }
});

test('music: ducking lowers the music and restores it afterwards', () => {
  const { player } = createHarness();
  const audio = player.ensureAudio();
  player.setVolume(0.5);
  assert.equal(audio.volume, 0.5);

  player.setDuck(true);
  assert.equal(player.ducked, true);
  assert.ok(audio.volume < 0.5, 'music is quieter while the Witch speaks');
  assert.equal(Math.round(audio.volume * 1000) / 1000, 0.15);

  player.setDuck(false);
  assert.equal(audio.volume, 0.5, 'music returns to its previous level');
});

test('music: track changes never leave two tracks playing at once', async () => {
  const { player, elements } = createHarness();
  await player.play();
  await player.next();
  await player.next();

  const audible = elements.filter((element) => element.muted !== true);
  assert.equal(audible.length, 1, 'exactly one audible audio element exists');
  assert.equal(audible.filter((element) => !element.paused).length, 1, 'only one track is playing');
});
