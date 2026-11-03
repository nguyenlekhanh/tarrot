/**
 * DrinkShopFX — light 30 FPS canvas effects for the drink shop stream.
 * Hearts (likes), confetti (gifts), sparkles (serving), soda bubbles (ambience).
 * Everything is pre-rendered once into offscreen canvases; the frame loop only
 * uses drawImage / fillRect, so it stays cheap for 24/7 OBS streaming.
 */
(function () {
  class DrinkShopFX {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      this.width = 1080;
      this.height = 1920;
      // live.js may already have set a DPR-aware backing store. Do not reset it
      // to 1080 x 1920 and throw away that high-DPI detail.
      if (!canvas.width || canvas.width < this.width) {
        canvas.width = this.width;
        canvas.height = this.height;
      }

      this.particles = [];
      this.time = 0;
      this.lastTs = 0;
      this.bubbleTimer = 0;
      this.frameInterval = 1000 / 30;
      this.enabled = true;

      this.buildSprites();
      this.animate = this.animate.bind(this);
      requestAnimationFrame(this.animate);
    }

    buildSprites() {
      // heart
      const heart = document.createElement('canvas');
      heart.width = 44;
      heart.height = 40;
      const hctx = heart.getContext('2d');
      hctx.translate(22, 20);
      hctx.beginPath();
      hctx.moveTo(0, 14);
      hctx.bezierCurveTo(-22, -2, -14, -20, 0, -8);
      hctx.bezierCurveTo(14, -20, 22, -2, 0, 14);
      hctx.closePath();
      hctx.fillStyle = '#ff5a72';
      hctx.fill();
      hctx.lineWidth = 3;
      hctx.strokeStyle = '#b02f45';
      hctx.stroke();
      hctx.beginPath();
      hctx.ellipse(-6, -6, 3.2, 5, -0.5, 0, Math.PI * 2);
      hctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      hctx.fill();
      this.heartSprite = heart;

      // soda bubble
      const bubble = document.createElement('canvas');
      bubble.width = 28;
      bubble.height = 28;
      const bctx = bubble.getContext('2d');
      bctx.beginPath();
      bctx.arc(14, 14, 11, 0, Math.PI * 2);
      bctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      bctx.lineWidth = 3;
      bctx.stroke();
      bctx.beginPath();
      bctx.arc(10, 9, 3, 0, Math.PI * 2);
      bctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      bctx.fill();
      this.bubbleSprite = bubble;

      // sparkle / star
      const star = document.createElement('canvas');
      star.width = 32;
      star.height = 32;
      const sctx = star.getContext('2d');
      sctx.translate(16, 16);
      sctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        sctx.moveTo(0, 0);
        sctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
        sctx.lineTo(Math.cos(a + Math.PI / 4) * 4, Math.sin(a + Math.PI / 4) * 4);
      }
      sctx.fillStyle = '#ffe27a';
      sctx.fill();
      this.starSprite = star;
    }

    add(particle) {
      if (!this.enabled) return;
      if (this.particles.length > 280) return;
      this.particles.push(particle);
    }

    hearts(x, y, count) {
      for (let i = 0; i < count; i++) {
        this.add({
          kind: 'heart',
          x: x + (Math.random() - 0.5) * 160,
          y: y + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 70,
          vy: -70 - Math.random() * 90,
          size: 26 + Math.random() * 26,
          rot: (Math.random() - 0.5) * 0.6,
          vrot: (Math.random() - 0.5) * 1.2,
          life: 1
        });
      }
    }

    sparkle(x, y, count = 10) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 150;
        this.add({
          kind: 'star',
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 40,
          size: 14 + Math.random() * 18,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 4,
          life: 1
        });
      }
    }

    bubbles(x, y, count = 6) {
      for (let i = 0; i < count; i++) {
        this.add({
          kind: 'bubble',
          x: x + (Math.random() - 0.5) * 70,
          y: y + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 20,
          vy: -50 - Math.random() * 70,
          size: 10 + Math.random() * 18,
          rot: 0,
          vrot: 0,
          life: 1
        });
      }
    }

    confetti(count = 80) {
      const palette = ['#ef5a4b', '#ffc94d', '#45b980', '#2fb2d8', '#ffffff', '#ff8fb1'];
      for (let i = 0; i < count; i++) {
        this.add({
          kind: 'confetti',
          x: 540 + (Math.random() - 0.5) * 520,
          y: 640 + (Math.random() - 0.5) * 160,
          vx: (Math.random() - 0.5) * 260,
          vy: -120 - Math.random() * 220,
          size: 8 + Math.random() * 10,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 9,
          life: 1,
          color: palette[Math.floor(Math.random() * palette.length)]
        });
      }
    }

    fireworks(bursts = 5) {
      for (let i = 0; i < bursts; i++) {
        const x = 240 + Math.random() * 600;
        const y = 560 + Math.random() * 520;
        const palette = ['#ffd76a', '#ffb347', '#7fe0ff', '#ffffff', '#ff8fb1'];
        const color = palette[Math.floor(Math.random() * palette.length)];
        for (let k = 0; k < 14; k++) {
          const angle = (Math.PI * 2 * k) / 14;
          const speed = 90 + Math.random() * 150;
          this.add({
            kind: 'star',
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 10 + Math.random() * 12,
            rot: Math.random() * Math.PI,
            vrot: (Math.random() - 0.5) * 5,
            life: 1,
            color
          });
        }
      }
    }

    update(dt) {
      this.time += dt;

      // gentle soda bubbles drifting up from the counter
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleTimer = 0.9 + Math.random() * 0.9;
        this.add({
          kind: 'bubble',
          x: 300 + Math.random() * 680,
          y: 1000 + Math.random() * 220,
          vx: (Math.random() - 0.5) * 12,
          vy: -18 - Math.random() * 22,
          size: 8 + Math.random() * 14,
          rot: 0,
          vrot: 0,
          life: 1,
          soft: true
        });
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.kind === 'confetti') p.vy += 420 * dt;
        if (p.kind === 'bubble') p.vx += Math.sin(this.time * 2 + p.y * 0.02) * 8 * dt;
        p.life -= p.soft ? dt * 0.28 : dt * 0.5;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
    }

    draw() {
      const ctx = this.ctx;
      const renderScale = this.canvas.width / this.width;
      if (Number.isFinite(renderScale) && renderScale > 0) {
        ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      }
      ctx.clearRect(0, 0, this.width, this.height);
      for (const p of this.particles) {
        const alpha = Math.max(0, Math.min(1, p.life));
        ctx.save();
        ctx.globalAlpha = p.soft ? alpha * 0.45 : alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.kind === 'heart') {
          ctx.drawImage(this.heartSprite, -p.size / 2, -p.size / 2, p.size, p.size * 0.9);
        } else if (p.kind === 'star') {
          if (p.color) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(0, 0, p.size * 0.32, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.drawImage(this.starSprite, -p.size / 2, -p.size / 2, p.size, p.size);
          }
        } else if (p.kind === 'bubble') {
          ctx.drawImage(this.bubbleSprite, -p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
        }
        ctx.restore();
      }
    }

    animate(ts) {
      requestAnimationFrame(this.animate);
      if (document.hidden) return;
      if (ts - this.lastTs < this.frameInterval) return;
      const dt = this.lastTs ? Math.min(0.06, (ts - this.lastTs) / 1000) : 0.033;
      this.lastTs = ts;
      this.update(dt);
      this.draw();
    }
  }

  window.DrinkShopFX = DrinkShopFX;
})();
