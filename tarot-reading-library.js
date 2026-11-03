'use strict';

/**
 * Mystic Witch Live — built-in reading library.
 *
 * Deterministic, offline interpretation for all 78 cards in both orientations,
 * specialised per reading topic. It never draws cards: the reading arrives with
 * its cards already chosen, and this module only explains them and scores them.
 *
 * Every topic owns its own section structure (Family Energy, Hidden Concerns,
 * Current Challenges, ...). Each section is written from the cards that were
 * actually drawn, their orientation, their meaning and the spread position they
 * fell in, so two readings almost never read the same and no topic reuses
 * another topic's paragraphs.
 *
 * Fortune percentages are derived from the actual cards (orientation, arcana,
 * keyword polarity, topic affinity, spread position), so the same reading always
 * produces the same numbers — they are never random.
 */

const CLOSING_LINE = 'The future is not written. Your choices shape your destiny.';
const MAX_ORACLE_CHARS = 2400;
const MAX_SECTION_CHARS = 340;
const MAX_SPOKEN_SECTION_CHARS = 200;

/** Topic ids from tarot-topics.js mapped to the profile that interprets them. */
const TOPIC_PROFILE_IDS = {
  family_reading: 'family',
  personality_reading: 'personality',
  name_reading: 'personality',
  this_weeks_fortune: 'future',
  todays_fortune: 'general',
  my_question: 'general',
  love_reading: 'love',
  crush_reading: 'crush',
  future_partner: 'partner',
  career_reading: 'career',
  wealth_reading: 'wealth',
  study_reading: 'study'
};

/**
 * Six sections per topic, always in this order: atmosphere, bond, hidden,
 * challenge, change, advice. Only the labels and the wording change per topic,
 * so the result box has a stable, readable rhythm on the 9:16 stage.
 */
const TOPIC_PROFILES = {
  general: {
    label: 'Reading',
    aura: 'pale silver light',
    intro: 'You have been carrying a question that has no easy shape yet.',
    lens: 'your situation as a whole',
    affinity: ['truth', 'balance', 'clarity', 'guidance', 'hope', 'movement'],
    risk: ['illusion', 'confusion'],
    strong: 'Trust the plain reading of what is in front of you.',
    tense: 'Name the thing you have been avoiding naming.',
    synthesis: 'The situation is already moving, and your next honest step decides the direction.',
    caution: 'The cards are not asking for a leap. They are asking for one clear, small decision.',
    sections: [
      {
        key: 'energy',
        label: 'The Situation',
        variants: [
          '{card} {orientation} in your {position} position describes where you actually stand: {meaning}.',
          'The situation itself has the shape of {meaning}, with {card} {orientation} over it.',
          '{card} {orientation} is the honest summary of this moment: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'What Surrounds You',
        variants: [
          'What surrounds you reads as {meaning} — {card} {orientation} shows the company you keep.',
          '{card} {orientation} speaks to the people and conditions around you: {meaning}.',
          'The ground you are standing on looks like {meaning}, drawn by {card} {orientation}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Hidden Factors',
        variants: [
          '{card} {orientation} points at what is being left unsaid: {meaning}.',
          'Underneath the obvious sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows the part of this you have not looked at directly: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'The Obstacle',
        variants: [
          'The hard part is {meaning}; {card} {orientation} puts it plainly.',
          '{card} {orientation} marks the friction in this: {meaning}.',
          'What makes this heavy is {meaning}, and {card} {orientation} is where it sits.'
        ]
      },
      {
        key: 'change',
        label: 'What Is Moving',
        variants: [
          '{card} {orientation} in the {position} position says what is moving next: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already leaning that way.',
          'The change forming here looks like {meaning}, carried by {card} {orientation}.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  love: {
    label: 'Love Reading',
    aura: 'soft pink light',
    intro: 'You have been carrying quiet hopes in your heart, especially about love and the future.',
    lens: 'your love life',
    affinity: ['love', 'cups', 'union', 'nurture', 'heart', 'romance', 'partnership', 'emotion', 'affection', 'harmony'],
    risk: ['conflict', 'loss', 'attachment', 'temptation'],
    strong: 'Let the warmth you already give come back to you without testing it.',
    tense: 'Ask for what you need instead of guessing what the other person feels.',
    synthesis: 'Affection that is real but unfinished is what these cards describe; patience is making room for honesty.',
    caution: 'Do not read silence as an answer. A gentle question tells you more than another night of wondering.',
    sections: [
      {
        key: 'energy',
        label: 'Heart Energy',
        variants: [
          '{card} {orientation} in your {position} position sets the temperature of your heart: {meaning}.',
          'What you feel when you are honest with yourself is {meaning}; {card} {orientation} is the weather.',
          '{card} {orientation} describes the emotional climate between you: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'The Bond As It Is',
        variants: [
          'The bond itself reads as {meaning}, and {card} {orientation} is how it is being held.',
          'Between the two of you, {card} {orientation} shows the pattern: {meaning}.',
          'How this connection is being carried looks like {meaning} — {card} {orientation}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Unspoken Feelings',
        variants: [
          '{card} {orientation} points at a feeling that has not been spoken aloud: {meaning}.',
          'Under the affection sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows what one of you is holding back: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'Points of Friction',
        variants: [
          'The friction here is {meaning}; {card} {orientation} says it without softening it.',
          '{card} {orientation} marks the tender spot: {meaning}.',
          'What makes this difficult is {meaning}, and {card} {orientation} shows why it repeats.'
        ]
      },
      {
        key: 'change',
        label: 'Where This Is Going',
        variants: [
          '{card} {orientation} says where this is going: {meaning}.',
          'The next turn in this story looks like {meaning}, carried by {card} {orientation}.',
          'Ahead, {meaning} — {card} {orientation} is already moving you toward it.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  crush: {
    label: 'Crush Reading',
    aura: 'blushing rose light',
    intro: 'There is someone on your mind, and the cards are looking at the space between you.',
    lens: 'this crush and the signals around it',
    affinity: ['romance', 'affection', 'curiosity', 'spark', 'hope', 'union', 'temptation'],
    risk: ['illusion', 'hiding', 'self-doubt', 'attachment'],
    strong: 'Say one true thing out loud instead of rehearsing it a hundred times.',
    tense: 'Stop building a whole story out of a single warm glance.',
    synthesis: 'Something is genuinely moving here, but it is moving at the speed of two people, not one.',
    caution: 'The cards warn against inventing the answer. Ask, and let the answer be whatever it is.',
    sections: [
      {
        key: 'energy',
        label: 'Your Inner Weather',
        variants: [
          '{card} {orientation} in your {position} position describes how you feel around them: {meaning}.',
          'Your own energy when they are near reads as {meaning}, drawn by {card} {orientation}.',
          '{card} {orientation} is the truth of your side of this: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'Their Signals',
        variants: [
          'What passes between you reads as {meaning}; {card} {orientation} shows the exchange.',
          '{card} {orientation} speaks to the signals actually being sent: {meaning}.',
          'The back-and-forth has the shape of {meaning}, with {card} {orientation} in it.'
        ]
      },
      {
        key: 'hidden',
        label: 'What Is Hidden',
        variants: [
          '{card} {orientation} points at what neither of you has admitted: {meaning}.',
          'Under the casual conversations sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows the thing you keep almost saying: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'The Risk',
        variants: [
          'The risk here is {meaning}; {card} {orientation} is blunt about it.',
          '{card} {orientation} marks what could go wrong: {meaning}.',
          'What holds this in place is {meaning}, and {card} {orientation} shows where.'
        ]
      },
      {
        key: 'change',
        label: 'Where It Leads',
        variants: [
          '{card} {orientation} says what the next honest step changes: {meaning}.',
          'Where this leads looks like {meaning}, carried by {card} {orientation}.',
          'Ahead, {meaning} — {card} {orientation} is already clearing the way.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  partner: {
    label: 'Future Partner',
    aura: 'moonlit lavender light',
    intro: 'The cards are looking past today, toward the person you have not met yet.',
    lens: 'the partner approaching you',
    affinity: ['union', 'romance', 'partnership', 'belonging', 'hope', 'renewal', 'harmony'],
    risk: ['delay', 'illusion', 'attachment', 'loss'],
    strong: 'Become the person you want to meet; the meeting follows that work.',
    tense: 'Stop auditioning for a future you have not been offered yet.',
    synthesis: 'The cards show a meeting that is already on its way, arriving through ordinary days rather than a sign.',
    caution: 'Do not mistake longing for evidence. The person is real; the timeline is not yours to force.',
    sections: [
      {
        key: 'energy',
        label: 'Meeting Energy',
        variants: [
          '{card} {orientation} in your {position} position describes the season you will meet in: {meaning}.',
          'The conditions around this meeting read as {meaning}, drawn by {card} {orientation}.',
          '{card} {orientation} shows the energy that brings this person toward you: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'Who They Are',
        variants: [
          'Who they are reads as {meaning}; {card} {orientation} is the character in the card.',
          '{card} {orientation} speaks to the person approaching: {meaning}.',
          'The partner these cards describe carries {meaning} — {card} {orientation}.'
        ]
      },
      {
        key: 'hidden',
        label: 'What You Will Share',
        variants: [
          '{card} {orientation} shows what the two of you will have in common: {meaning}.',
          'What this bond shares is {meaning}, and {card} {orientation} names it.',
          '{card} {orientation} points at the unspoken understanding between you: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'The Obstacle',
        variants: [
          'The obstacle between you is {meaning}; {card} {orientation} puts it plainly.',
          '{card} {orientation} marks what must be worked through: {meaning}.',
          'What stands in the way is {meaning}, and {card} {orientation} is where it lives.'
        ]
      },
      {
        key: 'change',
        label: 'The Path Together',
        variants: [
          '{card} {orientation} says where the path together turns: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already walking you toward it.',
          'The path together takes the shape of {meaning}, carried by {card} {orientation}.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  family: {
    label: 'Family Reading',
    aura: 'warm amber light',
    intro: 'The people who raised you still live in the rooms of your mind, whether or not they are in the room.',
    lens: 'your family and the home you come from',
    affinity: ['nurture', 'tradition', 'belonging', 'home', 'generosity', 'stability', 'care'],
    risk: ['conflict', 'burden', 'control'],
    strong: 'A small act of care will settle more than a long explanation.',
    tense: 'An old rule in the family is asking to be renegotiated, kindly.',
    synthesis: 'This bond is load-bearing: it can hold more honesty than you have been giving it.',
    caution: 'Do not carry a role that was assigned to you before you could choose it.',
    sections: [
      {
        key: 'energy',
        label: 'Family Energy',
        variants: [
          '{card} {orientation} in your {position} position sets the temperature of the house: {meaning}.',
          'The mood your family is living in reads like {meaning}, carried by {card} {orientation}.',
          '{card} {orientation} is the weather over your family right now: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'Family Relationships',
        variants: [
          'Between you and them, {card} {orientation} describes the bond: {meaning}.',
          'The relationships in your family take their shape from {meaning} — {card} {orientation} shows the pattern.',
          '{card} {orientation} speaks to how your family treats each other: {meaning}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Hidden Concerns',
        variants: [
          '{card} {orientation} points at what the family is not saying: {meaning}.',
          'Under the ordinary conversation sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows the worry nobody has put into words: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'Current Challenges',
        variants: [
          'The current strain is {meaning}; {card} {orientation} puts it plainly.',
          '{card} {orientation} marks the hard part right now: {meaning}.',
          'What makes this season difficult is {meaning}, and {card} {orientation} is where it began.'
        ]
      },
      {
        key: 'change',
        label: 'Coming Changes',
        variants: [
          '{card} {orientation} in the {position} position says the change coming is this: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already moving the household that way.',
          'The shift your family is heading into looks like {meaning}, and {card} {orientation} carries it.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  personality: {
    label: 'Personality Reading',
    aura: 'violet light',
    intro: 'You are not a fixed thing, and the cards are looking at the part of you that is currently changing.',
    lens: 'who you are becoming',
    affinity: ['intuition', 'courage', 'mastery', 'curiosity', 'independence', 'reflection', 'presence'],
    risk: ['self-doubt', 'isolation', 'rigidity'],
    strong: 'The quality you admire in others is already yours; it just needs practice.',
    tense: 'The trait you dislike in yourself is asking for attention, not punishment.',
    synthesis: 'These cards describe someone more resilient than they give themselves credit for, and quietly ready for a larger role.',
    caution: 'Do not confuse self-protection with self-knowledge.',
    sections: [
      {
        key: 'energy',
        label: 'Your Core Energy',
        variants: [
          '{card} {orientation} in your {position} position is the core of who you are now: {meaning}.',
          'The energy you are made of reads as {meaning}, drawn by {card} {orientation}.',
          '{card} {orientation} describes the self you bring into rooms: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'How Others See You',
        variants: [
          'Others meet you as {meaning}; {card} {orientation} shows the impression you leave.',
          '{card} {orientation} speaks to how you land on people: {meaning}.',
          'The version of you that others know has the shape of {meaning} — {card} {orientation}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Hidden Depths',
        variants: [
          '{card} {orientation} points at the part of you nobody sees: {meaning}.',
          'Under the surface sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows the depth you rarely show: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'Inner Friction',
        variants: [
          'The inner friction is {meaning}; {card} {orientation} is honest about it.',
          '{card} {orientation} marks the pattern you keep running into: {meaning}.',
          'What makes this hard is {meaning}, and {card} {orientation} shows where it started.'
        ]
      },
      {
        key: 'change',
        label: 'Who You Are Becoming',
        variants: [
          '{card} {orientation} says who you are turning into: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already reshaping you.',
          'The person you are becoming looks like {meaning}, carried by {card} {orientation}.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  career: {
    label: 'Career Reading',
    aura: 'cool blue light',
    intro: 'Your work is asking a question that has nothing to do with luck and everything to do with direction.',
    lens: 'your work and the path you are building',
    affinity: ['drive', 'skill', 'structure', 'ambition', 'authority', 'progress', 'collaboration', 'wands'],
    risk: ['stagnation', 'delay', 'burnout'],
    strong: 'Take the next practical step; the path opens by walking it.',
    tense: 'A delay here is information about the plan, not about your worth.',
    synthesis: 'Effort is beginning to compound. What looks slow from inside is visible progress from outside.',
    caution: 'Do not stay in a structure that has stopped returning your investment.',
    sections: [
      {
        key: 'energy',
        label: 'Work Energy',
        variants: [
          '{card} {orientation} in your {position} position sets the mood of your working week: {meaning}.',
          'The energy around your work reads as {meaning}, drawn by {card} {orientation}.',
          '{card} {orientation} describes the weather at your desk: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'Your Standing',
        variants: [
          '{card} {orientation} speaks to where you stand with the people you work with: {meaning}.',
          'Your position in the room reads as {meaning}, and {card} {orientation} shows it.',
          'How you are seen at work has the shape of {meaning} — {card} {orientation}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Hidden Pressure',
        variants: [
          '{card} {orientation} points at the pressure nobody has put in writing: {meaning}.',
          'Under the deadlines sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows the quiet cost of how you work: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'The Obstacle',
        variants: [
          'The obstacle is {meaning}; {card} {orientation} puts it plainly.',
          '{card} {orientation} marks what is actually blocking progress: {meaning}.',
          'What slows this down is {meaning}, and {card} {orientation} is where it sits.'
        ]
      },
      {
        key: 'change',
        label: 'What Opens Next',
        variants: [
          '{card} {orientation} says what opens next: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already widening the path.',
          'The next opening looks like {meaning}, carried by {card} {orientation}.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  wealth: {
    label: 'Wealth Reading',
    aura: 'golden light',
    intro: 'Money is rarely only money; it carries your history, your fear and your permission to want more.',
    lens: 'your money and material security',
    affinity: ['abundance', 'pentacles', 'growth', 'stability', 'generosity', 'recovery', 'completion'],
    risk: ['loss', 'burden', 'excess'],
    strong: 'A steady, unglamorous habit will outperform a dramatic gamble.',
    tense: 'Something is leaking quietly; find it before it becomes a story about bad luck.',
    synthesis: 'Resources are arriving in the same season as a lesson about how you hold them.',
    caution: 'Separate what you need from what you are using to feel safe.',
    sections: [
      {
        key: 'energy',
        label: 'Money Flow',
        variants: [
          '{card} {orientation} in your {position} position shows how money is moving: {meaning}.',
          'The flow of your finances reads as {meaning}, drawn by {card} {orientation}.',
          '{card} {orientation} describes the current state of your accounts: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'Security and Habits',
        variants: [
          '{card} {orientation} speaks to the habits holding your security: {meaning}.',
          'The way you hold money reads as {meaning}, and {card} {orientation} shows it.',
          'Security in your life has the shape of {meaning} — {card} {orientation}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Hidden Leaks',
        variants: [
          '{card} {orientation} points at money leaving quietly: {meaning}.',
          'Under the budget sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows the quiet leak you have not priced: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'The Pressure Point',
        variants: [
          'The pressure point is {meaning}; {card} {orientation} puts it plainly.',
          '{card} {orientation} marks what is expensive right now: {meaning}.',
          'What strains this is {meaning}, and {card} {orientation} is where it sits.'
        ]
      },
      {
        key: 'change',
        label: 'Coming Opportunity',
        variants: [
          '{card} {orientation} says what opens: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already moving resources toward you.',
          'The opportunity forming looks like {meaning}, carried by {card} {orientation}.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  study: {
    label: 'Study Reading',
    aura: 'silver-blue light',
    intro: 'Learning is asking you to be a beginner again, and beginners are allowed to be slow.',
    lens: 'your studies and the way you learn',
    affinity: ['study', 'curiosity', 'patience', 'discipline', 'message', 'swords', 'mastery'],
    risk: ['confusion', 'delay', 'self-doubt'],
    strong: 'Consistency beats intensity; a smaller session repeated will carry you.',
    tense: 'The block is in the method, not in your ability.',
    synthesis: 'Understanding is closer than it feels, waiting on one structure you have been avoiding.',
    caution: 'Do not measure yourself by someone else’s pace.',
    sections: [
      {
        key: 'energy',
        label: 'Study Energy',
        variants: [
          '{card} {orientation} in your {position} position sets your studying climate: {meaning}.',
          'The energy you bring to learning reads as {meaning}, drawn by {card} {orientation}.',
          '{card} {orientation} describes how your mind is working now: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'How You Learn',
        variants: [
          '{card} {orientation} speaks to the method that actually works for you: {meaning}.',
          'Your learning style reads as {meaning}, and {card} {orientation} shows it.',
          'How you absorb material has the shape of {meaning} — {card} {orientation}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Hidden Blocks',
        variants: [
          '{card} {orientation} points at the block you keep blaming on laziness: {meaning}.',
          'Under the missed sessions sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows what is really interrupting you: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'The Hard Part',
        variants: [
          'The hard part is {meaning}; {card} {orientation} is honest about it.',
          '{card} {orientation} marks the subject or habit that costs you most: {meaning}.',
          'What makes this difficult is {meaning}, and {card} {orientation} shows where it began.'
        ]
      },
      {
        key: 'change',
        label: 'What Improves',
        variants: [
          '{card} {orientation} says what improves from here: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already building the habit.',
          'The improvement forming looks like {meaning}, carried by {card} {orientation}.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  },

  future: {
    label: 'Future Fortune',
    aura: 'deep indigo light',
    intro: 'The future you are asking about is still soft clay, and the cards are showing its current shape.',
    lens: 'what is coming next',
    affinity: ['future', 'cycles', 'movement', 'turning point', 'hope', 'renewal'],
    risk: ['delay', 'uncertainty', 'stagnation'],
    strong: 'Meet the change instead of bracing for it.',
    tense: 'A cycle is repeating because its lesson has not been learned yet.',
    synthesis: 'A turning point has already begun quietly; the visible change comes later.',
    caution: 'Plan for the likely path without treating it as a verdict.',
    sections: [
      {
        key: 'energy',
        label: 'The Current Tide',
        variants: [
          '{card} {orientation} in your {position} position is the tide you are already in: {meaning}.',
          'The present current reads as {meaning}, drawn by {card} {orientation}.',
          '{card} {orientation} describes the direction things are already moving: {meaning}.'
        ]
      },
      {
        key: 'bond',
        label: 'What Is Forming',
        variants: [
          '{card} {orientation} speaks to what is taking shape around you: {meaning}.',
          'What is forming reads as {meaning}, and {card} {orientation} shows the outline.',
          '{card} {orientation} shows the shape of what is half-built: {meaning}.'
        ]
      },
      {
        key: 'hidden',
        label: 'Hidden Factors',
        variants: [
          '{card} {orientation} points at the influence you have not counted: {meaning}.',
          'Under the obvious sits {meaning}; {card} {orientation} names it.',
          '{card} {orientation} shows the factor working quietly in the background: {meaning}.'
        ]
      },
      {
        key: 'challenge',
        label: 'The Turning Point',
        variants: [
          'The turning point is {meaning}; {card} {orientation} marks it.',
          '{card} {orientation} shows where the direction changes: {meaning}.',
          'What tips this over is {meaning}, and {card} {orientation} is the hinge.'
        ]
      },
      {
        key: 'change',
        label: 'What Comes Next',
        variants: [
          '{card} {orientation} says what comes next: {meaning}.',
          'Ahead, {meaning} — {card} {orientation} is already arriving.',
          'What comes next looks like {meaning}, carried by {card} {orientation}.'
        ]
      },
      { key: 'advice', label: 'Oracle Advice', variants: [] }
    ]
  }
};

/** Topic-neutral closing clause per section, chosen deterministically. */
const SECTION_CLAUSES = {
  energy: [
    'You will feel it before anyone explains it.',
    'It is easier to work with than to argue with.',
    'It is already shifting, slowly, in your favour.'
  ],
  bond: [
    'The pattern is older than this week, and it can be renegotiated.',
    'One honest sentence will do more than a month of being careful.',
    'What you give here comes back, though not always on the same day.'
  ],
  hidden: [
    'Say the quiet part gently and it stops steering things.',
    'It waits for a moment when nobody is in a hurry.',
    'Naming it takes less courage than carrying it does.'
  ],
  challenge: [
    'Small, steady repairs beat one dramatic move.',
    'The difficulty is structural, not personal; stop taking it as a verdict.',
    'Loosen one rule at a time rather than the whole structure at once.'
  ],
  change: [
    'You do not have to steer it; you only have to not resist it.',
    'Meet it openly and it arrives as relief rather than disruption.',
    'It comes slower than the worry and faster than the fear predicts.'
  ]
};

const POSITIVE = new Set([
  'abundance', 'affection', 'awakening', 'balance', 'beginnings', 'belonging', 'calling', 'clarity',
  'collaboration', 'completion', 'courage', 'creation', 'curiosity', 'drive', 'freedom', 'generosity',
  'growth', 'guidance', 'harmony', 'healing', 'hope', 'innocence', 'intuition', 'joy', 'love',
  'mastery', 'momentum', 'movement', 'nurture', 'opportunity', 'patience', 'progress', 'recovery',
  'renewal', 'resilience', 'return', 'revelation', 'romance', 'skill', 'spark', 'stability', 'strength',
  'success', 'support', 'transformation', 'truth', 'union', 'victory', 'warmth', 'will', 'wisdom'
]);

const NEGATIVE = new Set([
  'anxiety', 'attachment', 'avoidance', 'bondage', 'burden', 'collapse', 'conflict', 'confusion',
  'control', 'debt', 'delay', 'disaster', 'doubt', 'fear', 'friction', 'hiding', 'illusion',
  'imbalance', 'isolation', 'loss', 'neglect', 'overwhelm', 'recklessness', 'rigidity', 'sacrifice',
  'stagnation', 'stalemate', 'temptation', 'uncertainty', 'upheaval', 'withdrawal'
]);

const MAJOR_NAMES = [
  'The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant',
  'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice',
  'The Hanged Man', 'Death', 'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon',
  'The Sun', 'Judgement', 'The World'
];

const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'];
const SUIT_NAMES = ['Wands', 'Cups', 'Swords', 'Pentacles'];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clean(value, maxLength = 220) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Stable hash so a card always picks the same wording for a given section. */
function hashOf(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(list, seed) {
  if (!Array.isArray(list) || !list.length) return '';
  return list[hashOf(seed) % list.length];
}

/** Which profile interprets this reading: topic id first, then theme, then label. */
function resolveProfileKey(reading) {
  const topicId = String((reading && reading.topicId) || '').toLowerCase();
  const theme = String((reading && reading.theme) || '').toLowerCase();
  const topicKey = TOPIC_PROFILE_IDS[topicId];
  const specificTheme = theme && theme !== 'general' && TOPIC_PROFILES[theme] ? theme : '';
  // "My Question" is the catch-all for any sentence with a question mark; it
  // must never outrank the topic the stream actually asked for.
  if (topicKey && !(topicKey === 'general' && specificTheme)) return topicKey;
  if (TOPIC_PROFILES[theme]) return theme;
  const label = String((reading && (reading.topicLabel || reading.topic_label)) || '').toLowerCase();
  for (const [key, profile] of Object.entries(TOPIC_PROFILES)) {
    if (label.includes(key) || label.includes(profile.label.toLowerCase())) return key;
  }
  if (/crush|admirer|secret love/.test(label)) return 'crush';
  if (/partner|husband|wife|soulmate/.test(label)) return 'partner';
  if (/family|home|parent/.test(label)) return 'family';
  if (/money|wealth|finance/.test(label)) return 'wealth';
  if (/study|exam|school/.test(label)) return 'study';
  if (/career|job|work/.test(label)) return 'career';
  if (/love|relationship/.test(label)) return 'love';
  if (/personality|name/.test(label)) return 'personality';
  return 'general';
}

function topicProfile(theme) {
  const key = String(theme || '').toLowerCase();
  return TOPIC_PROFILES[key] || TOPIC_PROFILES.general;
}

function profileFor(reading) {
  return TOPIC_PROFILES[resolveProfileKey(reading)] || TOPIC_PROFILES.general;
}

function resolveTopicLabel(reading, profile) {
  const explicit = clean(reading && (reading.topicLabel || reading.topic_label), 60);
  if (explicit) return explicit;
  return profile.label;
}

function keywordPolarity(keywords) {
  let score = 0;
  for (const raw of Array.isArray(keywords) ? keywords : []) {
    const keyword = String(raw || '').toLowerCase();
    if (POSITIVE.has(keyword)) score += 1;
    else if (NEGATIVE.has(keyword)) score -= 1;
  }
  return clamp(score, -3, 3);
}

/**
 * One card's fortune contribution, in a 5..95 band.
 * Deterministic inputs only: orientation, arcana, keywords, topic, position.
 */
function cardFortune(card, profile, index, total) {
  let score = card.reversed ? 44 : 60;
  score += keywordPolarity(card.keywords) * 5;
  if (card.arcana === 'major') score += card.reversed ? -7 : 7;
  const keywords = (card.keywords || []).map((keyword) => String(keyword).toLowerCase());
  const affinity = keywords.filter((keyword) => profile.affinity.includes(keyword)).length;
  const risks = keywords.filter((keyword) => profile.risk.includes(keyword)).length;
  score += Math.min(2, affinity) * 6;
  score -= Math.min(2, risks) * 5;
  if (total > 1) {
    if (index === total - 1) score += 2;
    if (index === 0) score -= 1;
  }
  if (card.position === 'Future' && card.reversed) score -= 2;
  if (card.position === 'Past' && !card.reversed) score += 1;
  return clamp(Math.round(score), 5, 95);
}

function scoreReading(reading) {
  const profile = profileFor(reading);
  const cards = Array.isArray(reading && reading.cards) ? reading.cards : [];
  if (!cards.length) return { fortune: 50, caution: 50, perCard: [] };
  const perCard = cards.map((card, index) => ({
    name: card.name,
    position: card.position || 'Guidance',
    reversed: Boolean(card.reversed),
    score: cardFortune(card, profile, index, cards.length)
  }));
  const mean = perCard.reduce((sum, item) => sum + item.score, 0) / perCard.length;
  const fortune = clamp(Math.round(mean), 8, 92);
  return { fortune, caution: 100 - fortune, perCard };
}

function meaningOf(card) {
  return clean(
    card.meaning ||
      (card.reversed ? card.reversedMeaning : card.uprightMeaning) ||
      (Array.isArray(card.keywords) ? `carries ${card.keywords.slice(0, 3).join(', ')}` : ''),
    220
  );
}

/**
 * Card meanings are written as instructions ("Step back and carry your own
 * lantern"), which cannot follow "reads like" or "the shape of". Turning the
 * imperative into a noun phrase keeps every template grammatical.
 */
const IMPERATIVE_OPENERS = new Set([
  'step', 'take', 'ask', 'name', 'trust', 'meet', 'let', 'speak', 'practise', 'notice',
  'hold', 'sit', 'stop', 'say', 'stay', 'look', 'choose', 'carry', 'bring', 'keep', 'walk',
  'accept', 'release', 'wait', 'listen', 'move', 'begin', 'make', 'tell', 'follow', 'answer',
  'repeat', 'finish', 'return', 'open', 'close', 'grow', 'give', 'build', 'find', 'remember',
  'forgive', 'heal', 'rest', 'face', 'slow', 'plan', 'share', 'leave'
]);

function nominalMeaning(value) {
  const text = String(value || '').replace(/\.$/, '').trim();
  if (!text) return '';
  const firstWord = text.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
  const lowered = `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return IMPERATIVE_OPENERS.has(firstWord) ? `a call to ${lowered}` : lowered;
}

/** A meaning trimmed to the clause that fits inside one section sentence. */
function shortMeaning(card, maxLength = 95) {
  const meaning = nominalMeaning(meaningOf(card));
  if (meaning.length <= maxLength) return meaning;
  const cut = meaning.slice(0, maxLength);
  const stop = cut.lastIndexOf(' ');
  return (stop > maxLength * 0.5 ? cut.slice(0, stop) : cut).replace(/[,;:]$/, '');
}

function cardLabel(card) {
  return `${clean(card.name, 60)}${card.reversed ? ' reversed' : ''}`;
}

function fillTemplate(template, card) {
  return String(template || '')
    .replace(/\{card\}/g, clean(card.name, 60))
    .replace(/\{orientation\}/g, card.reversed ? 'reversed' : 'upright')
    .replace(/\{position\}/g, String(card.position || 'Guidance').toLowerCase())
    .replace(/\{meaning\}/g, shortMeaning(card))
    .replace(/\{keywords\}/g, (card.keywords || []).slice(0, 2).join(' and '));
}

/** The advice section is written across the whole spread, never from one card. */
function adviceSection(cardList, profile, scores) {
  const drawn = cardList.map(cardLabel).join(', ');
  const reversed = cardList.filter((card) => card.reversed);
  const anchor = (cardList[0].keywords || []).slice(0, 2).join(' and ');
  const verdict = scores.fortune >= 60 ? profile.synthesis : profile.caution;
  const tension = reversed.length
    ? ` Where ${cardLabel(reversed[0])} sits, ${profile.tense.charAt(0).toLowerCase()}${profile.tense.slice(1)}`
    : '';
  const practice = anchor
    ? `Practise ${anchor} this week rather than waiting for the whole answer.`
    : 'Practise one small, repeatable act this week rather than waiting for the whole answer.';
  const text = clampSentence(`On the table: ${drawn}. ${profile.strong} ${verdict}${tension} ${practice}`, MAX_SECTION_CHARS);
  const spoken = clampSentence(`On the table: ${drawn}. ${profile.strong} ${scores.fortune >= 60 ? profile.synthesis : profile.caution}`, MAX_SPOKEN_SECTION_CHARS);
  return { text, spoken };
}

/**
 * Six sections for one reading. Section n is written from card n (cycled), so a
 * three-card spread speaks through all three positions across the reading.
 */
function buildSections(reading, profile, scores) {
  const cards = Array.isArray(reading && reading.cards) ? reading.cards : [];
  if (!cards.length) return [];
  const seen = new Set();
  return profile.sections.map((section, index) => {
    if (section.key === 'advice') {
      const advice = adviceSection(cards, profile, scores);
      return {
        key: section.key,
        label: section.label,
        text: advice.text,
        spoken: advice.spoken,
        cards: cards.map((card) => cardLabel(card))
      };
    }
    const card = cards[index % cards.length];
    const seed = `${card.id || card.name}|${card.reversed ? 'r' : 'u'}|${section.key}`;
    const variant = pick(section.variants, seed);
    // A card used twice in one spread speaks through its keywords the second
    // time, so no two sections quote the same meaning sentence.
    const repeated = seen.has(card.id || card.name);
    seen.add(card.id || card.name);
    const keywords = (card.keywords || []).slice(0, 2).join(' and ');
    const view = repeated && keywords ? { ...card, meaning: keywords } : card;
    const clause = pick(SECTION_CLAUSES[section.key] || SECTION_CLAUSES.energy, `${seed}|clause`);
    // Every section states which spread position it reads from, even when the
    // chosen wording does not name it.
    const position = String(card.position || 'Guidance').toLowerCase();
    let text = clean(`${fillTemplate(variant, view)} ${clause}`, MAX_SECTION_CHARS * 2);
    if (!text.toLowerCase().includes(position)) {
      const note = pick([
        `The ${position} position is where this lands.`,
        `Read from the ${position} position.`,
        `It belongs to the ${position} position of the spread.`
      ], `${seed}|position`);
      text = `${text} ${note}`;
    }
    text = clampSentence(text, MAX_SECTION_CHARS);
    return {
      key: section.key,
      label: section.label,
      text,
      spoken: firstSentence(text),
      cards: [cardLabel(card)]
    };
  });
}

/** Cut at a sentence boundary, never mid-word, so a capped section still reads. */
function clampSentence(text, max) {
  const value = clean(text, MAX_SECTION_CHARS * 2);
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (stop > max * 0.55) return cut.slice(0, stop + 1).trim();
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '')}.`;
}

function clampWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n\n'));
  return stop > max * 0.5 ? cut.slice(0, stop + 1).trim() : `${cut.trim()}…`;
}

function firstSentence(text, maxLength = MAX_SPOKEN_SECTION_CHARS) {
  const value = clean(text, MAX_SECTION_CHARS);
  const stop = value.indexOf('. ');
  const sentence = stop > 40 ? value.slice(0, stop + 1) : value;
  if (sentence.length <= maxLength) return sentence;
  const cut = sentence.slice(0, maxLength);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxLength * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '')}…`;
}

/** The spoken script for any set of sections: cards first, then each section. */
function spokenScript(user, topicLabel, cards, fortune, caution, sections) {
  const orientation = (card) => (card.reversed ? ', reversed' : '');
  const label = cards.length === 1 ? 'one card' : `${['', 'one', 'two', 'three'][cards.length] || cards.length} cards`;
  const lines = [
    `Welcome, ${user}. The Oracle is ready to read your ${String(topicLabel).toLowerCase()}.`,
    `${topicLabel}. I am drawing ${label} from the deck now.`
  ];
  cards.forEach((card, index) => {
    const first = index === 0;
    const cardLabelText = cards.length === 1
      ? 'The card'
      : first
        ? 'The first card'
        : index === cards.length - 1
          ? 'The final card'
          : 'The next card';
    lines.push(`${cardLabelText} ${first && cards.length > 1 ? 'reveals' : 'is'} ${card.name}${orientation(card)}, in the ${String(card.position || 'Guidance').toLowerCase()}.`);
  });
  lines.push(`${fortune} percent good fortune, ${caution} points to watch.`);
  for (const section of Array.isArray(sections) ? sections : []) {
    if (!section || !section.text) continue;
    lines.push(`${section.label}. ${section.spoken || firstSentence(section.text)}`);
  }
  lines.push(CLOSING_LINE);
  return lines.map((line) => clean(line, 240)).filter(Boolean);
}

/** Short, speakable lines in narration order; the stage queue plays them in order. */
function spokenLines(result, cards) {
  return spokenScript(
    result.user,
    result.topicLabel,
    cards,
    result.fortune,
    result.caution,
    result.sections
  );
}

/**
 * Build the full result the stage renders and the Oracle speaks.
 * `cards` are the drawn cards, untouched: this function never adds or removes one.
 */
function buildReadingResult(reading, options = {}) {
  const cards = Array.isArray(reading && reading.cards) ? reading.cards : [];
  if (!cards.length) return null;
  const profile = profileFor(reading);
  const scores = scoreReading(reading);
  const user = clean(reading.user || 'Seeker', 50);
  const topicLabel = resolveTopicLabel(reading, profile);
  const sections = buildSections(reading, profile, scores);
  const paragraphs = [
    `${user}, I see a ${profile.aura} around your crystal ball. ${profile.intro}`,
    ...sections.map((section) => section.text),
    CLOSING_LINE
  ];

  const oracleMessage = clampWords(paragraphs.join('\n\n'), MAX_ORACLE_CHARS);
  const result = {
    user,
    topic: reading.theme || 'general',
    topicId: reading.topicId || '',
    topicLabel,
    profile: resolveProfileKey(reading),
    headline: `${topicLabel.toUpperCase()} FOR ${user.toUpperCase()}`,
    spread: reading.spread || (cards.length === 1 ? 'one' : 'three'),
    fortune: scores.fortune,
    caution: scores.caution,
    perCard: scores.perCard,
    sections,
    cards: cards.map((card, index) => ({
      name: card.name,
      position: card.position || 'Guidance',
      orientation: card.reversed ? 'reversed' : 'upright',
      reversed: Boolean(card.reversed),
      arcana: card.arcana || 'minor',
      suit: card.suit || null,
      keywords: Array.isArray(card.keywords) ? card.keywords.slice(0, 3) : [],
      meaning: meaningOf(card),
      score: scores.perCard[index] ? scores.perCard[index].score : 50
    })),
    paragraphs,
    closing: CLOSING_LINE,
    oracleMessage,
    generatedAt: new Date().toISOString(),
    source: options.source || 'builtin'
  };
  result.spoken = spokenLines(result, cards);
  return result;
}

/**
 * Reject AI prose that names a card which was not drawn, or that tries to change
 * the spread. Everything else is allowed; length is trimmed before display.
 */
function validateAiText(text, reading) {
  const value = String(text || '').trim();
  if (value.length < 40) return { ok: false, reason: 'too_short' };
  if (value.length > 2400) return { ok: false, reason: 'too_long' };
  if (/[*#`]|^\s*[-•]/m.test(value)) return { ok: false, reason: 'markdown' };
  const drawn = new Set((reading.cards || []).map((card) => String(card.name).toLowerCase()));
  for (const name of MAJOR_NAMES) {
    if (value.toLowerCase().includes(name.toLowerCase()) && !drawn.has(name.toLowerCase())) {
      return { ok: false, reason: `unknown_card:${name}` };
    }
  }
  for (const rank of RANK_NAMES) {
    for (const suit of SUIT_NAMES) {
      const name = `${rank} of ${suit}`.toLowerCase();
      if (value.toLowerCase().includes(name) && !drawn.has(name)) {
        return { ok: false, reason: `unknown_card:${rank} of ${suit}` };
      }
    }
  }
  return { ok: true, text: value };
}

/**
 * Read "Label: text" lines from the AI answer. A paragraph with no labels is
 * still accepted as a single Oracle's Message section, so a terse model degrades
 * gracefully instead of losing its answer.
 */
function parseAiSections(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sections = [];
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Za-z' ]{2,40}):\s*(.+)$/);
    if (!match) continue;
    const label = clean(match[1], 40);
    const body = clean(match[2], MAX_SECTION_CHARS);
    if (label.length < 3 || body.length < 20) continue;
    sections.push({ key: label.toLowerCase().replace(/[^a-z]+/g, '-'), label, text: body, cards: [] });
  }
  if (sections.length >= 3) return sections;
  const whole = clean(text, 1600);
  return whole ? [{ key: 'message', label: "Oracle's Message", text: whole, cards: [] }] : [];
}

/** Merge an AI section set into the result without touching cards or scores. */
function applyAiInterpretation(result, aiText, options = {}) {
  if (!result) return null;
  const checked = validateAiText(aiText, { cards: result.cards.map((card) => ({ name: card.name })) });
  if (!checked.ok) return { ...result, aiError: checked.reason };
  const sections = parseAiSections(checked.text);
  if (!sections.length) return { ...result, aiError: 'empty_sections' };
  const paragraphs = [clean(checked.text, 1600), CLOSING_LINE];
  const merged = {
    ...result,
    sections,
    paragraphs,
    oracleMessage: paragraphs.join('\n\n'),
    source: 'ai',
    provider: options.provider || '',
    aiError: ''
  };
  merged.spoken = spokenScript(
    merged.user,
    merged.topicLabel,
    result.cards,
    merged.fortune,
    merged.caution,
    sections
  );
  return merged;
}

const CEREMONY_CLOSING_TEXT = 'Your reading is complete. May the spirits guide your path.';

/**
 * The spoken ceremony: one announcement, one preparation line, one line per
 * revealed card, the interpretation (verdict + every section) and the closing.
 * The stage advances each phase only after that phase's clips have played.
 */
function buildCeremonyClips(reading, result) {
  if (!result) return [];
  const cards = Array.isArray(reading && reading.cards) ? reading.cards : (Array.isArray(result.cards) ? result.cards : []);
  const clips = [];
  let order = 0;
  const push = (phase, text) => {
    const value = clean(text, 240);
    if (value) clips.push({ phase, order: order++, text: value });
  };
  const user = clean(result.user || (reading && reading.user) || 'Seeker', 50);
  const topicLabel = clean(result.topicLabel || 'Tarot Reading', 60);

  push('announce', `${user}, your turn has arrived. Come closer. The cards are ready to reveal your destiny.`);
  push('prepare', 'Take a deep breath. Let us discover what the cards have to tell you.');
  cards.forEach((card, index) => {
    const label = cards.length === 1
      ? 'The card'
      : index === 0
        ? 'The first card'
        : index === cards.length - 1
          ? 'The final card'
          : 'The next card';
    const position = String(card.position || 'Guidance').toLowerCase();
    push('reveal', `${label} is ${card.name}${card.reversed ? ', reversed' : ''}, in the ${position}.`);
  });
  push('interpret', `${result.fortune} percent good fortune, ${result.caution} points to watch for your ${String(topicLabel).toLowerCase()}.`);
  for (const section of Array.isArray(result.sections) ? result.sections : []) {
    if (!section || !section.text) continue;
    push('interpret', `${section.label}. ${section.spoken || firstSentence(section.text)}`);
  }
  push('closing', CEREMONY_CLOSING_TEXT);
  return clips;
}

module.exports = {
  TOPIC_PROFILES,
  TOPIC_PROFILE_IDS,
  SECTION_CLAUSES,
  CLOSING_LINE,
  MAJOR_NAMES,
  MAX_SECTION_CHARS,
  scoreReading,
  cardFortune,
  buildReadingResult,
  buildCeremonyClips,
  CEREMONY_CLOSING_TEXT,
  buildSections,
  spokenLines,
  spokenScript,
  validateAiText,
  parseAiSections,
  applyAiInterpretation,
  resolveProfileKey,
  topicProfile
};
