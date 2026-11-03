# 🔮 MYSTIC WITCH LIVE — TikTok Live Tarot Stage (9:16)

> **Migration in progress.** This is the original drink-shop application rebranded as
> **MYSTIC WITCH LIVE**. Phase 1 changed branding and metadata only: the TikTok
> connector, event engine and gameplay below are unchanged and still the drink shop.
> The tarot stage, 78-card deck and ComfyUI visuals arrive in later phases.

An interactive **TikTok Live drink shop simulation** in a vertical **9:16 (1080×1920)** frame, ready for **OBS Studio / TikTok Live Studio**. It runs on **Bun.js** with the original **Express + WebSocket + JSON-RPC 2.0** stack and the **tiktok-live-connector** integration, now driving a cute 2D cartoon drink stand instead of a temple scene.

Customers walk up to the counter, order a drink, get served, take a seat at a free table, finish their drink and leave — continuously. TikTok viewers drive the shop: **follows** bring in a VIP free-drink guest, **likes** trigger a crowd rush, **comments** place real orders and **gifts** send party trays.

---

## 🎮 Gameplay loop

- Background: static outdoor American drink-shop street (`public/assets/background/street.jpg`).
- Two sellers (male + female) work behind the counter; both are shown behind a candy-striped service counter.
- Customers spawn from both sides of the plaza: children, teenagers, adults, middle-aged and elderly guests, male and female, all taken from `public/assets/customers`.
- Each customer walks along a lane to a free queue slot in front of the counter, orders one drink from `public/assets/drinks`, is served, walks to a free table seat, drinks, then leaves.
- **Queue slots and table seats are fixed**, so people do not pile up; walkers also push apart from each other.
- If every table is full when an order is ready, the customer takes the drink **to go** and leaves.
- Depth sorting + per-row scaling keep near/far characters readable, and the background never moves.

---

## 🚀 Run it

```bash
bun install
bun start
# or hot reload:
bun run dev
```

- **Live screen + control dock:** http://localhost:3000
- **OBS clean view (9:16):** http://localhost:3000/?obs=1 → set the Browser Source to `1080 × 1920`
- **Admin panel:** http://localhost:3000/admin

`PORT` and `TIKTOK_USER` environment variables are still honoured, and the server auto-connects to `TIKTOK_USER` (default `@zenfacts_vn`) on boot.

Voice lines are spoken by **Piper** using the local ONNX models in `config/piper/en` and `config/piper/vn` — nothing is downloaded. The Bun server keeps one persistent Python worker (`piper_worker.py`) alive so voices stay warm, and a missing interpreter or model only logs a warning.

Install the engine once (the voice models are already in the repo):

```bash
python -m pip install piper-tts
```

The admin panel's **Piper Voice** card holds the language selector (English / Vietnamese), the discovered voice list, speech speed, volume, the voice on/off toggle and a test button. Voices are discovered from the files in `config/piper/en` and `config/piper/vn` (`<name>.onnx` plus `<name>.onnx.json`), so adding a model needs no JavaScript or config edit: the server scans on startup, watches the folders while it runs, and the **🔄 Refresh Piper Voices** button rescans on demand. Every voice is listed with its friendly name, gender when `voices.json` provides it, model path and a per-voice **▶ Test** button; voices without gender metadata are still listed. `GET /api/tts/voices` returns the grouped catalog (`en`, `vi`/`vn`) and `tts.refreshVoices` forces a rescan. TikTok comments are read with the selected voice and language, queued so lines never overlap, truncated to `ttsMaxChars` and filtered for empty or spam messages.

---

## 🎛️ Controls

The dock next to the stage, and the admin panel, expose:

| Control | Effect |
| --- | --- |
| **Start** | Resumes the shop simulation |
| **Pause / Resume** | Freezes spawning and movement (overlay on the stage) |
| **Reset** | Clears customers, queues, tables and counters |
| **Customer spawn rate** | 0.25× – 3.00× ambient customer frequency |
| **Spawn one customer** | Adds a single walk-in immediately |
| **TikTok connect / disconnect** | Same connection logic as before |
| **Auto demo** | Server-side simulated viewer interactions for testing |

---

## 📡 TikTok Live → gameplay mapping

| TikTok event | In-shop result |
| --- | --- |
| **Follow / Share** | VIP guest arrives with a crown, gets a free drink and a big tip |
| **Like** | Heart burst on the stage + a crowd rush of new customers |
| **Comment** | A viewer-named customer arrives and orders the drink named in the comment ("lemonade", "coffee", "soda", "smoothie", "slushie", "cola"), otherwise a random drink |
| **Gift** | Party tray: a group of customers arrives with confetti and a banner |
| **Join** | New guest walks in |
| **Viewer count** | Shown in the live status pill |

Spam/garbage glyph filtering and the per-user comment cooldown from the original project are preserved.

### 🎁 Gift → drink donations

Gifts buy drinks at the counter. Icons come from `public/assets/gift_icon/`, drinks from `public/assets/drinks/` — nothing is renamed or generated.

| Gift coins | Drink | Menu icon |
| --- | --- | --- |
| 1 | Classic Cola (`coca.jpg`) | `rose.webp` |
| 5 | Berry Smoothie (`Smoothie.jpg`) | `rose.webp` |
| 10 | Blue Slushie (`Slushie.jpg`) | `PrayerCandle.webp` |
| 15 | Orange Soda (`Orange_Soda.jpg`) | `PrayerCandle.webp` |
| 20 | Iced Coffee (`Iced_Coffee.jpg`) | `grandCeremony.webp` |
| 25 | Fresh Lemonade (`Lemonade.jpg`) | `grandCeremony.webp` |

The drink is chosen by the gift's **coin value alone** (`diamondCount`): 1, 5, 10, 15, 20 or 25. Gift identity never picks a drink — the gift icons are decorative menu art shown next to each drink on the donation menu. Coin values outside those six are ignored and create no order. Each gift spawns a customer named after the sender, who walks to the counter, orders the mapped drink, is served, and takes it to a table. Combo updates only create orders for new repeats, so repeated combo payloads never duplicate customers, and bursts are queued one at a time. The stage shows a gift banner (icon, sender, drink, coins), a recent-gifts ticker and a running coin total; the admin panel has a donation board plus one-click test buttons for all three gifts.

| RPC method | Params | Effect |
| --- | --- | --- |
| `shop.giftOrder` (alias `shop.sendGift`) | `user, giftId` (`rose`/`prayercandle`/`grandceremony`), `units` | Queues a gift drink order |
| `shop.ttsStatus` | – | Piper engine, executable and voice list |
| `tts.refreshVoices` | – | Rescan `config/piper` and return the grouped voice catalog |

---

## 🔌 JSON-RPC 2.0

HTTP `POST /rpc` and WebSocket `ws://localhost:3000/ws` behave as before: JSON-RPC 2.0 requests, `temple.state` / `temple.event` notifications, and result objects containing `{ event, state }`.

New shop methods:

| Method | Params | Purpose |
| --- | --- | --- |
| `shop.getState` | — | Full shop state |
| `shop.serveDrink` | `user, drinkId, count` | Serve a drink to a specific customer |
| `shop.follow` | `user` | Follow → VIP free-drink guest |
| `shop.like` | `user, count` | Like rush |
| `shop.comment` | `user, comment` | Comment-driven order |
| `shop.gift` | `user, coins, giftName` | Gift party tray |
| `shop.freeDrink` | `user` | Free sample |
| `shop.mysteryDrink` | `user` | Mystery Sip card + customer |
| `shop.spawnCustomer` | `user` | Spawn one walk-in |
| `shop.start` / `shop.pause` / `shop.resume` / `shop.reset` | — | Game control |
| `game.start` / `game.pause` / `game.resume` / `game.reset` | — | Same game controls |
| `game.setSpawnRate` | `rate` (0.25–3) | Customer frequency |
| `game.spawnCustomer` | `user?` | Spawn one walk-in |
| `shop.setSettings` | partial settings | Running, paused, volumes, spawn rate |
| `live.connect` / `live.disconnect` / `live.setAutoSim` | as before | TikTok connection |

Legacy names are still accepted so existing automation keeps working:

- `temple.getState`, `temple.burnIncense` (serve drink), `temple.strikeWoodenFish` (likes), `temple.ringBell` (follow VIP), `temple.sendPrayer` (free drink), `temple.offerGift` (party tray), `temple.drawFortune` (mystery sip), `temple.grandCeremony` (mega party), `temple.updateSettings`, `temple.resetMerit`, `temple.comment`, `temple.speak`, `temple.ttsStatus`.

Example:

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "shop.serveDrink",
    "params": { "user": "Mia Carter", "drinkId": "lemonade", "count": 2 }
  }'
```

---

## 📁 Structure

```text
├── server.js                  # Bun/Node HTTP + WebSocket JSON-RPC 2.0 + TikTok Live connector
├── piper_worker.py            # Persistent Piper worker (local ONNX voices)
├── config/piper/              # en/ and vn/ Piper voices (.onnx + .onnx.json)
├── data/
│   ├── game-state.json        # Shop counters, supporters and settings (created on first save)
│   └── tts-cache/             # Synthesized voice cache
├── public/
│   ├── index.html             # 9:16 live stage + control dock
│   ├── admin.html             # Stream control panel
│   ├── css/live.css           # Cartoon shop UI
│   ├── js/
│   │   ├── asset-manifest.js  # Generated list of the real asset filenames
│   │   ├── game.js            # Drink shop simulation engine (sprites, queue, tables, service)
│   │   ├── particles.js       # 30 FPS hearts / confetti / bubbles layer
│   │   ├── audio.js           # Synthesized shop sounds + Piper voice queue
│   │   └── live.js            # WebSocket/RPC controller + HUD
│   └── assets/                # Existing background, customers, drinks, seller art (unchanged)
└── README.md
```

### About the artwork

All images come from the four existing folders — `public/assets/background`, `customers`, `drinks` and `seller`. No files were renamed, replaced or generated. The client removes each JPG's flat white studio background at load time (flood fill from the border, so enclosed white clothing stays intact) and trims the sprite to its visible bounds.

`public/js/asset-manifest.js` is generated from the actual directory contents. If you add or rename art later, regenerate it so the filenames stay byte-exact.

## 👥 Viewer Character System

One TikTok viewer = one persistent game character for the whole live session.

- **Join** (`WebcastEvent.MEMBER` / `shop.join`): creates a character with a random
  customer sprite and shows the TikTok username above it. Repeated joins, follows,
  likes, comments and gifts never create a second character — the viewer is keyed by
  `uniqueId` (falling back to the sanitized name).
- **Follow**: VIP badge (crown) plus a celebration burst. **Like**: hearts and a waving
  animation. **Comment**: a speech bubble over the character. **Gift**: a drink order
  added to that viewer's personal queue (never a new body).
- **Multiple donations**: each valid coin tier appends an order; the character serves
  them one after another at the counter, showing the drink and its coin value. Combo
  replays are deduplicated by order id.
- **Large audiences**: no character cap and no waiting-slot cap. The first eight queue
  positions are the counter row; every other viewer fills expanding rows across the
  floor, bodies shrink gently as the crowd grows while names stay on the front rows and
  every VIP. Entrances are staggered, particles are throttled when the shop is packed,
  and walker separation is bounded so 50–100 viewers stay smooth. Viewers with paid
  orders are prioritised. When every table is taken a viewer keeps their drink standing
  in the shop instead of walking out, so nobody is silently dropped.
- **Leave**: the drink already on the counter is finished, the character shows
  “Thanks! See you next live! 👋”, waves and walks off screen; the body is then removed
  from the stage and from the active roster (sprite, nameplate and VIP effects included).
  Duplicate departures are ignored. The session is kept for 15 minutes so a reconnecting
  viewer gets the same character, sprite and identity back (`shop.leave` / `shop.join`);
  after that the existing new-session behaviour applies. TikTok’s connector exposes no
  viewer-leave event, so departures arrive through `shop.leave` (stage dock, admin or an
  external caller) — the client never invents one.
- **Leaderboard**: coins per viewer for the current live session (top supporters on
  stage), with all-time totals kept separately (`lifetimeLeaderboard`).
- RPC: `shop.join`, `shop.leave`, `shop.viewerServed`, `shop.viewers` (aliases under
  `live.*`). `GET /api/state` exposes `viewers`, `viewerSummary`, `session`,
  `leaderboard` and `lifetimeLeaderboard`.

## 👑 VIP Progression, Emotions & Celebrations

Viewer VIP level comes from coins donated during the current live session
(25 = VIP, 50 = Super VIP, 100 = Diamond VIP, 0–24 = Regular Customer). Levels
recompute on every valid gift, so multiple gifts accumulate, the character is
never replaced, and session levels reset when a new live session starts.

- **Appearance**: VIP 1 gets a gold VIP badge and soft sparkles, VIP 2 a gold
  crown with a glowing gold nameplate, VIP 3 a diamond crown with blue/gold
  sparkles and a blue-glow nameplate.
- **Emotions**: happy entry, waving + hearts on likes, gold sparkles on follows,
  truncated speech bubbles on comments, an excited hop with gift animation,
  a thank-you smile when the drink is served, and a goodbye wave on leave.
- **Celebrations** by individual gift value: 25–49 confetti, 50–99 golden
  confetti and gold particles, 100–499 fireworks with a VIP announcement, 500+
  a grand celebration where every customer cheers. Combo replays are deduped by
  order id on both the server and the stage.
- **Notifications**: animated banners for thank-yous, VIP promotions, new top
  supporter and big gifts (see `#noticeStack`).
- **Audio**: `playCoin`, `playVipUpgrade`, `playCelebration`, `playFireworks` sit
  on their own `sfxVolume` gain, separate from music and Piper voice, throttled
  so bursts of events never stack cues.
- **Admin**: the “VIP & Supporters” card shows session donations, VIP counts and
  the top 3, with test buttons (`shop.testVip`, `shop.testCelebration`) that
  replay the real visuals without touching leaderboard or session coins.

## 📡 TikTok LIVE connection

Both the stage dock and the admin panel show the live connection state
(`DISCONNECTED`, `CONNECTING...`, `CONNECTED`, `RECONNECTING...`, `CONNECTION ERROR`) with the
username, connection duration, viewer count and the last received LIVE event.

- Enter the account exactly as in the TikTok app (`@username` or `username`); a full
  `tiktok.com/@username/live` link also works.
- The server checks liveness before opening the websocket, so an offline account reports
  "`@user` is not LIVE right now" instead of a generic failure.
- A second Connect click while a connection is opening is rejected instead of starting a
  parallel attempt, and a dropped connection retries automatically (5 attempts, growing
  backoff) while reporting `RECONNECTING...`.
- `tiktok-live-connector` v2 signs websocket requests through Euler Stream. If the log shows
  *"This endpoint requires a Business plan"*, set `EULER_API_KEY` (or `TIKTOK_SIGN_API_KEY`)
  in the environment; the server passes it as `signApiKey`. Without such a key TikTok LIVE
  events cannot be received, and the UI reports that exact error.

## 📣 Automatic Shop Announcer

A context-aware announcer keeps the stream talking even when nobody interacts.

- **Scheduler**: starts with the shop, speaks every 5–8 s by default (5/8/10/15/20 s
  selectable), never interrupts a sentence, waits for the Piper queue to empty, never
  repeats the previous line, and stops while the shop is paused.
- **Context**: empty shop → welcome + invite; waiting customers → drink promos; a drink
  being served → atmosphere; quiet chat → call-to-action; new viewer → an occasional
  username greeting. Generic lines stay quiet for a few seconds after a personalized
  TikTok event so thank-yous never duplicate.
- **Catalog**: 26 editable English + Vietnamese sentences in five categories
  (welcome, drinks, call to action, atmosphere, supporter appreciation), stored in
  `localStorage` and managed from the admin panel (add/edit/delete/enable, filter,
  search, test individual lines).
- **Voices**: local Piper models only (`config/piper/en`, `config/piper/vn`), with
  female/male/random seller selection, language, speed and volume controls.
- **Shared speech queue**: priority 0 gifts/VIP, 1 viewer replies, 2 announcements.
  Announcements are skipped rather than queued behind speech; important lines clear
  queued chatter; music and SFX keep their own volumes.

## 🎵 Background Music Playlist

`public/js/music.js` (`ShopMusicPlayer`) owns the background playlist; `public/js/audio.js` delegates all music playback to it and keeps the synthesized ambience only as a fallback. Music volume is independent from the Piper voice volume and is remembered in `localStorage` (`shop_music_vol`) together with the last track (`shop_music_track`).

| # | Track | File | Feel |
| --- | --- | --- | --- |
| 1 | Sunny Morning | `sunny-morning.mp3` | Cheerful acoustic café |
| 2 | Summer Lemonade | `summer-lemonade.mp3` | Light tropical instrumental |
| 3 | Happy Café | `happy-cafe.mp3` | Warm soft jazz |
| 4 | Weekend Vibes | `weekend-vibes.mp3` | Upbeat summer groove |
| 5 | Beachside Drive | `beachside-drive.mp3` | Breezy marimba + shaker |
| 6 | Coffee Break | `coffee-break.mp3` | Relaxing lo-fi |
| 7 | Good Times | `good-times.mp3` | Bright bells and plucks |
| 8 | Little Sunshine | `little-sunshine.mp3` | Gentle music-box calm |

All eight tracks are **original instrumentals generated locally** by `tools/generate_music.py` (numpy additive synthesis → ffmpeg MP3). No third-party, commercial or copyrighted music is included; the files live in `public/assets/music/` and contain no vocals.

Playback starts automatically when the shop loads. Browsers that block autoplay retry on the first pointer/key gesture. The player advances when a track ends, wraps from the last track back to the first, preloads the next file, skips files that fail to load (falling back to the synthesized ambience if none play), and uses a single `Audio` element so two tracks can never overlap. Refreshing game state or customers arriving/leaving never restarts the music.

The admin panel's **🎵 Background Music** card shows the current track, Play, Pause, Previous, Next, the volume slider, a live progress bar and the full playlist with the playing track highlighted. The card talks to the stage player over a `BroadcastChannel` (`mystic-witch-music`), so its buttons control the OBS/stage audio; if no stage tab is open it plays inside the panel instead. The Next button stops the current track immediately and starts the next one.
