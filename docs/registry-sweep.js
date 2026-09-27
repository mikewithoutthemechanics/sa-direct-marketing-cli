/**
 * registry-sweep.js — the monthly cleanse, drawn literally.
 *
 * Replaces an earlier 3D "gate" that turned out to be the wrong object:
 * a rotating lattice reads as an AI or crypto product, which is the
 * opposite of what this page is selling. Compliance sells evidence and a
 * register, so the picture is a register.
 *
 * What you see:
 *   left   YOUR LIST - contacts moving up through a sweep line
 *   right  DNC REGISTER - every blocked contact that gets caught
 * Blocked records stop, turn amber, and move across into the register.
 * Cleared records simply pass and are counted. That is the actual job,
 * performed monthly, and it produces exactly the two artefacts the
 * service is priced on: a suppressed list and a dated register.
 *
 * Canvas 2D, no dependencies, ~6KB, works offline. Deliberately NOT 3D:
 * this is a ledger, not a spectacle.
 *
 * Safety: no 2D context removes the canvas; prefers-reduced-motion draws
 * one static frame and never starts the loop; the loop pauses when the
 * canvas scrolls out of view.
 */
(function (global) {
  "use strict";

  var MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  var hasCanvas = (function () {
    try { return !!global.document.createElement("canvas").getContext("2d"); }
    catch (e) { return false; }
  })();

  function Sweep(canvas, opts) {
    if (!hasCanvas) {
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return;
    }
    opts = opts || {};

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);

    this.ink = opts.ink || "#0E1116";
    this.steel = opts.steel || "#4A5260";
    this.mute = opts.mute || "#8B93A1";
    this.line = opts.line || "#E3E7ED";
    this.surface = opts.surface || "#F5F6F8";
    this.accent = opts.accent || "#F5A524";
    this.accentDeep = opts.accentDeep || "#B45309";
    this.accentSoft = opts.accentSoft || "#FEF3E2";

    this.rate = opts.rate || 5.2;         // records per second
    this.density = opts.density || 0.34;  // share of records that are blocked
    this.maxVisible = opts.maxVisible || 14;
    this.hud = opts.hud !== false;

    // state
    this.t = 0;
    this.records = [];
    this.sweepY = 0;      // set in _layout
    this.checked = 0;
    this.suppressed = 0;
    this.cleared = 0;
    this.register = [];   // the DNC register, newest first
    this.locked = null;   // { nums, isBlocked } when driven by the demo

    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);

    this._onResize();
    this._seed();
    global.addEventListener("resize", this._onResize, { passive: true });

    if (this._wantsMotion()) {
      var self = this;
      if (typeof global.IntersectionObserver === "function") {
        this._io = new global.IntersectionObserver(function (entries) {
          var vis = entries[0].isIntersecting;
          if (vis) self.start(); else self.stop();
        }, { threshold: 0.01 });
        this._io.observe(canvas);
      } else {
        this.start();
      }
    } else {
      this.reduced = true;
      this._draw();
    }
  }

  Sweep.prototype._wantsMotion = function () {
    try {
      return !(global.matchMedia &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return true; }
  };

  Sweep.prototype._onResize = function () {
    var w = this.canvas.clientWidth || 320;
    var h = this.canvas.clientHeight || 320;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.w = w; this.h = h;
    this.rowH = Math.max(15, Math.min(21, Math.round(h / 17)));
    this.sweepY = Math.round(h * 0.58);
    this._layoutColumns();
    if (this.reduced) this._draw();
  };

  /** Two columns with a gutter, or stacked on a narrow canvas. */
  Sweep.prototype._layoutColumns = function () {
    var pad = 14;
    var gutter = 16;
    var stacked = this.w < 420;
    if (stacked) {
      this.stack = true;
      this.leftX = pad;
      this.leftW = this.w - pad * 2;
      this.rightX = pad;
      this.rightW = this.w - pad * 2;
      this.regTop = Math.round(this.h * 0.60);
      this.sweepY = Math.round(this.h * 0.44);
    } else {
      this.stack = false;
      var colW = Math.floor((this.w - pad * 2 - gutter) / 2);
      this.leftX = pad; this.leftW = colW;
      this.rightX = pad + colW + gutter; this.rightW = colW;
      this.regTop = Math.round(this.rowH * 2.2);
      this.sweepY = Math.round(this.h * 0.58);
    }
  };


  /* ---------------- records ---------------- */
  function randNum() {
    var pre = ["082", "083", "072", "071", "061", "074", "079", "063"];
    return pre[Math.floor(Math.random() * pre.length)] +
           String(Math.floor(Math.random() * 10000000)).padStart(7, "0");
  }

  var nextId = 1;

  Sweep.prototype._make = function () {
    return {
      rid: nextId++,        // stable identity, so a record and its register
      num: randNum(),       // entry can be matched while crossing over
      off: 0,               // distance travelled, in rows
      state: "moving",      // moving | caught | passing
      x: 0,                 // progress crossing into the register
      alpha: 1,
      entry: undefined,
      blocked: undefined    // decided when it reaches the sweep line
    };
  };

  Sweep.prototype._seed = function () {
    this.records.length = 0;
    for (var i = 0; i < this.maxVisible; i++) {
      var r = this._make();
      r.off = (i / this.maxVisible) * 13;
      this.records.push(r);
    }
  };

  /**
   * Drive the sweep with specific numbers so an interactive demo and this
   * picture can never disagree. `isBlocked` is a predicate.
   */
  Sweep.prototype.setRecords = function (nums, isBlocked) {
    this.records.length = 0;
    this.register.length = 0;
    this.checked = 0; this.suppressed = 0; this.cleared = 0;
    this.locked = { nums: nums, isBlocked: isBlocked };
    var self = this;
    nums.forEach(function (n, i) {
      var r = self._make();
      r.num = n;
      r.blocked = isBlocked ? !!isBlocked(n) : false;
      r.off = 13 - (i / nums.length) * 13;
      self.records.push(r);
    });
  };

  /* ---------------- step ---------------- */
  Sweep.prototype._step = function (dt) {
    this.t += dt;
    var speed = this.locked ? 2.0 : this.rate;   // rows per second

    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i];

      if (r.state === "moving") {
        // ease into motion: records should arrive with a little weight
        // rather than snapping to speed, which is what made the first
        // version look mechanical
        r.ease = r.ease === undefined ? 0 : r.ease;
        r.ease = Math.min(1, r.ease + dt * 2.6);
        var ramp = 0.55 + 0.45 * (r.ease * r.ease * (3 - 2 * r.ease)); // smoothstep
        r.off += speed * ramp * dt;

        if (r.off >= 13) {
          this.checked++;
          if (r.blocked === undefined) r.blocked = Math.random() < this.density;
          if (r.blocked) {
            r.state = "caught";
            r.x = 0;
            r.flare = 1;
            this.suppressed++;
            this.register.unshift({ num: r.num, born: this.t, rid: r.rid });
            if (this.register.length > 40) this.register.pop();
          } else {
            r.state = "passing";
            this.cleared++;
          }
        }
      } else if (r.state === "caught") {
        // quick out, slow in: the record leaves briskly and settles into
        // its slot, so the register reads as receiving it deliberately
        r.x = Math.min(1, r.x + dt * 1.55);
        var e = r.x;
        e = 1 - Math.pow(1 - e, 3);                    // easeOutCubic
        r.alpha = e > 0.82 ? Math.max(0, 1 - (e - 0.82) / 0.18) : 1;
        if (r.flare > 0) r.flare = Math.max(0, r.flare - dt * 1.9);
      } else if (r.state === "passing") {
        r.off += speed * dt;
        r.alpha = Math.max(0, 1 - (r.off - 13) / 5);
      }
    }

    // retire finished records and top the feed back up.
    // In locked (demo) mode we do NOT refill: the visitor's list is finite
    // and the counters must settle on exactly what they pasted, or the
    // picture would contradict the table above it.
    for (var j = this.records.length - 1; j >= 0; j--) {
      if (this.records[j].off > 19 || this.records[j].alpha <= 0) {
        this.records.splice(j, 1);
        if (!this.locked && this.records.length < this.maxVisible) {
          this.records.push(this._make());
        }
      }
    }
    this.records.sort(function (a, b) { return b.off - a.off; });
  };


  /* ---------------- drawing ---------------- */
  /** The register entry this caught record belongs to (identity match). */
  Sweep.prototype._entryOf = function (r) {
    if (r.entry === undefined) {
      for (var i = 0; i < this.register.length; i++) {
        if (this.register[i].rid === r.rid) { r.entry = this.register[i]; break; }
      }
    }
    return r.entry;
  };

  Sweep.prototype._draw = function () {
    var c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    this._drawColumns();
    this._drawList();
    this._drawSweepLine();
    this._drawRegister();
    if (this.hud) this._drawHud();
  };

  Sweep.prototype._drawColumns = function () {
    var c = this.ctx;
    c.save();
    c.font = "700 10px " + SANS;
    c.fillStyle = this.mute;
    c.textBaseline = "top";
    c.fillText("YOUR LIST", this.leftX, 10);
    c.fillText("DNC REGISTER", this.rightX, 10);

    var leftH = this.stack ? this.sweepY - 20 : this.h - 34;
    c.fillStyle = this.surface;
    roundRect(c, this.leftX - 6, 26, this.leftW + 12, leftH, 10);
    c.fill();

    var regY = this.stack ? this.regTop - 22 : 26;
    var regH = this.stack ? this.h - this.regTop - 8 : this.h - 34;
    c.fillStyle = this.accentSoft;
    roundRect(c, this.rightX - 6, regY, this.rightW + 12, regH, 10);
    c.fill();

    c.strokeStyle = this.line;
    c.lineWidth = 1;
    c.strokeRect(this.leftX - 6.5, 26.5, this.leftW + 12, leftH);
    c.restore();
  };

  Sweep.prototype._drawList = function () {
    var c = this.ctx;
    c.save();
    c.font = "500 11px " + MONO;
    c.textBaseline = "middle";

    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i];
      if (r.state === "caught" && r.x < 0.08) continue;
      var y = this.sweepY - (r.off - 13) * this.rowH;
      if (y < 32 || y > this.h - 12) continue;

      if (r.state === "passing") {
        c.globalAlpha = r.alpha;
        c.fillStyle = this.mute;
        c.fillText(r.num, this.leftX, y);
      } else if (r.state === "caught") {
        // crossing over into the register column
        var slot = this.register.indexOf(this._entryOf(r));
        var ty = this.regTop + 8 + (slot < 0 ? 0 : slot) * this.rowH;
        var tx = this.leftX + (this.rightX - this.leftX) * r.x;
        var ty2 = y + (ty - y) * r.x;

        // a brief glow behind the record at the moment of capture, so the
        // eye is drawn to the catch rather than having to find it
        if (r.flare > 0) {
          c.globalAlpha = r.flare * 0.5;
          c.fillStyle = this.accent;
          c.beginPath();
          c.arc(this.leftX + (tx - this.leftX) * 0.35,
                y + (ty2 - y) * 0.35, 11, 0, Math.PI * 2);
          c.fill();
        }
        c.globalAlpha = r.alpha;
        c.fillStyle = this.accentDeep;
        c.fillText(r.num, tx, ty2);
      } else {
        c.globalAlpha = r.alpha * 0.92;
        c.fillStyle = this.steel;
        c.fillText(r.num, this.leftX, y);
      }
    }
    c.restore();
  };

  Sweep.prototype._drawSweepLine = function () {
    var c = this.ctx;
    c.save();
    c.strokeStyle = this.accent;
    c.globalAlpha = 0.85;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(this.leftX - 10, this.sweepY + 0.5);
    c.lineTo(this.leftX + this.leftW + 10, this.sweepY + 0.5);
    c.stroke();

    c.globalAlpha = 1;
    c.fillStyle = this.accent;
    c.beginPath();
    c.moveTo(this.leftX - 10, this.sweepY);
    c.lineTo(this.leftX - 15, this.sweepY - 4);
    c.lineTo(this.leftX - 15, this.sweepY + 4);
    c.closePath();
    c.fill();
    c.restore();
  };

  Sweep.prototype._drawRegister = function () {
    var c = this.ctx;
    c.save();
    c.font = "500 11px " + MONO;
    c.textBaseline = "middle";

    // stop the register above the HUD band so the two never overlap
    var cap = Math.max(3, Math.floor((this.h - this.regTop - 34) / this.rowH));
    for (var i = 0; i < Math.min(this.register.length, cap); i++) {
      var e = this.register[i];
      var y = this.regTop + 8 + i * this.rowH;
      var age = this.t - e.born;

      // the newest entry arrives with a wipe that decays: the register
      // visibly RECEIVES the record, which is the whole point of the
      // right-hand column
      if (age < 0.55) {
        var k = age / 0.55;
        c.globalAlpha = 0.22 * (1 - k);
        c.fillStyle = this.accent;
        c.fillRect(this.rightX - 6, y - this.rowH / 2 - 1, this.rightW + 12, this.rowH);
        c.globalAlpha = 1;
        // a short amber lead-in that draws in from the left
        c.globalAlpha = (1 - k) * 0.9;
        c.fillRect(this.rightX - 6, y - this.rowH / 2 - 1,
                   Math.max(0, (this.rightW + 12) * k), this.rowH);
        c.globalAlpha = 1;
      }
      c.fillStyle = this.accentDeep;
      c.fillText(e.num, this.rightX, y);
    }
    c.restore();
  };

  Sweep.prototype._drawHud = function () {
    var c = this.ctx;
    c.save();
    c.font = "700 11px " + SANS;
    c.textBaseline = "bottom";
    // sit the counters inside a small inset, not hard against the edge,
    // so descenders are not clipped on a low-DPI screen
    var y = this.h - 12;

    c.textAlign = "left";
    c.fillStyle = this.steel;
    c.fillText("CHECKED " + this.checked, 16, y);
    c.textAlign = "right";
    c.fillStyle = this.accentDeep;
    c.fillText("SUPPRESSED " + this.suppressed, this.w - 16, y);
    c.restore();
  };

  /* ---------------- loop ---------------- */
  Sweep.prototype.start = function () {
    if (this.running || this.reduced) return;
    this.running = true;
    this._last = null;
    this._raf = global.requestAnimationFrame(this._loop);
  };

  Sweep.prototype.stop = function () {
    this.running = false;
    if (this._raf) global.cancelAnimationFrame(this._raf);
  };

  Sweep.prototype._loop = function (ts) {
    if (!this.running) return;
    if (this._last == null) this._last = ts;
    var dt = Math.min((ts - this._last) / 1000, 0.05);
    this._last = ts;
    this._step(dt);
    this._draw();
    this._raf = global.requestAnimationFrame(this._loop);
  };

  /* ---------------- shared helper ---------------- */
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  global.RegistrySweep = { create: function (c, o) { return new Sweep(c, o); } };
})(typeof window !== "undefined" ? window : this);
