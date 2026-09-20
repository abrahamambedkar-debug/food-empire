/* global Phaser */
/* ============================================================================
   FOOD EMPIRE · game.js   (v2 — NPC · ARENA · UPGRADES · SAVE)
   ----------------------------------------------------------------------------
   A top-down restaurant game built with Phaser 3 (CDN).
   Every visual is a colored rectangle / shape drawn in code — no image assets.

   CONTROLS
   · Move .............. WASD / Arrow keys (touch joystick on mobile)
   · Interact .......... E or SPACE  (ACTION button on mobile)
   · Hire NPC worker ... H            ($2000)
   · Arena battle ...... B
   · Upgrade menu ...... U            (U or X to close)
   · Restart (dead) .... R

   CONTENTS
   1. Constants & data tables
   2. State  (money / rep / upgrades / save-load)
   3. SoundFX (WebAudio synth — no audio files)
   4. NpcWorker (6-state machine AI cook)
   5. GameScene (restaurant: stations, customers, HUD, menu, save)
   6. ArenaScene (60 s cook-off vs rival AI + judge scorecard)
   7. Boot
   ========================================================================== */

/* ============================================================================
   1) CONSTANTS & DATA
   ========================================================================== */

const VIEW_W = 800;                  // logical canvas width
const VIEW_H = 600;                  // logical canvas height

const WALK_SPEED = 235;              // base player max speed (px/s)
const ACCEL = 1600;                  // player acceleration
const DRAG = 1400;                   // player deceleration (smooth stop)
const CUST_SPEED = 105;              // customer walking speed (px/s)
const NPC_SPEED = 90;                // NPC worker speed (px/s) — per spec

const COOK_MS = 3000;                // base cooking time (Fast Cooking → 1500)
const PATIENCE_MS = 30000;           // base guest patience (More Patience → 45000)

const RANGE_SERVE = 95;              // interaction radii
const RANGE_STATION = 78;
const RANGE_BIN = 78;

const REP_MAX = 100;
const REP_START = 55;
const REP_SERVE = 5;                 // rep gained per successful serve
const REP_WALKOUT = 12;              // rep lost when a guest storms out

const NPC_COST = 2000;               // price of hiring the NPC worker
const AUTOSAVE_MS = 30000;           // auto-save every 30 seconds
const SAVE_KEY = 'foodEmpireSave';   // localStorage key (per spec)

const FONT_BOLD = '"Arial Black", "Segoe UI", Arial, sans-serif';
const FONT_SOFT = 'Arial, "Segoe UI", sans-serif';

/* ---- THE MENU — 6 dishes, each with its own cooking station -------------- */
/* `x` is the station's position along the kitchen counter (y = 92).          */
const FOODS = [
  { key: 'burger', emoji: '🍔', name: 'Burger', price: 10, color: 0x2fae5f, dark: 0x1d7a41, x: 84 },
  { key: 'fries',  emoji: '🍟', name: 'Fries',  price: 8,  color: 0xe0a33c, dark: 0xa8761f, x: 202 },
  { key: 'pizza',  emoji: '🍕', name: 'Pizza',  price: 14, color: 0xd95f43, dark: 0x9c3c28, x: 320 },
  { key: 'taco',   emoji: '🌮', name: 'Taco',   price: 12, color: 0xc9a227, dark: 0x8f7016, x: 438 },
  { key: 'sushi',  emoji: '🍣', name: 'Sushi',  price: 18, color: 0xe36aa0, dark: 0xa33f70, x: 556 },
  { key: 'soda',   emoji: '🥤', name: 'Soda',   price: 6,  color: 0x39b8c4, dark: 0x1f7f89, x: 674 },
];
const foodByKey = (key) => FOODS.find((f) => f.key === key) || FOODS[0];

/* ---- Dining room -------------------------------------------------------- */
const TABLE_W = 96;
const TABLE_H = 44;
const SEAT_DY = 52;                  // guest sits this far below table center
/* 5th spot is only built when the "Extra Table" upgrade is owned. */
const TABLE_SPOTS = [
  { x: 190, y: 250 },
  { x: 470, y: 250 },
  { x: 190, y: 462 },
  { x: 470, y: 462 },
  { x: 330, y: 356 },
];

const CUSTOMER_TINTS = [0xe05252, 0xd94848, 0xe8654f, 0xc94545, 0xe05858];

/* ---- Key geometry ------------------------------------------------------- */
const AISLE_X = 716;                 // vertical lane guests walk along
const DOOR = { x: 836, y: 530 };     // off-screen spawn / exit point
const BIN = { x: 756, y: 92 };       // toss unwanted dishes here
const LANE_Y = 160;                  // NPC "highway" in front of the counter
const NPC_HOME = { x: 620, y: LANE_Y };
const SERVICE_DX = 78;               // NPC stands this far right of a table

/* ---- Upgrades (Feature 3) ----------------------------------------------- */
const UPGRADES = [
  { id: 'speed',      name: 'Speed Boost',  cost: 500,  emoji: '⚡',
    desc: 'Run 30% faster around the floor' },
  { id: 'fastCook',   name: 'Fast Cooking', cost: 800,  emoji: '🔥',
    desc: 'Every station cooks in 1.5 seconds' },
  { id: 'patience',   name: 'More Patience', cost: 600, emoji: '⏳',
    desc: 'Guests happily wait 45 seconds' },
  { id: 'extraTable', name: 'Extra Table',  cost: 1000, emoji: '🪑',
    desc: 'Open a 5th table for more guests' },
];

/* ---- Secret ingredients unlocked by winning arena battles --------------- */
const SECRETS = [
  'Truffle Dust', 'Dragon Chili', 'Golden Honey',
  'Smoked Miso', 'Volcano Salt', 'Midnight Vanilla',
];

/* ============================================================================
   2) STATE — the persistent empire (Feature 4: save / load)
   ========================================================================== */

const State = {
  money: 0,
  rep: REP_START,
  served: 0,
  upgrades: { speed: false, fastCook: false, patience: false, extraTable: false },
  npcHired: false,
  secrets: [],          // unlocked secret-ingredient names
  arenaWins: 0,
  arenaBattles: 0,

  /* ---- derived values (upgrades applied) ---- */
  get walkSpeed()  { return WALK_SPEED * (this.upgrades.speed ? 1.3 : 1); },
  get cookMs()     { return this.upgrades.fastCook ? 1500 : COOK_MS; },
  get patienceMs() { return this.upgrades.patience ? 45000 : PATIENCE_MS; },
  get tableCount() { return this.upgrades.extraTable ? 5 : 4; },
  /* secret ingredients make guests tip more generously */
  get tipMax()     { return 6 + this.secrets.length * 2; },

  /* ---- serialize ---- */
  toData() {
    return {
      v: 2,
      money: this.money,
      rep: this.rep,
      served: this.served,
      upgrades: { ...this.upgrades },
      npcHired: this.npcHired,
      secrets: [...this.secrets],
      arenaWins: this.arenaWins,
      arenaBattles: this.arenaBattles,
    };
  },

  /* ---- write to localStorage (returns true on success) ---- */
  save() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(this.toData()));
      return true;
    } catch (err) {
      return false;  // private mode / storage disabled — game keeps running
    }
  },

  /* ---- read from localStorage, validating every field ---- */
  load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return false;

      this.money = Math.max(0, Number(d.money) || 0);
      this.rep = Phaser.Math.Clamp(Number(d.rep) || REP_START, 1, REP_MAX);
      this.served = Math.max(0, Number(d.served) || 0);
      this.npcHired = !!d.npcHired;
      this.arenaWins = Math.max(0, Number(d.arenaWins) || 0);
      this.arenaBattles = Math.max(0, Number(d.arenaBattles) || 0);

      if (d.upgrades && typeof d.upgrades === 'object') {
        for (const u of UPGRADES) this.upgrades[u.id] = !!d.upgrades[u.id];
      }
      /* only keep secrets that still exist in the master list */
      this.secrets = Array.isArray(d.secrets)
        ? d.secrets.filter((s) => SECRETS.includes(s))
        : [];
      return true;
    } catch (err) {
      return false;
    }
  },

  /* ---- full wipe (Reset button) ---- */
  wipe() {
    this.money = 0;
    this.rep = REP_START;
    this.served = 0;
    this.upgrades = { speed: false, fastCook: false, patience: false, extraTable: false };
    this.npcHired = false;
    this.secrets = [];
    this.arenaWins = 0;
    this.arenaBattles = 0;
    try { window.localStorage.removeItem(SAVE_KEY); } catch (err) { /* ignore */ }
  },
};

/* ============================================================================
   3) SOUND — tiny WebAudio synth (no audio files at all)
   ========================================================================== */

const SoundFX = {
  ctx: null,

  /* Browsers need a user gesture before audio can start. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (err) { /* audio unavailable — game still works */ }
  },

  /* One synthesized note. `when` delays it (in seconds). */
  tone(freq, dur = 0.1, type = 'square', vol = 0.06, when = 0) {
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (err) { /* ignore */ }
  },

  click()  { this.tone(620, 0.05, 'square', 0.04); },
  pop()    { this.tone(520, 0.07, 'triangle', 0.07); this.tone(780, 0.08, 'triangle', 0.06, 0.05); },
  ding()   { this.tone(880, 0.12, 'sine', 0.08); this.tone(1318, 0.2, 'sine', 0.07, 0.08); },
  bell()   { this.tone(1568, 0.14, 'triangle', 0.06); this.tone(2093, 0.12, 'triangle', 0.04, 0.07); },
  cash()   { this.tone(1245, 0.06, 'square', 0.06); this.tone(1661, 0.09, 'square', 0.06, 0.06); },
  buzz()   { this.tone(140, 0.22, 'sawtooth', 0.08); },
  thud()   { this.tone(180, 0.1, 'square', 0.06); },
  chop()   { this.tone(300 + Math.random() * 60, 0.04, 'square', 0.05); },
  perfect(){ this.tone(1046, 0.05, 'triangle', 0.06); this.tone(1568, 0.07, 'triangle', 0.05, 0.04); },
  tick()   { this.tone(760, 0.03, 'square', 0.03); },
  buy()    { this.tone(660, 0.07, 'square', 0.06); this.tone(990, 0.1, 'square', 0.05, 0.07);
             this.tone(1320, 0.14, 'triangle', 0.05, 0.15); },
  hire()   { this.tone(523, 0.1, 'triangle', 0.07); this.tone(659, 0.1, 'triangle', 0.07, 0.09);
             this.tone(880, 0.18, 'triangle', 0.07, 0.18); },
  fanfare(){ [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'square', 0.06, i * 0.1)); },
  lose()   { [420, 340, 260].forEach((f, i) => this.tone(f, 0.2, 'sawtooth', 0.06, i * 0.12)); },
};

/* ============================================================================
   4) NPC WORKER (Feature 1)
   ----------------------------------------------------------------------------
   A purple rectangle cook driven by a 6-state machine:
     IDLE → WALK_TO_STATION → COOK → WALK_TO_CUSTOMER → SERVE → WALK_BACK → IDLE
   It walks only on a safe lane network (a horizontal highway in front of the
   counter + clear vertical corridors beside each table) so it can never get
   stuck on furniture. A watchdog timer resets any state that runs too long.
   ========================================================================== */

const NPC_STATES = {
  IDLE: 'IDLE',
  WALK_TO_STATION: 'WALK_TO_STATION',
  COOK: 'COOK',
  WALK_TO_CUSTOMER: 'WALK_TO_CUSTOMER',
  SERVE: 'SERVE',
  WALK_BACK: 'WALK_BACK',
};

class NpcWorker {
  constructor(scene) {
    this.scene = scene;
    this.name = 'ANA';

    this.x = NPC_HOME.x;
    this.y = NPC_HOME.y;

    this.state = NPC_STATES.IDLE;
    this.stateTime = 0;        // watchdog: ms spent in the current state
    this.thinkTimer = 0;       // throttles the "look for work" scan
    this.serveTimer = 0;       // small pause while plating
    this.path = [];            // remaining waypoints

    this.station = null;       // reserved station
    this.target = null;        // targeted customer
    this.carrying = null;      // food object in hands

    this.buildVisuals();
  }

  /* ---- purple rectangle body + status badge above the head ---- */
  buildVisuals() {
    const s = this.scene;
    this.container = s.add.container(this.x, this.y).setDepth(26);

    const shadow = s.add.ellipse(0, 17, 28, 10, 0x000000, 0.28);
    const body = s.add.rectangle(0, 0, 26, 34, 0x9b6ee0).setStrokeStyle(2, 0x6b45a8);
    const eyeL = s.add.rectangle(-6, -7, 5, 7, 0x24123f);
    const eyeR = s.add.rectangle(6, -7, 5, 7, 0x24123f);
    const apron = s.add.rectangle(0, 8, 18, 12, 0xffffff, 0.22);
    const hat = s.add.rectangle(0, -21, 20, 8, 0xf2ecff).setStrokeStyle(1, 0xb9a6e0);

    /* status badge (state machine read-out, per spec) */
    this.badge = s.add.rectangle(0, -40, 96, 15, 0x2a1b45, 0.92).setStrokeStyle(1, 0x9b6ee0);
    this.status = s.add.text(0, -40, 'IDLE', {
      fontFamily: FONT_SOFT, fontSize: '9px', color: '#e7dcff',
    }).setOrigin(0.5);
    this.tag = s.add.text(0, -55, 'ANA · NPC COOK', {
      fontFamily: FONT_SOFT, fontSize: '8px', color: '#b9a6e0',
    }).setOrigin(0.5);

    /* dish carried above the head */
    this.carryText = s.add.text(0, -70, '', { fontSize: '19px' }).setOrigin(0.5).setVisible(false);

    this.container.add([shadow, body, eyeL, eyeR, apron, hat,
      this.badge, this.status, this.tag, this.carryText]);

    /* spawn pop-in */
    this.container.setScale(0.2);
    s.tweens.add({ targets: this.container, scale: 1, duration: 320, ease: 'Back.easeOut' });
  }

  /* ---- status text helper ---- */
  setStatus(text, color = '#e7dcff') {
    if (this.status.text !== text) {
      this.status.setText(text).setColor(color);
      this.badge.displayWidth = Math.max(54, this.status.width + 14);
    }
  }

  /* ---- build a safe route to (tx, ty) using the lane network ---- */
  pathTo(tx, ty) {
    const pts = [];
    if (Math.abs(this.y - LANE_Y) > 2) pts.push({ x: this.x, y: LANE_Y }); // get on the highway
    pts.push({ x: tx, y: LANE_Y });                                        // travel along it
    if (Math.abs(ty - LANE_Y) > 2) pts.push({ x: tx, y: ty });             // drop to the target
    this.path = pts;
  }

  /* ---- follow the path; returns true when the last point is reached ---- */
  moveAlongPath(delta) {
    const step = (NPC_SPEED * delta) / 1000;
    let budget = step;

    while (budget > 0 && this.path.length > 0) {
      const t = this.path[0];
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const d = Math.hypot(dx, dy);

      if (d <= budget || d < 0.5) {
        this.x = t.x;
        this.y = t.y;
        this.path.shift();
        budget -= d;
      } else {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        budget = 0;
      }
    }
    this.container.setPosition(this.x, this.y);
    return this.path.length === 0;
  }

  /* ---- walking wobble on / off ---- */
  wobble(on) {
    if (on && !this.wobbleTween) {
      this.container.setAngle(-3);
      this.wobbleTween = this.scene.tweens.add({
        targets: this.container, angle: 3,
        duration: 150, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    } else if (!on && this.wobbleTween) {
      this.wobbleTween.stop();
      this.wobbleTween = null;
      this.container.setAngle(0);
    }
  }

  /* ---- release every reservation (used on retarget / watchdog) ---- */
  releaseAll(freeStation = true) {
    if (this.target) { this.target.npcClaim = false; this.target = null; }
    if (freeStation && this.station) {
      if (this.station.owner === 'npc' && this.station.state === 'idle') this.station.owner = null;
      this.station = null;
    }
  }

  /* ---- drop whatever is in hand ---- */
  dropDish() {
    if (!this.carrying) return;
    this.carrying = null;
    this.carryText.setVisible(false);
  }

  /* ---- is this customer still a valid delivery target? ---- */
  validTarget(c) {
    return !!c && c.state === 'waiting' && this.scene.customers.indexOf(c) !== -1;
  }

  /* ---- find a waiting guest whose station is free ---- */
  findJob() {
    const scene = this.scene;
    /* most impatient guest first, so the NPC helps where it matters */
    const waiting = scene.customers
      .filter((c) => c.state === 'waiting' && !c.npcClaim)
      .sort((a, b) => a.patience - b.patience);

    for (const c of waiting) {
      const st = scene.stationFor(c.order.key);
      if (st && st.state === 'idle' && !st.owner) return { customer: c, station: st };
    }
    return null;
  }

  /* ======================= STATE MACHINE TICK ======================= */
  update(delta) {
    const scene = this.scene;
    this.stateTime += delta;

    /* --- watchdog: nothing may ever hang --- */
    if (this.stateTime > 22000 && this.state !== NPC_STATES.IDLE) {
      this.recover();
      return;
    }

    switch (this.state) {
      /* ---------- IDLE: scan for work a few times per second ---------- */
      case NPC_STATES.IDLE: {
        this.wobble(false);
        this.setStatus('IDLE · looking for orders', '#cbbdf0');
        this.thinkTimer -= delta;
        if (this.thinkTimer > 0) break;
        this.thinkTimer = 420;

        const job = this.findJob();
        if (!job) break;

        this.target = job.customer;
        this.target.npcClaim = true;
        this.station = job.station;
        this.station.owner = 'npc';                   // reserve it from the player

        this.pathTo(this.station.x, 152);
        this.go(NPC_STATES.WALK_TO_STATION);
        break;
      }

      /* ---------- WALK_TO_STATION ---------- */
      case NPC_STATES.WALK_TO_STATION: {
        this.wobble(true);
        const dish = this.station ? this.station.food : null;
        this.setStatus(`WALK → ${dish ? dish.emoji : ''} STATION`);

        if (!this.station) { this.recover(); break; }

        if (this.moveAlongPath(delta)) {
          /* arrived: fire the burner (shared station API) */
          this.station.state = 'cooking';
          this.station.owner = 'npc';
          this.station.cookEnd = scene.time.now + State.cookMs;
          scene.showStationCooking(this.station);
          SoundFX.pop();
          this.go(NPC_STATES.COOK);
        }
        break;
      }

      /* ---------- COOK: wait for the shared progress bar to fill ---------- */
      case NPC_STATES.COOK: {
        this.wobble(false);
        if (!this.station) { this.recover(); break; }
        const left = Math.max(0, this.station.cookEnd - scene.time.now);
        this.setStatus(`COOK ${this.station.food.emoji} ${(left / 1000).toFixed(1)}s`, '#ffe6a3');

        if (this.station.state === 'ready') {
          /* plate up and free the station for everyone else */
          this.carrying = this.station.food;
          this.carryText.setText(this.carrying.emoji).setVisible(true);
          scene.clearStation(this.station);
          this.station.owner = null;
          this.station = null;
          SoundFX.pop();

          /* still someone to feed? otherwise find a new home for the dish */
          if (!this.validTarget(this.target)) this.retargetOrGoHome();
          else {
            this.pathTo(this.target.table.x + SERVICE_DX, this.target.container.y);
            this.go(NPC_STATES.WALK_TO_CUSTOMER);
          }
        }
        break;
      }

      /* ---------- WALK_TO_CUSTOMER ---------- */
      case NPC_STATES.WALK_TO_CUSTOMER: {
        this.wobble(true);
        this.setStatus(`DELIVER ${this.carrying ? this.carrying.emoji : ''}`);

        if (!this.carrying) { this.recover(); break; }
        if (!this.validTarget(this.target)) { this.retargetOrGoHome(); break; }

        if (this.moveAlongPath(delta)) {
          this.serveTimer = 380;                    // small plating pause
          this.go(NPC_STATES.SERVE);
        }
        break;
      }

      /* ---------- SERVE ---------- */
      case NPC_STATES.SERVE: {
        this.wobble(false);
        this.setStatus('SERVING…', '#9ff5c0');
        this.serveTimer -= delta;
        if (this.serveTimer > 0) break;

        if (this.validTarget(this.target) && this.carrying &&
            this.carrying.key === this.target.order.key) {
          scene.serveCustomer(this.target, 'npc');
          this.dropDish();
          this.target = null;
        } else {
          this.retargetOrGoHome();
          break;
        }
        this.pathTo(NPC_HOME.x, NPC_HOME.y);
        this.go(NPC_STATES.WALK_BACK);
        break;
      }

      /* ---------- WALK_BACK ---------- */
      case NPC_STATES.WALK_BACK: {
        this.wobble(true);
        this.setStatus('RETURNING…');
        if (this.moveAlongPath(delta)) {
          this.dropDish();                          // never hoard a stale plate
          this.releaseAll();
          this.go(NPC_STATES.IDLE);
        }
        break;
      }

      default:
        this.recover();
    }
  }

  /* ---- enter a new state (resets the watchdog) ---- */
  go(state) {
    this.state = state;
    this.stateTime = 0;
  }

  /* ---- holding a dish but the guest vanished: find another taker ---- */
  retargetOrGoHome() {
    const scene = this.scene;
    if (this.target) { this.target.npcClaim = false; this.target = null; }

    if (this.carrying) {
      const alt = scene.customers.find(
        (c) => c.state === 'waiting' && !c.npcClaim && c.order.key === this.carrying.key,
      );
      if (alt) {
        this.target = alt;
        alt.npcClaim = true;
        this.pathTo(alt.table.x + SERVICE_DX, alt.container.y);
        this.go(NPC_STATES.WALK_TO_CUSTOMER);
        return;
      }
    }
    this.pathTo(NPC_HOME.x, NPC_HOME.y);
    this.go(NPC_STATES.WALK_BACK);
  }

  /* ---- watchdog recovery: drop everything and walk home ---- */
  recover() {
    if (this.station) {
      if (this.station.owner === 'npc' && this.station.state !== 'ready') {
        this.scene.clearStation(this.station);
      }
      this.station.owner = null;
      this.station = null;
    }
    this.releaseAll();
    this.dropDish();
    this.path = [];
    this.pathTo(NPC_HOME.x, NPC_HOME.y);
    this.go(NPC_STATES.WALK_BACK);
  }
}

/* ============================================================================
   5) GAME SCENE — the restaurant
   ========================================================================== */

class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    /* ---- per-run state (State holds the persistent numbers) ---- */
    this.isGameOver = false;
    this.restartArmed = false;
    this.menuOpen = false;
    this.inArena = false;
    this.resetArmed = false;

    this.carrying = null;             // dish in the player's hands
    this.customers = [];
    this.tables = [];
    this.nextSpawnAt = 1800;          // first guest at ~1.8 s
    this.steamAcc = 0;
    this.badgeAcc = 0;

    this.queuedAction = false;        // set by the mobile ACTION button
    this.joyVec = { x: 0, y: 0 };
    this.hintOverride = null;
    this.hintOverrideUntil = 0;
    this.hintLast = '';

    /* ---- audio unlock on first input ---- */
    this.input.once('pointerdown', () => SoundFX.unlock());
    if (this.input.keyboard) this.input.keyboard.once('keydown', () => SoundFX.unlock());

    /* ---- build the world ---- */
    this.buildWorld();
    this.buildStations();
    this.buildTables();
    this.buildPlayer();
    this.buildHUD();
    this.buildHintBar();
    this.setupKeys();
    this.buildTouchControls();
    this.buildAmbience();

    /* ---- NPC worker restored from the save ---- */
    this.npc = State.npcHired ? new NpcWorker(this) : null;

    /* ---- customer director ---- */
    this.time.addEvent({ delay: 850, loop: true, callback: () => this.trySpawn() });

    /* ---- auto-save every 30 s (Feature 4) ---- */
    this.time.addEvent({ delay: AUTOSAVE_MS, loop: true, callback: () => this.autoSave() });

    /* ---- returning from the arena ---- */
    this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);

    this.updateHUD();
    this.refreshStationBadges();

    if (this.loadedNotice !== true && State.money + State.served > 0) {
      this.loadedNotice = true;
      this.showToast('Save loaded — welcome back, chef!', '#7ee8a2');
    }
  }

  /* ==========================================================================
     WORLD
     ======================================================================== */
  buildWorld() {
    this.solidGroup = this.physics.add.staticGroup();

    /* helper: colored rectangle + static body registered as a solid */
    this.solid = (x, y, w, h, color) => {
      const r = this.add.rectangle(x, y, w, h, color);
      this.physics.add.existing(r, true);
      this.solidGroup.add(r);
      return r;
    };

    /* floors */
    this.add.rectangle(400, 328, 800, 544, 0x1c2740);
    this.add.rectangle(400, 98, 800, 84, 0x171f33);

    /* tile grid */
    const grid = this.add.graphics().setDepth(1);
    grid.lineStyle(1, 0xffffff, 0.045);
    for (let x = 0; x <= 800; x += 40) grid.lineBetween(x, 140, x, 600);
    for (let y = 140; y <= 600; y += 40) grid.lineBetween(0, y, 800, y);

    /* walls */
    this.solid(400, 64, 800, 16, 0x0b1326);
    this.solid(400, 592, 800, 16, 0x0b1326);
    this.solid(8, 328, 16, 544, 0x0b1326);
    this.solid(792, 278, 16, 444, 0x0b1326);
    this.solid(792, 580, 16, 40, 0x0b1326);
    this.solid(792, 530, 16, 60, 0x0b1326).setVisible(false);  // invisible door plug

    const trim = this.add.graphics().setDepth(2);
    trim.lineStyle(2, 0xffd166, 0.22);
    trim.strokeRect(16, 72, 768, 512);

    /* entrance */
    this.add.rectangle(776, 530, 10, 60, 0xffd166, 0.35).setDepth(2);
    this.add.text(766, 530, 'DOOR', {
      fontFamily: FONT_SOFT, fontSize: '10px', color: '#8fa3c8',
    }).setOrigin(0.5).setAngle(-90).setDepth(2);

    /* kitchen counter (one long solid the player cannot cross) */
    this.solid(400, 92, 768, 48, 0x2e3a57).setDepth(5);
    this.add.rectangle(400, 70, 768, 6, 0x43517a).setDepth(6);
    this.add.rectangle(400, 116, 768, 4, 0x10182b).setDepth(6);

    /* trash bin */
    this.add.rectangle(BIN.x, BIN.y + 2, 46, 34, 0x39445c).setDepth(6);
    this.add.rectangle(BIN.x, BIN.y - 4, 50, 26, 0x5b6678).setDepth(7).setStrokeStyle(2, 0x39445c);
    this.add.text(BIN.x, BIN.y + 16, 'TOSS', {
      fontFamily: FONT_SOFT, fontSize: '9px', color: '#aeb9d4',
    }).setOrigin(0.5, 0).setDepth(8);

    this.physics.world.setBounds(0, 0, VIEW_W, VIEW_H);
  }

  /* ==========================================================================
     6 COOKING STATIONS — one per dish, all sharing the same API
     ======================================================================== */
  buildStations() {
    this.stations = FOODS.map((food) => {
      const x = food.x;
      const y = 92;

      this.add.rectangle(x, y + 3, 96, 48, food.dark).setDepth(6);
      const body = this.add.rectangle(x, y, 96, 48, food.color).setDepth(7)
        .setStrokeStyle(2, food.dark);

      /* grate stripes */
      const grate = this.add.graphics().setDepth(8);
      grate.lineStyle(3, food.dark, 0.85);
      for (let i = -26; i <= 26; i += 13) grate.lineBetween(x + i, y - 13, x + i, y + 13);

      this.add.text(x, y + 15, food.name.toUpperCase(), {
        fontFamily: FONT_SOFT, fontSize: '9px', color: '#0d1626',
      }).setOrigin(0.5).setDepth(9);

      /* idle emoji hint on the station face */
      const idleIcon = this.add.text(x, y - 8, food.emoji, { fontSize: '17px' })
        .setOrigin(0.5).setDepth(9).setAlpha(0.85);

      /* dish being cooked / ready */
      const dish = this.add.text(x, y - 6, food.emoji, { fontSize: '25px' })
        .setOrigin(0.5).setDepth(16).setVisible(false);

      /* progress bar sits below the counter so the HUD never hides it */
      const progBg = this.add.rectangle(x, 128, 86, 11, 0x0a1120).setDepth(40)
        .setStrokeStyle(1, 0x2c3c5f).setVisible(false);
      const progFill = this.add.rectangle(x - 41, 128, 2, 7, 0x3fce7c)
        .setOrigin(0, 0.5).setDepth(41).setVisible(false);

      /* demand badge: how many seated guests want this dish */
      const badge = this.add.circle(x + 38, 70, 10, 0xff5a5a).setDepth(42).setVisible(false);
      const badgeText = this.add.text(x + 38, 70, '0', {
        fontFamily: FONT_BOLD, fontSize: '11px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(43).setVisible(false);

      /* owner tag shown while the NPC uses the station */
      const ownerTag = this.add.text(x, 142, 'ANA', {
        fontFamily: FONT_SOFT, fontSize: '9px', color: '#c7b2f5',
      }).setOrigin(0.5).setDepth(42).setVisible(false);

      return {
        food, x, y,
        state: 'idle',        // idle | cooking | ready
        owner: null,          // null | 'player' | 'npc'
        cookEnd: 0,
        body, idleIcon, dish, progBg, progFill, badge, badgeText, ownerTag,
        pulse: null, sizzle: null,
      };
    });
  }

  stationFor(key) {
    return this.stations.find((s) => s.food.key === key) || null;
  }

  /* start the cooking visuals (shared by player + NPC) */
  showStationCooking(st) {
    st.dish.setText(st.food.emoji).setVisible(true).setScale(1).setPosition(st.x, st.y - 6);
    st.progBg.setVisible(true);
    st.progFill.setVisible(true).setFillStyle(0x3fce7c);
    st.progFill.displayWidth = 2;
    st.ownerTag.setVisible(st.owner === 'npc');
    st.idleIcon.setVisible(false);

    if (st.sizzle) st.sizzle.stop();
    st.sizzle = this.tweens.add({
      targets: st.dish, y: st.y - 9,
      duration: 140, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  /* dish finished cooking */
  markStationReady(st) {
    st.state = 'ready';
    if (st.sizzle) { st.sizzle.stop(); st.sizzle = null; }
    st.dish.setPosition(st.x, st.y - 6);
    st.progFill.setFillStyle(0xffd166);
    st.pulse = this.tweens.add({
      targets: st.dish, scale: 1.18,
      duration: 280, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    SoundFX.ding();
    this.floatText(st.x, st.y + 46, 'READY!', '#ffd166', 12);
  }

  /* wipe a station back to idle */
  clearStation(st) {
    st.state = 'idle';
    st.cookEnd = 0;
    if (st.pulse) { st.pulse.stop(); st.pulse = null; }
    if (st.sizzle) { st.sizzle.stop(); st.sizzle = null; }
    st.dish.setVisible(false).setScale(1);
    st.progBg.setVisible(false);
    st.progFill.setVisible(false);
    st.ownerTag.setVisible(false);
    st.idleIcon.setVisible(true);
  }

  /* ==========================================================================
     TABLES (4, or 5 with the upgrade)
     ======================================================================== */
  buildTables() {
    const count = State.tableCount;
    for (let i = 0; i < count; i++) this.createTable(TABLE_SPOTS[i]);
  }

  /* built at runtime so the "Extra Table" upgrade can add one mid-shift */
  createTable(spot) {
    const t = { x: spot.x, y: spot.y, occupied: false };

    this.add.rectangle(t.x + 4, t.y + 6, TABLE_W, TABLE_H, 0x000000, 0.28).setDepth(4);
    this.add.rectangle(t.x, t.y - 44, 26, 22, 0x6b4426).setDepth(4);
    this.add.rectangle(t.x, t.y + SEAT_DY, 26, 22, 0x6b4426).setDepth(4);
    this.add.rectangle(t.x, t.y, TABLE_W, TABLE_H, 0x8a5a33).setDepth(8)
      .setStrokeStyle(3, 0x6f4626);
    this.add.rectangle(t.x - 30, t.y, 10, 8, 0xe8eefc).setDepth(9);
    this.add.rectangle(t.x + 30, t.y, 10, 8, 0xe8eefc).setDepth(9);
    this.add.circle(t.x, t.y, 6, 0xffd166, 0.85).setDepth(9);

    this.solid(t.x, t.y, TABLE_W, TABLE_H, 0x8a5a33).setVisible(false);  // collider only

    this.tables.push(t);
    return t;
  }

  /* ==========================================================================
     PLAYER
     ======================================================================== */
  buildPlayer() {
    const px = 400;
    const py = 330;

    this.playerShadow = this.add.ellipse(px, py + 17, 30, 10, 0x000000, 0.3).setDepth(11);
    this.player = this.add.rectangle(px, py, 26, 34, 0x35a2ff).setDepth(30);
    this.player.setStrokeStyle(2, 0x1363b8);
    this.physics.add.existing(this.player);

    const body = this.player.body;
    body.setCollideWorldBounds(true);
    body.setDrag(DRAG, DRAG);
    body.setMaxVelocity(State.walkSpeed, State.walkSpeed);

    this.eyeL = this.add.rectangle(px - 6, py - 7, 5, 7, 0x0d2440).setDepth(31);
    this.eyeR = this.add.rectangle(px + 6, py - 7, 5, 7, 0x0d2440).setDepth(31);
    this.carryText = this.add.text(px, py - 40, '', { fontSize: '24px' })
      .setOrigin(0.5).setDepth(31).setVisible(false);

    this.physics.add.collider(this.player, this.solidGroup);
  }

  /* keep the body limit in sync with the Speed Boost upgrade */
  applySpeedUpgrade() {
    this.player.body.setMaxVelocity(State.walkSpeed, State.walkSpeed);
  }

  /* ==========================================================================
     HUD
     ======================================================================== */
  buildHUD() {
    const D = 2000;
    this.add.rectangle(400, 28, 800, 56, 0x0b1120, 0.94).setDepth(D);
    this.add.rectangle(400, 56, 800, 2, 0xffd166, 0.28).setDepth(D);

    this.add.text(14, 17, 'FOOD EMPIRE', {
      fontFamily: FONT_BOLD, fontSize: '18px', color: '#ffd166',
    }).setOrigin(0, 0.5).setDepth(D);
    this.statLine = this.add.text(15, 38, '', {
      fontFamily: FONT_SOFT, fontSize: '10px', color: '#8fa3c8',
    }).setOrigin(0, 0.5).setDepth(D);

    /* --- hotkey chips (clickable on desktop AND mobile) --- */
    this.chips = {};
    const mkChip = (x, key, label, cb) => {
      const g = this.add.container(x, 28).setDepth(D + 1);
      const bg = this.add.rectangle(0, 0, 76, 30, 0x1a2540)
        .setStrokeStyle(1, 0x33466e).setInteractive({ useHandCursor: true });
      const k = this.add.text(-26, 0, key, {
        fontFamily: FONT_BOLD, fontSize: '12px', color: '#ffd166',
      }).setOrigin(0.5);
      const t = this.add.text(6, 0, label, {
        fontFamily: FONT_SOFT, fontSize: '10px', color: '#cfe0ff',
      }).setOrigin(0.5);
      g.add([bg, k, t]);
      bg.on('pointerdown', (p, lx, ly, ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        SoundFX.unlock();
        cb();
        this.tweens.add({ targets: g, scale: 0.92, duration: 70, yoyo: true });
      });
      return { g, bg, k, t };
    };

    this.chips.hire = mkChip(300, 'H', 'HIRE', () => this.hireNpc());
    this.chips.battle = mkChip(382, 'B', 'ARENA', () => this.enterArena());
    this.chips.menu = mkChip(464, 'U', 'UPGRADE', () => this.toggleMenu());

    /* --- money (top-right) --- */
    this.add.circle(624, 20, 9, 0xffd166).setStrokeStyle(2, 0xf4a936).setDepth(D);
    this.add.text(624, 20, '$', {
      fontFamily: FONT_BOLD, fontSize: '11px', color: '#7c5511',
    }).setOrigin(0.5).setDepth(D);
    this.moneyText = this.add.text(786, 20, '$ 0', {
      fontFamily: FONT_BOLD, fontSize: '19px', color: '#ffd166',
    }).setOrigin(1, 0.5).setDepth(D);

    /* --- reputation bar (top-right) --- */
    this.add.text(640, 41, 'REP', {
      fontFamily: FONT_BOLD, fontSize: '10px', color: '#8fa3c8',
    }).setOrigin(1, 0.5).setDepth(D);
    this.add.rectangle(786, 41, 134, 11, 0x1e2a44).setOrigin(1, 0.5).setDepth(D);
    this.repFill = this.add.rectangle(784, 41, 60, 7, 0x3fce7c)
      .setOrigin(1, 0.5).setDepth(D + 1);

    /* --- toast line (save / info messages) --- */
    this.toast = this.add.text(400, 72, '', {
      fontFamily: FONT_BOLD, fontSize: '13px', color: '#7ee8a2',
      stroke: '#05070d', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(3000).setAlpha(0);
  }

  buildHintBar() {
    this.add.rectangle(400, 568, 500, 28, 0x0b1120, 0.88).setDepth(2100)
      .setStrokeStyle(1, 0x2c3c5f);
    this.hintText = this.add.text(400, 568, '', {
      fontFamily: FONT_SOFT, fontSize: '13px', color: '#cfe0ff',
    }).setOrigin(0.5).setDepth(2101);
  }

  /* ==========================================================================
     INPUT
     ======================================================================== */
  setupKeys() {
    this.keys = this.input.keyboard.addKeys({ up: 'W', left: 'A', down: 'S', right: 'D' });
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyH = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H);
    this.keyB = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.keyU = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.U);
    this.keyX = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.input.keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
  }

  buildTouchControls() {
    if (!this.sys.game.device.input.touch) return;
    this.input.addPointer(2);

    const CX = 110, CY = 486;

    this.add.circle(CX, CY, 58, 0x1d2a44, 0.55).setDepth(2500).setStrokeStyle(2, 0x2c3c5f);
    this.stick = this.add.circle(CX, CY, 26, 0xffd166, 0.9).setDepth(2501);

    const zone = this.add.zone(CX, CY, 250, 250).setInteractive().setDepth(2499);
    this.joyActive = false;
    this.joyId = null;

    const applyStick = (p) => {
      const dx = p.x - CX, dy = p.y - CY;
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(len, 38);
      this.stick.setPosition(CX + (dx / len) * cl, CY + (dy / len) * cl);
      this.joyVec.x = (dx / len) * Math.min(1, len / 38);
      this.joyVec.y = (dy / len) * Math.min(1, len / 38);
    };
    const releaseStick = () => {
      this.joyActive = false;
      this.joyId = null;
      this.joyVec.x = 0;
      this.joyVec.y = 0;
      this.stick.setPosition(CX, CY);
    };

    zone.on('pointerdown', (p) => { this.joyActive = true; this.joyId = p.id; applyStick(p); });
    this.input.on('pointermove', (p) => { if (this.joyActive && p.id === this.joyId) applyStick(p); });
    this.input.on('pointerup', (p) => { if (p.id === this.joyId) releaseStick(); });
    this.input.on('pointerupoutside', (p) => { if (p.id === this.joyId) releaseStick(); });

    const btn = this.add.circle(698, 486, 42, 0xffd166, 0.95).setDepth(2500)
      .setStrokeStyle(3, 0xf4a936).setInteractive({ useHandCursor: true });
    this.add.text(698, 482, 'E', {
      fontFamily: FONT_BOLD, fontSize: '24px', color: '#7c5511',
    }).setOrigin(0.5).setDepth(2501);
    this.add.text(698, 506, 'ACTION', {
      fontFamily: FONT_SOFT, fontSize: '8px', color: '#7c5511',
    }).setOrigin(0.5).setDepth(2501);
    btn.on('pointerdown', () => {
      this.queuedAction = true;
      this.tweens.add({ targets: btn, scale: 0.88, duration: 70, yoyo: true });
    });
  }

  buildAmbience() {
    for (let i = 0; i < 9; i++) {
      const m = this.add.rectangle(
        Phaser.Math.Between(40, 760), Phaser.Math.Between(180, 560),
        Phaser.Math.Between(2, 4), Phaser.Math.Between(2, 4), 0xffd166, 0.1,
      ).setDepth(3);
      this.tweens.add({
        targets: m,
        x: m.x + Phaser.Math.Between(-50, 50),
        y: m.y + Phaser.Math.Between(-40, 40),
        alpha: 0.02,
        duration: Phaser.Math.Between(4000, 8000),
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
  }

  /* ==========================================================================
     MAIN UPDATE
     ======================================================================== */
  update(time, delta) {
    const now = this.time.now;   // scene clock (freezes while the arena runs)

    /* ---------- game over: only restart input ---------- */
    if (this.isGameOver) {
      if (this.restartArmed &&
         (Phaser.Input.Keyboard.JustDown(this.keyR) || this.queuedAction)) {
        this.hardRestart();
      }
      this.queuedAction = false;
      return;
    }

    /* ---------- global hotkeys (work even with the menu open) ---------- */
    if (Phaser.Input.Keyboard.JustDown(this.keyU)) this.toggleMenu();
    if (this.menuOpen && Phaser.Input.Keyboard.JustDown(this.keyX)) this.closeMenu();
    if (!this.menuOpen) {
      if (Phaser.Input.Keyboard.JustDown(this.keyH)) this.hireNpc();
      if (Phaser.Input.Keyboard.JustDown(this.keyB)) this.enterArena();
    }

    /* ---------- stations finish cooking (time-based, pause safe) ---------- */
    for (const st of this.stations) {
      if (st.state === 'cooking') {
        const pct = Phaser.Math.Clamp(1 - (st.cookEnd - now) / State.cookMs, 0, 1);
        st.progFill.displayWidth = Math.max(2, 82 * pct);
        if (now >= st.cookEnd) this.markStationReady(st);
      }
    }

    /* ---------- steam puffs ---------- */
    this.steamAcc += delta;
    if (this.steamAcc > 240) {
      this.steamAcc = 0;
      for (const st of this.stations) if (st.state === 'cooking') this.spawnSteam(st);
    }

    /* ---------- station demand badges ---------- */
    this.badgeAcc += delta;
    if (this.badgeAcc > 400) { this.badgeAcc = 0; this.refreshStationBadges(); }

    /* ---------- the upgrade menu freezes the shift ---------- */
    if (this.menuOpen) {
      this.player.body.setAcceleration(0, 0);
      this.player.body.setVelocity(0, 0);
      this.syncPlayerParts(time);
      this.queuedAction = false;
      return;
    }

    /* ---------- movement (WASD + arrows + joystick) ---------- */
    let vx = 0, vy = 0;
    if (this.keys.left.isDown || this.cursors.left.isDown) vx -= 1;
    if (this.keys.right.isDown || this.cursors.right.isDown) vx += 1;
    if (this.keys.up.isDown || this.cursors.up.isDown) vy -= 1;
    if (this.keys.down.isDown || this.cursors.down.isDown) vy += 1;
    vx += this.joyVec.x;
    vy += this.joyVec.y;

    const mag = Math.hypot(vx, vy);
    if (mag > 0.15) {
      if (mag > 1) { vx /= mag; vy /= mag; }
      this.player.body.setAcceleration(vx * ACCEL, vy * ACCEL);
    } else {
      this.player.body.setAcceleration(0, 0);
    }
    this.syncPlayerParts(time);

    /* ---------- interact ---------- */
    if (Phaser.Input.Keyboard.JustDown(this.keyE) ||
        Phaser.Input.Keyboard.JustDown(this.keySpace) ||
        this.queuedAction) {
      this.queuedAction = false;
      this.tryInteract();
    }

    /* ---------- NPC worker ---------- */
    if (this.npc) this.npc.update(delta);

    /* ---------- customer patience ---------- */
    for (const c of [...this.customers]) {
      if (c.state !== 'waiting') continue;
      c.patience -= delta;
      const pct = Math.max(0, c.patience / c.patienceMax);
      c.pfg.displayWidth = Math.max(0.01, 36 * pct);
      c.pfg.setFillStyle(pct > 0.5 ? 0x3fce7c : pct > 0.25 ? 0xffb84d : 0xff5a5a);
      if (c.patience <= 0) this.walkout(c);
    }

    this.refreshHint(now);
  }

  /* shadow / eyes / carried plate follow the player */
  syncPlayerParts(time) {
    this.playerShadow.setPosition(this.player.x, this.player.y + 17);
    this.eyeL.setPosition(this.player.x - 6, this.player.y - 7);
    this.eyeR.setPosition(this.player.x + 6, this.player.y - 7);
    const bob = Math.sin(time / 170) * 2.5;
    this.carryText.setPosition(this.player.x, this.player.y - 42 + bob);
  }

  /* ==========================================================================
     INTERACTION
     ======================================================================== */
  distTo(x, y) {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y);
  }

  nearCustomer() {
    let best = null, bestD = RANGE_SERVE;
    for (const c of this.customers) {
      if (c.state !== 'waiting') continue;
      const d = this.distTo(c.container.x, c.container.y);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  nearStation() {
    let best = null, bestD = RANGE_STATION;
    for (const st of this.stations) {
      const d = this.distTo(st.x, st.y + 28);
      if (d < bestD) { best = st; bestD = d; }
    }
    return best;
  }

  /* context-sensitive E: guest → station → bin */
  tryInteract() {
    const guest = this.nearCustomer();

    /* --- serve --- */
    if (guest) {
      if (!this.carrying) {
        this.nudge(guest);
        SoundFX.click();
        this.flashHint(`They ordered ${guest.order.emoji} ${guest.order.name} — cook it first!`);
        return;
      }
      if (this.carrying.key === guest.order.key) {
        this.serveCustomer(guest, 'player');
        return;
      }
      this.nudge(guest);
      guest.patience = Math.max(600, guest.patience - 2500);
      SoundFX.buzz();
      this.flashHint(`Wrong dish! They ordered ${guest.order.emoji} ${guest.order.name}.`);
      return;
    }

    /* --- station --- */
    const st = this.nearStation();
    if (st) {
      if (st.owner === 'npc') {
        SoundFX.click();
        this.flashHint('Ana is working this station — use another one!');
        return;
      }
      if (st.state === 'cooking') {
        SoundFX.click();
        this.flashHint('Still cooking… grab it when the bar fills!');
        return;
      }
      if (st.state === 'ready') { this.pickUpDish(st); return; }
      this.startCooking(st);
      return;
    }

    /* --- bin --- */
    if (this.distTo(BIN.x, BIN.y + 26) < RANGE_BIN) {
      if (this.carrying) { this.tossDish(); return; }
      SoundFX.click();
      this.flashHint('Nothing to toss — the bin only takes carried dishes.');
      return;
    }

    this.flashHint('Stand at a station or a waiting guest, then press E.');
  }

  startCooking(st) {
    st.state = 'cooking';
    st.owner = 'player';
    st.cookEnd = this.time.now + State.cookMs;
    this.showStationCooking(st);
    SoundFX.pop();
    this.flashHint(`Cooking ${st.food.emoji} ${st.food.name}… ${(State.cookMs / 1000).toFixed(1)}s`);
  }

  pickUpDish(st) {
    if (this.carrying) {
      SoundFX.buzz();
      this.flashHint('Hands full — serve it or toss it in the bin first!');
      return;
    }
    this.carrying = st.food;
    this.clearStation(st);
    st.owner = null;

    this.carryText.setText(this.carrying.emoji).setVisible(true).setScale(0.2);
    this.tweens.add({ targets: this.carryText, scale: 1, duration: 220, ease: 'Back.easeOut' });
    SoundFX.pop();
    this.flashHint(`Picked up ${this.carrying.emoji} ${this.carrying.name} — deliver it hot!`);
  }

  tossDish() {
    const dish = this.carrying;
    this.carrying = null;
    this.carryText.setVisible(false);
    SoundFX.thud();
    this.burst(BIN.x, BIN.y - 6, 0x9aa7bd);
    this.flashHint(`Tossed the ${dish.emoji} ${dish.name}.`);
  }

  /* ---- shared by the player AND the NPC worker ---- */
  serveCustomer(guest, by = 'player') {
    if (!guest || guest.state !== 'waiting') return;
    guest.state = 'served';
    guest.npcClaim = false;

    const tip = Math.ceil(State.tipMax * (guest.patience / guest.patienceMax));
    const pay = guest.order.price + tip;
    State.money += pay;
    State.served += 1;
    State.rep = Math.min(REP_MAX, State.rep + REP_SERVE);

    if (by === 'player') {
      this.carrying = null;
      this.carryText.setVisible(false);
    }

    guest.pbg.setVisible(false);
    guest.pfg.setVisible(false);
    guest.icon.setText('★').setColor('#f4a936');
    this.tweens.add({ targets: guest.icon, scale: 1.5, duration: 180, yoyo: true, ease: 'Back.easeOut' });

    this.floatText(guest.container.x, guest.container.y - 52, `+$${pay}`, '#ffd166', 19);
    if (tip > 0) this.floatText(guest.container.x, guest.container.y - 34, `tip +$${tip}`, '#3fce7c', 11);
    if (by === 'npc') this.floatText(guest.container.x, guest.container.y - 16, 'served by ANA', '#c7b2f5', 10);
    this.burst(guest.container.x, guest.container.y - 20, 0xffd166);

    SoundFX.cash();
    this.updateHUD(true);
    this.refreshStationBadges();
    this.time.delayedCall(700, () => this.dismiss(guest));
  }

  walkout(guest) {
    if (guest.state !== 'waiting') return;
    guest.state = 'leaving';
    guest.npcClaim = false;

    State.rep = Math.max(0, State.rep - REP_WALKOUT);
    guest.pbg.setVisible(false);
    guest.pfg.setVisible(false);
    guest.icon.setText('✕').setColor('#e05252');

    this.nudge(guest);
    this.floatText(guest.container.x, guest.container.y - 52, 'too slow…', '#ff5a5a', 13);
    this.floatText(700, 62, `-${REP_WALKOUT} REP`, '#ff5a5a', 12);

    SoundFX.buzz();
    this.updateHUD();
    this.refreshStationBadges();

    this.time.delayedCall(500, () => this.dismiss(guest));
    if (State.rep <= 0) this.time.delayedCall(900, () => this.closeDown());
  }

  /* ==========================================================================
     CUSTOMERS
     ======================================================================== */
  trySpawn() {
    if (this.isGameOver || this.menuOpen || this.inArena) return;
    if (this.time.now < this.nextSpawnAt) return;

    const free = this.tables.filter((t) => !t.occupied);
    if (free.length === 0 || this.customers.length >= this.tables.length) return;

    const table = Phaser.Utils.Array.GetRandom(free);
    table.occupied = true;

    const order = Phaser.Utils.Array.GetRandom(FOODS);
    const tint = Phaser.Utils.Array.GetRandom(CUSTOMER_TINTS);
    const seatY = table.y + SEAT_DY;

    const cont = this.add.container(DOOR.x, DOOR.y).setDepth(20);
    const shadow = this.add.ellipse(0, 17, 28, 10, 0x000000, 0.25);
    const bodyR = this.add.rectangle(0, 0, 26, 34, tint).setStrokeStyle(2, 0x8f2f2f);
    const eyeL = this.add.rectangle(-5, -7, 4, 6, 0x1c1430);
    const eyeR = this.add.rectangle(5, -7, 4, 6, 0x1c1430);
    const apron = this.add.rectangle(0, 7, 15, 10, 0xffffff, 0.16);

    const ring = this.add.circle(0, -36, 18, 0xffffff).setStrokeStyle(2, 0x1d2a44);
    const tail = this.add.rectangle(0, -18, 9, 9, 0xffffff).setAngle(45).setStrokeStyle(2, 0x1d2a44);
    const icon = this.add.text(0, -36, order.emoji, { fontSize: '21px' }).setOrigin(0.5);
    const pbg = this.add.rectangle(0, -60, 40, 6, 0x10182b);
    const pfg = this.add.rectangle(-18, -60, 36, 4, 0x3fce7c).setOrigin(0, 0.5);

    cont.add([shadow, bodyR, eyeL, eyeR, apron, ring, tail, icon, pbg, pfg]);
    [ring, tail, icon, pbg, pfg].forEach((o) => o.setVisible(false));

    const guest = {
      container: cont, ring, tail, icon, pbg, pfg,
      table, order,
      state: 'arriving',
      patience: State.patienceMs,
      patienceMax: State.patienceMs,
      npcClaim: false,
      freed: false,
      pathIdx: 0,
      onArrive: null,
    };

    guest.bubbleBob = this.tweens.add({
      targets: [ring, tail, icon, pbg, pfg],
      y: '-=3', duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    this.customers.push(guest);
    SoundFX.bell();

    guest.path = [
      { x: AISLE_X, y: DOOR.y },
      { x: AISLE_X, y: seatY },
      { x: table.x, y: seatY },
    ];
    this.startWobble(guest);
    this.walkStep(guest);

    this.nextSpawnAt = this.time.now + 4000 + Math.random() * 3000;
  }

  walkStep(guest) {
    const target = guest.path[guest.pathIdx];
    if (!target) {
      if (guest.onArrive) guest.onArrive();
      else this.seatGuest(guest);
      return;
    }
    const d = Phaser.Math.Distance.Between(guest.container.x, guest.container.y, target.x, target.y);
    this.tweens.add({
      targets: guest.container,
      x: target.x, y: target.y,
      duration: Math.max(220, (d / CUST_SPEED) * 1000),
      ease: 'Sine.easeInOut',
      onComplete: () => { guest.pathIdx += 1; this.walkStep(guest); },
    });
  }

  seatGuest(guest) {
    if (guest.state !== 'arriving') return;
    guest.state = 'waiting';
    this.stopWobble(guest);
    [guest.ring, guest.tail, guest.icon, guest.pbg, guest.pfg].forEach((o) => o.setVisible(true));
    guest.icon.setScale(0.2);
    this.tweens.add({ targets: guest.icon, scale: 1, duration: 260, ease: 'Back.easeOut' });
    guest.pfg.displayWidth = 36;
    SoundFX.pop();
    this.refreshStationBadges();
  }

  dismiss(guest) {
    if (!guest.freed) { guest.freed = true; guest.table.occupied = false; }
    guest.state = 'leaving';
    guest.npcClaim = false;
    guest.pathIdx = 0;
    guest.onArrive = () => this.despawn(guest);
    [guest.ring, guest.tail, guest.icon, guest.pbg, guest.pfg].forEach((o) => o.setVisible(false));
    if (guest.bubbleBob) guest.bubbleBob.stop();
    this.startWobble(guest);
    guest.path = [
      { x: AISLE_X, y: guest.container.y },
      { x: AISLE_X, y: DOOR.y },
      { x: DOOR.x, y: DOOR.y },
    ];
    this.walkStep(guest);
    this.refreshStationBadges();
  }

  despawn(guest) {
    const i = this.customers.indexOf(guest);
    if (i >= 0) this.customers.splice(i, 1);
    this.tweens.add({
      targets: guest.container, alpha: 0, duration: 240,
      onComplete: () => guest.container.destroy(true),
    });
  }

  startWobble(guest) {
    guest.container.setAngle(-3);
    guest.wobble = this.tweens.add({
      targets: guest.container, angle: 3,
      duration: 150, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  stopWobble(guest) {
    if (guest.wobble) guest.wobble.stop();
    this.tweens.add({ targets: guest.container, angle: 0, duration: 120 });
  }

  /* ==========================================================================
     FEATURE 1 — HIRE THE NPC WORKER
     ======================================================================== */
  hireNpc() {
    if (this.isGameOver) return;

    if (State.npcHired) {
      SoundFX.click();
      this.flashHint('Ana already works here — she is on the floor!');
      return;
    }
    if (State.money < NPC_COST) {
      SoundFX.buzz();
      this.flashHint(`Hiring costs $${NPC_COST} — you have $${State.money}.`);
      return;
    }

    State.money -= NPC_COST;
    State.npcHired = true;
    State.save();

    this.npc = new NpcWorker(this);
    this.updateHUD(true);
    this.refreshHudChips();
    SoundFX.hire();

    /* big "NPC HIRED" banner (per spec) */
    const banner = this.add.text(400, 300, 'NPC HIRED!', {
      fontFamily: FONT_BOLD, fontSize: '46px', color: '#c7b2f5',
      stroke: '#05070d', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(3200).setScale(0.4);
    const sub = this.add.text(400, 346, 'ANA joined the kitchen — she cooks and serves on her own', {
      fontFamily: FONT_SOFT, fontSize: '14px', color: '#eaf1ff',
      stroke: '#05070d', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(3200).setAlpha(0);

    this.tweens.add({ targets: banner, scale: 1, duration: 420, ease: 'Back.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 300, delay: 220 });
    this.tweens.add({
      targets: [banner, sub], alpha: 0, y: '-=26',
      delay: 1700, duration: 520,
      onComplete: () => { banner.destroy(); sub.destroy(); },
    });
  }

  /* ==========================================================================
     FEATURE 2 — ENTER THE ARENA
     ======================================================================== */
  enterArena() {
    if (this.isGameOver || this.inArena || this.menuOpen) return;
    this.inArena = true;

    /* drop held keys / joystick so nothing sticks while paused */
    this.input.keyboard.resetKeys();
    this.joyVec.x = 0;
    this.joyVec.y = 0;
    this.queuedAction = false;
    this.player.body.setVelocity(0, 0);
    this.player.body.setAcceleration(0, 0);

    SoundFX.fanfare();
    this.scene.pause();
    this.scene.launch('arena');
  }

  /* called when the arena hands control back */
  onResume(sys, data) {
    this.inArena = false;
    this.queuedAction = false;
    this.joyVec.x = 0;
    this.joyVec.y = 0;
    if (this.input.keyboard) this.input.keyboard.resetKeys();
    this.applySpeedUpgrade();
    this.updateHUD(true);
    this.refreshHudChips();

    const r = data && data.arena;
    if (!r) return;

    const title = r.forfeit ? 'BATTLE FORFEITED'
      : r.win ? 'ARENA VICTORY!' : 'ARENA DEFEAT';
    const color = r.win ? '#ffd166' : '#ff9d9d';
    const lines = [];
    if (r.cash) lines.push(`+$${r.cash}`);
    if (r.rep) lines.push(`+${r.rep} REP`);
    if (r.secret) lines.push(`🔮 ${r.secret} unlocked`);

    const banner = this.add.text(400, 290, title, {
      fontFamily: FONT_BOLD, fontSize: '32px', color,
      stroke: '#05070d', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(3200).setScale(0.5);
    const sub = this.add.text(400, 330, lines.join('   ·   ') || 'Back to the restaurant', {
      fontFamily: FONT_SOFT, fontSize: '14px', color: '#eaf1ff',
      stroke: '#05070d', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(3200);

    this.tweens.add({ targets: banner, scale: 1, duration: 380, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: [banner, sub], alpha: 0, y: '-=24',
      delay: 1600, duration: 520,
      onComplete: () => { banner.destroy(); sub.destroy(); },
    });
  }

  /* ==========================================================================
     FEATURE 3 — UPGRADE MENU
     ======================================================================== */
  toggleMenu() {
    if (this.isGameOver || this.inArena) return;
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

  openMenu() {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.resetArmed = false;
    SoundFX.click();
    this.buildMenu();
  }

  closeMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.resetArmed = false;
    SoundFX.click();
    if (this.menuLayer) { this.menuLayer.destroy(true); this.menuLayer = null; }
    if (this.input.keyboard) this.input.keyboard.resetKeys();
  }

  refreshMenu() {
    if (!this.menuOpen) return;
    if (this.menuLayer) { this.menuLayer.destroy(true); this.menuLayer = null; }
    this.buildMenu();
  }

  buildMenu() {
    const L = this.add.container(0, 0).setDepth(5000);
    this.menuLayer = L;

    /* dark overlay that also swallows clicks on the world below */
    const veil = this.add.rectangle(400, 300, 800, 600, 0x05070d, 0.9).setInteractive();
    const panel = this.add.rectangle(400, 300, 620, 470, 0x111a2c).setStrokeStyle(2, 0x33466e);
    const head = this.add.rectangle(400, 96, 620, 62, 0x18233c);

    const title = this.add.text(112, 84, 'UPGRADES', {
      fontFamily: FONT_BOLD, fontSize: '24px', color: '#ffd166',
    }).setOrigin(0, 0.5);
    const cash = this.add.text(688, 84, `$ ${State.money}`, {
      fontFamily: FONT_BOLD, fontSize: '22px', color: '#7ee8a2',
    }).setOrigin(1, 0.5);
    const sub = this.add.text(112, 108, 'Permanent boosts — saved automatically', {
      fontFamily: FONT_SOFT, fontSize: '11px', color: '#8fa3c8',
    }).setOrigin(0, 0.5);

    L.add([veil, panel, head, title, cash, sub]);

    /* ---- close button ---- */
    const xBtn = this.add.rectangle(688, 112, 30, 30, 0x2a3550)
      .setStrokeStyle(1, 0x4a5c86).setInteractive({ useHandCursor: true });
    const xTxt = this.add.text(688, 112, '✕', {
      fontFamily: FONT_BOLD, fontSize: '14px', color: '#ffb3b3',
    }).setOrigin(0.5);
    xBtn.on('pointerdown', () => this.closeMenu());
    L.add([xBtn, xTxt]);

    /* ---- one row per upgrade ---- */
    UPGRADES.forEach((up, i) => {
      const y = 168 + i * 72;
      const owned = State.upgrades[up.id];
      const canAfford = State.money >= up.cost;

      const row = this.add.rectangle(400, y, 560, 62, owned ? 0x14301f : 0x18233c)
        .setStrokeStyle(1, owned ? 0x2f7a4e : 0x2c3c5f);
      const icon = this.add.text(148, y, up.emoji, { fontSize: '24px' }).setOrigin(0.5);
      const name = this.add.text(180, y - 11, up.name, {
        fontFamily: FONT_BOLD, fontSize: '15px', color: '#eaf1ff',
      }).setOrigin(0, 0.5);
      const desc = this.add.text(180, y + 10, up.desc, {
        fontFamily: FONT_SOFT, fontSize: '11px', color: '#8fa3c8',
      }).setOrigin(0, 0.5);
      L.add([row, icon, name, desc]);

      if (owned) {
        const tag = this.add.rectangle(596, y, 104, 34, 0x1f7a45).setStrokeStyle(1, 0x3fce7c);
        const tagT = this.add.text(596, y, 'OWNED', {
          fontFamily: FONT_BOLD, fontSize: '13px', color: '#d7ffe8',
        }).setOrigin(0.5);
        L.add([tag, tagT]);
      } else {
        const btn = this.add.rectangle(596, y, 104, 34, canAfford ? 0xffd166 : 0x2a3550)
          .setStrokeStyle(1, canAfford ? 0xf4a936 : 0x4a5c86)
          .setInteractive({ useHandCursor: true });
        const btnT = this.add.text(596, y, `$${up.cost}`, {
          fontFamily: FONT_BOLD, fontSize: '14px',
          color: canAfford ? '#5d3d06' : '#8fa3c8',
        }).setOrigin(0.5);
        btn.on('pointerdown', () => this.buyUpgrade(up));
        L.add([btn, btnT]);
      }
    });

    /* ---- reset save (with confirmation) ---- */
    const rBtn = this.add.rectangle(400, 468, 250, 38,
      this.resetArmed ? 0x7a1f1f : 0x2a3550)
      .setStrokeStyle(1, this.resetArmed ? 0xff5a5a : 0x4a5c86)
      .setInteractive({ useHandCursor: true });
    const rTxt = this.add.text(400, 468,
      this.resetArmed ? 'CLICK AGAIN TO CONFIRM' : '⟲ RESET SAVE', {
        fontFamily: FONT_BOLD, fontSize: '13px',
        color: this.resetArmed ? '#ffd9d9' : '#cfe0ff',
      }).setOrigin(0.5);
    rBtn.on('pointerdown', () => this.onResetClicked());
    L.add([rBtn, rTxt]);

    const foot = this.add.text(400, 508, 'Press U or X to close', {
      fontFamily: FONT_SOFT, fontSize: '12px', color: '#8fa3c8',
    }).setOrigin(0.5);
    L.add(foot);
  }

  buyUpgrade(up) {
    if (State.upgrades[up.id]) return;
    if (State.money < up.cost) {
      SoundFX.buzz();
      this.showToast(`Not enough cash for ${up.name}`, '#ff9d9d');
      return;
    }

    State.money -= up.cost;
    State.upgrades[up.id] = true;
    State.save();
    SoundFX.buy();

    /* apply the effect immediately */
    if (up.id === 'speed') this.applySpeedUpgrade();
    if (up.id === 'extraTable' && this.tables.length < 5) this.createTable(TABLE_SPOTS[4]);
    if (up.id === 'patience') {
      /* running guests get the longer fuse too */
      for (const c of this.customers) {
        if (c.state === 'waiting' || c.state === 'arriving') {
          const ratio = c.patience / c.patienceMax;
          c.patienceMax = State.patienceMs;
          c.patience = c.patienceMax * ratio;
        }
      }
    }

    this.updateHUD(true);
    this.showToast(`${up.emoji} ${up.name} purchased!`, '#7ee8a2');
    this.refreshMenu();
  }

  onResetClicked() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      SoundFX.buzz();
      this.refreshMenu();
      /* disarm after 4 s so it can never fire accidentally */
      this.time.delayedCall(4000, () => {
        if (this.resetArmed) { this.resetArmed = false; this.refreshMenu(); }
      });
      return;
    }
    /* confirmed */
    State.wipe();
    SoundFX.lose();
    this.closeMenu();
    this.hardRestart(true);
  }

  /* ==========================================================================
     FEATURE 4 — SAVE / LOAD HELPERS
     ======================================================================== */
  autoSave() {
    if (this.isGameOver || this.inArena) return;
    if (State.save()) this.showToast('💾 Game Saved', '#7ee8a2');
  }

  showToast(msg, color = '#7ee8a2') {
    this.toast.setText(msg).setColor(color).setAlpha(1).setY(72).setScale(0.9);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.toast, alpha: 0, y: 62, delay: 1500, duration: 500 });
  }

  /* full restart (after game over or a save wipe) */
  hardRestart(fromReset = false) {
    if (!fromReset) {
      State.rep = REP_START;     // reputation resets, the empire's cash stays
      State.save();
    }
    this.scene.restart();
  }

  /* ==========================================================================
     UI HELPERS & JUICE
     ======================================================================== */
  refreshStationBadges() {
    const counts = {};
    for (const c of this.customers) {
      if (c.state !== 'waiting') continue;
      counts[c.order.key] = (counts[c.order.key] || 0) + 1;
    }
    for (const st of this.stations) {
      const n = counts[st.food.key] || 0;
      st.badge.setVisible(n > 0);
      st.badgeText.setVisible(n > 0).setText(String(n));
    }
  }

  updateHUD(popMoney = false) {
    this.moneyText.setText(`$ ${State.money}`);
    const pct = State.rep / REP_MAX;
    this.repFill.displayWidth = Math.max(2, 130 * pct);
    this.repFill.setFillStyle(pct > 0.5 ? 0x3fce7c : pct > 0.25 ? 0xffb84d : 0xff5a5a);

    this.statLine.setText(
      `served ${State.served}  ·  🏆 ${State.arenaWins}  ·  🔮 ${State.secrets.length}` +
      (State.npcHired ? '  ·  👩‍🍳 ANA' : ''),
    );

    if (popMoney) {
      this.moneyText.setScale(1.22);
      this.tweens.add({ targets: this.moneyText, scale: 1, duration: 220, ease: 'Back.easeOut' });
    }
    this.refreshHudChips();
  }

  refreshHudChips() {
    if (!this.chips) return;
    const hired = State.npcHired;
    this.chips.hire.t.setText(hired ? 'HIRED' : 'HIRE');
    this.chips.hire.t.setColor(hired ? '#c7b2f5' : (State.money >= NPC_COST ? '#7ee8a2' : '#cfe0ff'));
  }

  floatText(x, y, str, color, size = 14) {
    const t = this.add.text(x, y, str, {
      fontFamily: FONT_BOLD, fontSize: `${size}px`, color,
      stroke: '#0b101c', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(2200).setScale(0.7);
    this.tweens.add({
      targets: t, y: y - 38, alpha: 0, scale: 1,
      duration: 950, ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  spawnSteam(st) {
    const s = this.add.rectangle(
      st.x + Phaser.Math.Between(-22, 22), st.y - 18, 5, 5, 0xffffff, 0.5,
    ).setDepth(15);
    this.tweens.add({
      targets: s, y: s.y - 28, alpha: 0, scale: 0.4,
      duration: 700, ease: 'Sine.easeOut',
      onComplete: () => s.destroy(),
    });
  }

  burst(x, y, color) {
    for (let i = 0; i < 5; i++) {
      const p = this.add.rectangle(x, y, 5, 5, color).setDepth(21);
      const a = Math.random() * Math.PI * 2;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * 26, y: y + Math.sin(a) * 26,
        alpha: 0, angle: Phaser.Math.Between(-180, 180),
        duration: 420, ease: 'Cubic.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  nudge(guest) {
    const cx = guest.container.x;
    this.tweens.add({
      targets: guest.container, x: cx + 5,
      duration: 55, yoyo: true, repeat: 3,
      onComplete: () => guest.container.setX(cx),
    });
  }

  flashHint(msg, ms = 2600) {
    this.hintOverride = msg;
    this.hintOverrideUntil = this.time.now + ms;
  }

  refreshHint(now) {
    let msg;
    if (this.hintOverride && now < this.hintOverrideUntil) {
      msg = `· ${this.hintOverride} ·`;
    } else {
      this.hintOverride = null;
      msg = this.contextHint();
    }
    if (msg !== this.hintLast) {
      this.hintLast = msg;
      this.hintText.setText(msg);
    }
  }

  contextHint() {
    const guest = this.nearCustomer();
    if (guest) {
      if (!this.carrying) return `Guest wants ${guest.order.emoji} ${guest.order.name} — cook it, then press E`;
      return this.carrying.key === guest.order.key
        ? `Press E — serve ${guest.order.emoji} ${guest.order.name} (+$${guest.order.price})`
        : `Wrong dish in hand — they ordered ${guest.order.emoji}`;
    }
    const st = this.nearStation();
    if (st) {
      if (st.owner === 'npc') return `${st.food.emoji} station — ANA is using this one`;
      if (st.state === 'cooking') {
        const left = Math.max(0, st.cookEnd - this.time.now);
        return `Cooking ${st.food.emoji}… ${(left / 1000).toFixed(1)}s left`;
      }
      if (st.state === 'ready') {
        return this.carrying
          ? 'Hands full — serve it or toss it in the bin'
          : `Press E — pick up the ${st.food.emoji} ${st.food.name}`;
      }
      return `Press E — cook ${st.food.emoji} ${st.food.name} ($${st.food.price})`;
    }
    if (this.distTo(BIN.x, BIN.y + 26) < RANGE_BIN) {
      return this.carrying ? `Press E — toss the ${this.carrying.emoji}` : 'Trash bin';
    }
    if (this.carrying) return `Carrying ${this.carrying.emoji} ${this.carrying.name} — find its order bubble`;
    return 'H hire cook  ·  B arena battle  ·  U upgrades  ·  E interact';
  }

  /* ==========================================================================
     GAME OVER
     ======================================================================== */
  closeDown() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.closeMenu();
    this.player.body.setAcceleration(0, 0);
    this.player.body.setVelocity(0, 0);
    State.rep = 0;
    State.save();
    SoundFX.lose();

    const D = 4000;
    this.add.rectangle(400, 300, 800, 600, 0x05070d, 0.88).setDepth(D);
    this.add.text(400, 208, 'SHIFT OVER', {
      fontFamily: FONT_BOLD, fontSize: '44px', color: '#ff5a5a',
      stroke: '#0b101c', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(D + 1);
    this.add.text(400, 262, 'Reputation hit zero — the diner locked its doors.', {
      fontFamily: FONT_SOFT, fontSize: '15px', color: '#8fa3c8',
    }).setOrigin(0.5).setDepth(D + 1);
    this.add.text(400, 304, `Guests served: ${State.served}    ·    Bank: $ ${State.money}`, {
      fontFamily: FONT_BOLD, fontSize: '17px', color: '#ffd166',
    }).setOrigin(0.5).setDepth(D + 1);
    this.add.text(400, 338, 'Your cash, upgrades and staff are saved.', {
      fontFamily: FONT_SOFT, fontSize: '12px', color: '#7ee8a2',
    }).setOrigin(0.5).setDepth(D + 1);

    const again = this.add.text(400, 400, 'Tap the screen or press  R  to reopen', {
      fontFamily: FONT_SOFT, fontSize: '15px', color: '#eaf1ff',
    }).setOrigin(0.5).setDepth(D + 1);
    this.tweens.add({ targets: again, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });

    this.time.delayedCall(700, () => {
      this.restartArmed = true;
      this.input.once('pointerdown', () => this.hardRestart());
    });
  }
}

/* ============================================================================
   6) ARENA SCENE (Feature 2)
   ----------------------------------------------------------------------------
   60-second split-screen cook-off. Both chefs cook the SAME dish.
   Player mashes E / SPACE / TAP to prep; keeping the heat gauge inside the
   green zone scores "perfect" hits. Overheating burns the plate.
   A judge panel then scores Taste 30 · Presentation 20 · Speed 20 ·
   Creativity 15 · Hygiene 15 for both chefs.
   ========================================================================== */

const BATTLE_MS = 60000;
const HEAT_PER_HIT = 9;       // heat added per press
const HEAT_DECAY = 16;        // heat lost per second (press ~1.8/s to hold steady)
const ZONE_LO = 40;           // generous "perfect" window so the skill is
const ZONE_HI = 82;           // modulating your rhythm, not frame-perfect timing
const HEAT_START = 48;        // chefs walk in with the pan already warm
const PREP_PER_HIT = 8;
const PREP_PERFECT_BONUS = 5;
const SPEED_TARGET = 12;      // plates needed for full speed marks

class ArenaScene extends Phaser.Scene {
  constructor() {
    super('arena');
  }

  create() {
    this.phase = 'intro';
    this.introT = 2200;
    this.remaining = BATTLE_MS;
    this.finished = false;

    /* dish of the day */
    this.dish = Phaser.Utils.Array.GetRandom(FOODS);

    /* player battle stats */
    this.me = {
      prep: 0, heat: HEAT_START, hits: 0, perfect: 0,
      dishes: 0, burns: 0, streak: 0, best: 0, flair: 0,
    };

    /* rival AI — gets slightly tougher the more battles you win */
    const skill = Phaser.Math.Clamp(0.5 + State.arenaWins * 0.06, 0.5, 0.86);
    this.rival = {
      skill, prep: 0, interval: 0, timer: 0,
      hits: 0, perfect: 0, dishes: 0, burns: 0, best: 0, flair: 0,
    };
    this.rollRivalInterval();

    this.buildBackground();
    this.buildBattleUI();
    this.buildIntro();
    this.bindInput();

    State.arenaBattles += 1;
  }

  /* ---------- static background ---------- */
  buildBackground() {
    this.add.rectangle(400, 300, 800, 600, 0x070b14);
    this.add.rectangle(200, 330, 396, 460, 0x101a2e);          // player side
    this.add.rectangle(600, 330, 396, 460, 0x2a1220);          // rival side
    this.add.rectangle(400, 330, 4, 460, 0xffd166, 0.45);      // divider

    /* crowd dots for atmosphere */
    for (let i = 0; i < 26; i++) {
      const c = this.add.circle(
        Phaser.Math.Between(20, 780), Phaser.Math.Between(124, 150),
        Phaser.Math.Between(4, 7),
        Phaser.Utils.Array.GetRandom([0x2c3c5f, 0x3c2a4d, 0x27405e]),
      );
      this.tweens.add({
        targets: c, y: c.y - Phaser.Math.Between(3, 7),
        duration: Phaser.Math.Between(500, 1100),
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    /* header */
    this.add.rectangle(400, 40, 800, 80, 0x0b1120, 0.96);
    this.add.rectangle(400, 80, 800, 2, 0xffd166, 0.3);
    this.add.text(400, 24, '⚔  ARENA BATTLE  ⚔', {
      fontFamily: FONT_BOLD, fontSize: '20px', color: '#ffd166',
    }).setOrigin(0.5);
    this.add.text(400, 50, `Tonight's dish:  ${this.dish.emoji}  ${this.dish.name.toUpperCase()}`, {
      fontFamily: FONT_SOFT, fontSize: '13px', color: '#cfe0ff',
    }).setOrigin(0.5);
    this.add.text(400, 68, 'ESC to forfeit', {
      fontFamily: FONT_SOFT, fontSize: '10px', color: '#6f81a6',
    }).setOrigin(0.5);
  }

  /* ---------- battle HUD (kept in one container so judging can hide it) ---- */
  buildBattleUI() {
    const UI = this.add.container(0, 0);
    this.battleUI = UI;

    /* timer */
    this.timerText = this.add.text(400, 106, '60.0', {
      fontFamily: FONT_BOLD, fontSize: '30px', color: '#ffffff',
    }).setOrigin(0.5);
    UI.add(this.timerText);

    /* ---- build one side (player = blue, rival = red) ---- */
    const side = (cx, tint, stroke, label) => {
      const g = {};
      g.name = this.add.text(cx, 146, label, {
        fontFamily: FONT_BOLD, fontSize: '15px', color: '#eaf1ff',
      }).setOrigin(0.5);

      /* chef */
      g.shadow = this.add.ellipse(cx, 300, 44, 14, 0x000000, 0.35);
      g.body = this.add.rectangle(cx, 268, 40, 54, tint).setStrokeStyle(3, stroke);
      g.hat = this.add.rectangle(cx, 234, 30, 12, 0xf2ecff).setStrokeStyle(1, 0xb9c6e0);
      g.eyeL = this.add.rectangle(cx - 9, 258, 6, 9, 0x0d1424);
      g.eyeR = this.add.rectangle(cx + 9, 258, 6, 9, 0x0d1424);

      /* prep counter top */
      g.counter = this.add.rectangle(cx, 322, 190, 26, 0x2e3a57).setStrokeStyle(2, 0x1b2438);
      g.plate = this.add.text(cx, 314, this.dish.emoji, { fontSize: '20px' }).setOrigin(0.5);

      /* prep bar */
      this.add.rectangle(cx, 356, 200, 16, 0x0a1120).setStrokeStyle(1, 0x2c3c5f);
      g.prepFill = this.add.rectangle(cx - 99, 356, 2, 11, 0x3fce7c).setOrigin(0, 0.5);
      g.prepLabel = this.add.text(cx, 376, 'PREP', {
        fontFamily: FONT_SOFT, fontSize: '9px', color: '#8fa3c8',
      }).setOrigin(0.5);

      /* heat gauge */
      this.add.rectangle(cx, 428, 200, 16, 0x0a1120).setStrokeStyle(1, 0x2c3c5f);
      /* green perfect zone marker */
      this.add.rectangle(cx - 100 + (ZONE_LO / 100) * 200, 428,
        ((ZONE_HI - ZONE_LO) / 100) * 200, 12, 0x3fce7c, 0.28).setOrigin(0, 0.5);
      g.heatFill = this.add.rectangle(cx - 99, 428, 2, 11, 0xffb84d).setOrigin(0, 0.5);
      g.heatLabel = this.add.text(cx, 448, 'HEAT', {
        fontFamily: FONT_SOFT, fontSize: '9px', color: '#8fa3c8',
      }).setOrigin(0.5);

      /* dish counter */
      g.dishText = this.add.text(cx, 478, '🍽 0 plates', {
        fontFamily: FONT_BOLD, fontSize: '15px', color: '#ffd166',
      }).setOrigin(0.5);
      g.subText = this.add.text(cx, 498, 'perfect 0%  ·  burns 0', {
        fontFamily: FONT_SOFT, fontSize: '11px', color: '#8fa3c8',
      }).setOrigin(0.5);

      UI.add([g.name, g.shadow, g.body, g.hat, g.eyeL, g.eyeR, g.counter, g.plate,
        g.prepFill, g.prepLabel, g.heatFill, g.heatLabel, g.dishText, g.subText]);
      return g;
    };

    this.pUI = side(200, 0x35a2ff, 0x1363b8, 'YOU');
    this.rUI = side(600, 0xe05252, 0x8f2f2f, 'RIVAL CHEF');

    /* instructions / mobile button */
    this.hintText = this.add.text(400, 540,
      'Mash  E / SPACE  (or TAP) — hit while the HEAT sits in the green zone', {
        fontFamily: FONT_SOFT, fontSize: '12px', color: '#cfe0ff',
      }).setOrigin(0.5);
    UI.add(this.hintText);

    if (this.sys.game.device.input.touch) {
      const b = this.add.circle(200, 560, 30, 0xffd166, 0.95).setStrokeStyle(3, 0xf4a936);
      const t = this.add.text(200, 560, 'TAP', {
        fontFamily: FONT_BOLD, fontSize: '13px', color: '#7c5511',
      }).setOrigin(0.5);
      UI.add([b, t]);
    }
  }

  buildIntro() {
    this.introText = this.add.text(400, 300, 'GET READY', {
      fontFamily: FONT_BOLD, fontSize: '52px', color: '#ffd166',
      stroke: '#05070d', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(900);
  }

  bindInput() {
    /* keyboard */
    this.input.keyboard.on('keydown-E', () => this.onAction());
    this.input.keyboard.on('keydown-SPACE', () => this.onAction());
    this.input.keyboard.on('keydown-ESC', () => this.onEscape());

    /* pointer (works for mouse and touch, anywhere on screen) */
    this.input.on('pointerdown', () => { SoundFX.unlock(); this.onAction(); });
  }

  /* ---------- a single chop / stir ---------- */
  onAction() {
    if (this.phase === 'result') { this.finish(); return; }
    if (this.phase !== 'battle') return;

    const me = this.me;
    me.hits += 1;

    const inZone = me.heat >= ZONE_LO && me.heat <= ZONE_HI;
    if (inZone) {
      me.perfect += 1;
      me.streak += 1;
      me.best = Math.max(me.best, me.streak);
      me.prep += PREP_PER_HIT + PREP_PERFECT_BONUS;
      SoundFX.perfect();
      if (me.streak % 5 === 0) this.popText(200, 240, `PERFECT ×${me.streak}`, '#7ee8a2', 15);
    } else {
      me.streak = 0;
      me.prep += PREP_PER_HIT;
      SoundFX.chop();
    }

    me.heat = Math.min(100, me.heat + HEAT_PER_HIT);

    /* chef bob */
    this.tweens.add({ targets: this.pUI.body, y: 262, duration: 55, yoyo: true });
    this.tweens.add({ targets: this.pUI.plate, scale: 1.2, duration: 70, yoyo: true });

    if (me.heat >= 100) this.burn(me, this.pUI, 200);
    if (me.prep >= 100) this.completeDish(me, this.pUI, 200, true);
  }

  /* ---------- floating feedback text ---------- */
  popText(x, y, str, color, size = 14) {
    const t = this.add.text(x, y, str, {
      fontFamily: FONT_BOLD, fontSize: `${size}px`, color,
      stroke: '#05070d', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(800).setScale(0.7);
    this.tweens.add({
      targets: t, y: y - 34, alpha: 0, scale: 1,
      duration: 720, ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  onEscape() {
    if (this.phase === 'result') { this.finish(); return; }
    if (this.finished) return;
    this.finished = true;
    this.phase = 'done';
    this.returnToRestaurant({ forfeit: true, win: false, cash: 0, rep: 0, secret: null });
  }

  /* ---------- burning a plate ---------- */
  burn(stats, ui, cx) {
    stats.burns += 1;
    stats.prep = Math.max(0, stats.prep - 30);
    stats.heat = 30;
    stats.streak = 0;
    SoundFX.buzz();
    this.popText(cx, 292, 'BURNT! 🔥', '#ff5a5a', 16);
    this.cameras.main.shake(140, 0.006);

    /* red flash plate over the chef (cleaner than tweening a color value) */
    const flash = this.add.rectangle(cx, 268, 46, 60, 0xff3b3b, 0.55);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 260,
      onComplete: () => flash.destroy(),
    });
  }

  /* ---------- finishing a plate ---------- */
  completeDish(stats, ui, cx, isPlayer) {
    stats.dishes += 1;
    if (stats.streak >= 5) stats.flair += 1;
    stats.prep = 0;
    stats.heat = Math.max(0, stats.heat * 0.6);

    if (isPlayer) SoundFX.ding();
    this.popText(cx, 300, `${this.dish.emoji} SERVED`, '#ffd166', 15);

    /* plate flies up to the counter */
    const p = this.add.text(cx, 314, this.dish.emoji, { fontSize: '20px' }).setOrigin(0.5);
    this.tweens.add({
      targets: p, y: 180, alpha: 0, scale: 1.6,
      duration: 620, ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
    });
  }

  rollRivalInterval() {
    /* faster with higher skill, with a little randomness each plate */
    this.rival.interval = 8200 - this.rival.skill * 2600 + Phaser.Math.Between(-500, 700);
    this.rival.timer = this.rival.interval;
  }

  updateRival(delta) {
    const r = this.rival;
    r.timer -= delta;
    r.prep = Phaser.Math.Clamp(1 - r.timer / r.interval, 0, 1) * 100;

    if (r.timer <= 0) {
      /* rival plates up; quality driven by skill */
      const plateHits = Phaser.Math.Between(9, 13);
      const goodRatio = Phaser.Math.Clamp(r.skill + Phaser.Math.FloatBetween(-0.16, 0.14), 0.15, 0.95);
      r.hits += plateHits;
      r.perfect += Math.round(plateHits * goodRatio);
      r.best = Math.max(r.best, Math.round(plateHits * goodRatio));
      if (goodRatio > 0.7) r.flair += 1;
      if (Math.random() > 0.78 + r.skill * 0.15) r.burns += 1;

      this.completeDish(r, this.rUI, 600, false);
      this.rollRivalInterval();

      this.tweens.add({ targets: this.rUI.body, y: 262, duration: 70, yoyo: true });
    }
  }

  /* ---------- main loop ---------- */
  update(time, delta) {
    if (this.phase === 'intro') {
      this.introT -= delta;
      const n = Math.ceil(this.introT / 600);
      const label = this.introT > 1800 ? 'GET READY' : (n > 0 ? String(Math.min(3, n)) : 'COOK!');
      if (this.introText.text !== label) {
        this.introText.setText(label).setScale(1.5);
        this.tweens.add({ targets: this.introText, scale: 1, duration: 220, ease: 'Back.easeOut' });
        SoundFX.tick();
      }
      if (this.introT <= 0) {
        this.introText.destroy();
        this.phase = 'battle';
        SoundFX.bell();
      }
      return;
    }

    if (this.phase !== 'battle') return;

    /* timer */
    this.remaining -= delta;
    if (this.remaining < 0) this.remaining = 0;
    const secs = this.remaining / 1000;
    this.timerText.setText(secs.toFixed(1));
    this.timerText.setColor(secs <= 10 ? '#ff5a5a' : '#ffffff');
    if (secs <= 10 && Math.floor(secs) !== this.lastBeep) {
      this.lastBeep = Math.floor(secs);
      SoundFX.tick();
    }

    /* heat cools down */
    this.me.heat = Math.max(0, this.me.heat - (HEAT_DECAY * delta) / 1000);

    this.updateRival(delta);
    this.refreshBars();

    if (this.remaining <= 0) this.startJudging();
  }

  refreshBars() {
    const me = this.me;
    this.pUI.prepFill.displayWidth = Math.max(2, (me.prep / 100) * 196);
    this.pUI.heatFill.displayWidth = Math.max(2, (me.heat / 100) * 196);
    this.pUI.heatFill.setFillStyle(
      me.heat > 92 ? 0xff5a5a : (me.heat >= ZONE_LO && me.heat <= ZONE_HI) ? 0x3fce7c : 0xffb84d,
    );
    this.pUI.dishText.setText(`🍽 ${me.dishes} plates`);
    this.pUI.subText.setText(
      `perfect ${me.hits ? Math.round((me.perfect / me.hits) * 100) : 0}%  ·  burns ${me.burns}`,
    );

    const r = this.rival;
    this.rUI.prepFill.displayWidth = Math.max(2, (r.prep / 100) * 196);
    this.rUI.heatFill.displayWidth = Math.max(2, (0.5 + r.skill * 0.35) * 196);
    this.rUI.dishText.setText(`🍽 ${r.dishes} plates`);
    this.rUI.subText.setText(
      `perfect ${r.hits ? Math.round((r.perfect / r.hits) * 100) : 0}%  ·  burns ${r.burns}`,
    );
  }

  /* ---------- scoring ----------
     `secretBonus` is only granted to the player: unlocked secret ingredients
     make the judges rate your creativity higher. */
  scoreOf(s, secretBonus = 0) {
    const clamp = (v) => Phaser.Math.Clamp(v, 0, 1);
    const ratio = s.hits ? s.perfect / s.hits : 0;

    const taste = 30 * clamp(0.28 + 0.72 * ratio);
    const presentation = 20 * clamp(0.35 + 0.65 * (s.best / 12) - s.burns * 0.08);
    const speed = 20 * clamp(s.dishes / SPEED_TARGET);
    const creativity = 15 * clamp(0.3 + 0.5 * (s.flair / 4) + secretBonus);
    const hygiene = 15 * clamp(1 - s.burns * 0.18);

    const rows = [
      { label: 'Taste',        val: taste,        max: 30 },
      { label: 'Presentation', val: presentation, max: 20 },
      { label: 'Speed',        val: speed,        max: 20 },
      { label: 'Creativity',   val: creativity,   max: 15 },
      { label: 'Hygiene',      val: hygiene,      max: 15 },
    ].map((r) => ({ ...r, val: Math.round(r.val) }));

    const total = rows.reduce((a, b) => a + b.val, 0);
    return { rows, total };
  }

  startJudging() {
    this.phase = 'judging';
    this.battleUI.setVisible(false);

    this.myScore = this.scoreOf(this.me, State.secrets.length * 0.04);
    this.rivalScore = this.scoreOf(this.rival, 0);   // rival gets no secret bonus

    const L = this.add.container(0, 0);
    this.resultUI = L;

    L.add(this.add.rectangle(400, 330, 700, 440, 0x0b1120, 0.97).setStrokeStyle(2, 0xffd166));
    L.add(this.add.text(400, 138, "JUDGES' SCORECARD", {
      fontFamily: FONT_BOLD, fontSize: '22px', color: '#ffd166',
    }).setOrigin(0.5));
    L.add(this.add.text(520, 172, 'YOU', {
      fontFamily: FONT_BOLD, fontSize: '13px', color: '#35a2ff',
    }).setOrigin(0.5));
    L.add(this.add.text(636, 172, 'RIVAL', {
      fontFamily: FONT_BOLD, fontSize: '13px', color: '#e05252',
    }).setOrigin(0.5));

    /* reveal each category in sequence */
    this.myScore.rows.forEach((row, i) => {
      const y = 204 + i * 38;
      this.time.delayedCall(260 * i, () => {
        if (!this.scene.isActive()) return;
        const rv = this.rivalScore.rows[i];

        const label = this.add.text(140, y, `${row.label}`, {
          fontFamily: FONT_SOFT, fontSize: '14px', color: '#cfe0ff',
        }).setOrigin(0, 0.5);
        const max = this.add.text(268, y, `/ ${row.max}`, {
          fontFamily: FONT_SOFT, fontSize: '11px', color: '#6f81a6',
        }).setOrigin(0, 0.5);

        /* mini comparison bars */
        const barBg = this.add.rectangle(320, y, 160, 12, 0x1a2540).setOrigin(0, 0.5);
        const mine = this.add.rectangle(320, y, 2, 12, 0x35a2ff).setOrigin(0, 0.5);
        this.tweens.add({ targets: mine, displayWidth: (row.val / row.max) * 160, duration: 340 });

        const mv = this.add.text(520, y, String(row.val), {
          fontFamily: FONT_BOLD, fontSize: '15px',
          color: row.val >= rv.val ? '#7ee8a2' : '#eaf1ff',
        }).setOrigin(0.5);
        const rvT = this.add.text(636, y, String(rv.val), {
          fontFamily: FONT_BOLD, fontSize: '15px',
          color: rv.val > row.val ? '#ff9d9d' : '#eaf1ff',
        }).setOrigin(0.5);

        L.add([label, max, barBg, mine, mv, rvT]);
        SoundFX.tick();
      });
    });

    /* totals + verdict */
    this.time.delayedCall(260 * 5 + 260, () => {
      if (!this.scene.isActive()) return;
      this.showVerdict(L);
    });
  }

  showVerdict(L) {
    const mine = this.myScore.total;
    const theirs = this.rivalScore.total;
    const win = mine > theirs;

    L.add(this.add.rectangle(400, 408, 620, 2, 0x2c3c5f));
    L.add(this.add.text(140, 434, 'TOTAL', {
      fontFamily: FONT_BOLD, fontSize: '18px', color: '#ffd166',
    }).setOrigin(0, 0.5));
    L.add(this.add.text(520, 434, String(mine), {
      fontFamily: FONT_BOLD, fontSize: '26px', color: win ? '#7ee8a2' : '#eaf1ff',
    }).setOrigin(0.5));
    L.add(this.add.text(636, 434, String(theirs), {
      fontFamily: FONT_BOLD, fontSize: '26px', color: !win ? '#ff9d9d' : '#eaf1ff',
    }).setOrigin(0.5));

    /* ---- rewards ---- */
    let cash = 0, rep = 0, secret = null;
    if (win) {
      cash = 500;
      rep = 12;
      State.arenaWins += 1;
      const locked = SECRETS.filter((s) => !State.secrets.includes(s));
      if (locked.length) {
        secret = locked[0];
        State.secrets.push(secret);
      } else {
        cash += 250;                    // everything unlocked → bonus purse
      }
      State.money += cash;
      State.rep = Math.min(REP_MAX, State.rep + rep);
      SoundFX.fanfare();
    } else {
      cash = 100;                       // appearance fee
      State.money += cash;
      SoundFX.lose();
    }
    State.save();

    const banner = this.add.text(400, 486, win ? '🏆  YOU WIN!' : '💀  RIVAL WINS', {
      fontFamily: FONT_BOLD, fontSize: '30px', color: win ? '#ffd166' : '#ff9d9d',
      stroke: '#05070d', strokeThickness: 6,
    }).setOrigin(0.5).setScale(0.5);
    this.tweens.add({ targets: banner, scale: 1, duration: 420, ease: 'Back.easeOut' });

    const rewardLines = [`+$${cash}`];
    if (rep) rewardLines.push(`+${rep} REP`);
    if (secret) rewardLines.push(`🔮 ${secret}`);
    const rewards = this.add.text(400, 518, rewardLines.join('     ·     '), {
      fontFamily: FONT_BOLD, fontSize: '15px', color: '#7ee8a2',
    }).setOrigin(0.5);

    const cont = this.add.text(400, 552, 'Press E / SPACE or TAP to return to the restaurant', {
      fontFamily: FONT_SOFT, fontSize: '12px', color: '#cfe0ff',
    }).setOrigin(0.5);
    this.tweens.add({ targets: cont, alpha: 0.4, duration: 650, yoyo: true, repeat: -1 });

    L.add([banner, rewards, cont]);

    this.payload = { win, cash, rep, secret, forfeit: false };
    /* small delay so a stray tap can't skip the scorecard */
    this.time.delayedCall(600, () => { this.phase = 'result'; });
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.returnToRestaurant(this.payload || { win: false, cash: 0, rep: 0, secret: null });
  }

  returnToRestaurant(result) {
    this.scene.resume('game', { arena: result });
    this.scene.stop();
  }
}

/* ============================================================================
   7) BOOT
   ========================================================================== */

/* load the save once, before the first scene is created */
State.load();

new Phaser.Game({
  type: Phaser.AUTO,                        // WebGL with Canvas fallback
  parent: 'game-container',
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: '#121a2a',
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,                 // shrink to fit any screen…
    autoCenter: Phaser.Scale.CENTER_BOTH,   // …and stay centered
  },
  render: { antialias: true },
  scene: [GameScene, ArenaScene],           // GameScene boots, ArenaScene on demand
});

/* save when the tab is hidden or closed (best-effort) */
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') State.save();
});
window.addEventListener('beforeunload', () => State.save());
