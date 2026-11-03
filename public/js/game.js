/**
 * Sunny Side Sips — 2D cartoon drink shop simulation (1080 x 1920)
 *
 * - Uses only the supplied JPG art in /assets (background, customers, drinks, seller)
 * - White studio backgrounds are flood-filled away from the image border, so enclosed
 *   white clothing (t-shirts, sneakers) stays opaque
 * - Queue slots + table seats + path lanes keep characters from stacking up
 * - Depth sorted rendering, single canvas, no per-frame filters
 */
(function () {
  const ASSETS = window.SHOP_ASSETS;
  if (!ASSETS) {
    console.error('[ShopGame] asset-manifest.js did not load');
    return;
  }

  const W = 1080;
  const H = 1920;
  // No character or waiting-queue cap: the whole floor is the stage. The first
  // few queue positions are the counter row; everybody else fills expanding rows
  // behind them so a large audience stays visible instead of being held off-stage.
  const FRONT_SLOTS = 8; // 4 counter queue slots + 4 overflow slots
  const CROWD_AREA = { x0: 110, x1: 970, y0: 1176, y1: 1812 };
  const CROWD_CELL_SIZE = 72;
  const CROWD_TIERS = [
    { max: 30, tier: 'full', stride: 1 },
    { max: 75, tier: 'spatial', stride: 1 },
    { max: 149, tier: 'adaptive', stride: 2 },
    { max: Infinity, tier: 'light', stride: 3 }
  ];
  const DRINK_PRICES = {
    lemonade: 5,
    'iced-coffee': 6,
    'orange-soda': 4,
    smoothie: 7,
    slushie: 5,
    cola: 3
  };

  const COLORS = {
    ink: '#3b2a20',
    inkSoft: '#6b5140',
    cream: '#fff7e4',
    cream2: '#ffeccb',
    coral: '#ef5a4b',
    coralDark: '#c93a2c',
    sun: '#ffc94d',
    wood: '#d99b5c',
    woodDark: '#8a5a2b',
    woodLight: '#f2cb93',
    mint: '#45b980'
  };

  const LAYOUT = {
    counter: { x: 452, y: 1004, w: 558, h: 100 },
    sellers: [
      { key: 'female', x: 606, y: 1102 },
      { key: 'male', x: 786, y: 1106 }
    ],
    queueSlots: [
      { x: 592, y: 1246 },
      { x: 706, y: 1274 },
      { x: 820, y: 1302 },
      { x: 934, y: 1330 }
    ],
    overflow: [
      { x: 486, y: 1348 },
      { x: 386, y: 1368 },
      { x: 900, y: 1386 },
      { x: 1010, y: 1408 }
    ],
    tables: [
      { x: 226, y: 1456, umbrella: true },
      { x: 512, y: 1490, umbrella: false },
      { x: 800, y: 1512, umbrella: false },
      { x: 344, y: 1624, umbrella: true },
      { x: 700, y: 1650, umbrella: true }
    ],
    seatSpread: 96,
    seatDrop: 36,
    entries: {
      left: { x: -150, y: 1442 },
      right: { x: W + 150, y: 1418 }
    }
  };

  // --------------------------------------------------------------------------
  // helpers
  // --------------------------------------------------------------------------
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const round2 = (v) => Math.round(v * 100) / 100;
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

  function depthScale(y) {
    return clamp(0.72 + (y - 1150) * 0.00042, 0.7, 1.08);
  }

  /** Rows/columns plus a gentle shrink, so 100 viewers fit without stacking up. */
  function crowdMetrics(count) {
    const n = Math.max(FRONT_SLOTS, count || 0);
    const cols = Math.round(clamp(Math.sqrt(n * 1.5), 8, 18));
    const rows = Math.max(1, Math.ceil(n / cols));
    return {
      cols,
      rows,
      dx: (CROWD_AREA.x1 - CROWD_AREA.x0) / Math.max(1, cols - 1),
      dy: clamp((CROWD_AREA.y1 - CROWD_AREA.y0) / Math.max(1, rows - 1), 36, 96),
      scale: clamp(Math.sqrt(70 / Math.max(16, n)), 0.42, 1)
    };
  }

  function crowdSlot(index, metrics = crowdMetrics(0)) {
    const i = Math.max(0, Math.round(Number(index) || 0));
    const col = i % metrics.cols;
    const row = Math.floor(i / metrics.cols);
    const brick = row % 2 === 0 ? 0 : metrics.dx * 0.5;
    return {
      x: clamp(CROWD_AREA.x0 + col * metrics.dx + brick, 54, W - 54),
      y: clamp(CROWD_AREA.y0 + row * metrics.dy, 1140, 1830)
    };
  }

  function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function ellipse(ctx, x, y, rx, ry, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 3;
      ctx.stroke();
    }
  }

  /**
   * A small spatial hash keeps collision work proportional to nearby bodies.
   * The cell size is deliberately adjustable: the stage mixes counter-sized
   * personal space with a much denser background crowd.
   */
  class SpatialHashGrid {
    constructor(cellSize = CROWD_CELL_SIZE) {
      this.cellSize = Math.max(32, Number(cellSize) || CROWD_CELL_SIZE);
      this.cells = new Map();
      this.items = [];
      this.collisionChecks = 0;
    }

    clear() {
      this.cells.clear();
      this.items.length = 0;
      this.collisionChecks = 0;
    }

    insert(item) {
      const x = Number(item && item.x);
      const y = Number(item && item.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const cx = Math.floor(x / this.cellSize);
      const cy = Math.floor(y / this.cellSize);
      const key = `${cx}:${cy}`;
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push(item);
      this.items.push(item);
    }

    query(x, y, radius, visitor) {
      if (!this.cells.size || typeof visitor !== 'function') return 0;
      const r = Math.max(0, Number(radius) || 0);
      const minX = Math.floor((x - r) / this.cellSize);
      const maxX = Math.floor((x + r) / this.cellSize);
      const minY = Math.floor((y - r) / this.cellSize);
      const maxY = Math.floor((y + r) / this.cellSize);
      let checks = 0;
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          const bucket = this.cells.get(`${cx}:${cy}`);
          if (!bucket) continue;
          for (const item of bucket) {
            checks += 1;
            visitor(item);
          }
        }
      }
      this.collisionChecks += checks;
      return checks;
    }

    get cellCount() {
      return this.cells.size;
    }
  }

  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = String(text);
    while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
      out = out.slice(0, -1);
    }
    return out + '…';
  }

  /** Wrap a canvas label without exceeding the bubble/tag width. */
  function wrapCanvasText(ctx, text, maxWidth, maxLines = 3) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      // Split an oversized unbroken token rather than letting it leave the box.
      line = '';
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          lines.push(line);
          line = char;
        } else {
          line += char;
        }
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const rest = lines.slice(maxLines - 1).join(' ');
      lines.length = maxLines - 1;
      lines.push(ellipsize(ctx, rest, maxWidth));
    }
    return lines;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${src}`));
      img.src = src;
    });
  }

  /**
   * Remove the flat studio background by flood filling inward from the borders.
   * Interior white areas (t-shirt, shoes) are never reached, so they survive.
   * Returns a trimmed offscreen canvas so every character has the same anchor.
   */
  function cutOutBackground(img) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const full = document.createElement('canvas');
    full.width = sw;
    full.height = sh;
    const ctx = full.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    let data;
    try {
      data = ctx.getImageData(0, 0, sw, sh);
    } catch (err) {
      return { canvas: full, w: sw, h: sh };
    }

    const px = data.data;
    const total = sw * sh;
    const visited = new Uint8Array(total);
    const stack = new Int32Array(total);
    let sp = 0;

    const isBackground = (i) => {
      const o = i * 4;
      const r = px[o];
      const g = px[o + 1];
      const b = px[o + 2];
      const mn = Math.min(r, g, b);
      const mx = Math.max(r, g, b);
      return mn >= 229 && mx - mn <= 20;
    };
    const push = (i) => {
      if (i >= 0 && i < total && !visited[i] && isBackground(i)) {
        visited[i] = 1;
        stack[sp++] = i;
      }
    };

    for (let x = 0; x < sw; x++) {
      push(x);
      push((sh - 1) * sw + x);
    }
    for (let y = 0; y < sh; y++) {
      push(y * sw);
      push(y * sw + sw - 1);
    }

    while (sp > 0) {
      const i = stack[--sp];
      px[i * 4 + 3] = 0;
      const x = i % sw;
      const y = (i - x) / sw;
      if (x > 0) push(i - 1);
      if (x < sw - 1) push(i + 1);
      if (y > 0) push(i - sw);
      if (y < sh - 1) push(i + sw);
    }

    let minX = sw;
    let minY = sh;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < sh; y++) {
      const row = y * sw;
      for (let x = 0; x < sw; x++) {
        if (px[(row + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return { canvas: full, w: sw, h: sh };

    const pad = 2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(sw - 1, maxX + pad);
    maxY = Math.min(sh - 1, maxY + pad);
    const tw = maxX - minX + 1;
    const th = maxY - minY + 1;

    ctx.putImageData(data, 0, 0);
    const trimmed = document.createElement('canvas');
    trimmed.width = tw;
    trimmed.height = th;
    trimmed.getContext('2d').drawImage(full, minX, minY, tw, th, 0, 0, tw, th);
    return { canvas: trimmed, w: tw, h: th };
  }

  // --------------------------------------------------------------------------
  // Game
  // --------------------------------------------------------------------------
  class ShopGame {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      const initialScale = canvas.width / W;
      if (Number.isFinite(initialScale) && initialScale > 0) {
        this.ctx.setTransform(initialScale, 0, 0, initialScale, 0, 0);
      }
      this.sprites = { customers: [], drinks: [], sellers: {} };
      this.customers = [];
      this.queue = [];
      this.pending = [];
      this.tables = LAYOUT.tables.map((t) => ({
        x: t.x,
        y: t.y,
        umbrella: t.umbrella,
        occupants: [null, null],
        seats: [
          { x: t.x - LAYOUT.seatSpread, y: t.y + LAYOUT.seatDrop },
          { x: t.x + LAYOUT.seatSpread, y: t.y + LAYOUT.seatDrop }
        ]
      }));
      this.session = { served: 0, drinks: 0, tips: 0 };
      this.settings = { running: true, paused: false, spawnRate: 1 };
      this.seq = 0;
      this.spawnTimer = 2400;
      this.time = 0;
      this.lastTs = 0;
      this.tipPops = [];
      this.viewers = new Map();
      this.departed = new Set();
      this.crowd = crowdMetrics(0);
      this.standSeq = 0;
      this.entranceBurst = 0;
      this.entranceWindowAt = 0;
      this.effects = [];
      this.orderSeq = 0;
      this.onOrderServed = null;
      this.pendingEvents = [];
      this.pendingViewerSync = null;
      this.viewerRoster = null;
      this.viewerSyncTimer = 0;
      this.servingId = null;
      this.serveFlash = 0;
      this.ready = false;
      this.onSale = null;
      this.loop = this.loop.bind(this);
      this.raf = null;
      this.simFrame = 0;
      this.spatialCellSize = CROWD_CELL_SIZE;
      this.spatialGrid = new SpatialHashGrid(this.spatialCellSize);
      this.separationGrid = new SpatialHashGrid(this.spatialCellSize);
      this.queueIndex = new Map();
      this.floorSeq = 0;
      this.crowdProfile = this.getCrowdProfile(0);
      this.drawables = [];
      this.perf = {
        updateMs: 0,
        renderMs: 0,
        fps: 0,
        collisionChecks: 0,
        gridCells: 0,
        frameCount: 0,
        fpsAt: 0,
        fpsFrames: 0
      };
    }

    async load() {
      const customerJobs = ASSETS.customers.map((meta) =>
        loadImage(meta.src)
          .then((img) => ({ meta, sprite: cutOutBackground(img) }))
          .catch((err) => {
            console.warn('[ShopGame]', err.message);
            return null;
          })
      );
      const drinkJobs = ASSETS.drinks.map((meta) =>
        loadImage(meta.src)
          .then((img) => ({ id: meta.id, name: meta.name, sprite: cutOutBackground(img) }))
          .catch((err) => {
            console.warn('[ShopGame]', err.message);
            return null;
          })
      );
      const sellerJobs = Object.keys(ASSETS.sellers).map((key) =>
        loadImage(ASSETS.sellers[key])
          .then((img) => ({ key, sprite: cutOutBackground(img) }))
          .catch((err) => {
            console.warn('[ShopGame]', err.message);
            return null;
          })
      );

      const [customers, drinks, sellers] = await Promise.all([
        Promise.all(customerJobs),
        Promise.all(drinkJobs),
        Promise.all(sellerJobs)
      ]);

      this.sprites.customers = customers.filter(Boolean);
      this.sprites.drinks = drinks.filter(Boolean);
      sellers.filter(Boolean).forEach((s) => {
        this.sprites.sellers[s.key] = s.sprite;
      });

      if (!this.sprites.customers.length || !this.sprites.drinks.length) {
        console.error('[ShopGame] Customer or drink art failed to load');
      }

      this.ready = true;
      this.lastTs = 0;
      if (this.pendingViewerSync) {
        const list = this.pendingViewerSync;
        this.pendingViewerSync = null;
        this.syncViewers(list);
      }
      if (this.pendingEvents.length) {
        const queued = this.pendingEvents;
        this.pendingEvents = [];
        queued.forEach((ev) => this.handleEvent(ev));
      }
      if (!this.raf) this.raf = requestAnimationFrame(this.loop);
      return this;
    }

    // ---------------------------------------------------------------- controls
    setPaused(paused) {
      this.settings.paused = Boolean(paused);
    }

    setRunning(running) {
      this.settings.running = Boolean(running);
    }

    setSpawnRate(rate) {
      this.settings.spawnRate = clamp(Number(rate) || 1, 0.25, 3);
    }

    applySettings(settings = {}) {
      if (typeof settings.paused === 'boolean') this.settings.paused = settings.paused;
      if (typeof settings.running === 'boolean') this.settings.running = settings.running;
      if (typeof settings.spawnRate === 'number') this.setSpawnRate(settings.spawnRate);
    }

    reset() {
      this.customers = [];
      this.queue = [];
      this.pending = [];
      this.tipPops = [];
      this.viewers.clear();
      this.departed.clear();
      this.crowd = crowdMetrics(0);
      this.standSeq = 0;
      this.floorSeq = 0;
      this.entranceBurst = 0;
      this.entranceWindowAt = 0;
      this.viewerRoster = null;
      this.effects = [];
      this.orderSeq = 0;
      this.servingId = null;
      this.serveFlash = 0;
      this.session = { served: 0, drinks: 0, tips: 0 };
      this.spawnTimer = 1800;
      this.simFrame = 0;
      this.queueIndex.clear();
      this.spatialGrid.clear();
      this.separationGrid.clear();
      this.drawables.length = 0;
      this.crowdProfile = this.getCrowdProfile(0);
      this.perf.collisionChecks = 0;
      this.perf.gridCells = 0;
      this.perf.updateMs = 0;
      this.perf.renderMs = 0;
      this.perf.fps = 0;
      this.perf.fpsAt = 0;
      this.perf.fpsFrames = 0;
      this.tables.forEach((t) => {
        t.occupants = [null, null];
      });
    }

    getCrowdProfile(count = this.customers.length) {
      const found = CROWD_TIERS.find((entry) => count <= entry.max) || CROWD_TIERS[CROWD_TIERS.length - 1];
      return { max: found.max, tier: found.tier, stride: found.stride, count };
    }

    refreshQueueIndex() {
      this.queueIndex.clear();
      for (let i = 0; i < this.queue.length; i++) this.queueIndex.set(this.queue[i], i);
    }

    isWalking(customer) {
      return Boolean(
        customer &&
          (customer.state === 'enter' ||
            customer.state === 'toSeat' ||
            customer.state === 'leave' ||
            customer.state === 'toGo')
      );
    }

    isCrowdPriority(customer) {
      if (!customer) return false;
      if ((customer.vipLevel || 0) > 0) return true;
      if (customer.reaction || customer.wave > 0 || customer.celebrate > 0) return true;
      if (
        customer.state === 'order' ||
        customer.state === 'toSeat' ||
        customer.state === 'leave' ||
        customer.state === 'toGo'
      ) {
        return true;
      }
      if (customer.leaving || customer.leaveAfterServe || customer.orders.length) return true;
      const queuePosition = this.queueIndex.get(customer.id);
      return customer.state === 'queue' && queuePosition != null && queuePosition < FRONT_SLOTS;
    }

    setCrowdCellSize(size) {
      this.spatialCellSize = clamp(Number(size) || CROWD_CELL_SIZE, 36, 160);
      this.spatialGrid.cellSize = this.spatialCellSize;
      this.separationGrid.cellSize = this.spatialCellSize;
      this.spatialGrid.clear();
      this.separationGrid.clear();
      return this.spatialCellSize;
    }

    buildSpatialGrid(grid, walkersOnly = false) {
      if (!grid) return grid;
      grid.clear();
      for (const customer of this.customers) {
        if (customer.gone) continue;
        if (customer.entranceAt && this.time < customer.entranceAt) continue;
        if (walkersOnly && !this.isWalking(customer)) continue;
        grid.insert(customer);
      }
      this.perf.gridCells = grid.cellCount;
      return grid;
    }

    getCrowdDiagnostics() {
      let rendered = 0;
      let moving = 0;
      let waiting = 0;
      let seated = 0;
      let stuck = 0;
      const now = this.time;
      for (const customer of this.customers) {
        if (customer.gone) continue;
        if (customer.entranceAt && now < customer.entranceAt) continue;
        rendered += 1;
        if (customer.state === 'queue') waiting += 1;
        if (customer.state === 'seated') seated += 1;
        let target = null;
        if (customer.state === 'queue') {
          const index = this.queueIndex.get(customer.id);
          if (index != null) target = this.queueSlotFor(index);
        } else if (customer.waypoints && customer.waypoints[0]) {
          target = customer.waypoints[0];
        }
        const needsMotion =
          customer.state === 'enter' ||
          customer.state === 'toSeat' ||
          customer.state === 'leave' ||
          customer.state === 'toGo' ||
          (customer.state === 'linger' && customer.waypoints && customer.waypoints.length > 0) ||
          customer.state === 'queue';
        const atTarget = Boolean(target && Math.hypot(target.x - customer.x, target.y - customer.y) < 5);
        if (needsMotion && !atTarget) {
          moving += 1;
          if (now - (customer.lastMoveAt || 0) > 1.8) stuck += 1;
        }
      }
      const profile = this.getCrowdProfile(this.customers.length);
      const frameMs = (this.perf.updateMs || 0) + (this.perf.renderMs || 0);
      return {
        totalViewers: this.viewers.size,
        charactersRendered: rendered,
        charactersMoving: moving,
        charactersWaiting: waiting,
        charactersSeated: seated,
        charactersStuck: stuck,
        averageUpdateMs: round2(this.perf.updateMs || 0),
        averageRenderMs: round2(this.perf.renderMs || 0),
        fps: Math.round(this.perf.fps || 0),
        spatialGridCells: this.perf.gridCells || this.spatialGrid.cellCount,
        collisionChecksPerFrame: this.perf.collisionChecks || 0,
        crowdTier: profile.tier,
        simulationStride: profile.stride,
        warning:
          frameMs > 28 || (this.perf.fps > 0 && this.perf.fps < 40)
            ? 'Crowd movement is under pressure. Background updates are being throttled.'
            : ''
      };
    }

    getStats() {
      return {
        served: this.session.served,
        drinks: this.session.drinks,
        tips: round2(this.session.tips),
        queue: this.queue.length,
        tables: this.tables.reduce((sum, t) => sum + t.occupants.filter(Boolean).length, 0),
        seats: this.tables.length * 2,
        paused: this.settings.paused,
        characters: this.customers.length,
        viewerCharacters: this.viewers.size
      };
    }

    // ------------------------------------------------------------------- spawn
    findDrinkSprite(drink) {
      const id = typeof drink === 'string' ? drink : drink && drink.id;
      const found = this.sprites.drinks.find((d) => d.id === id);
      if (found) return found;
      return this.sprites.drinks.length ? pickOne(this.sprites.drinks) : null;
    }

    findCustomerSprite(gender) {
      const pool =
        gender && this.sprites.customers.some((c) => c.meta.gender === gender)
          ? this.sprites.customers.filter((c) => c.meta.gender === gender)
          : this.sprites.customers;
      return pickOne(pool);
    }

    spawn(opts = {}) {
      if (!this.ready) return null;
      // A viewer can only ever own one character.
      if (opts.viewerId) {
        const existing = this.viewers.get(opts.viewerId);
        if (existing && !existing.gone) return existing;
      }
      if (!this.sprites.customers.length || !this.sprites.drinks.length) return null;

      const record = opts.record || this.findCustomerSprite(opts.gender);
      const drink = opts.drinkRecord || this.findDrinkSprite(opts.drink);
      const fromLeft = opts.fromLeft != null ? opts.fromLeft : Math.random() < 0.5;
      const entry = fromLeft ? LAYOUT.entries.left : LAYOUT.entries.right;

      const customer = {
        id: ++this.seq,
        record,
        drink,
        name: opts.name || '',
        viewerId: opts.viewerId || null,
        uniqueId: opts.uniqueId || '',
        spriteIndex: Number.isInteger(opts.spriteIndex) ? opts.spriteIndex : null,
        orders: [],
        orderIds: new Set(),
        wave: 0,
        celebrate: 0,
        excited: 0,
        reaction: null,
        sparkleTimer: 0,
        vipLevel: Number(opts.vipLevel) || 0,
        leaving: false,
        leaveAfterServe: false,
        vip: Boolean(opts.vip),
        gift: opts.gift || null,
        gender: record.meta.gender,
        heightFactor: record.meta.height || 1,
        x: entry.x + (fromLeft ? -rand(0, 70) : rand(0, 70)),
        y: entry.y + rand(-16, 16),
        speed: rand(150, 196),
        facing: fromLeft ? 1 : -1,
        state: 'enter',
        waypoints: [{ x: fromLeft ? rand(340, 470) : rand(700, 830), y: rand(1400, 1440) }],
        bubble: null,
        cupInHand: false,
        orderTimer: 0,
        seatedTimer: 0,
        table: null,
        seat: null,
        walkPhase: Math.random() * Math.PI * 2,
        entranceAt: this.time + this.nextEntranceDelay(),
        standSlot: null,
        floorSlot: null,
        queueIndex: -1,
        simAccum: 0,
        lastMoveAt: this.time,
        stuckTime: 0,
        leaveAt: 0,
        gone: false
      };

      this.customers.push(customer);
      if (opts.priority) this.queue.unshift(customer.id);
      else this.queue.push(customer.id);
      if (customer.viewerId) this.viewers.set(customer.viewerId, customer);
      return customer;
    }

    /** Burst arrivals walk in one after another instead of popping in together. */
    nextEntranceDelay() {
      if (!this.entranceWindowAt || this.time - this.entranceWindowAt > 1.6) {
        this.entranceWindowAt = this.time;
        this.entranceBurst = 0;
      }
      this.entranceBurst += 1;
      return Math.min(2.6, this.entranceBurst * 0.11 + Math.random() * 0.08);
    }

    spawnRush(count) {
      for (let i = 0; i < count; i++) {
        this.pending.push({ at: this.time + i * 0.45, opts: { fromLeft: i % 2 === 0 } });
      }
    }

    spawnParty(ev) {
      const size = Math.round(clamp(Number(ev.groupSize) || 3, 2, 6));
      for (let i = 0; i < size; i++) {
        this.pending.push({
          at: this.time + i * 0.4,
          opts: {
            name: i === 0 ? ev.user : '',
            drink: ev.drink,
            fromLeft: i % 2 === 0,
            priority: i === 0
          }
        });
      }
    }

    /** One gift = one drink order at the counter; combo units queue up behind it. */
    spawnGiftOrders(ev) {
      const units = Math.round(clamp(Number(ev.units || ev.count) || 1, 1, 20));
      const gift = ev.gift || {
        id: ev.giftId,
        name: ev.giftName || 'Gift',
        icon: ev.giftIcon,
        coins: ev.coins
      };
      for (let i = 0; i < units; i++) {
        this.pending.push({
          at: this.time + i * 1.15,
          opts: {
            name: ev.user || 'Guest',
            drink: ev.drink,
            priority: true,
            gift
          }
        });
      }
    }

    // ------------------------------------------------------- viewer characters
    spriteForIndex(index) {
      const list = this.sprites.customers;
      if (!list.length) return null;
      if (!Number.isInteger(index)) return pickOne(list);
      return list[((index % list.length) + list.length) % list.length];
    }

    findViewerCharacter(viewerId) {
      const found = viewerId ? this.viewers.get(viewerId) : null;
      return found && !found.gone ? found : null;
    }

    /** Reuse the viewer's character; create it only the first time they appear. */
    ensureViewerCharacter(ev) {
      const viewerId = ev.viewerId;
      if (!viewerId) return null;
      // A fresh interaction from this viewer means they are back on stage.
      this.departed.delete(String(viewerId));
      const existing = this.findViewerCharacter(viewerId);
      if (existing) {
        if (existing.leaving) this.cancelViewerLeave(existing);
        if (ev.user) existing.name = ev.user;
        if (ev.uniqueId) existing.uniqueId = ev.uniqueId;
        if (Number.isInteger(ev.sprite)) existing.spriteIndex = ev.sprite;
        if (Number.isFinite(ev.vipLevel)) existing.vipLevel = Number(ev.vipLevel);
        return existing;
      }
      const record = this.spriteForIndex(Number.isInteger(ev.sprite) ? ev.sprite : null);
      if (!record) return null;
      const character = this.spawn({
        name: ev.user || 'Viewer',
        uniqueId: ev.uniqueId || '',
        viewerId,
        spriteIndex: Number.isInteger(ev.sprite) ? ev.sprite : null,
        record,
        vipLevel: Number(ev.vipLevel) || 0,
        priority: Boolean(ev.vip || ev.priority)
      });
      return character;
    }

    /** Gift senders move ahead of passive viewers in the waiting line. */
    prioritise(character) {
      if (!character) return;
      this.queue = this.queue.filter((id) => id !== character.id);
      this.queue.unshift(character.id);
    }

    enqueueViewerOrders(character, base, opts = {}) {
      if (!character) return;
      const units = Math.round(clamp(Number(opts.units) || 1, 1, 20));
      const order = base && base[0] ? base[0] : {};
      if (!order.drink && !order.giftName) return;
      let added = 0;
      for (let i = 0; i < units; i++) {
        const id = order.id
          ? i === 0
            ? String(order.id)
            : `${order.id}_${i}`
          : `local_${character.id}_${++this.orderSeq}`;
        if (character.orderIds.has(id)) continue; // combo replay never doubles an order
        character.orderIds.add(id);
        character.orders.push({
          id,
          drink: order.drink || null,
          coins: i === 0 ? Number(order.coins) || 0 : 0,
          giftName: order.giftName || ''
        });
        added += 1;
      }
      if (added && order.drink) character.drink = order.drink;
      if (added && opts.front) this.prioritise(character);
      // A big tray should never push the personal queue past the cap.
      if (character.orders.length > 20) character.orders.splice(0, character.orders.length - 20);
    }

    releaseSeat(character) {
      if (character.table && character.seat) {
        character.table.occupants[character.seat.index] = null;
      }
      character.table = null;
      character.seat = null;
    }

    forgetViewerCharacter(character) {
      const key = character.viewerId != null ? String(character.viewerId) : '';
      if (key && this.viewers.get(key) === character) this.viewers.delete(key);
      if (this.servingId === character.id) this.servingId = null;
    }

    startViewerLeave(character) {
      if (!character || character.gone) return;
      // Repeated departures for the same body are ignored instead of restarting.
      if (character.leaving && character.state === 'leave') return;
      // Left while still walking in: the body never reaches the stage.
      if (this.time < (character.entranceAt || 0)) {
        character.gone = true;
        this.queue = this.queue.filter((id) => id !== character.id);
        this.releaseSeat(character);
        this.forgetViewerCharacter(character);
        return;
      }
      if (character.state === 'order') {
        // Finish the drink already on the counter, then wave goodbye and walk out.
        character.leaving = true;
        character.leaveAfterServe = true;
        character.bubble = { text: 'Thanks! See you next live! 👋', timer: 2200 };
        return;
      }
      character.leaving = true;
      character.leaveAfterServe = false;
      this.finishViewerLeave(character);
    }

    finishViewerLeave(character) {
      if (!character || character.gone) return;
      character.leaving = true;
      character.leaveAfterServe = false;
      this.queue = this.queue.filter((id) => id !== character.id);
      this.releaseSeat(character);
      character.bubble = { text: 'Thanks! See you next live! 👋', timer: 2600 };
      character.wave = Math.max(character.wave || 0, 2.4);
      character.waypoints = [
        { x: character.x < W / 2 ? 430 : 700, y: 1730 },
        this.exitFor(character)
      ];
      character.state = 'leave';
      character.leaveAt = this.time;
      character.cupInHand = false;
      this.heartsAround(character, 2);
    }

    cancelViewerLeave(character) {
      character.leaving = false;
      character.leaveAfterServe = false;
      character.leaveAt = 0;
      character.wave = 0;
      character.bubble = { text: 'Back again!', timer: 1600 };
      // Interrupted mid-service or while seated: stay exactly where they are.
      if (character.state === 'order' || character.state === 'toSeat' || character.state === 'seated') return;
      if (character.seat) {
        character.state = 'seated';
        character.waypoints = [];
        return;
      }
      if (!this.queue.includes(character.id)) this.queue.push(character.id);
      character.state = 'queue';
      character.waypoints = [];
    }

    /** Departures arrive by viewerId, uniqueId or name; resolve the same body. */
    handleViewerLeave(ev) {
      const viewerId = ev.viewerId != null ? String(ev.viewerId) : '';
      if (viewerId) this.departed.add(viewerId);
      let character = viewerId ? this.findViewerCharacter(ev.viewerId) : null;
      if (!character) character = this.findCharacterByViewer(ev);
      if (!character) return; // no body was on stage: never spawn one to say goodbye
      if (character.viewerId != null) this.departed.add(String(character.viewerId));
      this.startViewerLeave(character);
    }

    findCharacterByViewer(ev) {
      const uniqueId = String(ev.uniqueId || '').toLowerCase();
      const name = String(ev.user || '').toLowerCase();
      for (const character of this.customers) {
        if (character.gone) continue;
        if (uniqueId && String(character.uniqueId || '').toLowerCase() === uniqueId) return character;
        if (name && String(character.name || '').toLowerCase() === name) return character;
      }
      return null;
    }

    queueSlotFor(index) {
      if (index < LAYOUT.queueSlots.length) return LAYOUT.queueSlots[index];
      const overflowIndex = index - LAYOUT.queueSlots.length;
      if (overflowIndex < LAYOUT.overflow.length) return LAYOUT.overflow[overflowIndex];
      return crowdSlot(overflowIndex - LAYOUT.overflow.length, this.crowd);
    }

    standSpotFor(customer) {
      if (!customer.standSlot) customer.standSlot = ++this.standSeq;
      return crowdSlot(this.queue.length + customer.standSlot + FRONT_SLOTS, this.crowd);
    }

    isFrontRow(customer) {
      if (customer.state === 'order' || customer.state === 'toSeat' || customer.state === 'seated') return true;
      if (customer.state !== 'queue') return false;
      const index = this.queueIndex.has(customer.id) ? this.queueIndex.get(customer.id) : this.queue.indexOf(customer.id);
      return index !== -1 && index < FRONT_SLOTS;
    }

    updateLeavers(dt) {
      let dropped = false;
      for (const customer of this.customers) {
        if (customer.gone) continue;
        if (customer.state === 'leave' || customer.state === 'toGo') {
          if (!customer.leaveAt) customer.leaveAt = this.time;
          if (this.advancePath(customer, dt) || this.time - customer.leaveAt > 12) customer.gone = true;
        }
      }
      for (const customer of this.customers) if (customer.gone) dropped = true;
      if (dropped) {
        this.customers = this.customers.filter((customer) => !customer.gone);
        for (const [viewerId, character] of this.viewers) {
          if (character.gone) this.viewers.delete(viewerId);
        }
      }
    }

    celebrate(character) {
      if (!character) return;
      character.celebrate = Math.max(character.celebrate, 2.6);
      this.effects.push({
        kind: 'burst',
        x: character.x,
        y: character.y - 300 * this.customerScale(character),
        t: 0,
        life: 1.6
      });
    }

    heartsAround(character, count = 4) {
      if (!character) return;
      const scale = this.customerScale(character);
      for (let i = 0; i < count; i++) {
        this.effects.push({
          kind: 'heart',
          x: character.x + rand(-46, 46),
          y: character.y - rand(210, 330) * scale,
          vy: rand(48, 92),
          drift: rand(-22, 22),
          size: rand(12, 22),
          t: 0,
          life: rand(1.1, 2)
        });
      }
    }

    react(character, emoji, seconds = 1.4) {
      if (!character) return;
      character.reaction = { emoji, timer: seconds };
    }

    goldSparkles(character, count = 12) {
      if (!character) return;
      const scale = this.customerScale(character);
      const diamond = (character.vipLevel || 0) >= 3;
      for (let i = 0; i < count; i++) {
        if (this.effects.length > 90) break;
        this.effects.push({
          kind: 'sparkle',
          x: character.x + rand(-54, 54),
          y: character.y - rand(110, 360) * scale,
          vy: rand(30, 72),
          drift: rand(-18, 18),
          size: rand(6, 13),
          color: diamond && i % 3 === 0 ? '#7fe0ff' : '#ffd76a',
          t: 0,
          life: rand(0.8, 1.5)
        });
      }
    }

    vipCelebrate(character) {
      if (!character) return;
      character.celebrate = Math.max(character.celebrate || 0, 2.6);
      this.goldSparkles(character, (character.vipLevel || 0) >= 3 ? 24 : 14);
      this.effects.push({
        kind: 'burst',
        x: character.x,
        y: character.y - 300 * this.customerScale(character),
        t: 0,
        life: 1.7
      });
      this.react(character, '👑', 2);
    }

    /** Big donations make the whole shop cheer and wave. */
    cheerAll(intensity = 1) {
      // A packed shop cheers with motion only; particles stay on the front rows.
      for (let i = 0; i < this.customers.length; i++) {
        const character = this.customers[i];
        character.wave = Math.max(character.wave || 0, 1.4 + intensity * 0.5);
        character.celebrate = Math.max(character.celebrate || 0, 1.2 + intensity * 0.5);
        if (character.viewerId && i < 24) this.heartsAround(character, 2);
      }
    }

    handleViewerEvent(ev) {
      // A departure removes a body, it never creates one.
      if (ev.type === 'viewerLeave') {
        this.handleViewerLeave(ev);
        return;
      }
      const character = this.ensureViewerCharacter(ev);
      if (!character) return;
      if (ev.vip) character.vip = true;
      if (Number.isFinite(ev.vipLevel) && Number(ev.vipLevel) > (character.vipLevel || 0)) {
        character.vipLevel = Number(ev.vipLevel);
        this.vipCelebrate(character);
      } else if (Number.isFinite(ev.vipLevel)) {
        character.vipLevel = Number(ev.vipLevel);
      }
      if (ev.vipUpgraded) this.vipCelebrate(character);

      if (ev.type === 'viewerJoin' || ev.type === 'viewerReconnect') {
        this.departed.delete(String(ev.viewerId));
        character.leaving = false;
        character.leaveAfterServe = false;
        character.leaveAt = 0;
        character.bubble = { text: ev.type === 'viewerReconnect' ? 'Back again!' : 'Hi everyone!', timer: 1800 };
        this.react(character, '😊', 1.6);
        return;
      }
      if (this.settings.paused) return;

      switch (ev.type) {
        case 'followGuest':
        case 'freeDrink':
          character.vip = true;
          this.celebrate(character);
          this.goldSparkles(character, 10);
          this.heartsAround(character, 6);
          this.react(character, '🥳', 1.8);
          break;
        case 'likeBurst':
          character.wave = 2.4;
          this.heartsAround(character, Math.min(10, 3 + Math.round((Number(ev.count) || 1) / 2)));
          this.react(character, '😄', 1.4);
          break;
        case 'commentOrder': {
          const text = String(ev.bubbleText || ev.message || (ev.drink ? `One ${ev.drink.name}, please!` : 'Hello!')).slice(0, 110);
          character.bubble = { text, drink: ev.drink, timer: 3200 };
          this.react(character, '💬', 1.4);
          this.enqueueViewerOrders(character, [{ id: ev.orderId, drink: ev.drink, coins: 0 }], {
            units: Number(ev.count) || 1
          });
          break;
        }
        case 'viewerComment': {
          const text = String(ev.bubbleText || ev.comment || ev.message || 'Hello!').slice(0, 110);
          character.bubble = { text, timer: 3200 };
          this.react(character, '💬', 1.4);
          break;
        }
        case 'giftOrder':
        case 'partyOrder': {
          const units = Math.max(1, Number(ev.units || ev.count || ev.groupSize) || 1);
          character.bubble = {
            text:
              ev.type === 'partyOrder'
                ? `${ev.giftName || 'Party tray'} · ${units} drinks`
                : `${ev.giftName || 'Gift'} → ${ev.drink ? ev.drink.name : 'drink'}`,
            drink: ev.drink,
            timer: 3200
          };
          this.enqueueViewerOrders(
            character,
            [{ id: ev.orderId, drink: ev.drink, coins: Number(ev.coins) || 0, giftName: ev.giftName }],
            { units, front: true }
          );
          this.celebrate(character);
          character.excited = 2;
          this.react(character, '🤩', 1.8);
          this.goldSparkles(character, 8);
          break;
        }
        case 'mysteryDrink':
        case 'serveDrink':
          character.bubble = { text: ev.message || 'One fresh drink!', drink: ev.drink, timer: 2800 };
          this.enqueueViewerOrders(character, [{ id: ev.orderId, drink: ev.drink, coins: 0 }], {
            units: Number(ev.count) || 1
          });
          break;
        default:
          break;
      }
    }

    /** Rebuild characters for viewers that joined before this page loaded. */
    syncViewers(list) {
      if (!Array.isArray(list)) return;
      this.viewerRoster = list;
      if (!this.ready) {
        this.pendingViewerSync = list;
        return;
      }
      const activeIds = new Set(
        list.filter((viewer) => viewer && viewer.id != null && !viewer.leftAt).map((viewer) => String(viewer.id))
      );
      // The server roster is authoritative: bodies whose viewer is gone walk out.
      for (const [viewerId, character] of [...this.viewers]) {
        if (!activeIds.has(String(viewerId)) && !character.leaving) {
          this.departed.add(String(viewerId));
          this.startViewerLeave(character);
        }
      }
      for (const viewer of list) {
        if (!viewer || viewer.id == null || viewer.leftAt) continue;
        this.departed.delete(String(viewer.id));
        let character = this.findViewerCharacter(viewer.id);
        if (!character) {
          character = this.ensureViewerCharacter({
            viewerId: viewer.id,
            user: viewer.name,
            uniqueId: viewer.uniqueId,
            sprite: viewer.sprite,
            vip: viewer.vip
          });
        }
        if (!character) continue;
        character.vip = Boolean(character.vip || viewer.vip);
        character.vipLevel = Math.max(character.vipLevel || 0, Number(viewer.vipLevel) || 0);
        for (const order of viewer.orders || []) {
          this.enqueueViewerOrders(
            character,
            [
              {
                id: order.id,
                drink: this.findDrinkSprite(order.drinkId),
                coins: Number(order.coins) || 0,
                giftName: order.giftName || ''
              }
            ],
            { units: 1 }
          );
        }
        // Viewers with paid orders waiting are served before passive guests.
        if (character.orders.length) this.prioritise(character);
      }
    }

    /** Map a server event (TikTok interaction) onto the simulation. */
    handleEvent(ev) {
      if (!ev) return;
      // Art is still decoding: replay the interaction once sprites exist.
      if (!this.ready) {
        this.pendingEvents.push(ev);
        // Keep a whole big-audience burst; the roster sync covers anything older.
        if (this.pendingEvents.length > 600) this.pendingEvents.shift();
        return;
      }
      if (ev.viewerId) {
        this.handleViewerEvent(ev);
        return;
      }
      if (this.settings.paused) return;
      switch (ev.type) {
        case 'serveDrink':
        case 'commentOrder':
        case 'mysteryDrink':
          this.spawn({ name: ev.user, drink: ev.drink });
          break;
        case 'followGuest':
        case 'freeDrink':
          this.spawn({ name: ev.user, drink: ev.drink, vip: true, priority: true });
          break;
        case 'likeBurst':
          this.spawnRush(2 + Math.min(3, Math.floor((Number(ev.count) || 1) / 5)));
          break;
        case 'partyOrder':
          this.spawnParty(ev);
          break;
        case 'giftOrder':
          this.spawnGiftOrders(ev);
          break;
        case 'newGuest':
          this.spawn({ name: ev.user, drink: ev.drink });
          break;
        default:
          break;
      }
    }

    // ------------------------------------------------------------------ update
    spawnInterval() {
      const rate = clamp(this.settings.spawnRate || 1, 0.25, 3);
      return clamp(6200 / rate, 1400, 20000) * rand(0.75, 1.25);
    }

    findSeat() {
      for (const table of this.tables) {
        for (let i = 0; i < table.occupants.length; i++) {
          if (!table.occupants[i]) {
            return { table, index: i, x: table.seats[i].x, y: table.seats[i].y };
          }
        }
      }
      return null;
    }

    exitFor(customer) {
      return customer.x < W / 2
        ? { x: -170, y: 1760 }
        : { x: W + 170, y: 1740 };
    }

    moveToward(customer, target, step) {
      const dx = target.x - customer.x;
      const dy = target.y - customer.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.6) return true;
      if (dist <= step) {
        customer.x = target.x;
        customer.y = target.y;
        customer.lastMoveAt = this.time;
        return true;
      }
      let vx = dx / dist;
      let vy = dy / dist;
      // Only look at the spatial cells in front of this body. Stationary
      // queue/table bodies are soft obstacles, never hard blockers: a walker
      // can steer around a knot without deadlocking in a packed shop.
      if (this.spatialGrid && this.spatialGrid.cellCount) {
        const scale = this.customerScale(customer);
        const avoidRadius = Math.max(42, 58 * scale);
        let pushX = 0;
        let pushY = 0;
        let found = false;
        this.spatialGrid.query(
          customer.x + vx * Math.min(step * 1.5, 36),
          customer.y + vy * Math.min(step * 1.5, 36),
          avoidRadius,
          (other) => {
            if (other === customer || this.isWalking(other)) return;
            const ox = customer.x - other.x;
            const oy = (customer.y - other.y) * 1.35;
            const distance = Math.hypot(ox, oy);
            if (distance < 0.001 || distance >= avoidRadius) return;
            const weight = (avoidRadius - distance) / avoidRadius;
            pushX += (ox / distance) * weight;
            pushY += (oy / distance) * weight;
            found = true;
          }
        );
        if (found) {
          vx += pushX * 1.15;
          vy += pushY * 1.15;
          const length = Math.hypot(vx, vy);
          if (length > 0.001) {
            vx /= length;
            vy /= length;
          }
        }
      }
      customer.x += vx * step;
      customer.y += vy * step;
      customer.lastMoveAt = this.time;
      customer.stuckTime = 0;
      if (Math.abs(dx) > 2) customer.facing = dx > 0 ? 1 : -1;
      return false;
    }

    advancePath(customer, dt) {
      const wp = customer.waypoints[0];
      if (!wp) return true;
      // Departing characters hurry out so no body lingers at the shop edge.
      const step = customer.speed * (customer.state === 'leave' ? 1.5 : 1) * dt;
      const arrived = this.moveToward(customer, wp, step);
      if (arrived) {
        customer.waypoints.shift();
        return customer.waypoints.length === 0;
      }
      return false;
    }

    beginOrder(customer) {
      customer.state = 'order';
      customer.orderTimer = rand(900, 1250);
      this.servingId = customer.id;
      const order = customer.orders && customer.orders[0];
      if (order && order.drink) customer.drink = order.drink;
      const drink = customer.drink;
      const coins = order ? Number(order.coins) || 0 : 0;
      customer.bubble = {
        text: coins > 0
          ? `${order.giftName || 'Gift'} · ${drink.name} · ${coins} coins`
          : customer.gift
            ? `${customer.gift.name} gift · one ${drink.name}!`
            : customer.vip
              ? 'New follower treat!'
              : `One ${drink.name}, please!`,
        drink,
        timer: 2200
      };
    }

    completeOrder(customer) {
      this.queue = this.queue.filter((id) => id !== customer.id);
      this.servingId = null;
      this.serveFlash = 1;
      customer.cupInHand = true;

      const servedOrder = customer.orders && customer.orders.length ? customer.orders.shift() : null;
      if (servedOrder && servedOrder.drink) customer.drink = servedOrder.drink;

      const price = DRINK_PRICES[customer.drink.id] != null ? DRINK_PRICES[customer.drink.id] : 4;
      const bonus = customer.vip ? 6 : 1;
      const totalTip = round2(price + bonus);
      this.session.served += 1;
      this.session.drinks += 1;
      this.session.tips = round2(this.session.tips + totalTip);

      this.tipPops.push({
        text: `+$${totalTip.toFixed(2)}`,
        x: customer.x,
        y: customer.y - 250 * this.customerScale(customer),
        life: 1
      });

      if (servedOrder && servedOrder.coins > 0) {
        this.tipPops.push({
          text: `+${servedOrder.coins} 💰`,
          x: customer.x + 46,
          y: customer.y - 268 * this.customerScale(customer),
          life: 1
        });
      }

      if (this.onSale) {
        this.onSale({
          tip: totalTip,
          drink: customer.drink ? customer.drink.name : '',
          name: customer.name || 'Walk-in guest'
        });
      }

      if (servedOrder && customer.viewerId && this.onOrderServed) {
        this.onOrderServed({
          viewerId: customer.viewerId,
          uniqueId: customer.uniqueId,
          name: customer.name,
          orderId: servedOrder.id,
          coins: servedOrder.coins
        });
      }

      if (customer.viewerId) {
        customer.bubble = { text: `Thank you, ${customer.name}! 😊`, timer: 2000 };
        customer.wave = Math.max(customer.wave || 0, 1.2);
        this.react(customer, '😊', 1.5);
      }

      // Viewer left mid-service: finish this drink, then wave goodbye.
      if (customer.leaveAfterServe) {
        customer.cupInHand = false;
        this.finishViewerLeave(customer);
        return;
      }

      // More drinks in this viewer's personal queue → stay at the counter.
      if (customer.orders.length) {
        customer.cupInHand = false;
        this.queue.unshift(customer.id);
        customer.state = 'queue';
        customer.bubble = { text: `${customer.orders.length} more coming up!`, timer: 1600 };
        return;
      }

      const seat = this.findSeat();
      if (seat) {
        customer.table = seat.table;
        customer.seat = seat;
        seat.table.occupants[seat.index] = customer.id;
        customer.waypoints = [
          { x: seat.x + (seat.index === 0 ? -30 : 30), y: seat.y - 96 },
          { x: seat.x, y: seat.y }
        ];
        customer.state = 'toSeat';
        customer.bubble = { text: 'Thanks!', timer: 1200 };
      } else if (customer.viewerId) {
        // Audience too big for a table? Enjoy the drink standing in the shop.
        customer.waypoints = [this.standSpotFor(customer)];
        customer.state = 'linger';
        customer.seatedTimer = rand(6000, 11000);
        customer.bubble = { text: 'Thanks!', timer: 1400 };
      } else {
        customer.waypoints = [
          { x: customer.x < W / 2 ? 420 : 700, y: 1720 },
          this.exitFor(customer)
        ];
        customer.state = 'toGo';
        customer.bubble = { text: 'To go, thanks!', timer: 1500 };
      }
    }

    finishDrink(customer) {
      // A viewer's character stays in the shop until they actually leave.
      if (customer.viewerId) {
        customer.seatedTimer = rand(6000, 9000);
        customer.bubble = { text: 'That hit the spot!', timer: 1400 };
        return;
      }
      if (customer.table && typeof customer.seat.index === 'number') {
        customer.table.occupants[customer.seat.index] = null;
      }
      customer.table = null;
      customer.seat = null;
      customer.cupInHand = false;
      customer.bubble = { text: 'That hit the spot!', timer: 1400 };
      customer.waypoints = [
        { x: customer.x + (customer.x < W / 2 ? -70 : 70), y: customer.y + 40 },
        { x: customer.x < W / 2 ? 460 : 720, y: 1725 },
        this.exitFor(customer)
      ];
      customer.state = 'leave';
    }

    update(dt) {
      if (this.settings.paused) {
        // Pausing must not freeze a goodbye: leavers still walk out and vanish.
        this.updateLeavers(dt);
        return;
      }

      this.serveFlash = Math.max(0, this.serveFlash - dt * 1.6);

      for (let i = this.effects.length - 1; i >= 0; i--) {
        const fx = this.effects[i];
        fx.t += dt;
        if (fx.kind === 'heart' || fx.kind === 'sparkle') {
          fx.y -= fx.vy * dt;
          fx.x += fx.drift * dt;
        }
        if (fx.t >= fx.life) this.effects.splice(i, 1);
      }

      // delayed spawns (rush / party trays)
      if (this.pending.length) {
        const due = this.pending.filter((p) => p.at <= this.time);
        this.pending = this.pending.filter((p) => p.at > this.time);
        due.forEach((p) => this.spawn(p.opts));
      }

      // Walk-in extras only fill an empty shop; viewers own the floor otherwise.
      if (this.settings.running && this.viewers.size === 0) {
        this.spawnTimer -= dt * 1000;
        if (this.spawnTimer <= 0) {
          this.spawn();
          this.spawnTimer = this.spawnInterval();
        }
      }

      this.simFrame += 1;
      this.refreshQueueIndex();
      const crowdProfile = this.getCrowdProfile(this.customers.length);
      this.crowdProfile = crowdProfile;
      this.buildSpatialGrid(this.spatialGrid, false);
      this.perf.collisionChecks = 0;

      for (const customer of this.customers) {
        // Staggered entrance: the body exists but is not on stage yet.
        if (customer.entranceAt && this.time < customer.entranceAt) continue;
        if (customer.bubble) {
          customer.bubble.timer -= dt * 1000;
          if (customer.bubble.timer <= 0) customer.bubble = null;
        }
        customer.walkPhase += dt * 8;
        if (customer.wave > 0) customer.wave = Math.max(0, customer.wave - dt);
        if (customer.celebrate > 0) customer.celebrate = Math.max(0, customer.celebrate - dt);
        if (customer.excited > 0) customer.excited = Math.max(0, customer.excited - dt);
        if (customer.reaction && customer.reaction.timer > 0) {
          customer.reaction.timer = Math.max(0, customer.reaction.timer - dt);
          if (customer.reaction.timer === 0) customer.reaction = null;
        }
        const vipLevelNow = customer.vipLevel || 0;
        if (vipLevelNow > 0) {
          customer.sparkleTimer = (customer.sparkleTimer || 0) + dt;
          // Packed shops sparkle less often so particles cannot flood the frame.
          const crowded = this.customers.length > 40 ? 3 : 1;
          const sparkleGap = (vipLevelNow >= 3 ? 0.34 : vipLevelNow === 2 ? 0.6 : 1.2) * crowded;
          if (customer.sparkleTimer >= sparkleGap && this.effects.length < 90) {
            customer.sparkleTimer = 0;
            this.goldSparkles(customer, 1);
          }
        }

        // Important bodies always receive a full step. Background bodies keep
        // their accumulated delta and run at a lower frequency in large crowds.
        const priority = this.isCrowdPriority(customer);
        const stride = priority ? 1 : crowdProfile.stride;
        const due = stride === 1 || (this.simFrame + customer.id) % stride === 0;
        if (!due) {
          customer.simAccum = Math.min(0.2, (customer.simAccum || 0) + dt);
          continue;
        }
        const simDt = Math.min(0.2, (customer.simAccum || 0) + dt);
        customer.simAccum = 0;

        switch (customer.state) {
          case 'enter': {
            if (this.advancePath(customer, simDt)) customer.state = 'queue';
            break;
          }
          case 'queue': {
            const index = this.queue.indexOf(customer.id);
            if (index === -1) {
              customer.waypoints = [this.exitFor(customer)];
              customer.state = 'leave';
              break;
            }
            // Every waiting viewer gets a real standing spot, in expanding rows.
            const slot = this.queueSlotFor(index);
            const arrived = this.moveToward(customer, slot, customer.speed * simDt);
            if (index === 0 && arrived && !this.servingId) this.beginOrder(customer);
            break;
          }
          case 'order': {
            customer.orderTimer -= simDt * 1000;
            if (customer.orderTimer <= 0) this.completeOrder(customer);
            break;
          }
          case 'toSeat': {
            if (this.advancePath(customer, simDt)) {
              customer.state = 'seated';
              customer.seatedTimer = rand(5200, 9000);
              customer.bubble = { text: 'Ahh, perfect!', timer: 1400 };
            }
            break;
          }
          case 'seated': {
            customer.seatedTimer -= simDt * 1000;
            if (customer.seatedTimer <= 0) this.finishDrink(customer);
            break;
          }
          case 'linger': {
            if (customer.waypoints.length) {
              this.advancePath(customer, simDt);
              break;
            }
            customer.seatedTimer -= simDt * 1000;
            if (customer.seatedTimer <= 0) {
              customer.seatedTimer = rand(6000, 11000);
              if (Math.random() < 0.25) customer.wave = Math.max(customer.wave || 0, 1);
            }
            break;
          }
          case 'toGo':
          case 'leave': {
            if (!customer.leaveAt) customer.leaveAt = this.time;
            if (this.advancePath(customer, simDt) || this.time - customer.leaveAt > 12) customer.gone = true;
            break;
          }
          default:
            break;
        }
      }

      this.separateWalkers();
      this.customers = this.customers.filter((c) => !c.gone);

      // Every active viewer must own exactly one body; retry any that are missing.
      this.viewerSyncTimer += dt;
      if (this.viewerRoster && this.viewerSyncTimer > 2) {
        this.viewerSyncTimer = 0;
        const waiting = this.viewerRoster.filter((viewer) => viewer && !viewer.leftAt);
        if (this.viewers.size < waiting.length) this.syncViewers(this.viewerRoster);
      }
      for (const [viewerId, character] of this.viewers) {
        if (character.gone) this.viewers.delete(viewerId);
      }
      this.crowd = crowdMetrics(this.customers.length);
      this.crowdProfile = this.getCrowdProfile(this.customers.length);
      this.refreshQueueIndex();
    }

    separateWalkers() {
      const walkers = this.customers.filter((c) => this.isWalking(c));
      if (!walkers.length) return;
      this.buildSpatialGrid(this.separationGrid, true);
      for (const a of walkers) {
        const aScale = this.customerScale(a);
        const queryRadius = Math.max(48, 78 * aScale);
        this.separationGrid.query(a.x, a.y, queryRadius, (b) => {
          if (b === a || !this.isWalking(b) || b.id <= a.id) return;
          const minDist = 66 * Math.max(aScale, this.customerScale(b));
          const dx = b.x - a.x;
          const dy = (b.y - a.y) * 1.6;
          const dist = Math.hypot(dx, dy);
          if (dist >= minDist || dist < 0.001) return;
          const push = ((minDist - dist) / dist) * 0.28;
          a.x -= dx * push;
          a.y -= (dy * push) / 1.6;
          b.x += dx * push;
          b.y += (dy * push) / 1.6;
        });
      }
      this.perf.collisionChecks = this.spatialGrid.collisionChecks + this.separationGrid.collisionChecks;
      this.perf.gridCells = this.spatialGrid.cellCount;
    }

    customerScale(customer) {
      const crowd = this.isFrontRow(customer) ? 1 : this.crowd.scale;
      return depthScale(customer.y) * (customer.heightFactor || 1) * crowd;
    }

    // ------------------------------------------------------------------ render
    loop(ts) {
      this.raf = requestAnimationFrame(this.loop);
      if (document.hidden) return;
      const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0.016;
      this.lastTs = ts;
      this.time += dt;
      const updateStarted = performance.now();
      this.update(dt);
      const updateMs = performance.now() - updateStarted;
      this.perf.updateMs = this.perf.updateMs ? this.perf.updateMs * 0.88 + updateMs * 0.12 : updateMs;
      const renderStarted = performance.now();
      this.render();
      const renderMs = performance.now() - renderStarted;
      this.perf.renderMs = this.perf.renderMs ? this.perf.renderMs * 0.88 + renderMs * 0.12 : renderMs;
      this.perf.frameCount += 1;
      this.perf.fpsFrames += 1;
      if (!this.perf.fpsAt) this.perf.fpsAt = ts;
      if (ts - this.perf.fpsAt >= 500) {
        this.perf.fps = (this.perf.fpsFrames * 1000) / (ts - this.perf.fpsAt);
        this.perf.fpsAt = ts;
        this.perf.fpsFrames = 0;
      }
    }

    render() {
      if (!this.ready) return;
      const ctx = this.ctx;
      // The backing store can be denser than 1080 x 1920 on high-DPI displays.
      // Keep every scene coordinate in the original 1080 x 1920 space.
      const renderScale = this.canvas.width / W;
      if (Number.isFinite(renderScale) && renderScale > 0) {
        ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      }
      ctx.clearRect(0, 0, W, H);

      this.drawGround(ctx);
      this.drawUmbrellas(ctx);
      this.drawSellers(ctx);
      this.drawCounter(ctx);

      const drawables = this.drawables;
      drawables.length = 0;
      for (const table of this.tables) {
        const item = table._drawItem || (table._drawItem = { table: null, customer: null, y: 0 });
        item.table = table;
        item.customer = null;
        item.y = table.y;
        drawables.push(item);
      }
      for (const customer of this.customers) {
        if (customer.entranceAt && this.time < customer.entranceAt) continue;
        const seated = customer.state === 'seated' && customer.table;
        const item = customer._drawItem || (customer._drawItem = { table: null, customer: null, y: 0 });
        item.table = null;
        item.customer = customer;
        item.y = seated ? customer.table.y - 2 : customer.y;
        drawables.push(item);
      }
      drawables.sort((a, b) => a.y - b.y);
      for (const item of drawables) {
        if (item.customer) this.drawCustomer(ctx, item.customer);
        else if (item.table) this.drawTable(ctx, item.table);
      }

      this.drawEffects(ctx);
      this.drawTipPops(ctx);
    }

    drawEffects(ctx) {
      for (const fx of this.effects) {
        const alpha = clamp(1 - fx.t / fx.life, 0, 1);
        if (fx.kind === 'heart') {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(fx.x, fx.y);
          const s = fx.size;
          ctx.beginPath();
          ctx.moveTo(0, s * 0.35);
          ctx.bezierCurveTo(-s, -s * 0.4, -s * 0.5, -s, 0, -s * 0.45);
          ctx.bezierCurveTo(s * 0.5, -s, s, -s * 0.4, 0, s * 0.35);
          ctx.fillStyle = '#ef5a4b';
          ctx.fill();
          ctx.strokeStyle = COLORS.ink;
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        } else if (fx.kind === 'sparkle') {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.t * 3);
          ctx.fillStyle = fx.color || '#ffd76a';
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const angle = (Math.PI / 2) * i;
            ctx.lineTo(Math.cos(angle) * fx.size, Math.sin(angle) * fx.size);
            ctx.lineTo(Math.cos(angle + Math.PI / 4) * fx.size * 0.35, Math.sin(angle + Math.PI / 4) * fx.size * 0.35);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (fx.kind === 'burst') {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(fx.x, fx.y);
          const radius = 26 + fx.t * 90;
          ctx.strokeStyle = COLORS.sun;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.stroke();
          for (let i = 0; i < 8; i++) {
            const a = (Math.PI / 4) * i + fx.t * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * radius, Math.sin(a) * radius, 6, 0, Math.PI * 2);
            ctx.fillStyle = i % 2 === 0 ? COLORS.coral : COLORS.sun;
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }

    drawGround(ctx) {
      ctx.save();
      ctx.translate(646, 1222);
      ctx.rotate(-0.03);
      ctx.font = '800 26px "Nunito", sans-serif';
      ctx.textAlign = 'center';
      const label = 'ORDER HERE';
      const w = ctx.measureText(label).width + 34;
      ctx.fillStyle = 'rgba(255, 247, 228, 0.78)';
      roundedRect(ctx, -w / 2, -24, w, 46, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(59, 42, 32, 0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(59, 42, 32, 0.72)';
      ctx.fillText(label, 0, 10);
      ctx.restore();
    }

    drawUmbrellas(ctx) {
      for (const table of this.tables) {
        if (!table.umbrella) continue;
        const x = table.x;
        const canopyY = table.y - 344;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, table.y - 56);
        ctx.lineTo(x, canopyY);
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 13;
        ctx.stroke();
        ctx.strokeStyle = '#cfc7b6';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.restore();

        const rx = 122;
        const ry = 58;
        const apexY = canopyY - ry * 0.92;
        const segments = 6;
        for (let i = 0; i < segments; i++) {
          const a0 = Math.PI + (Math.PI / segments) * i;
          const a1 = a0 + Math.PI / segments;
          ctx.beginPath();
          ctx.moveTo(x, apexY);
          ctx.ellipse(x, canopyY, rx, ry, 0, a0, a1);
          ctx.closePath();
          ctx.fillStyle = i % 2 === 0 ? COLORS.coral : COLORS.cream;
          ctx.fill();
          ctx.strokeStyle = COLORS.ink;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x, apexY - 6);
        ctx.lineTo(x, apexY - 26);
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 6;
        ctx.stroke();
        ellipse(ctx, x, apexY - 30, 7, 7, COLORS.sun, COLORS.ink, 3);
      }
    }

    drawSellers(ctx) {
      const bounce = Math.sin(this.time * 1.9) * 3;
      const serve = Math.sin(this.serveFlash * Math.PI) * 6;
      LAYOUT.sellers.forEach((slot, index) => {
        const sprite = this.sprites.sellers[slot.key];
        if (!sprite) return;
        const height = 336;
        const width = height * (sprite.w / sprite.h);
        const bob = index === 0 ? bounce : -bounce;
        ctx.save();
        ctx.translate(slot.x + (index === 0 ? 0 : 2), slot.y + bob - serve);
        ctx.drawImage(sprite.canvas, -width / 2, -height, width, height);
        ctx.restore();
      });
    }

    drawCounter(ctx) {
      const { x, y, w, h } = LAYOUT.counter;
      const frontY = y + 26;
      const frontH = h - 26;

      // front panel
      ctx.save();
      roundedRect(ctx, x, frontY, w, frontH, 10);
      const grad = ctx.createLinearGradient(0, frontY, 0, frontY + frontH);
      grad.addColorStop(0, COLORS.woodLight);
      grad.addColorStop(1, '#c07c3f');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 5;
      ctx.stroke();

      // candy stripes
      ctx.save();
      roundedRect(ctx, x, frontY, w, frontH, 10);
      ctx.clip();
      const stripeW = 74;
      for (let i = 0; i * stripeW < w; i++) {
        if (i % 2 !== 0) continue;
        ctx.fillStyle = 'rgba(239, 90, 75, 0.55)';
        ctx.fillRect(x + i * stripeW, frontY, stripeW, frontH);
      }
      ctx.restore();

      // counter sign plaque
      ctx.font = '800 26px "Baloo 2", "Nunito", sans-serif';
      ctx.textAlign = 'center';
      const plaqueLabel = 'FRESH SQUEEZED DAILY';
      const plaqueW = ctx.measureText(plaqueLabel).width + 38;
      roundedRect(ctx, x + w / 2 - plaqueW / 2, frontY + frontH / 2 - 22, plaqueW, 44, 12);
      ctx.fillStyle = COLORS.cream;
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = COLORS.coralDark;
      ctx.fillText(plaqueLabel, x + w / 2, frontY + frontH / 2 + 9);

      // top slab
      roundedRect(ctx, x - 16, y - 14, w + 32, 44, 16);
      ctx.fillStyle = '#ffe3b0';
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 5;
      ctx.stroke();

      // drink display cups on the counter
      const cups = this.sprites.drinks;
      if (cups.length) {
        const display = [
          { record: cups[0], x: x + 86 },
          { record: cups[Math.min(1, cups.length - 1)], x: x + 156 },
          { record: cups[Math.min(2, cups.length - 1)], x: x + w - 96 }
        ];
        for (const cup of display) {
          const s = cup.record.sprite;
          const height = 62;
          const width = height * (s.w / s.h);
          ctx.drawImage(s.canvas, cup.x - width / 2, y - 12 - height, width, height);
        }
      }
      ctx.restore();
    }

    drawTable(ctx, table) {
      const { x, y } = table;
      ctx.save();

      ellipse(ctx, x, y + 46, 104, 24, 'rgba(43, 32, 26, 0.16)');

      // stools (behind the table body)
      [0, 1].forEach((i) => {
        const seatX = table.seats[i].x;
        if (!table.occupants[i]) {
          ellipse(ctx, seatX, y + 38, 32, 12, '#e7d7b7', COLORS.ink, 3);
          ctx.beginPath();
          ctx.moveTo(seatX - 18, y + 42);
          ctx.lineTo(seatX - 24, y + 58);
          ctx.moveTo(seatX + 18, y + 42);
          ctx.lineTo(seatX + 24, y + 58);
          ctx.strokeStyle = COLORS.ink;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      });

      // base + pole
      ellipse(ctx, x, y + 34, 54, 16, '#b9b5c4', COLORS.ink, 3);
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 34);
      ctx.lineTo(x - 7, y + 34);
      ctx.moveTo(x + 7, y - 34);
      ctx.lineTo(x + 7, y + 34);
      ctx.strokeStyle = '#e4e1ec';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 2;
      ctx.stroke();

      // table top with a red picnic-cloth pattern
      ellipse(ctx, x, y - 40, 94, 28, '#b98b52', COLORS.ink, 4);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y - 52, 94, 28, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#fff4dd';
      ctx.fillRect(x - 98, y - 86, 196, 68);
      ctx.strokeStyle = 'rgba(216, 60, 45, 0.8)';
      ctx.lineWidth = 18;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 98 + i * 34, y - 86);
        ctx.lineTo(x - 62 + i * 34, y - 18);
        ctx.stroke();
      }
      ctx.restore();
      ellipse(ctx, x, y - 52, 94, 28, null, COLORS.ink, 5);

      // cup on the table when someone is seated
      const occupied = table.occupants.filter(Boolean).length;
      if (occupied > 0 && this.sprites.drinks.length) {
        const customer = this.customers.find((c) => c.table === table);
        const drink = customer && customer.drink;
        const fallback = drink && drink.id
          ? this.sprites.drinks.find((entry) => entry.id === drink.id)
          : this.sprites.drinks[0];
        const sprite =
          (drink && drink.sprite && drink.sprite.w && drink.sprite.h && drink.sprite.canvas && drink.sprite) ||
          (fallback && fallback.sprite) ||
          (this.sprites.drinks[0] && this.sprites.drinks[0].sprite);
        if (sprite && sprite.w && sprite.h && sprite.canvas) {
          const height = 46;
          const width = height * (sprite.w / sprite.h);
          ctx.drawImage(sprite.canvas, x + 26 - width / 2, y - 58 - height, width, height);
        }
      }

      ctx.restore();
    }

    drawCustomer(ctx, customer) {
      const sprite = customer.record.sprite;
      const scale = this.customerScale(customer);
      const height = 336 * scale;
      const width = height * (sprite.w / sprite.h);
      const walking =
        customer.state === 'enter' ||
        customer.state === 'toSeat' ||
        customer.state === 'leave' ||
        customer.state === 'toGo';
      const walkBob = walking ? Math.abs(Math.sin(customer.walkPhase)) * 7 : 0;
      const idleBob = customer.state === 'queue' || customer.state === 'order' ? Math.sin(this.time * 2 + customer.id) * 2 : 0;
      const excitedHop = customer.excited > 0 ? Math.abs(Math.sin(this.time * 18)) * 10 : 0;
      const feetY = customer.y - walkBob + idleBob - excitedHop;
      const seated = customer.state === 'seated';

      // shadow
      ellipse(ctx, customer.x, customer.y + 4, 46 * scale, 13 * scale, 'rgba(43, 32, 26, 0.2)');

      ctx.save();
      ctx.translate(customer.x, feetY);
      if (walking) {
        ctx.rotate(Math.sin(customer.walkPhase) * 0.018);
      } else if (customer.wave > 0) {
        // Waving = a happy little rock instead of a walk cycle.
        ctx.rotate(Math.sin(this.time * 16) * 0.055);
      }
      ctx.scale(customer.facing < 0 ? -1 : 1, seated ? 0.95 : 1);
      ctx.drawImage(sprite.canvas, -width / 2, -height, width, height);
      ctx.restore();

      if (customer.cupInHand && customer.drink && this.sprites.drinks.length) {
        // A drink restored from server state may arrive without a loaded sprite,
        // so fall back to the sprite for its id instead of crashing the render loop.
        const fallback = this.sprites.drinks.find((d) => d.meta && d.meta.id === customer.drink.id);
        const s =
          customer.drink.sprite && customer.drink.sprite.w && customer.drink.sprite.h
            ? customer.drink.sprite
            : fallback && fallback.sprite;
        if (s && s.w && s.h && s.canvas) {
          const cupH = 50 * scale;
          const cupW = cupH * (s.w / s.h);
          const cupX = customer.x + customer.facing * 30 * scale;
          const cupY = feetY - 132 * scale;
          ctx.drawImage(s.canvas, cupX - cupW / 2, cupY - cupH / 2, cupW, cupH);
        }
      }

      const vipLevel = customer.vipLevel || 0;
      if (vipLevel === 1) this.drawVipBadge(ctx, customer.x, feetY - height + 30 * scale, scale);
      if (vipLevel >= 2) this.drawCrown(ctx, customer.x, feetY - height - 10, scale, vipLevel >= 3 ? 'diamond' : 'gold');
      if (customer.reaction) {
        ctx.save();
        ctx.globalAlpha = clamp(customer.reaction.timer / 0.4, 0, 1);
        ctx.font = `${Math.round(32 * clamp(scale, 0.8, 1.1))}px "Nunito", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(customer.reaction.emoji, customer.x - 38 * scale, feetY - height - 34 * scale);
        ctx.restore();
      }
      if (customer.wave > 0) {
        ctx.save();
        ctx.font = `${Math.round(34 * clamp(scale, 0.8, 1.1))}px "Nunito", sans-serif`;
        ctx.textAlign = 'center';
        ctx.globalAlpha = clamp(customer.wave, 0, 1);
        ctx.fillText('👋', customer.x + 34 * scale, feetY - height - 58 * scale);
        ctx.restore();
      }
      // Deep rows keep their sprite but drop the tag; names stay readable up front.
      const showName =
        customer.name &&
        (this.isFrontRow(customer) || vipLevel > 0 || clamp(scale, 0, 1.2) >= 0.6);
      if (showName) {
        this.drawNameTag(ctx, customer, feetY - height - (vipLevel >= 2 ? 38 : customer.vip ? 34 : 12), scale);
      }
      if (customer.bubble) {
        const bubbleLift = showName ? 86 : 8;
        this.drawBubble(ctx, customer.x, feetY - height - bubbleLift, customer.bubble, scale);
      }
    }

    drawCrown(ctx, x, y, scale, style = 'gold') {
      const diamond = style === 'diamond';
      const w = 34 * scale;
      const h = 22 * scale;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y);
      ctx.lineTo(x - w / 2, y - h);
      ctx.lineTo(x - w / 6, y - h * 0.45);
      ctx.lineTo(x, y - h * 1.05);
      ctx.lineTo(x + w / 6, y - h * 0.45);
      ctx.lineTo(x + w / 2, y - h);
      ctx.lineTo(x + w / 2, y);
      ctx.closePath();
      ctx.fillStyle = diamond ? '#a9ecff' : COLORS.sun;
      ctx.fill();
      ctx.strokeStyle = diamond ? '#2b6f9c' : COLORS.ink;
      ctx.lineWidth = 3;
      ctx.stroke();
      if (diamond) {
        ctx.beginPath();
        ctx.arc(x, y - h * 0.55, 4.2 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();
    }

    drawVipBadge(ctx, x, y, scale) {
      const r = 23 * scale;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 32 * scale, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd76a';
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.font = `800 ${Math.round(26 * clamp(scale, 0.85, 1.1))}px "Nunito", sans-serif`;
      ctx.fillStyle = '#6b4512';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VIP', x + 32 * scale, y + 0.5);
      ctx.restore();
    }

    drawNameTag(ctx, customer, y, scale) {
      ctx.save();
      ctx.font = `800 ${Math.round(28 * clamp(scale, 0.72, 1.06))}px "Nunito", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pending = customer.orders ? customer.orders.length : 0;
      const label = pending > 1
        ? `${customer.name} · ${pending} orders`
        : customer.gift
          ? `${customer.name} · ${customer.gift.name}`
          : customer.name;
      const maxWidth = customer.vipLevel ? 330 : 300;
      const lines = wrapCanvasText(ctx, label, maxWidth, 2);
      const lineHeight = 32;
      const tagH = lines.length * lineHeight + 14;
      const textW = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const tagW = Math.max(96, Math.min(360, textW + 34));
      const tagX = clamp(customer.x - tagW / 2, 10, W - tagW - 10);
      roundedRect(ctx, tagX, y - tagH, tagW, tagH, 14);
      const level = customer.vipLevel || 0;
      if (level >= 3) {
        ctx.shadowColor = '#69d2ff';
        ctx.shadowBlur = 18;
      } else if (level === 2) {
        ctx.shadowColor = '#ffcf4d';
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle =
        level >= 2
          ? 'rgba(255, 226, 138, 0.98)'
          : customer.vip
            ? 'rgba(255, 223, 130, 0.97)'
            : 'rgba(255, 251, 240, 0.95)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = level >= 3 ? '#2b6f9c' : COLORS.ink;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      const firstLineY = y - tagH + 7 + lineHeight / 2;
      lines.forEach((line, index) => {
        ctx.fillText(line, tagX + tagW / 2, firstLineY + index * lineHeight);
      });
      ctx.restore();
    }

    drawBubble(ctx, x, y, bubble, scale) {
      if (!bubble) return;
      const alpha = clamp(bubble.timer / 350, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '800 32px "Nunito", sans-serif';
      const hasDrink = Boolean(bubble.drink && bubble.drink.sprite);
      const iconW = hasDrink ? 54 : 0;
      const lines = wrapCanvasText(ctx, String(bubble.text || '').slice(0, 180), 440, 3);
      const textW = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const boxW = Math.min(500, Math.max(160, textW + iconW + 44));
      const lineHeight = 40;
      const boxH = Math.max(72, lines.length * lineHeight + 28);
      const boxX = clamp(x - boxW / 2, 12, W - boxW - 12);
      const boxY = Math.max(10, y - boxH);

      // tail first so the body covers its top edge
      ctx.beginPath();
      const tailX = clamp(x, boxX + 26, boxX + boxW - 26);
      ctx.moveTo(tailX - 10, boxY + boxH - 3);
      ctx.lineTo(tailX + 10, boxY + boxH - 3);
      ctx.lineTo(tailX, boxY + boxH + 16);
      ctx.closePath();
      ctx.fillStyle = '#fffdf6';
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      roundedRect(ctx, boxX, boxY, boxW, boxH, 16);
      ctx.fillStyle = '#fffdf6';
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      if (hasDrink) {
        const s = bubble.drink.sprite;
        const cupH = 50;
        const cupW = cupH * (s.w / s.h);
        ctx.drawImage(s.canvas, boxX + 18, boxY + boxH / 2 - cupH / 2, cupW, cupH);
      }

      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const firstLineY = boxY + (boxH - lines.length * lineHeight) / 2 + lineHeight / 2 + 1;
      lines.forEach((line, index) => {
        ctx.fillText(line, boxX + 18 + iconW, firstLineY + index * lineHeight);
      });
      ctx.restore();
    }

    drawTipPops(ctx) {
      for (let i = this.tipPops.length - 1; i >= 0; i--) {
        const pop = this.tipPops[i];
        pop.life -= 0.016;
        pop.y -= 1.4;
        if (pop.life <= 0) {
          this.tipPops.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = clamp(pop.life, 0, 1);
        ctx.font = '800 34px "Baloo 2", "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#fffdf6';
        ctx.strokeText(pop.text, pop.x, pop.y);
        ctx.fillStyle = COLORS.mint;
        ctx.fillText(pop.text, pop.x, pop.y);
        ctx.restore();
      }
    }
  }

  window.ShopGame = ShopGame;
})();
