/**
 * Mystic Witch Live — automatic shop announcer
 *
 * - Editable English / Vietnamese announcement catalog (localStorage)
 * - Context-aware scheduler that speaks through the existing Piper TTS queue
 * - Never interrupts speech, never repeats the previous line, respects the
 *   game pause state, and yields to gifts / VIP / viewer replies
 */
(function () {
  const SETTINGS_KEY = 'shop_announcer_settings';
  const LIST_KEY = 'shop_announcer_list';

  const CATEGORIES = [
    { id: 'welcome', label: 'A. Welcome & Greeting', icon: '👋' },
    { id: 'drinks', label: 'B. Drink Promotion', icon: '🥤' },
    { id: 'cta', label: 'C. Call to Action', icon: '💬' },
    { id: 'atmosphere', label: 'D. Shop Atmosphere', icon: '☀️' },
    { id: 'appreciation', label: 'E. Supporter Appreciation', icon: '💛' }
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    running: true,
    interval: 8,
    language: 'en',
    voiceMode: 'random',
    voice: '',
    speed: 1,
    volume: 0.9,
    shuffle: true
  };

  const DEFAULTS = [
    // A. Welcome & Greeting
    { id: 'welcome_1', category: 'welcome', language: 'both', enabled: true, voice: '', textEn: 'Welcome to Mystic Witch Live! Fresh drinks, sunny vibes, all day long.', textVi: 'Chào mừng đến với Mystic Witch Live! Đồ uống tươi mát, không khí rộn ràng cả ngày.' },
    { id: 'welcome_2', category: 'welcome', language: 'both', enabled: true, voice: '', textEn: 'Hey everyone, welcome in! The shop is open and the ice is cold.', textVi: 'Xin chào mọi người, mời vào nhé! Tiệm đang mở và đá thì thật lạnh.' },
    { id: 'welcome_3', category: 'welcome', language: 'both', enabled: true, voice: '', textEn: "So glad you're here! Grab a drink and stay for the sunshine.", textVi: 'Rất vui vì bạn đã ghé! Chọn một ly nước và ở lại cùng nắng ấm nhé.' },
    { id: 'welcome_4', category: 'welcome', language: 'both', enabled: true, voice: '', textEn: "Welcome back to the shop, friends! Let's make today a sweet one.", textVi: 'Chào mừng các bạn quay lại tiệm! Hôm nay mình cùng ngọt ngào nhé.' },
    { id: 'welcome_5', category: 'welcome', language: 'both', enabled: true, voice: '', textEn: 'Step right up to Mystic Witch Live, your favorite little drink stop.', textVi: 'Mời bạn ghé Mystic Witch Live, điểm dừng chân đồ uống yêu thích.' },
    { id: 'welcome_6', category: 'welcome', language: 'both', enabled: true, voice: '', textEn: 'Welcome in, {viewer}! Great to see you at the counter.', textVi: 'Chào mừng {viewer} đã ghé tiệm! Rất vui được gặp bạn.' },

    // B. Drink Promotion
    { id: 'drinks_1', category: 'drinks', language: 'both', enabled: true, voice: '', textEn: 'Fresh lemonade, squeezed today. Ice cold and perfectly sweet!', textVi: 'Nước chanh tươi, vắt trong hôm nay. Mát lạnh và ngọt vừa!' },
    { id: 'drinks_2', category: 'drinks', language: 'both', enabled: true, voice: '', textEn: 'Try our berry smoothie: thick, creamy and full of summer.', textVi: 'Thử sinh tố dâu việt quất: sánh mịn, béo ngậy và đậm vị mùa hè.' },
    { id: 'drinks_3', category: 'drinks', language: 'both', enabled: true, voice: '', textEn: 'Iced coffee is ready — bold, cold and just the right kick.', textVi: 'Cà phê đá đã sẵn sàng — đậm đà, mát lạnh và tỉnh táo.' },
    { id: 'drinks_4', category: 'drinks', language: 'both', enabled: true, voice: '', textEn: 'Blue slushie time! Bright, frosty and fun to sip.', textVi: 'Đến giờ slushie xanh! Rực rỡ, mát rượi và uống rất vui.' },
    { id: 'drinks_5', category: 'drinks', language: 'both', enabled: true, voice: '', textEn: 'Orange soda, fizzy and fresh — a little sunshine in a cup.', textVi: 'Soda cam sủi bọt, tươi mới — một chút nắng trong ly.' },
    { id: 'drinks_6', category: 'drinks', language: 'both', enabled: true, voice: '', textEn: 'Classic cola over crushed ice. Simple, cold, always good.', textVi: 'Cola cổ điển với đá xay. Đơn giản, mát lạnh, luôn ngon.' },

    // C. Call to Action
    { id: 'cta_1', category: 'cta', language: 'both', enabled: true, voice: '', textEn: "Type your drink in the comments and we'll make it fresh for you!", textVi: 'Hãy gõ tên đồ uống trong phần bình luận, tiệm sẽ pha ngay cho bạn!' },
    { id: 'cta_2', category: 'cta', language: 'both', enabled: true, voice: '', textEn: 'Tap like and follow so you never miss a fresh pour.', textVi: 'Nhấn thích và theo dõi để không bỏ lỡ ly nước mới nhé.' },
    { id: 'cta_3', category: 'cta', language: 'both', enabled: true, voice: '', textEn: 'Send a gift to order a drink — every coin picks a special cup.', textVi: 'Gửi quà để đặt đồ uống — mỗi xu sẽ chọn một ly đặc biệt.' },
    { id: 'cta_4', category: 'cta', language: 'both', enabled: true, voice: '', textEn: 'Tell us your favorite flavor in the chat. We read every comment!', textVi: 'Cho tiệm biết vị bạn thích trong khung chat nhé. Tiệm đọc mọi bình luận!' },
    { id: 'cta_5', category: 'cta', language: 'both', enabled: true, voice: '', textEn: 'Order now and watch your drink being made live.', textVi: 'Đặt ngay và xem ly nước của bạn được pha trực tiếp.' },

    // D. Shop Atmosphere
    { id: 'atmosphere_1', category: 'atmosphere', language: 'both', enabled: true, voice: '', textEn: 'Sunshine, cold drinks and good music — the perfect little break.', textVi: 'Nắng ấm, đồ uống mát và nhạc hay — một khoảng nghỉ thật tuyệt.' },
    { id: 'atmosphere_2', category: 'atmosphere', language: 'both', enabled: true, voice: '', textEn: 'The blender is humming and the ice is sparkling. Come say hi!', textVi: 'Máy xay đang chạy và đá thì lấp lánh. Ghé chào tiệm nhé!' },
    { id: 'atmosphere_3', category: 'atmosphere', language: 'both', enabled: true, voice: '', textEn: 'Another hot day, another round of ice-cold drinks coming up.', textVi: 'Ngày nóng nữa lại đến, thêm một vòng đồ uống mát lạnh sắp ra lò.' },
    { id: 'atmosphere_4', category: 'atmosphere', language: 'both', enabled: true, voice: '', textEn: 'This is your sunny corner of the internet. Stay a while!', textVi: 'Đây là góc nắng nhỏ của bạn trên mạng. Ở lại một chút nhé!' },
    { id: 'atmosphere_5', category: 'atmosphere', language: 'both', enabled: true, voice: '', textEn: 'Fresh cups, fresh smiles, all day at Mystic Witch Live.', textVi: 'Ly mới, nụ cười mới, cả ngày tại Mystic Witch Live.' },

    // E. Supporter Appreciation
    { id: 'appreciation_1', category: 'appreciation', language: 'both', enabled: true, voice: '', textEn: 'Big thanks to everyone supporting the shop today!', textVi: 'Cảm ơn rất nhiều đến mọi người đã ủng hộ tiệm hôm nay!' },
    { id: 'appreciation_2', category: 'appreciation', language: 'both', enabled: true, voice: '', textEn: 'Shout out to our VIP supporters — you keep the drinks coming!', textVi: 'Xin chào các khách VIP — nhờ bạn mà những ly nước cứ thế ra đời!' },
    { id: 'appreciation_3', category: 'appreciation', language: 'both', enabled: true, voice: '', textEn: "Thank you for the gifts, the likes and the love. You're the best!", textVi: 'Cảm ơn những món quà, lượt thích và tình cảm. Bạn tuyệt nhất!' },
    { id: 'appreciation_4', category: 'appreciation', language: 'both', enabled: true, voice: '', textEn: 'Every follow and every gift makes this little shop brighter.', textVi: 'Mỗi lượt theo dõi và mỗi món quà đều làm tiệm nhỏ này rạng rỡ hơn.' }
  ];

  // Local Piper voices by seller gender (models live in config/piper).
  const VOICE_MAP = {
    en: {
      female: ['en_US-amy-medium', 'en_US-hfc_female-medium'],
      male: ['en_US-arctic-medium']
    },
    vi: {
      female: ['banmai', 'cuc', 'ngochuyen', 'ngochuyennew', 'phuongtrang', 'chieuthanh', 'vi_VN-vais1000-medium'],
      male: ['manhdung', 'minhkhang', 'minhquang', 'duyoryx3175', 'taian2', 'lacphi']
    }
  };

  // Catalog discovered by the server from config/piper (no filenames are hardcoded).
  // VOICE_MAP above is only a fallback for the offline / first-load case.
  let voiceCatalog = { en: [], vi: [] };

  // Server-owned voice character profiles. Null until the stage receives state.
  let voiceProfiles = null;
  let announcerTurn = 0;

  function setVoiceProfiles(snapshot) {
    if (!snapshot || !snapshot.profiles) return;
    voiceProfiles = snapshot;
  }

  function setVoiceCatalog(catalog) {
    if (!catalog) return;
    const byLanguage = { en: [], vi: [] };
    const grouped = !Array.isArray(catalog) && (Array.isArray(catalog.en) || Array.isArray(catalog.vi));
    if (grouped) {
      for (const voice of catalog.en || []) {
        if (voice && voice.id && voice.valid !== false) byLanguage.en.push(voice);
      }
      for (const voice of catalog.vi || catalog.vn || []) {
        if (voice && voice.id && voice.valid !== false) byLanguage.vi.push(voice);
      }
    } else if (Array.isArray(catalog)) {
      for (const voice of catalog) {
        if (!voice || !voice.id || voice.valid === false) continue;
        const language = voice.language === 'vi' || voice.language === 'vn' ? 'vi' : 'en';
        byLanguage[language].push(voice);
      }
    }
    voiceCatalog = byLanguage;
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function cloneDefaults() {
    return DEFAULTS.map((item) => ({ ...item }));
  }

  const Store = {
    loadSettings() {
      const saved = readJSON(SETTINGS_KEY, {});
      return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
    },
    saveSettings(patch) {
      const next = { ...Store.loadSettings(), ...patch };
      writeJSON(SETTINGS_KEY, next);
      return next;
    },
    loadList() {
      const stored = readJSON(LIST_KEY, null);
      if (!Array.isArray(stored) || stored.length === 0) return cloneDefaults();
      return stored.map((item) => ({ enabled: true, language: 'both', voice: '', ...item }));
    },
    saveList(list) {
      writeJSON(LIST_KEY, list);
      return list;
    },
    resetList() {
      const list = cloneDefaults();
      writeJSON(LIST_KEY, list);
      return list;
    },
    addItem(item) {
      const list = Store.loadList();
      const textEn = String(item.textEn || '').trim();
      const textVi = String(item.textVi || '').trim();
      const id = item.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      list.push({
        id,
        category: item.category || 'welcome',
        language: item.language || 'both',
        enabled: item.enabled !== false,
        voice: item.voice || '',
        textEn,
        textVi
      });
      Store.saveList(list);
      return id;
    },
    updateItem(id, patch) {
      const list = Store.loadList().map((item) => (item.id === id ? { ...item, ...patch } : item));
      Store.saveList(list);
      return list;
    },
    removeItem(id) {
      const list = Store.loadList().filter((item) => item.id !== id);
      Store.saveList(list);
      return list;
    }
  };

  function pickVoice(language, mode) {
    const lang = language === 'vi' ? 'vi' : 'en';
    const discovered = Array.isArray(voiceCatalog[lang]) ? voiceCatalog[lang] : [];
    let pool = discovered;
    if (discovered.length && mode !== 'random') {
      const byGender = discovered.filter((voice) => voice.gender === mode);
      // Voices without gender metadata stay playable instead of disappearing.
      if (byGender.length) pool = byGender;
    }
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)].id;
    const fallback = VOICE_MAP[lang] || VOICE_MAP.en;
    const ids =
      mode === 'male' ? fallback.male : mode === 'female' ? fallback.female : [...fallback.female, ...fallback.male];
    if (!ids.length) return null;
    return ids[Math.floor(Math.random() * ids.length)];
  }

  class ShopAnnouncer {
    constructor(options = {}) {
      this.audio = options.audio || null;
      this.getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
      this.settings = Store.loadSettings();
      this.list = Store.loadList();
      this.lastId = '';
      this.lastStartAt = 0;
      this.currentText = '';
      this.lastPersonalizedAt = 0;
      this.pendingGreet = null;
      this.paused = false;
      this.conversationActive = false;
      this.timer = null;
      this.lastBroadcastAt = 0;
      this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mystic-witch-announcer') : null;
      if (this.channel) {
        this.channel.onmessage = (event) => this.handleMessage(event.data);
      }
      this.voiceCatalog = voiceCatalog;
      this.voiceProfiles = voiceProfiles;
      this.refreshVoiceCatalog();
      setInterval(() => this.refreshVoiceCatalog(), 120000);
      window.addEventListener('storage', (event) => {
        if (event.key === SETTINGS_KEY || event.key === LIST_KEY) this.reload();
      });
      this.startTicking();
    }

    // ------------------------------------------------------------- persistence
    reload() {
      this.settings = Store.loadSettings();
      this.list = Store.loadList();
      this.broadcast(true);
    }

    saveSettings(patch) {
      this.settings = Store.saveSettings(patch);
      this.broadcast(true);
      return this.settings;
    }

    handleMessage(msg) {
      if (!msg) return;
      if (msg.type === 'refresh') this.reload();
      if (msg.type === 'status-request') this.broadcast(true);
      if (msg.type === 'control') {
        this.saveSettings({ running: msg.action !== 'stop' });
      }
    }

    // Keep gender pools aligned with the server's filesystem discovery.
    setVoiceCatalog(catalog) {
      setVoiceCatalog(catalog);
      this.voiceCatalog = voiceCatalog;
    }

    // Profile C: use the male seller, female seller, alternate or random seller.
    // The chosen seller contributes its complete voice, speed, volume and language.
    setVoiceProfiles(snapshot) {
      setVoiceProfiles(snapshot);
      this.voiceProfiles = voiceProfiles;
    }

    resolvedProfile() {
      const snapshot = this.voiceProfiles || voiceProfiles;
      const profiles = snapshot && snapshot.profiles;
      if (!profiles) return null;
      const announcer = profiles.announcer;
      const sellers = ['maleSeller', 'femaleSeller']
        .map((id) => profiles[id])
        .filter((profile) => profile && profile.enabled !== false);
      if (!announcer || announcer.enabled === false) return sellers.length ? sellers[0] : null;
      // An exact announcer voice (profile C) overrides the seller-selection modes.
      if (announcer.engine === 'kokoro' ? announcer.kokoroVoice : announcer.voice) return announcer;
      if (!sellers.length) return announcer;
      const mode = announcer.mode || snapshot.announcerMode || 'alternate';
      if (mode === 'maleSeller') {
        return profiles.maleSeller && profiles.maleSeller.enabled !== false ? profiles.maleSeller : sellers[0];
      }
      if (mode === 'femaleSeller') {
        return profiles.femaleSeller && profiles.femaleSeller.enabled !== false ? profiles.femaleSeller : sellers[0];
      }
      if (mode === 'random') return sellers[Math.floor(Math.random() * sellers.length)];
      const chosen = sellers[announcerTurn % sellers.length];
      announcerTurn += 1;
      return chosen;
    }

    async refreshVoiceCatalog() {
      try {
        const res = await fetch('/api/tts/voices');
        if (res.ok) setVoiceCatalog(await res.json());
      } catch (_) {}
      this.voiceCatalog = voiceCatalog;
      return this.voiceCatalog;
    }

    startTicking() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), 500);
    }

    stopTicking() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }

    // -------------------------------------------------------------- scheduler
    setPaused(paused) {
      const next = Boolean(paused);
      if (next === this.paused) return;
      this.paused = next;
      this.broadcast(true);
    }

    // A two-seller conversation owns the speech slot until it finishes, so the
    // automatic announcement catalog cannot talk over the other seller.
    setConversationActive(active) {
      this.conversationActive = Boolean(active);
      this.broadcast(true);
    }

    start() {
      this.saveSettings({ running: true });
    }

    stop() {
      this.saveSettings({ running: false });
    }

    speechBusy() {
      if (!this.audio) return false;
      return Boolean(this.audio.ttsPlaying) || (Array.isArray(this.audio.ttsQueue) && this.audio.ttsQueue.length > 0);
    }

    activeList() {
      return this.list.filter((item) => item.enabled !== false && (item.textEn || item.textVi));
    }

    contextInfo() {
      let ctx = {};
      try {
        ctx = this.getContext() || {};
      } catch (_) {
        ctx = {};
      }
      const stats = ctx.stats || {};
      return {
        customers: Number(stats.customers) || 0,
        waiting: Number(stats.waiting) || 0,
        serving: Boolean(stats.serving),
        viewers: Number(ctx.viewers) || 0
      };
    }

    preferredCategories(ctx) {
      const preferred = [];
      if (ctx.customers === 0 && ctx.viewers === 0) preferred.push('welcome', 'cta');
      else if (ctx.waiting > 0) preferred.push('drinks', 'cta');
      else if (ctx.serving) preferred.push('atmosphere', 'drinks');
      else preferred.push('welcome', 'atmosphere');
      if (ctx.viewers === 0) preferred.push('cta');
      preferred.push('appreciation');
      return preferred;
    }

    peek(consumeGreet = false) {
      const list = this.activeList();
      if (!list.length) return null;
      const ctx = this.contextInfo();
      const now = Date.now();

      // Occasionally greet a brand-new viewer by username.
      if (this.pendingGreet && now - this.pendingGreet.at < 20000) {
        const greetTemplate = list.find(
          (item) => item.category === 'welcome' && String(item.textEn || '').includes('{viewer}')
        );
        if (greetTemplate && greetTemplate.id !== this.lastId) {
          if (consumeGreet) {
            this.pendingGreet = null;
          }
          return { item: greetTemplate, viewer: this.pendingGreet ? this.pendingGreet.name : '' };
        }
      }

      const preferred = this.preferredCategories(ctx);
      let pool = list.filter((item) => preferred.includes(item.category));
      if (!pool.length) pool = list;
      pool = pool.filter((item) => item.id !== this.lastId);
      if (!pool.length) pool = list;

      let item;
      if (this.settings.shuffle) {
        item = pool[Math.floor(Math.random() * pool.length)];
      } else {
        const ordered = this.list.filter((entry) => entry.enabled !== false);
        const lastIndex = ordered.findIndex((entry) => entry.id === this.lastId);
        item = ordered[(lastIndex + 1) % Math.max(1, ordered.length)] || pool[0];
      }
      return { item, viewer: '' };
    }

    textFor(item, viewer, languageOverride) {
      const language =
        item.language === 'en' || item.language === 'vi'
          ? item.language
          : languageOverride || this.settings.language;
      const raw = language === 'vi' ? item.textVi || item.textEn : item.textEn || item.textVi;
      return String(raw || '').replace(/\{viewer\}/gi, viewer ? `@${viewer}` : '');
    }

    tick() {
      if (!this.audio) return;
      if (!this.settings.enabled || !this.settings.running || this.paused) return;
      if (this.conversationActive) return;
      const now = Date.now();
      const intervalMs = Math.max(3, Number(this.settings.interval) || 6) * 1000;
      if (this.lastStartAt && now - this.lastStartAt < intervalMs) return;
      if (this.speechBusy()) return;
      if (this.lastPersonalizedAt && now - this.lastPersonalizedAt < 6000) return;

      const pick = this.peek(false);
      if (!pick) return;
      this.speakItem(pick.item, pick.viewer);
    }

    speakItem(item, viewer) {
      if (!item || !this.audio) return false;
      const profile = this.resolvedProfile();
      const language = item.language === 'en' || item.language === 'vi' ? item.language : this.settings.language;
      const profileLanguage = profile ? (profile.language === 'vi' ? 'vi' : 'en') : '';
      const speechLanguage = profileLanguage || language;
      const text = this.textFor(item, viewer, speechLanguage);
      if (!text) return false;
      const voice =
        item.voice ||
        (profile && (profile.resolvedVoice || profile.voice || profile.kokoroVoice)) ||
        this.settings.voice ||
        pickVoice(speechLanguage, this.settings.voiceMode);
      const engine = item.voice ? 'piper' : profile && profile.resolvedEngine === 'kokoro' ? 'kokoro' : 'piper';
      const ok = this.audio.enqueueTts(text, {
        priority: 2,
        engine,
        language: speechLanguage,
        voice,
        piperVoice: profile ? profile.piperFallbackVoice || profile.voice : this.settings.voice,
        speed: profile ? Number(profile.speed) || 1 : Number(this.settings.speed) || 1,
        volume: profile ? profile.volume : this.settings.volume,
        profile: profile ? profile.id : 'announcer',
        onStart: () => {
          this.lastStartAt = Date.now();
          this.currentText = text;
          this.broadcast(true);
        },
        onEnd: () => {
          this.currentText = '';
          this.broadcast(true);
        }
      });
      if (ok === false) return false;
      this.lastId = item.id;
      this.currentId = item.id;
      this.broadcast(true);
      return true;
    }

    // Public helper for the admin test buttons.
    testSentence(id) {
      const item = this.list.find((entry) => entry.id === id);
      if (!item) return false;
      return this.speakItem(item, '');
    }

    notifyPersonalized(when = Date.now()) {
      this.lastPersonalizedAt = when;
    }

    greetViewer(name) {
      const clean = String(name || '').trim();
      if (!clean) return;
      this.pendingGreet = { name: clean, at: Date.now() };
    }

    status() {
      const now = Date.now();
      const intervalMs = Math.max(3, Number(this.settings.interval) || 6) * 1000;
      const nextDueAt = this.lastStartAt ? this.lastStartAt + intervalMs : now;
      let preview = null;
      if (this.settings.enabled && this.settings.running && !this.paused) {
        const pick = this.peek(false);
        if (pick) preview = { id: pick.item.id, text: this.textFor(pick.item, pick.viewer) };
      }
      return {
        enabled: this.settings.enabled,
        running: this.settings.running,
        paused: this.paused,
        conversationActive: this.conversationActive,
        interval: this.settings.interval,
        language: this.settings.language,
        voiceMode: this.settings.voiceMode,
        voiceProfile: (() => {
          const profiles = (this.voiceProfiles || voiceProfiles) || null;
          const announcer = profiles && profiles.profiles && profiles.profiles.announcer;
          return announcer
            ? {
                mode: announcer.mode || profiles.announcerMode,
                engine: announcer.engine || 'piper',
                voice: (announcer.engine === 'kokoro' ? announcer.kokoroVoice : announcer.voice) || ''
              }
            : null;
        })(),
        speaking: Boolean(this.currentText),
        currentText: this.currentText,
        lastId: this.lastId,
        next: preview,
        nextDueAt,
        queue: this.audio && Array.isArray(this.audio.ttsQueue) ? this.audio.ttsQueue.length : 0
      };
    }

    broadcast(force = false) {
      if (!this.channel) return;
      const now = Date.now();
      if (!force && now - this.lastBroadcastAt < 1000) return;
      this.lastBroadcastAt = now;
      try {
        this.channel.postMessage({ type: 'status', status: this.status() });
      } catch (_) {}
    }
  }

  window.SHOP_ANNOUNCER_CATEGORIES = CATEGORIES;
  window.SHOP_ANNOUNCER_DEFAULTS = DEFAULTS;
  window.ShopAnnouncerStore = Store;
  window.ShopAnnouncer = ShopAnnouncer;
})();
