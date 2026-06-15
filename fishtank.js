/**
 * fishtank.js
 *
 * Drop-in fish tank for any <div> on your page.
 *
 * Usage:
 *   const tank = new FishTank('#my-div');
 *
 * The container div must have an explicit width + height set via CSS.
 * The script injects a <canvas> and two control buttons inside it.
 *
 * Mechanics:
 *  - Fish wander in "pixel-step" increments (DOS-style chunky movement)
 *  - Fish sprites flip horizontally when moving left/right
 *  - Fish randomly "rest" — hovering up/down in pixel increments
 *  - "Feed" drops a random number of pellets (sometimes fewer than fish,
 *    sometimes more). Each fish picks its own nearest pellet. If another
 *    fish eats a pellet first, the displaced fish re-evaluates: claim
 *    a remaining pellet or go back to wandering.
 *  - "Light" toggle dims the tank
 *
 * Sprites: define each fish explicitly via the `fish` option — one entry per
 * fish, each with its own GIF. The number of fish equals the list length.
 * Sprite fish render as <img> overlays (GIFs animate natively; canvas would
 * freeze them) and flip with CSS. Omit a fish's `sprite` to get the
 * canvas-drawn fallback instead. Example:
 *   new FishTank('#tank', {
 *     fish: [
 *       { sprite: 'fish-orange.gif', w: 48, h: 28 },
 *       { sprite: 'fish-blue.gif',   w: 40, h: 24 },
 *       { sprite: 'fish-orange.gif' },   // reuse a GIF at default size
 *     ],
 *   });
 *
 * Background: pass a static image to replace the drawn gradient/caustics/bed:
 *   new FishTank('#tank', { background: 'tank-bg.png', backgroundFit: 'cover' });
 * For an animated GIF background, use a CSS background instead (see the note
 * at the bottom of this file).
 */

class FishTank {
  /* ─────────────────────── CONFIG ──────────────────────── */
  static DEFAULTS = {
    fishCount: 5,
    stepSize: 4,              // px per movement tick (DOS-style)
    tickMs: 120,              // ms between ticks
    restChance: 0.003,        // per-tick probability a wandering fish rests
    restDuration: [3000, 8000],
    bobAmplitude: 3,          // px up/down while resting or eating
    bobSpeed: 0.06,           // radians per tick
    foodDuration: 12000,      // ms a pellet lingers before disappearing
    eatRadius: 20,            // px — how close a fish must be to eat
    // Pellet count range relative to fishCount:
    //   min = fishCount - foodUnderCount  (some fish miss out)
    //   max = fishCount + foodOverCount   (extras for seconds)
    foodUnderCount: 2,
    foodOverCount: 3,
    fishColors: [
      { body: '#FF6B6B', fin: '#C0392B', eye: '#222' },
      { body: '#FFD93D', fin: '#F39C12', eye: '#222' },
      { body: '#6BCB77', fin: '#27AE60', eye: '#222' },
      { body: '#4D96FF', fin: '#1A5FB4', eye: '#222' },
      { body: '#FF922B', fin: '#D35400', eye: '#222' },
    ],
    fishSize: { w: 38, h: 20 },   // default size; per-fish w/h can override
    dimOpacity: 0.80,

    // ── Define your fish explicitly ──────────────────────────────
    // `fish` is the primary way to set up the tank: one entry per fish,
    // each with its own GIF sprite. The number of fish equals the length
    // of this array — no separate count needed.
    //
    //   fish: [
    //     { sprite: 'fish-orange.gif', w: 48, h: 28 },
    //     { sprite: 'fish-blue.gif',   w: 40, h: 24 },
    //     { sprite: 'fish-orange.gif' },          // reuse a GIF, default size
    //   ]
    //
    // Per-entry fields:
    //   sprite          — path/URL to the GIF (required for a sprite fish;
    //                      omit to get a canvas-drawn fish instead)
    //   w, h            — rendered size in px (defaults to fishSize)
    //   faceLeftDefault — set true only if the artwork faces LEFT by default
    //                     (right-facing GIFs: omit or leave false)
    //   color           — { body, fin, eye } for canvas-drawn fish only
    //
    // If `fish` is left null, the tank falls back to the legacy fishCount /
    // sprites / spriteFishCount options below.
    fish: null,

    // ── Legacy fallback (used only when `fish` is null) ──────────
    fishCount: 5,
    fishColors: [
      { body: '#FF6B6B', fin: '#C0392B', eye: '#222' },
      { body: '#FFD93D', fin: '#F39C12', eye: '#222' },
      { body: '#6BCB77', fin: '#27AE60', eye: '#222' },
      { body: '#4D96FF', fin: '#1A5FB4', eye: '#222' },
      { body: '#FF922B', fin: '#D35400', eye: '#222' },
    ],
    sprites: [],
    spriteFishCount: null,

    // ── Background image ─────────────────────────────────────────
    // Provide a static image (PNG/JPG) to replace the drawn gradient,
    // caustics, and seabed. Leave null to keep the drawn scene.
    //   background: 'images/tank-bg.png'
    // For an ANIMATED GIF background, don't use this option — set it as a
    // CSS background on the container instead (see notes below the class).
    background: null,
    // How the image fills the tank: 'cover' (fill, may crop),
    // 'stretch' (fill exactly, may distort), or 'contain' (fit, may letterbox).
    backgroundFit: 'cover',
  };

  constructor(selector, options = {}) {
    this.cfg = { ...FishTank.DEFAULTS, ...options };
    this.container = typeof selector === 'string'
      ? document.querySelector(selector)
      : selector;
    if (!this.container) throw new Error(`FishTank: element not found — "${selector}"`);
    this._build();
    this._spawnFish();
    this._startLoop();
  }

  /* ─────────────────────── DOM SETUP ──────────────────────── */
  _build() {
    const c = this.container;
    c.style.position = 'relative';
    c.style.overflow = 'hidden';
    c.style.userSelect = 'none';

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    c.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._resize();

    // Layer that holds animated GIF fish (<img> elements). Sits above the
    // canvas (background/food) but below the dim overlay so lights-off
    // darkens the sprites too.
    this.spriteLayer = document.createElement('div');
    this.spriteLayer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:2;';
    c.appendChild(this.spriteLayer);

    this.dimEl = document.createElement('div');
    this.dimEl.style.cssText =
      'position:absolute;inset:0;pointer-events:none;background:#000;opacity:0;transition:opacity .6s;z-index:5;';
    c.appendChild(this.dimEl);

    const bar = document.createElement('div');
    bar.style.cssText =
      'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:10;';
    c.appendChild(bar);

    this.feedBtn  = this._btn('Feed',      () => this._dropFood());
    this.lightBtn = this._btn('Light off', () => this._toggleLight());
    bar.appendChild(this.feedBtn);
    bar.appendChild(this.lightBtn);

    const ro = new ResizeObserver(() => this._resize());
    ro.observe(c);

    this.lightsOn  = true;
    this.foods     = [];   // array of pellet objects
    this._foodSeq  = 0;    // unique ID counter for pellets
    this.fishes    = [];

    // Preload the background image (if any). _draw() uses it once loaded,
    // and falls back to the drawn scene until then / if none is set.
    this.bgImage = null;
    if (this.cfg.background) {
      const img = new Image();
      img.onload = () => { this.bgImage = img; };
      img.src = this.cfg.background;
    }
  }

  _btn(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'font:13px/1 system-ui,sans-serif;padding:5px 10px;border-radius:999px;' +
      'border:1px solid rgba(255,255,255,.5);background:rgba(0,0,0,.35);color:#fff;' +
      'cursor:pointer;transition:background .15s;';
    b.onmouseenter = () => (b.style.background = 'rgba(0,0,0,.6)');
    b.onmouseleave = () => (b.style.background = 'rgba(0,0,0,.35)');
    b.onclick = fn;
    return b;
  }

  _resize() {
    this.W = this.container.clientWidth  || 400;
    this.H = this.container.clientHeight || 300;
    this.canvas.width  = this.W;
    this.canvas.height = this.H;
  }

  /* ─────────────────────── FISH ──────────────────────── */
  _spawnFish() {
    // Build a normalized list of fish specs from either the explicit `fish`
    // array (preferred) or the legacy fishCount/sprites options.
    const specs = this._resolveFishSpecs();
    for (const spec of specs) this._createFish(spec);
  }

  /** Produce an array of per-fish specs: { sprite, w, h, faceLeftDefault, color }. */
  _resolveFishSpecs() {
    const { fish, fishCount, fishColors, fishSize, sprites, spriteFishCount } = this.cfg;

    // Preferred path: explicit list, one entry per fish.
    if (Array.isArray(fish) && fish.length) {
      return fish.map((f, i) => ({
        sprite:          f.sprite || null,
        w:               f.w || fishSize.w,
        h:               f.h || fishSize.h,
        faceLeftDefault: !!f.faceLeftDefault,
        color:           f.color || fishColors[i % fishColors.length],
      }));
    }

    // Legacy fallback: fishCount + sprites (round-robin) + spriteFishCount.
    const spriteSlots = (sprites && sprites.length)
      ? (spriteFishCount == null ? fishCount : Math.min(spriteFishCount, fishCount))
      : 0;
    const specs = [];
    for (let i = 0; i < fishCount; i++) {
      const def = i < spriteSlots ? sprites[i % sprites.length] : null;
      specs.push({
        sprite:          def ? def.url : null,
        w:               (def && def.w) || fishSize.w,
        h:               (def && def.h) || fishSize.h,
        faceLeftDefault: def ? !!def.faceLeftDefault : false,
        color:           fishColors[i % fishColors.length],
      });
    }
    return specs;
  }

  /** Create one fish (and its <img> element if it has a sprite) from a spec. */
  _createFish(spec) {
    const fish = {
      x: this._rand(spec.w, this.W - spec.w),
      y: this._rand(spec.h, this.H - spec.h),
      dx: this._randDir(),
      dy: this._randDir(),
      facingLeft: false,
      color: spec.color,
      state: 'wander',          // 'wander' | 'rest' | 'seek' | 'eat'
      restTimer: 0,
      targetY: 0,
      bobPhase: Math.random() * Math.PI * 2,
      targetFoodId: null,       // id of the pellet this fish is heading for
      sprite: null,             // { w, h, faceLeftDefault } if a GIF fish
      el: null,                 // the <img> element, if any
    };

    if (spec.sprite) {
      fish.sprite = { w: spec.w, h: spec.h, faceLeftDefault: spec.faceLeftDefault };
      const img = document.createElement('img');
      img.src = spec.sprite;
      img.alt = '';
      img.style.cssText =
        'position:absolute;left:0;top:0;width:' + spec.w + 'px;height:' +
        spec.h + 'px;image-rendering:pixelated;will-change:transform;' +
        'transform-origin:center;';
      this.spriteLayer.appendChild(img);
      fish.el = img;
    }

    this.fishes.push(fish);
  }

  /* ─────────────────────── FOOD ──────────────────────── */
  _dropFood() {
    const { foodUnderCount, foodOverCount } = this.cfg;
    const n     = this.fishes.length;   // actual number of fish in the tank
    const min   = Math.max(1, n - foodUnderCount);
    const max   = n + foodOverCount;
    const count = Math.floor(this._rand(min, max + 1));

    const now = performance.now();
    for (let i = 0; i < count; i++) {
      this.foods.push({
        id:         ++this._foodSeq,
        x:          this._rand(16, this.W - 16),
        y:          this._rand(6, 28),   // slight random drop height — not a straight line
        spawnedAt:  now,
        sinkY:      0,
        claimedBy:  null,   // fish object currently heading here (soft lock)
      });
    }

    // Each free fish picks its nearest unclaimed pellet
    this._assignFood();
  }

  /**
   * For every fish that isn't already eating, find the nearest unclaimed
   * pellet and send it there. Pellets are soft-claimed so two fish don't
   * race to the same one unless there are more pellets than fish.
   */
  _assignFood() {
    // Release claims of fish that are wandering/resting (they'll re-claim below)
    for (const pellet of this.foods) {
      if (pellet.claimedBy && pellet.claimedBy.state !== 'seek' && pellet.claimedBy.state !== 'eat') {
        pellet.claimedBy = null;
      }
    }

    for (const f of this.fishes) {
      if (f.state === 'eat') continue;          // already eating, leave alone
      if (f.state === 'seek' && f.targetFoodId !== null) {
        // Verify the pellet it was heading for still exists
        if (this.foods.some(p => p.id === f.targetFoodId)) continue;
        // Pellet gone — re-assign below
        f.targetFoodId = null;
        f.state = 'wander';
      }

      const nearest = this._nearestUnclaimedPellet(f);
      if (nearest) {
        f.state        = 'seek';
        f.targetFoodId = nearest.id;
        nearest.claimedBy = f;
      }
      // If no pellet available, fish stays in its current state (wander/rest)
    }
  }

  /** Return the nearest pellet not already claimed by another fish. */
  _nearestUnclaimedPellet(fish) {
    let best = null, bestDist = Infinity;
    for (const p of this.foods) {
      if (p.claimedBy && p.claimedBy !== fish) continue;  // taken
      const d = Math.hypot(p.x - fish.x, (p.y + p.sinkY) - fish.y);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  /** Remove a pellet by id; displace any fish that was heading to it. */
  _consumePellet(id) {
    this.foods = this.foods.filter(p => p.id !== id);
    for (const f of this.fishes) {
      if (f.targetFoodId === id) {
        f.targetFoodId = null;
        // Try to redirect to another pellet; fall back to wander
        const next = this._nearestUnclaimedPellet(f);
        if (next) {
          f.state           = 'seek';
          f.targetFoodId    = next.id;
          next.claimedBy    = f;
        } else {
          f.state = 'wander';
        }
      }
    }
  }

  /* ─────────────────────── LIGHTS ──────────────────────── */
  _toggleLight() {
    this.lightsOn = !this.lightsOn;
    this.dimEl.style.opacity  = this.lightsOn ? '0' : this.cfg.dimOpacity;
    this.lightBtn.textContent = this.lightsOn ? '💡 Light off' : '💡 Light on';
  }

  /* ─────────────────────── MAIN LOOP ──────────────────────── */
  _startLoop() {
    this._lastTick = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const elapsed = now - this._lastTick;
      if (elapsed >= this.cfg.tickMs) {
        this._lastTick = now - (elapsed % this.cfg.tickMs);
        this._tick(now);
      }
      this._draw();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _tick(now) {
    const { stepSize, restChance, restDuration, bobSpeed,
            eatRadius, foodDuration, fishSize } = this.cfg;
    const W = this.W, H = this.H;

    /* ── Expire old pellets ── */
    const before = this.foods.length;
    this.foods = this.foods.filter(p => now - p.spawnedAt <= foodDuration);
    if (this.foods.length < before) {
      // Some pellets expired; displace fish that were heading to them
      for (const f of this.fishes) {
        if (f.targetFoodId !== null && !this.foods.some(p => p.id === f.targetFoodId)) {
          f.targetFoodId = null;
          const next = this._nearestUnclaimedPellet(f);
          if (next) { f.state = 'seek'; f.targetFoodId = next.id; next.claimedBy = f; }
          else if (f.state === 'seek') f.state = 'wander';
        }
      }
    }

    /* ── Sink all pellets ── */
    for (const p of this.foods) {
      p.sinkY = Math.min(p.sinkY + 0.4, H * 0.25);
    }

    /* ── Update each fish ── */
    for (const f of this.fishes) {
      f.bobPhase += bobSpeed;

      /* SEEK */
      if (f.state === 'seek') {
        const pellet = f.targetFoodId !== null
          ? this.foods.find(p => p.id === f.targetFoodId)
          : null;

        if (!pellet) {
          // Target vanished (eaten or expired by another fish)
          f.targetFoodId = null;
          const next = this._nearestUnclaimedPellet(f);
          if (next) { f.targetFoodId = next.id; next.claimedBy = f; }
          else      { f.state = 'wander'; }
          continue;
        }

        const fx = pellet.x, fy = pellet.y + pellet.sinkY;
        const dx = fx - f.x,  dy = fy - f.y;
        const dist = Math.hypot(dx, dy);

        if (dist < eatRadius) {
          // Arrived — consume the pellet
          f.state = 'eat';
          f.x = Math.round(fx);
          f.y = Math.round(fy);
          this._consumePellet(pellet.id);   // removes pellet, redirects rivals
        } else {
          f.x += Math.sign(dx) * stepSize;
          f.y += Math.sign(dy) * (Math.abs(dy) > stepSize ? stepSize : Math.ceil(Math.abs(dy)));
          // Only flip when there's meaningful horizontal travel, so a fish
          // approaching a pellet from directly above/below won't flicker.
          if (Math.abs(dx) > eatRadius) f.facingLeft = dx < 0;
        }
        this._clamp(f, fishSize, W, H);
        continue;
      }

      /* EAT — bob in place; check for another pellet when done */
      if (f.state === 'eat') {
        // If there's still food available, stay in eat state and bob
        // (fish finishes current pellet; if more pellets exist it'll seek again
        //  once it resumes wander — handled when food drops or fish re-evaluates)
        f.y += Math.round(Math.sin(f.bobPhase) * this.cfg.bobAmplitude) * 0.3;
        // After a short eat pause, see if more food is available
        if (!f._eatTimer) f._eatTimer = now + 1800 + Math.random() * 1200;
        if (now > f._eatTimer) {
          f._eatTimer = null;
          const next = this._nearestUnclaimedPellet(f);
          if (next) {
            f.state        = 'seek';
            f.targetFoodId = next.id;
            next.claimedBy = f;
          } else {
            f.state = 'wander';
          }
        }
        this._clamp(f, fishSize, W, H);
        continue;
      }

      /* REST */
      if (f.state === 'rest') {
        f.restTimer -= this.cfg.tickMs;
        if (f.restTimer <= 0) { f.state = 'wander'; continue; }
        f.y = f.targetY + Math.round(Math.sin(f.bobPhase) * this.cfg.bobAmplitude);
        this._clamp(f, fishSize, W, H);
        continue;
      }

      /* WANDER */
      if (Math.random() < restChance) {
        f.state     = 'rest';
        f.targetY   = f.y;
        f.restTimer = this._rand(restDuration[0], restDuration[1]);
        continue;
      }

      f.x += f.dx * stepSize;
      f.y += f.dy * stepSize;

      if (f.x <= fishSize.w / 2)         { f.x = fishSize.w / 2;         f.dx = 1;  f.facingLeft = false; }
      else if (f.x >= W - fishSize.w / 2) { f.x = W - fishSize.w / 2;   f.dx = -1; f.facingLeft = true;  }
      if (f.y <= fishSize.h / 2)          { f.y = fishSize.h / 2;         f.dy = 1;  }
      else if (f.y >= H - fishSize.h / 2) { f.y = H - fishSize.h / 2;    f.dy = -1; }

      if (Math.random() < 0.02)  f.dy = this._randDir();
      if (Math.random() < 0.015) { f.dx = this._randDir(); f.facingLeft = f.dx < 0; }
    }
  }

  /* ─────────────────────── DRAW ──────────────────────── */
  _draw() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;

    if (this.bgImage) {
      // Custom image replaces the gradient, caustics, and seabed.
      this._drawBackgroundImage(ctx, W, H);
    } else {
      // Default drawn scene.
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0077b6');
      bg.addColorStop(1, '#023e8a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      this._drawCaustics(ctx, W, H);
      this._drawBed(ctx, W, H);
    }

    for (const p of this.foods) this._drawPellet(ctx, p);
    for (const f of this.fishes) {
      if (f.sprite) this._positionSprite(f);
      else          this._drawFish(ctx, f);
    }

    this._drawOverlay(ctx, W, H)
  }

  /* Draw the loaded background image to fill the tank per backgroundFit. */
  _drawBackgroundImage(ctx, W, H) {
    const img = this.bgImage;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const fit = this.cfg.backgroundFit;

    if (fit === 'stretch') {
      ctx.drawImage(img, 0, 0, W, H);
      return;
    }

    // 'cover' fills the box (cropping overflow); 'contain' fits inside it.
    const scale = fit === 'contain'
      ? Math.min(W / iw, H / ih)
      : Math.max(W / iw, H / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;

    if (fit === 'contain') {
      // Letterbox fill so gaps aren't transparent.
      ctx.fillStyle = '#023e8a';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  _drawOverlay(ctx, W, H) {
    const img = new Image()
    img.src = 'img/overlay.png'
    const iw = img.naturalWidth, ih = img.naturalHeight
    const fit = this.cfg.backgroundFit

    if (fit === 'stretch') {
      ctx.drawImage(img, 0, 0, W, H);
      return;
    }

    // 'cover' fills the box (cropping overflow); 'contain' fits inside it.
    const scale = fit === 'contain'
      ? Math.min(W / iw, H / ih)
      : Math.max(W / iw, H / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;

    if (fit === 'contain') {
      // Letterbox fill so gaps aren't transparent.
      ctx.fillStyle = '#023e8a';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  /* Position a GIF-sprite fish's <img> element. The GIF animates natively;
     we only move it and flip it horizontally. Sprite faces right by default,
     so we flip (scaleX(-1)) when the fish should face left — inverted if the
     artwork's faceLeftDefault is set. */
  _positionSprite(f) {
    const { w, h } = f.sprite;
    const flip = f.sprite.faceLeftDefault ? !f.facingLeft : f.facingLeft;
    const left = Math.round(f.x - w / 2);
    const top  = Math.round(f.y - h / 2);
    f.el.style.transform =
      'translate(' + left + 'px,' + top + 'px)' + (flip ? ' scaleX(-1)' : '');
  }

  _drawCaustics(ctx, W, H) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    const t = performance.now() / 2000;
    for (let i = 0; i < 6; i++) {
      const x = (i * 137 + t * 30) % W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 20, H * 0.3, x - 20, H * 0.6, x + 10, H);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBed(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = '#c9a84c';
    ctx.fillRect(0, H - 18, W, 18);
    const pebbles = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((r, i) => ({
      x: r * W + (i * 31 % 30) - 15,
      r: 4 + (i * 7 % 6),
    }));
    for (const p of pebbles) {
      ctx.fillStyle = ['#8B7355', '#A0845C', '#6B7280'][p.r % 3];
      ctx.beginPath();
      ctx.ellipse(p.x, H - 12, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 5; i++) {
      const sx = (W * (i + 1)) / 6;
      const t = performance.now() / 1200 + i;
      ctx.strokeStyle = '#2d6a4f';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, H - 18);
      ctx.bezierCurveTo(
        sx + Math.sin(t) * 8,     H - 38,
        sx + Math.sin(t + 1) * 8, H - 52,
        sx + Math.sin(t + 2) * 6, H - 65,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPellet(ctx, p) {
    const fy = p.y + p.sinkY;
    ctx.save();
    ctx.fillStyle = '#F4A261';
    ctx.beginPath();
    ctx.arc(p.x, fy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#E76F51';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  _drawFish(ctx, f) {
    const { w, h } = this.cfg.fishSize;
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));
    if (f.facingLeft) ctx.scale(-1, 1);

    ctx.fillStyle = f.color.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = f.color.fin;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(-w / 2 - 12, -h / 2 - 2);
    ctx.lineTo(-w / 2 - 12,  h / 2 + 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = f.color.fin;
    ctx.beginPath();
    ctx.moveTo(-4, -h / 2);
    ctx.lineTo( 6, -h / 2 - 8);
    ctx.lineTo(14, -h / 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w / 2 - 9, -2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.color.eye;
    ctx.beginPath();
    ctx.arc(w / 2 - 8, -2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w / 2 - 7.5, -2.5, 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /* ─────────────────────── HELPERS ──────────────────────── */
  _rand(min, max) { return Math.random() * (max - min) + min; }
  _randDir()      { return Math.random() < 0.5 ? -1 : 1; }
  _clamp(f, fishSize, W, H) {
    f.x = Math.max(fishSize.w / 2, Math.min(W - fishSize.w / 2, f.x));
    f.y = Math.max(fishSize.h / 2, Math.min(H - fishSize.h / 2, f.y));
  }

  /* ─────────────────────── CLEANUP ──────────────────────── */
  destroy() {
    cancelAnimationFrame(this._raf);
    this.container.innerHTML = '';
  }
}

/* ── Auto-initialise any element with data-fishtank ── */
//document.querySelectorAll('[data-fishtank]').forEach(el => new FishTank(el));

/*
 * ANIMATED GIF BACKGROUND
 * -----------------------
 * The `background` option draws to canvas, which freezes GIFs on frame one.
 * For an animated background, skip that option and set the GIF as a CSS
 * background on the container, then make the canvas transparent so the fish
 * and food show through. The drawn gradient/caustics/bed must be off, which
 * happens automatically as long as you DON'T pass `background`... but you also
 * need the canvas itself to be see-through. Two small changes:
 *
 *   1) CSS on your container:
 *        #my-tank {
 *          width: 500px; height: 320px;
 *          background: url('tank-bg.gif') center / cover no-repeat;
 *        }
 *
 *   2) Make the canvas clear instead of painting the default scene. The
 *      simplest way is to give the tank a transparent "image": pass a 1x1
 *      transparent PNG as `background`, OR replace the else-branch in _draw()
 *      with `ctx.clearRect(0, 0, W, H);` to leave the canvas transparent.
 *
 * Food and fish still render on top; lights-off still dims everything because
 * the dim overlay sits above both the CSS background and the canvas.
 */
