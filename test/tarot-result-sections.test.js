'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DECK } = require('../tarot-engine');
const { TOPIC_DEFAULTS } = require('../tarot-topics');
const {
  CLOSING_LINE,
  MAX_SECTION_CHARS,
  buildReadingResult,
  parseAiSections,
  applyAiInterpretation,
  resolveProfileKey,
  spokenScript
} = require('../tarot-reading-library');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const POSITIONS = ['Past', 'Present', 'Future'];

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

function reading(cards, topic = {}) {
  return {
    user: topic.user || 'Emily',
    theme: topic.theme || 'general',
    topicId: topic.topicId || '',
    topicLabel: topic.topicLabel || '',
    question: topic.question || 'What do the cards see?',
    spread: cards.length === 1 ? 'one' : 'three',
    cards
  };
}

const FAMILY_SECTIONS = [
  'Family Energy',
  'Family Relationships',
  'Hidden Concerns',
  'Current Challenges',
  'Coming Changes',
  'Oracle Advice'
];

// ----------------------------------------------------------------- structure

test('Family Reading ships all six requested sections, in order', () => {
  const result = buildReadingResult(
    reading(
      [card('The Empress', false, 'Past'), card('Five of Wands', true, 'Present'), card('Ten of Pentacles', false, 'Future')],
      { theme: 'family', topicId: 'family_reading', topicLabel: 'Family Reading' }
    )
  );
  assert.deepEqual(result.sections.map((section) => section.label), FAMILY_SECTIONS);
  assert.equal(result.profile, 'family');
  for (const section of result.sections) {
    assert.ok(section.text.length >= 40, `${section.label} is too short`);
    assert.ok(section.text.length <= MAX_SECTION_CHARS, `${section.label} is too long`);
  }
  // The panel shows every section, so every section must be in the message too.
  for (const label of FAMILY_SECTIONS) {
    assert.equal(result.sections.filter((section) => section.label === label).length, 1);
  }
  assert.ok(result.oracleMessage.includes(result.sections[2].text));
});

test('every topic owns a different set of relevant section labels', () => {
  const cards = [card('The Star', false, 'Past'), card('Three of Cups', false, 'Present'), card('The Tower', true, 'Future')];
  const byProfile = new Map();
  for (const topic of TOPIC_DEFAULTS) {
    const result = buildReadingResult(
      reading(cards, { theme: topic.theme, topicId: topic.id, topicLabel: topic.label })
    );
    const labels = result.sections.map((section) => section.label);
    assert.equal(labels.length, 6, `${topic.label} should have six sections`);
    assert.equal(new Set(labels).size, 6, `${topic.label} repeats a section label`);
    assert.ok(result.sections.every((section) => section.text.trim().length > 0));
    const profile = resolveProfileKey(reading(cards, { theme: topic.theme, topicId: topic.id, topicLabel: topic.label }));
    byProfile.set(profile, labels);
  }
  // The eight requested topics are all distinct interpretations, not one shared paragraph.
  const required = ['family', 'love', 'crush', 'partner', 'career', 'wealth', 'study', 'personality', 'future', 'general'];
  for (const profile of required) {
    assert.ok(byProfile.has(profile), `no sections for ${profile}`);
  }
  const signatures = required.map((profile) => byProfile.get(profile).join('|'));
  assert.equal(new Set(signatures).size, required.length, 'two topics share the same section structure');
  assert.deepEqual(byProfile.get('family'), FAMILY_SECTIONS);
});

test('the requested topic outranks the generic My Question fallback', () => {
  const cards = [card('Nine of Cups', true, 'Past'), card('Ace of Wands', false, 'Present'), card('The Sun', false, 'Future')];
  const result = buildReadingResult(
    reading(cards, { theme: 'career', topicId: 'my_question', topicLabel: 'Career Reading' })
  );
  assert.equal(result.profile, 'career');
  assert.equal(result.sections[0].label, 'Work Energy');
  assert.equal(result.headline, 'CAREER READING FOR EMILY');
  // A deliberately specific topic still wins over the shared theme.
  const crush = buildReadingResult(reading(cards, { theme: 'love', topicId: 'crush_reading', topicLabel: 'Crush Reading' }));
  assert.equal(crush.profile, 'crush');
  assert.equal(crush.sections[0].label, 'Your Inner Weather');
});

test('sections are generated from the drawn cards, orientation and spread position', () => {
  const cards = [card('The Hermit', false, 'Past'), card('Seven of Swords', true, 'Present'), card('The Sun', false, 'Future')];
  const result = buildReadingResult(
    reading(cards, { theme: 'family', topicId: 'family_reading', topicLabel: 'Family Reading' })
  );
  const text = result.sections.map((section) => section.text).join(' ');
  for (const entry of cards) {
    assert.ok(text.includes(entry.name), `${entry.name} is never referenced`);
  }
  assert.match(text, /reversed/);
  assert.match(text, /upright/);
  assert.match(text.toLowerCase(), /past/);
  assert.match(text.toLowerCase(), /future/);
  // The card a section names is recorded, so the panel and the tests can trace it.
  assert.deepEqual(result.sections[0].cards, ['The Hermit']);
  assert.ok(result.sections[5].cards.includes('Seven of Swords reversed'));
});

test('consecutive readings differ, while the same draw stays reproducible', () => {
  const topic = { theme: 'family', topicId: 'family_reading', topicLabel: 'Family Reading' };
  const first = buildReadingResult(reading([card('The Empress', false, 'Past'), card('The Moon', true, 'Present'), card('The World', false, 'Future')], topic));
  const repeat = buildReadingResult(reading([card('The Empress', false, 'Past'), card('The Moon', true, 'Present'), card('The World', false, 'Future')], topic));
  assert.deepEqual(repeat.sections, first.sections, 'the same draw must reproduce the same reading');

  const second = buildReadingResult(reading([card('The Fool', true, 'Past'), card('Ace of Cups', false, 'Present'), card('The Devil', false, 'Future')], topic));
  const changed = second.sections.filter((section, index) => section.text !== first.sections[index].text).length;
  assert.ok(changed >= 4, `only ${changed} of six sections changed between readings`);
  assert.notEqual(second.oracleMessage, first.oracleMessage);
});

test('every card in both orientations fills every section', () => {
  assert.equal(DECK.length, 78);
  for (const entry of DECK) {
    for (const reversed of [false, true]) {
      const result = buildReadingResult(
        reading([card(entry.name, reversed)], { theme: 'love', topicId: 'love_reading', topicLabel: 'Love Reading' })
      );
      assert.equal(result.sections.length, 6, `${entry.name} lost a section`);
      for (const section of result.sections) {
        assert.ok(section.text.length >= 40, `${entry.name} ${section.label} is empty`);
        assert.ok(section.text.length <= MAX_SECTION_CHARS);
      }
      assert.ok(result.oracleMessage.includes(entry.name));
      assert.ok(result.oracleMessage.includes(CLOSING_LINE));
      if (reversed) assert.match(result.oracleMessage, new RegExp(`${entry.name} reversed`));
    }
  }
});

// ----------------------------------------------------------------- AI merge

test('AI section lines replace the built-in sections and drive the narration', () => {
  const cards = [card('The Star', false, 'Past'), card('Two of Cups', false, 'Present'), card('The Chariot', true, 'Future')];
  const base = buildReadingResult(reading(cards, { theme: 'love', topicId: 'love_reading', topicLabel: 'Love Reading' }));
  const labels = base.sections.map((section) => section.label);
  const aiText = labels
    .map((label) => `${label}: ${label} speaks here, with The Star upright in the past and The Chariot reversed ahead, asking for one honest conversation rather than another silent week.`)
    .join('\n');
  const merged = applyAiInterpretation(base, aiText, { provider: 'ollama' });

  assert.equal(merged.source, 'ai');
  assert.equal(merged.provider, 'ollama');
  assert.deepEqual(merged.sections.map((section) => section.label), labels);
  assert.deepEqual(merged.cards, base.cards);
  assert.equal(merged.fortune, base.fortune);
  assert.ok(merged.sections.every((section) => section.text.includes('The Star upright')));
  assert.ok(!merged.spoken.some((line) => line.includes(base.sections[0].text)), 'narration still reads the built-in text');
  assert.ok(merged.spoken.some((line) => line.includes(`${labels[0]}.`) && line.includes('honest conversation')));
  assert.equal(merged.spoken[merged.spoken.length - 1], CLOSING_LINE);
});

test('a label-free AI answer still merges as one Oracle section', () => {
  const cards = [card('The Sun', false, 'Future')];
  const base = buildReadingResult(reading(cards, { theme: 'career', topicId: 'career_reading', topicLabel: 'Career Reading' }));
  const text = 'The Sun sits upright in your future, and it asks you to finish the ordinary work in front of you before asking for a bigger stage.';
  const merged = applyAiInterpretation(base, text, { provider: 'openrouter' });
  assert.equal(merged.source, 'ai');
  assert.equal(merged.sections.length, 1);
  assert.equal(merged.sections[0].label, "Oracle's Message");
  assert.ok(merged.oracleMessage.includes(text));
  assert.ok(merged.spoken.some((line) => line.includes("Oracle's Message.")));
});

test('AI text that invents a card never reaches the sections', () => {
  const cards = [card('The Star', false, 'Future')];
  const base = buildReadingResult(reading(cards, { theme: 'study', topicId: 'study_reading', topicLabel: 'Study Reading' }));
  const text = `Hidden Blocks: The Tower reversed is behind this block, so stop pretending the method is the problem when it is clearly the whole approach.`;
  const merged = applyAiInterpretation(base, text, { provider: 'ollama' });
  assert.notEqual(merged.source, 'ai');
  assert.match(merged.aiError, /unknown_card/);
  assert.deepEqual(merged.sections, base.sections);
});

test('the label parser keeps order and rejects half-written lines', () => {
  const sections = parseAiSections([
    'Family Energy: The house is warm but tired, and The Empress upright in the past says so.',
    'Hidden Concerns: short',
    'Oracle Advice: Speak to the person who taught you to keep quiet, and do it without an audience this time.'
  ].join('\n'));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].label, "Oracle's Message");
});

// ----------------------------------------------------------------- narration

test('narration reads every section of the result, never a fixed placeholder', () => {
  const cards = [card('The Moon', true, 'Past'), card('The Empress', false, 'Present'), card('The Star', false, 'Future')];
  const result = buildReadingResult(reading(cards, { theme: 'family', topicId: 'family_reading', topicLabel: 'Family Reading' }));
  const spoken = result.spoken.join(' ');
  for (const section of result.sections) {
    assert.ok(spoken.includes(`${section.label}.`), `${section.label} is not spoken`);
  }
  assert.match(spoken, /percent good fortune/);
  assert.equal(result.spoken[result.spoken.length - 1], CLOSING_LINE);
  // The old generic verdict is no longer read on its own.
  assert.ok(!result.spoken.some((line) => line === CLOSING_LINE && result.spoken.indexOf(line) === 0));
  assert.ok(result.spoken.length <= 14);
  const script = spokenScript('Emily', 'Family Reading', cards, 61, 39, result.sections);
  assert.equal(script[0], 'Welcome, Emily. The Oracle is ready to read your family reading.');
});

// ------------------------------------------------------------- stage + server

test('the stage renders the sections and keeps them inside the result box', () => {
  const html = read('public/index.html');
  assert.match(html, /id="resultSections"/);
  const js = read('public/js/stage.js');
  assert.match(js, /function renderResultSections\(result\)/);
  assert.match(js, /resultSectionsEl\.innerHTML = sections/);
  assert.match(js, /function fitResultSections\(\)/);
  assert.match(js, /while \(size > 11 && resultSectionsEl\.scrollHeight > resultSectionsEl\.clientHeight/);
  assert.match(js, /renderResultSections\(result\);/);
  assert.match(js, /oracle\.classList\.toggle\('is-hidden', Boolean\(sections\.length\)\)/);
  const css = read('public/css/stage-tarot.css');
  assert.match(css, /\.result-sections \{[\s\S]*?grid-template-columns: 1fr 1fr;/);
  assert.match(css, /\.result-sections \{[\s\S]*?max-height: 320px;/);
  assert.match(css, /\.result-section-label \{/);
  assert.match(css, /\.result-sections\.is-hidden,/);
});

test('the AI prompt asks for the topic section labels and narration covers them', () => {
  const server = read('server.js');
  assert.match(server, /`Sections: \$\{sectionLabels\.join\(' \| '\)\}`/);
  assert.match(server, /\"Section Label: one or two sentences\"/);
  assert.match(server, /const MAX_CEREMONY_PARTS = 20;/);
  assert.match(server, /announceTarotReading\(reading, result, ceremonyClips\)/);
});
