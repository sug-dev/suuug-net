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
    fishCount: 6,
    stepSize: 4,
    tickMs: 120,
    restChance: 0.003,
    restDuration: [6000, 18000],
    bobAmplitude: 5,
    bobSpeed: 0.25,
    foodDuration: 12000,
    eatRadius: 10,
    foodUnderCount: 2,
    foodOverCount: 3,
    dimOpacity: 0.80,

    fish: null,
    fishSize: { w: 38, h: 20 },   // default size; per-fish w/h can override

    sprites: [],
    spriteFishCount: null,

    background: null,
    overlay: null
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
    this.foods     = [];
    this._foodSeq  = 0;
    this.fishes    = [];

    this.bgImage = null;
    if (this.cfg.background) {
      const img = new Image();
      img.onload = () => { this.bgImage = img; };
      img.src = this.cfg.background;
    }

    this.overlayImg = null;
    if (this.cfg.overlay) {
      const img = new Image();
      img.onload = () => { this.overlayImg = img; };
      img.src = this.cfg.overlay;
    }
  }

  _btn(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'font:6px;padding:5px 10px;border-radius:999px;font-family:pixel;' +
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
    const specs = this._resolveFishSpecs();
    for (const spec of specs) this._createFish(spec);
  }

  _resolveFishSpecs() {
    const { fish, fishCount, fishSize, sprites, spriteFishCount } = this.cfg;

    if (Array.isArray(fish) && fish.length) {
      return fish.map((f, i) => ({
        sprite:          f.sprite || null,
        w:               f.w || fishSize.w,
        h:               f.h || fishSize.h,
        faceLeftDefault: !!f.faceLeftDefault,
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
    this.lightBtn.textContent = this.lightsOn ? 'Light off' : 'Light on';
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

    this._drawBackgroundImage(ctx, W, H);

    for (const p of this.foods) this._drawPellet(ctx, p);
    for (const f of this.fishes) {
      this._positionSprite(f);
    }

    this._drawOverlay(ctx, W, H)
  }

  _drawBackgroundImage(ctx, W, H) {
    const img = this.bgImage;
    ctx.drawImage(img, 0, 0, W, H);
  }

  _drawOverlay(ctx, W, H) {
    const img = this.overlayImg
    ctx.drawImage(img, 0, 0, W, H);
  }

  _positionSprite(f) {
    const { w, h } = f.sprite;
    const flip = f.sprite.faceLeftDefault ? !f.facingLeft : f.facingLeft;
    const left = Math.round(f.x - w / 2);
    const top  = Math.round(f.y - h / 2);
    f.el.style.transform =
      'translate(' + left + 'px,' + top + 'px)' + (flip ? ' scaleX(-1)' : '');
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
