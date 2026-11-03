'use strict';

/**
 * Mystic Witch Live — tarot reading topics.
 *
 * The twelve topics from the stage design live here as defaults. Admin can add,
 * edit, delete, reorder, enable or disable them; the same module rotates them on
 * the stage and matches a natural English comment to the right topic.
 */

const TOPIC_VERSION = 1;
const MAX_TOPICS = 40;
const ROTATION_SECONDS = [3, 5, 6, 8, 10, 15, 20];

const TOPIC_DEFAULTS = [
  {
    id: 'family_reading',
    label: 'Family Reading',
    theme: 'family',
    keywords: ['family', 'mom', 'mother', 'dad', 'father', 'parents', 'sister', 'brother', 'siblings', 'child', 'children', 'home', 'grandma', 'grandpa', 'relatives']
  },
  {
    id: 'personality_reading',
    label: 'Personality Reading',
    theme: 'personality',
    keywords: ['personality', 'myself', 'who am i', 'character', 'traits', 'strengths', 'weaknesses', 'my nature', 'about me']
  },
  {
    id: 'name_reading',
    label: 'Name Reading',
    theme: 'personality',
    keywords: ['name', 'my name', 'name meaning', 'surname', 'nickname', 'rename']
  },
  {
    id: 'this_weeks_fortune',
    label: "This Week's Fortune",
    theme: 'future',
    keywords: ['this week', 'week ahead', 'weekly', 'next 7 days', 'coming week', 'the week']
  },
  {
    id: 'todays_fortune',
    label: "Today's Fortune",
    theme: 'general',
    keywords: ['today', 'tonight', 'this day', 'this morning', 'this evening', 'right now']
  },
  {
    id: 'my_question',
    label: 'My Question',
    theme: 'general',
    keywords: ['my question', 'i have a question', 'question for the cards', 'ask the cards', 'question']
  },
  {
    id: 'love_reading',
    label: 'Love Reading',
    theme: 'love',
    keywords: ['love', 'relationship', 'partner', 'boyfriend', 'girlfriend', 'romance', 'marriage', 'soulmate', 'dating', 'breakup', 'ex', 'heart']
  },
  {
    id: 'crush_reading',
    label: 'Crush Reading',
    theme: 'love',
    keywords: ['crush', 'secret love', 'someone i like', 'does he like me', 'does she like me', 'admirer', 'feelings for']
  },
  {
    id: 'future_partner',
    label: 'Future Partner',
    theme: 'love',
    keywords: ['future partner', 'future husband', 'future wife', 'who will i marry', 'marriage partner', 'future lover', 'soul mate']
  },
  {
    id: 'career_reading',
    label: 'Career Reading',
    theme: 'career',
    keywords: ['career', 'job', 'work', 'business', 'boss', 'promotion', 'interview', 'profession', 'office', 'project', 'coworker']
  },
  {
    id: 'wealth_reading',
    label: 'Wealth Reading',
    theme: 'wealth',
    keywords: ['wealth', 'money', 'finance', 'financial', 'rich', 'income', 'salary', 'debt', 'investment', 'savings', 'prosperity']
  },
  {
    id: 'study_reading',
    label: 'Study Reading',
    theme: 'study',
    keywords: ['study', 'exam', 'school', 'university', 'college', 'grades', 'learning', 'student', 'test', 'class', 'homework']
  }
];

function cleanText(value, maxLength = 80) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function slug(value) {
  return cleanText(value, 60)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function normalizeKeywords(raw, label) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const cleaned = list
    .map((item) => cleanText(item, 40).toLowerCase())
    .filter(Boolean);
  if (!cleaned.length && label) cleaned.push(cleanText(label, 40).toLowerCase().replace(/ reading$/, ''));
  return [...new Set(cleaned)];
}

/** Deduplicate by id and by label so the same topic cannot appear twice. */
function normalizeTopics(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : TOPIC_DEFAULTS;
  const seenIds = new Set();
  const seenLabels = new Set();
  const topics = [];
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const label = cleanText(item.label || item.name || item.title, 60);
    if (!label) return;
    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) return;
    let id = slug(item.id) || slug(label) || `topic_${index + 1}`;
    while (seenIds.has(id)) id = `${id}_${index + 1}`;
    seenIds.add(id);
    seenLabels.add(labelKey);
    const fallback = TOPIC_DEFAULTS.find((topic) => topic.label.toLowerCase() === labelKey);
    topics.push({
      id,
      label,
      theme: cleanText(item.theme || (fallback && fallback.theme) || 'general', 20) || 'general',
      keywords: normalizeKeywords(item.keywords || (fallback && fallback.keywords), label),
      enabled: item.enabled !== false,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
    });
  });
  if (!topics.length) return normalizeTopics(TOPIC_DEFAULTS);
  return topics
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_TOPICS)
    .map((topic, index) => ({ ...topic, order: index }));
}

function defaultTopicSettings() {
  return { enabled: true, rotationSeconds: 6, columns: 2, rows: 3 };
}

function normalizeTopicSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rotation = Number(source.rotationSeconds);
  return {
    enabled: source.enabled !== false,
    rotationSeconds: ROTATION_SECONDS.includes(rotation) ? rotation : 6,
    columns: 2,
    rows: Math.max(1, Math.min(4, Number(source.rows) || 3))
  };
}

/**
 * Match a natural English comment to one topic.
 * Longest keyword wins, then catalog order. A question with no keyword match
 * lands on "My Question" so the viewer's own wording is preserved.
 */
function detectTopic(rawText, topics) {
  const text = cleanText(rawText, 240);
  if (!text) return null;
  const list = normalizeTopics(topics).filter((topic) => topic.enabled !== false);
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9'\s?]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let best = null;
  for (const topic of list) {
    for (const keyword of topic.keywords) {
      const needle = ` ${keyword} `;
      if (!normalized.includes(needle)) continue;
      const score = keyword.length;
      if (!best || score > best.score) best = { topic, keyword, score };
    }
  }
  if (best) {
    return {
      topicId: best.topic.id,
      label: best.topic.label,
      theme: best.topic.theme,
      keyword: best.keyword,
      matched: true
    };
  }
  const isQuestion = /\?/.test(text) || /^\s*(what|when|where|who|why|how|will|should|can|is|are|does|do)\b/i.test(text);
  if (!isQuestion) return null;
  const fallback =
    list.find((topic) => topic.id === 'my_question') ||
    list.find((topic) => topic.theme === 'general') ||
    list[0];
  return {
    topicId: fallback.id,
    label: fallback.label,
    theme: fallback.theme,
    keyword: '',
    matched: false
  };
}

/** Keep the viewer's actual words, minus the ritual prefixes. */
function extractQuestion(rawText) {
  return cleanText(
    String(rawText || '')
      .replace(/^\s*(@\w+\s*)/g, '')
      .replace(/^(?:\s*(?:tarot|reading|cards?|fortune)\b\s*[:,-]?\s*)+/i, '')
      .replace(/\s+/g, ' '),
    200
  );
}

/** Two columns, `rows` visible per column, one step of rotation per interval. */
function rotateTopics(topics, settings, nowValue) {
  const config = normalizeTopicSettings(settings);
  const requested = Number(nowValue);
  const now = Number.isFinite(requested) ? requested : Date.now();
  const enabled = normalizeTopics(topics).filter((topic) => topic.enabled !== false);
  const perPage = config.columns * config.rows;
  const stepMs = Math.max(1000, config.rotationSeconds * 1000);
  const step = enabled.length ? Math.floor(now / stepMs) % enabled.length : 0;
  const columns = [];
  for (let column = 0; column < config.columns; column += 1) {
    const items = [];
    for (let row = 0; row < config.rows; row += 1) {
      const index = enabled.length ? (step + column * config.rows + row) % enabled.length : -1;
      if (index >= 0 && enabled[index]) items.push({ label: enabled[index].label, id: enabled[index].id });
    }
    columns.push(items);
  }
  return {
    step,
    total: enabled.length,
    rotationSeconds: config.rotationSeconds,
    columns,
    perPage: perPage > enabled.length ? enabled.length : perPage
  };
}

module.exports = {
  TOPIC_VERSION,
  TOPIC_DEFAULTS,
  MAX_TOPICS,
  ROTATION_SECONDS,
  normalizeTopics,
  normalizeTopicSettings,
  defaultTopicSettings,
  detectTopic,
  extractQuestion,
  rotateTopics,
  slug,
  cleanText
};
