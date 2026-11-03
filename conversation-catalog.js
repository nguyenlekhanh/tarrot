/**
 * Mystic Witch Live — default seller conversation catalog.
 *
 * Local, deterministic dialogue only: no cloud AI, no external requests.
 * The server seeds these into game-state.json on first run; the Admin panel can
 * then edit, disable, add, delete or restore them and the changes persist.
 */

const CONVERSATION_CATEGORIES = [
  { id: 'daily', label: 'Daily shop conversations', icon: '☀️' },
  { id: 'drinks', label: 'Drink recommendations', icon: '🥤' },
  { id: 'menu', label: 'Menu discussions', icon: '📋' },
  { id: 'funny', label: 'Funny conversations', icon: '😄' },
  { id: 'teasing', label: 'Friendly teasing', icon: '😜' },
  { id: 'greetings', label: 'Customer greetings', icon: '👋' },
  { id: 'busy', label: 'Busy shop reactions', icon: '🏃' },
  { id: 'quiet', label: 'Quiet shop conversations', icon: '🌤️' },
  { id: 'weather', label: 'Weather and summer', icon: '🌞' },
  { id: 'weekend', label: 'Weekend conversations', icon: '🎉' },
  { id: 'supporter', label: 'Supporter appreciation', icon: '💛' },
  { id: 'atmosphere', label: 'Shop atmosphere', icon: '🏪' }
];

const CONVERSATION_INTERVALS = [20, 30, 45, 60, 90];

const DEFAULT_CONVERSATIONS = [
  // ---------------------------------------------------------- daily (6)
  {
    id: 'daily_1',
    category: 'daily',
    male: "Morning, Sarah! The ice machine is already humming. That's a good sign.",
    female: "Best sound in the shop! I take it as a personal compliment.",
    followUp: "Let's make today a busy one, then."
  },
  {
    id: 'daily_2',
    category: 'daily',
    male: 'Hey, quick question: are we a drink shop or a sunshine delivery service?',
    female: 'Why not both? We hand out the sunshine in cups.',
    followUp: "That's going on the sign. Sunshine, with ice."
  },
  {
    id: 'daily_3',
    category: 'daily',
    male: "I just organized the straws by color, and honestly? It's beautiful.",
    female: 'You need a hobby, Marcus.',
    followUp: "I have a hobby. It's organizing straws."
  },
  {
    id: 'daily_4',
    category: 'daily',
    male: 'First customer of the day gets my famous welcome speech.',
    female: "Please don't do the robot again.",
    followUp: 'Too late. The robot is happening.'
  },
  {
    id: 'daily_5',
    category: 'daily',
    male: 'I think the syrup shelf is judging me.',
    female: "It's definitely the blue raspberry. It's been staring all morning.",
    followUp: "I'm moving it to the back."
  },
  {
    id: 'daily_6',
    category: 'daily',
    male: 'New day, fresh ice, same beautiful chaos.',
    female: 'You say that like you did not forget to stock the cups.',
    followUp: 'I stocked them. Eventually counts.'
  },

  // --------------------------------------------------------- drinks (5)
  {
    id: 'drinks_1',
    category: 'drinks',
    male: "What's your go-to right now? I need inspiration.",
    female: 'Strawberry smoothie. Cold, creamy, and a little dramatic.',
    followUp: "Dramatic? It's a drink."
  },
  {
    id: 'drinks_2',
    category: 'drinks',
    male: 'I made a lemonade so fresh it slapped me.',
    female: "That's not how lemonade works.",
    followUp: "Tell that to my face. It's still recovering."
  },
  {
    id: 'drinks_3',
    category: 'drinks',
    male: 'If you could only drink one thing from the menu forever?',
    female: 'Easy. Iced coffee. I have things to do.',
    followUp: 'Everything except sleep, apparently.'
  },
  {
    id: 'drinks_4',
    category: 'drinks',
    male: 'Blue slushie or berry smoothie? Settle this for me.',
    female: 'Slushie for the vibes, smoothie for the actual fruit.',
    followUp: 'So both. Got it.'
  },
  {
    id: 'drinks_5',
    category: 'drinks',
    male: "I'm testing a new combo: orange soda with a splash of lemonade.",
    female: 'That sounds either genius or a science experiment.',
    followUp: 'Those are my two favorite categories.'
  },

  // ----------------------------------------------------------- menu (5)
  {
    id: 'menu_1',
    category: 'menu',
    male: 'Somebody asked if we have anything warm.',
    female: 'We have a warm personality and a hot coffee machine.',
    followUp: "I'll put that on the menu."
  },
  {
    id: 'menu_2',
    category: 'menu',
    male: "We should rename the mystery drink 'Trust Me.'",
    female: "Absolutely not. People will think it's a dare.",
    followUp: "It is a dare. That's the fun part."
  },
  {
    id: 'menu_3',
    category: 'menu',
    male: 'The menu board looks crooked again.',
    female: "It's not crooked. It's leaning into the summer theme.",
    followUp: "You're a genius."
  },
  {
    id: 'menu_4',
    category: 'menu',
    male: 'Do we have a drink for somebody who cannot decide?',
    female: 'That is what the mystery sip was invented for.',
    followUp: 'One mystery sip, coming right up.'
  },
  {
    id: 'menu_5',
    category: 'menu',
    male: 'I counted the menu twice and got two different numbers.',
    female: 'That is because you counted the pictures as drinks.',
    followUp: 'The pictures are very convincing.'
  },

  // ---------------------------------------------------------- funny (6)
  {
    id: 'funny_1',
    category: 'funny',
    male: 'I tried to take a nap behind the counter, but the blender had opinions.',
    female: 'The blender is the real manager.',
    followUp: 'Then I want a raise.'
  },
  {
    id: 'funny_2',
    category: 'funny',
    male: 'A customer asked if our ice is organic.',
    female: 'What did you tell them?',
    followUp: "I said it's locally frozen."
  },
  {
    id: 'funny_3',
    category: 'funny',
    male: 'I dropped a cup earlier and it bounced.',
    female: 'We should not be proud of that.',
    followUp: "Too late. I'm telling everyone."
  },
  {
    id: 'funny_4',
    category: 'funny',
    male: 'Why does the register beep so aggressively?',
    female: "It's excited about money.",
    followUp: 'Same, honestly.'
  },
  {
    id: 'funny_5',
    category: 'funny',
    male: 'I named the mop Kevin.',
    female: 'Of course you did. Does Kevin get a break?',
    followUp: 'Kevin gets one bucket a day.'
  },
  {
    id: 'funny_6',
    category: 'funny',
    male: 'The health inspector asked if I have a system.',
    female: 'Please tell me you said yes.',
    followUp: 'I said the ice knows where it belongs.'
  },

  // --------------------------------------------------------- teasing (5)
  {
    id: 'teasing_1',
    category: 'teasing',
    male: "You've been humming the same song for an hour.",
    female: "It's a good song!",
    followUp: 'It was. Twenty minutes ago.'
  },
  {
    id: 'teasing_2',
    category: 'teasing',
    male: "Sarah says my drinks are 'a little sweet.'",
    female: 'I said that with love.',
    followUp: 'You said it with a straw.'
  },
  {
    id: 'teasing_3',
    category: 'teasing',
    male: "I'm the fastest pour in the shop.",
    female: "You're the fastest spill.",
    followUp: 'That was one time.'
  },
  {
    id: 'teasing_4',
    category: 'teasing',
    male: 'You always take the last cherry.',
    female: "Because I'm the closer. Closers get cherries.",
    followUp: "That's not in the handbook."
  },
  {
    id: 'teasing_5',
    category: 'teasing',
    male: 'I fixed the shelf.',
    female: 'You put a book under it.',
    followUp: 'A very stable book.'
  },

  // ------------------------------------------------------- greetings (6)
  {
    id: 'greetings_1',
    category: 'greetings',
    contexts: ['newViewer', 'quiet', 'empty'],
    male: 'Welcome in! You picked a good time. The ice is fresh.',
    female: 'And the music is questionable, but the drinks are great.',
    followUp: 'Hey. I picked the music.'
  },
  {
    id: 'greetings_2',
    category: 'greetings',
    contexts: ['newViewer', 'empty'],
    male: 'New faces at the counter! Come say hi in the chat.',
    female: "We don't bite. We do hand out samples.",
    followUp: 'Only if you ask nicely.'
  },
  {
    id: 'greetings_3',
    category: 'greetings',
    contexts: ['newViewer', 'quiet'],
    male: 'Hey @{viewer}! Welcome to the sunny side.',
    female: 'We saved you a spot and a straw.',
    followUp: 'The good straw. The bendy one.'
  },
  {
    id: 'greetings_4',
    category: 'greetings',
    contexts: ['newViewer', 'quiet', 'empty'],
    male: 'Good to see you again, friends.',
    female: 'Same seats, same sunshine, fresh drinks.',
    followUp: 'We even cleaned the counter.'
  },
  {
    id: 'greetings_5',
    category: 'greetings',
    contexts: ['newViewer', 'empty'],
    male: 'If this is your first time here, welcome.',
    female: "If it's not, welcome back. We missed you.",
    followUp: 'Both work. Both get a drink.'
  },
  {
    id: 'greetings_6',
    category: 'greetings',
    contexts: ['newViewer', 'quiet'],
    male: 'Look who just walked in! @{viewer}, welcome.',
    female: 'Perfect timing. We were just talking about drinks.',
    followUp: 'We are always talking about drinks.'
  },

  // ----------------------------------------------------------- busy (5)
  {
    id: 'busy_1',
    category: 'busy',
    contexts: ['busy'],
    male: 'Whoa, the queue is moving! I need backup.',
    female: 'Backup is here. I brought ice and attitude.',
    followUp: 'Perfect. We need both.'
  },
  {
    id: 'busy_2',
    category: 'busy',
    contexts: ['busy'],
    male: 'Three orders at once. Stay with me, Sarah.',
    female: "I've got the smoothies. You take the coffees.",
    followUp: 'Teamwork makes the drinks work.'
  },
  {
    id: 'busy_3',
    category: 'busy',
    contexts: ['busy'],
    male: "We're getting slammed, and I love it.",
    female: 'Tell your face that. You look terrified.',
    followUp: 'This is my excited face.'
  },
  {
    id: 'busy_4',
    category: 'busy',
    contexts: ['busy'],
    male: 'Order up, order up! Who had the lemonade?',
    female: "That one's mine. Coming through!",
    followUp: 'Careful. The straw is armed.'
  },
  {
    id: 'busy_5',
    category: 'busy',
    contexts: ['busy'],
    male: "Everybody stay patient, we're getting to every order.",
    female: "We're working as fast as the blender allows.",
    followUp: 'The blender is doing its best.'
  },

  // ---------------------------------------------------------- quiet (6)
  {
    id: 'quiet_1',
    category: 'quiet',
    contexts: ['quiet', 'empty'],
    male: "It's quiet. Too quiet.",
    female: "You're about to do something weird, aren't you?",
    followUp: 'I was thinking a karaoke hour.'
  },
  {
    id: 'quiet_2',
    category: 'quiet',
    contexts: ['quiet', 'empty'],
    male: 'Slow afternoon. Should we wipe the counter?',
    female: 'We wiped it four minutes ago.',
    followUp: 'Then we wipe it with purpose.'
  },
  {
    id: 'quiet_3',
    category: 'quiet',
    contexts: ['quiet', 'empty'],
    male: "I can hear the fridge. That's how quiet it is.",
    female: "Let's give the chat something to talk about.",
    followUp: "I'll start. Favorite drink, anyone?"
  },
  {
    id: 'quiet_4',
    category: 'quiet',
    contexts: ['quiet', 'empty'],
    male: 'Quiet shop, fresh ice, no line.',
    female: 'This is the calm before the smoothie storm.',
    followUp: "I'll hold onto the counter."
  },
  {
    id: 'quiet_5',
    category: 'quiet',
    contexts: ['quiet', 'empty'],
    male: 'Should we practice our customer service smile?',
    female: 'Mine is already perfect.',
    followUp: "Mine looks like I'm thinking about pizza."
  },
  {
    id: 'quiet_6',
    category: 'quiet',
    contexts: ['quiet', 'empty'],
    male: 'What do you want to drink today, chat?',
    female: 'Pick something cold. It is a beautiful day for ice.',
    followUp: 'And for a little friendly peer pressure.'
  },

  // --------------------------------------------------------- weather (5)
  {
    id: 'weather_1',
    category: 'weather',
    male: 'It is officially hot enough to fry an egg on the sidewalk.',
    female: "Let's not test that. Let's make lemonade instead.",
    followUp: "Science can wait. Lemonade can't."
  },
  {
    id: 'weather_2',
    category: 'weather',
    male: 'Another scorcher out there. People need cold drinks.',
    female: 'And a little shade, and maybe a nap.',
    followUp: 'We sell two of those.'
  },
  {
    id: 'weather_3',
    category: 'weather',
    male: 'The sun is doing the absolute most today.',
    female: "That's why we're the sunny side. We planned for this.",
    followUp: 'Somebody plan me a fan.'
  },
  {
    id: 'weather_4',
    category: 'weather',
    male: 'Summer is here, and the slushie machine knows it.',
    female: "It's been showing off all morning.",
    followUp: 'Let it. It earned it.'
  },
  {
    id: 'weather_5',
    category: 'weather',
    male: 'Hot day, cold drink, good music. That is the whole plan.',
    female: 'You forgot friendly service.',
    followUp: 'I was getting to that.'
  },

  // --------------------------------------------------------- weekend (5)
  {
    id: 'weekend_1',
    category: 'weekend',
    contexts: ['weekend', 'any'],
    male: "It's the weekend! You know what that means.",
    female: 'Long lines and extra cherries?',
    followUp: 'You read my mind.'
  },
  {
    id: 'weekend_2',
    category: 'weekend',
    contexts: ['weekend', 'any'],
    male: 'Saturday energy in the shop today.',
    female: 'Saturdays get the good ice.',
    followUp: "Every day gets the good ice. Don't tell the other days."
  },
  {
    id: 'weekend_3',
    category: 'weekend',
    contexts: ['weekend', 'any'],
    male: 'Weekend plans? Mine is making drinks and listening to you talk.',
    female: "That's not a plan, that's a job.",
    followUp: "Best job I've had."
  },
  {
    id: 'weekend_4',
    category: 'weekend',
    contexts: ['weekend', 'any'],
    male: "Sunday is for slow sips and good company.",
    female: "And for pretending Monday isn't coming.",
    followUp: "We don't say that word here."
  },
  {
    id: 'weekend_5',
    category: 'weekend',
    contexts: ['weekend', 'any'],
    male: 'The weekend crowd is always ready to try something new.',
    female: 'So let them try the weird combo.',
    followUp: 'The people asked. We deliver.'
  },

  // ------------------------------------------------------- supporter (5)
  {
    id: 'supporter_1',
    category: 'supporter',
    contexts: ['any', 'supporter'],
    male: 'Shout out to everyone who followed today. You are the best.',
    female: 'Every follow puts a little sparkle in the shop.',
    followUp: 'We see you. We appreciate you.'
  },
  {
    id: 'supporter_2',
    category: 'supporter',
    contexts: ['gift', 'supporter'],
    male: 'Somebody just sent a gift, and the whole counter lit up.',
    female: 'That is the good stuff. Thank you from both of us.',
    followUp: 'We will make the next drink extra special.'
  },
  {
    id: 'supporter_3',
    category: 'supporter',
    contexts: ['any', 'supporter'],
    male: 'Look at our supporters go! This shop runs on good people.',
    female: 'And a surprising amount of ice.',
    followUp: 'Mostly good people, though.'
  },
  {
    id: 'supporter_4',
    category: 'supporter',
    contexts: ['bigGift', 'gift'],
    male: 'Whoa! Did everybody see that? {viewer} just went all in!',
    female: 'We saw it! That calls for a victory lap around the blender.',
    followUp: 'Make it two laps. And an extra-large smoothie!'
  },
  {
    id: 'supporter_5',
    category: 'supporter',
    contexts: ['bigGift', 'gift'],
    male: 'Hold up. {viewer} just dropped a legendary gift!',
    female: 'Legendary! Somebody give that supporter a front-row stool.',
    followUp: 'Already saving it. Best seat in the shop!'
  },

  // ------------------------------------------------------ atmosphere (6)
  {
    id: 'atmosphere_1',
    category: 'atmosphere',
    male: 'I love this little shop. The music, the ice, the chaos.',
    female: "It's home. With more straws.",
    followUp: "That's going on a mug."
  },
  {
    id: 'atmosphere_2',
    category: 'atmosphere',
    male: 'Smell that? Fresh lemon and clean counter.',
    female: 'We should bottle that.',
    followUp: 'We bottle the lemon. The counter stays.'
  },
  {
    id: 'atmosphere_3',
    category: 'atmosphere',
    male: 'The afternoon light in here is perfect.',
    female: "You're getting sentimental.",
    followUp: "It's the syrup fumes."
  },
  {
    id: 'atmosphere_4',
    category: 'atmosphere',
    male: 'This is my favorite part of the day, right before the rush.',
    female: 'You say that before every rush.',
    followUp: "It's always true."
  },
  {
    id: 'atmosphere_5',
    category: 'atmosphere',
    male: 'Good drinks, good people, good music. Not a bad way to spend a day.',
    female: 'And the best coworker.',
    followUp: "I wasn't going to say it, but yes."
  },
  {
    id: 'atmosphere_6',
    category: 'atmosphere',
    male: 'Listen to the ice settle. This shop has a soundtrack.',
    female: 'You are one cup away from writing poetry.',
    followUp: 'One cup and a very small notebook.'
  }
];

module.exports = { CONVERSATION_CATEGORIES, CONVERSATION_INTERVALS, DEFAULT_CONVERSATIONS };
