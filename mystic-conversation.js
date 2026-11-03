/**
 * Mystic Witch Live — Mystic Conversation System catalog.
 *
 * The Oracle speaks alone, in English, in short ambient lines between readings.
 * Everything here is local and deterministic: no cloud AI, no external requests.
 * The server seeds these into game-state.json on first run; the Admin panel can
 * then edit, disable, add, delete or restore them and the changes persist.
 *
 * Categories cover the whole stream, including the zero-viewer hours:
 *   ambient    — the room talking to itself when nobody is watching
 *   welcome    — arrivals, openings, the circle re-forming
 *   story      — short mystical stories
 *   tarot      — tarot knowledge and card meanings
 *   engagement — questions that invite the chat to answer
 *   reading    — promoting a tarot reading
 *   greeting   — a named viewer arriving ({viewer})
 *   follow     — a new follower ({viewer})
 *   gift       — a gift arriving ({viewer})
 */

const ORACLE_VOICE = 'af_alloy';
const CONVERSATION_VERSION = 2;

const MYSTIC_CATEGORIES = [
  { id: 'ambient', label: 'Ambient musings', icon: '🕯️' },
  { id: 'welcome', label: 'Welcome messages', icon: '🚪' },
  { id: 'story', label: 'Mystical stories', icon: '📖' },
  { id: 'tarot', label: 'Tarot knowledge', icon: '🃏' },
  { id: 'engagement', label: 'Audience engagement', icon: '💬' },
  { id: 'reading', label: 'Reading promotion', icon: '🔮' },
  { id: 'greeting', label: 'Viewer greetings', icon: '👋' },
  { id: 'follow', label: 'Follow reactions', icon: '✦' },
  { id: 'gift', label: 'Gift reactions', icon: '🎁' }
];

const MYSTIC_INTERVALS = [45, 60, 90, 120, 180];

const MYSTIC_CONTEXTS = ['any', 'empty', 'quiet', 'newViewer', 'follower', 'gift'];

const DEFAULT_CONVERSATIONS = [
  // ------------------------------------------------------------ ambient (6)
  { id: 'ambient_1', category: 'ambient', text: 'The candles are lit and the cards are resting. We begin whenever you are ready.' },
  { id: 'ambient_2', category: 'ambient', text: 'The room is quiet tonight, the way it always is before a message arrives.' },
  { id: 'ambient_3', category: 'ambient', text: 'Somewhere beyond the screen the moon is doing her slow, patient work.' },
  { id: 'ambient_4', category: 'ambient', text: 'Breathe with me for a moment. The circle is open and there is no hurry.' },
  { id: 'ambient_5', category: 'ambient', text: 'The smoke curls upward and forgets where it was going. I like that about it.' },
  { id: 'ambient_6', category: 'ambient', text: 'Night keeps its own counsel. I keep mine, and sometimes I share it with you.' },

  // ------------------------------------------------------------ welcome (5)
  { id: 'welcome_1', category: 'welcome', text: 'Welcome back to the circle. The candles are lit and the deck is warm.' },
  { id: 'welcome_2', category: 'welcome', text: 'You found your way here again. The spirits noticed before I did.' },
  { id: 'welcome_3', category: 'welcome', text: 'Come in, sit close. The room is quiet and the cards are listening.' },
  { id: 'welcome_4', category: 'welcome', text: 'Welcome, wanderer. Whatever brought you here brought you at the right time.' },
  { id: 'welcome_5', category: 'welcome', text: 'The door was never locked. Welcome to Mystic Witch Live.' },

  // -------------------------------------------------------------- story (6)
  { id: 'story_1', category: 'story', text: 'There was once a girl who could hear the river speak. She never told anyone, and the river never stopped talking.' },
  { id: 'story_2', category: 'story', text: 'They say a witch once traded her reflection for a single true answer. She never regretted it, and she never looked in mirrors again.' },
  { id: 'story_3', category: 'story', text: 'In the old quarter every house had a key that opened no door. The keys were the point.' },
  { id: 'story_4', category: 'story', text: 'A sailor carried a candle through nine storms. It never lit, and it never went out.' },
  { id: 'story_5', category: 'story', text: 'The fortune teller kept one card face down her whole life. Her last words were, not yet.' },
  { id: 'story_6', category: 'story', text: 'A crow learned a single word and refused to use it. The village waited years, and the crow enjoyed every moment.' },

  // -------------------------------------------------------------- tarot (6)
  { id: 'tarot_1', category: 'tarot', text: 'The Moon is not a warning. It is an invitation to walk carefully through what you cannot see.' },
  { id: 'tarot_2', category: 'tarot', text: 'The Tower frightens people, but it only removes what was already falling.' },
  { id: 'tarot_3', category: 'tarot', text: 'Death in the cards is rarely about endings. It is the quiet after a long fever.' },
  { id: 'tarot_4', category: 'tarot', text: 'The Star asks for nothing but your attention. That is why it is so often missed.' },
  { id: 'tarot_5', category: 'tarot', text: 'The Hermit carries a lamp, not a torch. Some truths only survive a small light.' },
  { id: 'tarot_6', category: 'tarot', text: 'Every suit has a season. Cups for what we feel, swords for what we think, wands for what we chase, pentacles for what we carry.' },

  // --------------------------------------------------------- engagement (6)
  { id: 'engagement_1', category: 'engagement', text: 'Tell me what has been on your mind today. The cards are patient, and so am I.' },
  { id: 'engagement_2', category: 'engagement', text: 'If you could ask one question and be guaranteed a true answer, what would it be?' },
  { id: 'engagement_3', category: 'engagement', text: 'Type the first word that comes to you. We will see what it stirs.' },
  { id: 'engagement_4', category: 'engagement', text: 'Some of you are here for the reading. Some of you are here for the quiet. Both are welcome.' },
  { id: 'engagement_5', category: 'engagement', text: 'What is one thing you are ready to leave behind this month?' },
  { id: 'engagement_6', category: 'engagement', text: 'The chat is part of the circle tonight. Say something, and I will answer.' },

  // ------------------------------------------------------------ reading (5)
  { id: 'reading_1', category: 'reading', text: 'If a question has been circling you for days, a reading may give it somewhere to land.' },
  { id: 'reading_2', category: 'reading', text: 'One card is enough for a single question. Three cards are for a story that has not finished.' },
  { id: 'reading_3', category: 'reading', text: 'I can draw for you whenever you are ready. The deck does not judge the question.' },
  { id: 'reading_4', category: 'reading', text: 'A reading is not a verdict. It is a lantern held at a different angle.' },
  { id: 'reading_5', category: 'reading', text: 'Send your question, and I will let the cards answer in their own slow language.' },

  // ----------------------------------------------------------- greeting (5)
  { id: 'greeting_1', category: 'greeting', contexts: ['newViewer', 'quiet', 'empty'], text: 'Welcome, {viewer}. The circle opens a little wider for you.' },
  { id: 'greeting_2', category: 'greeting', contexts: ['newViewer', 'empty'], text: '{viewer} has arrived. The candles noticed.' },
  { id: 'greeting_3', category: 'greeting', contexts: ['newViewer', 'quiet'], text: 'Ah, {viewer}. I was wondering when you would find your way back.' },
  { id: 'greeting_4', category: 'greeting', contexts: ['newViewer', 'quiet'], text: 'Come closer, {viewer}. The cards have been restless tonight.' },
  { id: 'greeting_5', category: 'greeting', contexts: ['newViewer', 'empty'], text: 'Welcome, {viewer}. Whatever you carry in, you may set it down here.' },

  // ------------------------------------------------------------- follow (5)
  { id: 'follow_1', category: 'follow', contexts: ['follower', 'newViewer'], text: 'A new soul has joined the circle. {viewer}, the light is brighter for it.' },
  { id: 'follow_2', category: 'follow', contexts: ['follower'], text: '{viewer} follows the path now. The spirits keep good company.' },
  { id: 'follow_3', category: 'follow', contexts: ['follower'], text: 'Thank you, {viewer}. A follow is a small vow, and I do not take it lightly.' },
  { id: 'follow_4', category: 'follow', contexts: ['follower', 'newViewer'], text: '{viewer} has bound their thread to ours. Welcome to the weave.' },
  { id: 'follow_5', category: 'follow', contexts: ['follower'], text: 'The circle grows. {viewer}, may the cards speak kindly to you tonight.' },

  // --------------------------------------------------------------- gift (5)
  { id: 'gift_1', category: 'gift', contexts: ['gift'], text: 'A gift arrives, and the flame leans toward it. Thank you, {viewer}.' },
  { id: 'gift_2', category: 'gift', contexts: ['gift'], text: '{viewer}, your kindness has been received. The spirits are listening more closely now.' },
  { id: 'gift_3', category: 'gift', contexts: ['gift'], text: 'The candles flare for {viewer}. Generosity like that does not go unnoticed here.' },
  { id: 'gift_4', category: 'gift', contexts: ['gift'], text: 'Thank you, {viewer}. I will ask the cards to remember your name tonight.' },
  { id: 'gift_5', category: 'gift', contexts: ['gift'], text: 'A gift given freely carries its own light. Thank you, {viewer}.' }
];

const CATEGORY_IDS = MYSTIC_CATEGORIES.map((category) => category.id);

/** Strip control characters and collapse whitespace, keeping the text speakable. */
function mysticText(value, maxLength = 260) {
  return String(value == null ? '' : value)
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function mysticCategory(value) {
  const id = String(value || '').trim();
  return CATEGORY_IDS.includes(id) ? id : 'ambient';
}

function mysticContexts(raw) {
  const list = Array.isArray(raw) ? raw : ['any'];
  const cleaned = list
    .map((context) => String(context || '').trim())
    .filter((context) => MYSTIC_CONTEXTS.includes(context));
  return cleaned.length ? [...new Set(cleaned)] : ['any'];
}

function defaultMysticSettings() {
  const categories = {};
  for (const id of CATEGORY_IDS) categories[id] = true;
  return {
    enabled: true,
    running: true,
    aiDialogue: false,
    interval: 60,
    shuffle: true,
    categories
  };
}

function normalizeMysticSettings(raw) {
  const defaults = defaultMysticSettings();
  const source = raw && typeof raw === 'object' ? raw : {};
  const categories = { ...defaults.categories };
  if (source.categories && typeof source.categories === 'object') {
    for (const id of CATEGORY_IDS) {
      if (typeof source.categories[id] === 'boolean') categories[id] = source.categories[id];
    }
  }
  const requested = Number(source.interval);
  return {
    enabled: source.enabled !== false,
    running: source.running !== false,
    aiDialogue: source.aiDialogue === true,
    interval: MYSTIC_INTERVALS.includes(requested) ? requested : defaults.interval,
    shuffle: source.shuffle !== false,
    categories,
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : null
  };
}

function normalizeMysticLine(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const text = mysticText(raw.text);
  if (!text) return null;
  const baseId = String(raw.id || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 48);
  return {
    id: baseId || `mystic_${index + 1}`,
    category: mysticCategory(raw.category),
    text,
    contexts: mysticContexts(raw.contexts),
    enabled: raw.enabled !== false,
    custom: raw.custom === true,
    edited: raw.edited === true,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null
  };
}

function defaultMysticLines() {
  return DEFAULT_CONVERSATIONS.map((entry, index) =>
    normalizeMysticLine({ ...entry, enabled: true, custom: false, edited: false }, index)
  ).filter(Boolean);
}

module.exports = {
  ORACLE_VOICE,
  CONVERSATION_VERSION,
  MYSTIC_CATEGORIES,
  MYSTIC_INTERVALS,
  MYSTIC_CONTEXTS,
  CATEGORY_IDS,
  DEFAULT_CONVERSATIONS,
  mysticText,
  mysticCategory,
  mysticContexts,
  defaultMysticSettings,
  normalizeMysticSettings,
  normalizeMysticLine,
  defaultMysticLines
};
