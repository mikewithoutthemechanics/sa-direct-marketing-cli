/**
 * registry-gate.js — a tiny 3D "registry gate" for the one-pager.
 *
 * Concept: records fall toward a rotating lattice. Blocked records are
 * caught and suppressed; the rest pass through. It is the product drawn.
 *
 * Written by hand rather than pulled from Three.js on purpose: this page
 * is read on a phone, and a full 3D library is ~600KB for a scene that
 * needs a perspective divide and some lines. This is a few KB, has no
 * dependencies, and degrades to nothing.
 *
 * Safety: no 2D context means nothing renders and the canvas is removed.
 * prefers-reduced-motion draws a single static frame and never starts
 * the loop. The loop pauses whenever the canvas scrolls out of view.
 */
(function (global) {
  "use strict";

  var TAU = Math.PI * 2;
  var hasCanvas = (function () {
    try { return !!document.createElement("canvas").getContext("2d"); }
    catch (e) { return false; }
  })();

  function Gate(canvas, opts) {
    if (!hasCanvas) {
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return;
    }
    opts = opts || {};

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);

    // ---- scene constants -------------------------------------------
    this.radius = opts.radius || 2.55;
    this.rings = opts.rings || 3;
    this.spokes = opts.spokes || 16;
    this.spin = opts.spin || 0.16;          // radians per second
    this.gravity = opts.gravity || 1.45;
    this.maxRecords = opts.maxRecords || 54;
    this.accent = opts.accent || "#F5A524";
    this.accentDeep = opts.accentDeep || "#B45309";
    this.slate = opts.slate || "#8B93A1";
    this.hud = opts.hud !== false;
    this.density = opts.density || 0.34;    // share of records that are blocked

    // ---- state ------------------------------------------------------
    this.t = 0;
    this.rot = 0;
    this.records = [];
    this.caught = 0;
    this.passed = 0;
    this.camX = 0; this.camY = 1.15; this.camZ = 7.4;
    this.pointerX = 0; this.pointerY = 0;    // -1..1, for parallax
    this.running = false;
    this.reduced = false;

    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);

    this._onResize();
    this._seed();               // always: the motion path needs records too
    global.addEventListener("resize", this._onResize, { passive: true });

    if (this._wantsMotion()) {
      var gate = this;
      if (typeof global.IntersectionObserver === "function") {
        this._io = new global.IntersectionObserver(function (entries) {
          gate.visible = entries[0].isIntersecting;
          if (gate.visible) gate.start(); else gate.stop();
        }, { threshold: 0.01 });
        this._io.observe(canvas);
      } else {
        // No observer (old browser, mocked env): just run it.
        this.start();
      }
    } else {
      this.reduced = true;
      this._seed();
      this._draw();
    }

    if (opts.parallax) this._bindPointer();
  }

  Gate.prototype._wantsMotion = function () {
    try {
      return !(global.matchMedia &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return true; }
  };

  Gate.prototype._onResize = function () {
    var w = this.canvas.clientWidth || 320;
    var h = this.canvas.clientHeight || 320;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.w = w; this.h = h;
    this.cx = w / 2; this.cy = h / 2;
    this.scale = Math.min(w, h) / 7.4;
    if (this.reduced) { this._seed(); this._draw(); }
  };


  Gate.prototype._bindPointer = function () {
    var self = this;
    var host = this.canvas.parentNode || this.canvas;
    function move(e) {
      var r = host.getBoundingClientRect();
      var p = e.touches ? e.touches[0] : e;
      self.pointerX = ((p.clientX - r.left) / r.width) * 2 - 1;
      self.pointerY = ((p.clientY - r.top) / r.height) * 2 - 1;
    }
    host.addEventListener("mousemove", move, { passive: true });
    host.addEventListener("touchmove", move, { passive: true });
    host.addEventListener("mouseleave", function () {
      self.pointerX = 0; self.pointerY = 0;
    }, { passive: true });
  };

  /* ---------------- records ---------------- */
  Gate.prototype._seed = function () {
    this.records.length = 0;
    for (var i = 0; i < this.maxRecords; i++) {
      this.records.push(this._makeRecord(true));
    }
  };

  Gate.prototype._makeRecord = function (scattered) {
    var a = Math.random() * TAU;
    var r = Math.sqrt(Math.random()) * (this.radius - 0.12);
    return {
      x: scattered ? (Math.random() - 0.5) * 4.4 : Math.cos(a) * r,
      y: scattered ? -0.4 + Math.random() * 4.2 : 2.4 + Math.random() * 3.2,
      z: scattered ? (Math.random() - 0.5) * 2.2 : Math.sin(a) * r,
      spin: (Math.random() - 0.5) * 1.6,
      ang: Math.random() * TAU,
      size: 0.075 + Math.random() * 0.055,
      blocked: Math.random() < this.density,
      state: "falling",
      flash: 0,
      life: 0
    };
  };

  /* ---------------- maths ---------------- */
  Gate.prototype._project = function (x, y, z) {
    var dx = x - this.camX;
    var dy = y - this.camY;
    var dz = z - this.camZ;              // negative in front of the camera
    var dist = -dz;                      // distance along the view axis
    if (dist < 0.25) dist = 0.25;        // never divide by ~0
    var f = this.camZ / dist;            // perspective divide (1.0 at the origin)
    return {
      x: this.cx + dx * this.scale * f,
      y: this.cy - dy * this.scale * f,
      f: f,
      depth: dz
    };
  };

  Gate.prototype._step = function (dt) {
    this.t += dt;
    this.rot += this.spin * dt;

    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i];
      r.ang += r.spin * dt;

      if (r.state === "falling") {
        r.y -= this.gravity * dt;
        r.x += Math.sin(this.t * 0.8 + r.ang) * 0.05 * dt;
        if (r.y <= 0) {
          var d = Math.sqrt(r.x * r.x + r.z * r.z);
          if (d <= this.radius && r.blocked) {
            r.state = "caught"; r.y = 0; r.flash = 1; r.life = 0; this.caught++;
          } else if (r.y <= -0.6) {
            r.state = "passed"; r.life = 0; this.passed++;
          }
        }
      } else if (r.state === "caught") {
        r.life += dt;
        if (r.flash > 0) r.flash = Math.max(0, r.flash - dt * 1.6);
        if (r.life > 2.4) r.state = "done";
      } else if (r.state === "passed") {
        r.life += dt;
        if (r.life > 1.1) r.state = "done";
      }
    }

    for (var j = this.records.length - 1; j >= 0; j--) {
      if (this.records[j].state === "done") {
        this.records.splice(j, 1);
        this.records.push(this._makeRecord(false));
      }
    }

    // ease the camera toward the pointer for a little depth
    this.camX += (this.pointerX * 1.15 - this.camX) * Math.min(1, dt * 2.4);
    this.camY += (1.15 - this.pointerY * 0.75 - this.camY) * Math.min(1, dt * 2.4);
  };


  /* ---------------- drawing ---------------- */
  Gate.prototype._draw = function () {
    var c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    var self = this;
    var items = [];   // depth-sorted draw list

    // --- the lattice: concentric rings, in the gate's own frame ---
    for (var ri = 0; ri <= this.rings; ri++) {
      (function (radius, ringIdx) {
        var pts = [];
        for (var a = 0; a <= 48; a++) {
          var th = (a / 48) * TAU + self.rot;
          pts.push(self._project(Math.cos(th) * radius, 0, Math.sin(th) * radius));
        }
        items.push({
          depth: 0,
          draw: function () { self._strokePath(pts, ringIdx === 0 ? 2 : 1, 0.5 + ringIdx * 0.08); }
        });
      })(this.radius * (ri / this.rings), ri);
    }

    // --- spokes ---
    for (var s = 0; s < this.spokes; s++) {
      (function (idx) {
        var th = (idx / self.spokes) * TAU + self.rot;
        var a = self._project(0, 0, 0);
        var b = self._project(Math.cos(th) * self.radius, 0, Math.sin(th) * self.radius);
        items.push({ depth: 0, draw: function () { self._stroke2(a, b, 1, 0.34); } });
      })(s);
    }

    // --- records ---
    for (var i = 0; i < this.records.length; i++) {
      (function (r) {
        var p = self._project(r.x, r.y, r.z);
        items.push({ depth: p.depth, draw: function () { self._drawRecord(r, p); } });
      })(this.records[i]);
    }

    // painter's algorithm: farthest first
    items.sort(function (a, b) { return a.depth - b.depth; });
    for (var k = 0; k < items.length; k++) items[k].draw();

    if (this.hud) this._drawHud();
  };

  Gate.prototype._strokePath = function (pts, width, alpha) {
    var c = this.ctx;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath();
    c.strokeStyle = this.slate;
    c.globalAlpha = alpha;
    c.lineWidth = width;
    c.stroke();
    c.globalAlpha = 1;
  };

  Gate.prototype._stroke2 = function (a, b, width, alpha) {
    var c = this.ctx;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.strokeStyle = this.slate;
    c.globalAlpha = alpha;
    c.lineWidth = width;
    c.stroke();
    c.globalAlpha = 1;
  };

  Gate.prototype._drawRecord = function (r, p) {
    var c = this.ctx;
    var s = r.size * p.f * this.scale;
    if (s < 0.4) return;

    var alpha = 1;
    if (r.state === "passed") alpha = Math.max(0, 1 - r.life / 1.1) * 0.7;
    if (r.state === "caught") alpha = Math.max(0, 1 - (r.life - 1.4) / 1.0) * 0.95;

    c.save();
    c.translate(p.x, p.y);
    c.rotate(r.ang);

    if (r.state === "caught") {
      // a blocked record squares up and flares amber
      c.globalAlpha = alpha;
      c.fillStyle = r.flash > 0 ? this.accent : this.accentDeep;
      c.shadowBlur = 8 + r.flash * 14;
      c.shadowColor = this.accent;
      c.fillRect(-s, -s, s * 2, s * 2);
    } else if (r.state === "passed") {
      c.globalAlpha = alpha;
      c.strokeStyle = this.slate;
      c.lineWidth = 1;
      c.strokeRect(-s, -s, s * 2, s * 2);
    } else {
      // falling records: small diamonds
      c.globalAlpha = 0.9;
      c.fillStyle = this.slate;
      c.beginPath();
      c.moveTo(0, -s * 1.5);
      c.lineTo(s, 0);
      c.lineTo(0, s * 1.5);
      c.lineTo(-s, 0);
      c.closePath();
      c.fill();
    }
    c.restore();
    c.globalAlpha = 1;
    c.shadowBlur = 0;
  };

  Gate.prototype._drawHud = function () {
    var c = this.ctx;
    c.save();
    c.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    c.textBaseline = "bottom";
    c.globalAlpha = 0.9;

    c.fillStyle = this.accent;
    c.textAlign = "left";
    c.fillText("BLOCKED  " + this.caught, 10, this.h - 10);

    c.fillStyle = this.slate;
    c.textAlign = "right";
    c.fillText("CLEARED  " + this.passed, this.w - 10, this.h - 10);

    c.restore();
  };

  /* ---------------- loop ---------------- */
  Gate.prototype.start = function () {
    if (this.running || this.reduced) return;
    this.running = true;
    this._last = null;
    this._raf = global.requestAnimationFrame(this._loop);
  };

  Gate.prototype.stop = function () {
    this.running = false;
    if (this._raf) global.cancelAnimationFrame(this._raf);
  };

  Gate.prototype._loop = function (ts) {
    if (!this.running) return;
    if (this._last == null) this._last = ts;
    var dt = Math.min((ts - this._last) / 1000, 0.05);
    this._last = ts;
    this._step(dt);
    this._draw();
    this._raf = global.requestAnimationFrame(this._loop);
  };

  global.RegistryGate = { create: function (c, o) { return new Gate(c, o); } };
})(typeof window !== "undefined" ? window : this);
