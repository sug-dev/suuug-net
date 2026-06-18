class FishTank {
  constructor() {
    this.cfg = {
      stepSize: 2,
      tickMs: 120,
      restChance: 0.003,
      restDuration: [6000, 18000],
      bobAmplitude: 5,
      bobSpeed: 0.25,
      foodDuration: 12000,
      eatRadius: 10,
      foodUnderCount: 1,
      foodOverCount: 3,
      dimOpacity: 0.80,
      fish: [
        { sprite: 'img/fish1.gif', w: 59, h: 46 },
        { sprite: 'img/fish2.gif',w: 59, h: 46 },
        { sprite: 'img/fish3.gif', w: 59, h: 46 },
      ],
      background: 'img/fishtank.png',
      backgroundFit: 'cover',
      backgroundPosition: 'bottom',
      overlay: 'img/overlay.png'
    }
    this.container = document.getElementById('fishtank')

    this._build()
    this._spawnFish(this.cfg.fish)
    this._startLoop()
  }

  _build() {
    const c = this.container

    const bar = document.getElementById('fishtank-controls')
    bar.style.cssText = 'z-index: 100000; display: flex; justify-content: space-evenly;'
    c.appendChild(bar)

    this.feedBtn = this._btn('Feed', () => this._dropFood())
    this.lightBtn = this._btn('Light off', () => this._toggleLight())
    bar.appendChild(this.feedBtn)
    bar.appendChild(this.lightBtn)

    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'width: 100%; height: 100%;'
    c.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    
    this.W = this.container.clientWidth
    this.H = this.container.clientHeight - 32
    this.canvas.width  = this.W
    this.canvas.height = this.H

    this.spriteLayer = document.createElement('div')
    this.spriteLayer.style.cssText = 'pointer-events: none; z-index: 2; height: calc(100% - 32px); width: 100%; position: absolute; bottom: 0;'
    c.appendChild(this.spriteLayer)

    this.dimEl = document.createElement('div')
    this.dimEl.style.cssText = 'position: absolute; inset: 0; pointer-events: none; background: #000; opacity: 0; transition: opacity .3s; z-index :5;'
    c.appendChild(this.dimEl)

    this.lightsOn = true
    this.foods = []
    this._foodSeq = 0
    this.fishes = []

    const bgImg = new Image()
    bgImg.onload = () => { this.bgImage = bgImg }
    bgImg.src = this.cfg.background

    const overImg = new Image()
    overImg.onload = () => { this.overlayImg = overImg }
    overImg.src = this.cfg.overlay
  }

  _btn(label, fn) {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'font: 8px; cursor: pointer; border: none; background: none; text-decoration: underline;'
    b.onmouseenter = () => (b.style.cssText = 'font: 8px; cursor: pointer; border: none; background: none; text-decoration: underline; color: var(--accent-one);')
    b.onmouseleave = () => (b.style.cssText = 'font: 8px; cursor: pointer; border: none; background: none; text-decoration: underline; color: var(--text-one);')
    b.onclick = fn
    return b
  }

  _spawnFish(fish) {
    const specs = fish.map((f, i) => ({
      sprite: f.sprite,
      w: f.w,
      h: f.h,
      faceLeftDefault: !!f.faceLeftDefault
    }))
    for (const spec of specs) this._createFish(spec)
  }

  _createFish(spec) {
    const fish = {
      x: this._rand(spec.w, this.W - spec.w),
      y: this._rand(spec.h, this.H - spec.h),
      dx: this._randDir(),
      dy: this._randDir(),
      facingLeft: false,
      state: 'wander',
      restTimer: 0,
      targetY: 0,
      bobPhase: Math.random() * Math.PI * 2,
      targetFoodId: null,
      el: null,
    }

    if (spec.sprite) {
      fish.sprite = { w: spec.w, h: spec.h, faceLeftDefault: spec.faceLeftDefault }
      const img = document.createElement('img')
      img.src = spec.sprite
      img.alt = 'fish image'
      img.style.cssText = `position: absolute; left: 0; top: 0; width: ${spec.w}px; height: ${spec.h}px; image-rendering: pixelated; will-change: transform; transform-origin: center;`
      this.spriteLayer.appendChild(img)
      fish.el = img
    }

    this.fishes.push(fish)
  }

  _dropFood() {
    const { foodUnderCount, foodOverCount } = this.cfg
    const n = this.fishes.length
    const min = Math.max(1, n - foodUnderCount)
    const max = n + foodOverCount
    const count = Math.floor(this._rand(min, max + 1))

    const now = performance.now()
    for (let i = 0; i < count; i++) {
      this.foods.push({
        id: ++this._foodSeq,
        x: this._rand(16, this.W - 16),
        y: this._rand(6, 32),
        spawnedAt: now,
        sinkY: 0,
        claimedBy: null,
      })
    }

    this._assignFood()
  }

  _assignFood() {
    for (const pellet of this.foods) {
      if (pellet.claimedBy && pellet.claimedBy.state !== 'seek' && pellet.claimedBy.state !== 'eat') {
        pellet.claimedBy = null
      }
    }

    for (const f of this.fishes) {
      if (f.state === 'eat') continue
      if (f.state === 'seek' && f.targetFoodId !== null) {
        if (this.foods.some(p => p.id === f.targetFoodId)) continue
        f.targetFoodId = null
        f.state = 'wander'
      }

      const nearest = this._nearestUnclaimedPellet(f)
      if (nearest) {
        f.state = 'seek'
        f.targetFoodId = nearest.id
        nearest.claimedBy = f
      }
    }
  }

  _nearestUnclaimedPellet(fish) {
    let best = null, bestDist = Infinity
    for (const p of this.foods) {
      if (p.claimedBy && p.claimedBy !== fish) continue
      const d = Math.hypot(p.x - fish.x, (p.y + p.sinkY) - fish.y)
      if (d < bestDist) { bestDist = d; best = p }
    }
    return best
  }

  _consumePellet(id) {
    this.foods = this.foods.filter(p => p.id !== id)
    for (const f of this.fishes) {
      if (f.targetFoodId === id) {
        f.targetFoodId = null
        const next = this._nearestUnclaimedPellet(f)
        if (next) {
          f.state = 'seek'
          f.targetFoodId = next.id
          next.claimedBy = f
        } else {
          f.state = 'wander'
        }
      }
    }
  }

  _toggleLight() {
    this.lightsOn = !this.lightsOn
    this.dimEl.style.opacity = this.lightsOn ? '0' : this.cfg.dimOpacity
    this.lightBtn.textContent = this.lightsOn ? 'Light off' : 'Light on'
  }

  _startLoop() {
    this._lastTick = performance.now()
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop)
      const elapsed = now - this._lastTick
      if (elapsed >= this.cfg.tickMs) {
        this._lastTick = now - (elapsed % this.cfg.tickMs)
        this._tick(now)
      }
      this._draw()
    };
    this._raf = requestAnimationFrame(loop)
  }

  _tick(now) {
    const { stepSize, restChance, restDuration, bobSpeed, eatRadius, foodDuration } = this.cfg
    const W = this.W, H = this.H

    const before = this.foods.length
    this.foods = this.foods.filter(p => now - p.spawnedAt <= foodDuration)
    if (this.foods.length < before) {
      for (const f of this.fishes) {
        if (f.targetFoodId !== null && !this.foods.some(p => p.id === f.targetFoodId)) {
          f.targetFoodId = null
          const next = this._nearestUnclaimedPellet(f)
          if (next) { f.state = 'seek'; f.targetFoodId = next.id; next.claimedBy = f }
          else if (f.state === 'seek') f.state = 'wander'
        }
      }
    }

    // Food sinking
    for (const p of this.foods) {
      p.sinkY = Math.min(p.sinkY + 0.4, H * 0.25)
    }

    for (const f of this.fishes) {
      f.bobPhase += bobSpeed;

      if (f.state === 'seek') {
        const pellet = f.targetFoodId !== null ? this.foods.find(p => p.id === f.targetFoodId) : null

        if (!pellet) {
          f.targetFoodId = null
          const next = this._nearestUnclaimedPellet(f)
          if (next) { f.targetFoodId = next.id; next.claimedBy = f }
          else { f.state = 'wander' }
          continue
        }

        const fx = pellet.x, fy = pellet.y + pellet.sinkY
        const dx = fx - f.x, dy = fy - f.y
        const dist = Math.hypot(dx, dy)

        if (dist < eatRadius) {
          f.state = 'eat'
          f.x = Math.round(fx)
          f.y = Math.round(fy)
          this._consumePellet(pellet.id)
        } else {
          f.x += Math.sign(dx) * stepSize
          f.y += Math.sign(dy) * (Math.abs(dy) > stepSize ? stepSize : Math.ceil(Math.abs(dy)))
          if (Math.abs(dx) > eatRadius) f.facingLeft = dx < 0
        }
        this._clamp(f, W, H)
        continue
      }

      if (f.state === 'eat') {
        f.y += Math.round(Math.sin(f.bobPhase) * this.cfg.bobAmplitude) * 0.3
        if (!f._eatTimer) f._eatTimer = now + 1800 + Math.random() * 1200
        if (now > f._eatTimer) {
          f._eatTimer = null
          const next = this._nearestUnclaimedPellet(f)
          if (next) {
            f.state = 'seek'
            f.targetFoodId = next.id
            next.claimedBy = f
          } else {
            f.state = 'wander'
          }
        }
        this._clamp(f, W, H)
        continue
      }

      if (f.state === 'rest') {
        f.restTimer -= this.cfg.tickMs
        if (f.restTimer <= 0) { f.state = 'wander'; continue }
        f.y = f.targetY + Math.round(Math.sin(f.bobPhase) * this.cfg.bobAmplitude)
        this._clamp(f, W, H)
        continue
      }

      if (Math.random() < restChance) {
        f.state     = 'rest'
        f.targetY   = f.y
        f.restTimer = this._rand(restDuration[0], restDuration[1])
        continue
      }

      f.x += f.dx * stepSize
      f.y += f.dy * stepSize

      if      (f.x <= f.sprite.w / 2)     { f.x = f.sprite.w / 2;         f.dx = 1;  f.facingLeft = false }
      else if (f.x >= W - f.sprite.w / 2) { f.x = W - f.sprite.w / 2;     f.dx = -1; f.facingLeft = true }
      if      (f.y <= f.sprite.h / 2)     { f.y = f.sprite.h / 2;         f.dy = 1  }
      else if (f.y >= H - f.sprite.h / 2) { f.y = H - f.sprite.h / 2;     f.dy = -1 }

      if (Math.random() < 0.02)  f.dy = this._randDir()
      if (Math.random() < 0.015) { f.dx = this._randDir(); f.facingLeft = f.dx < 0 }
    }
  }

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
    const img = this.bgImage
    ctx.drawImage(img, 0, 0, W, H)
  }

  _drawOverlay(ctx, W, H) {
    const img = this.overlayImg
    ctx.drawImage(img, 0, 0, W, H)
  }

  _positionSprite(f) {
    const { w, h } = f.sprite
    const flip = f.sprite.faceLeftDefault ? !f.facingLeft : f.facingLeft
    const left = Math.round(f.x - w / 2)
    const top  = Math.round(f.y - h / 2)
    f.el.style.transform = 'translate(' + left + 'px,' + top + 'px)' + (flip ? ' scaleX(-1)' : '')
  }

  _drawPellet(ctx, p) {
    const fy = p.y + p.sinkY
    ctx.save()
    ctx.fillStyle = '#F4A261'
    ctx.beginPath()
    ctx.arc(p.x, fy, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#E76F51'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  // HELPER functions
  _rand(min, max) { return Math.random() * (max - min) + min }
  _randDir() { return Math.random() < 0.5 ? -1 : 1 }
  _clamp(f, W, H) {
    f.x = Math.max(f.sprite.w / 2, Math.min(W - f.sprite.w / 2, f.x))
    f.y = Math.max(f.sprite.h / 2, Math.min(H - f.sprite.h / 2, f.y))
  }
}

document.addEventListener("DOMContentLoaded", () => {
    new FishTank()
})