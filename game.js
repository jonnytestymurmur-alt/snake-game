/* ==========================================================================
   Neon Serpent — retro arcade snake
   Vanilla JS, no dependencies. Sections:
     1. Config          5. DOM references
     2. Storage         6. Board rendering
     3. Pixel font      7. Game logic
     4. Audio           8. Input + loop + boot
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Config
   * ------------------------------------------------------------------ */

  var COLS = 21;
  var ROWS = 21;
  var START_LENGTH = 4;

  var BASE_STEP_MS = 150;   // ms per move at level 1
  var STEP_DECAY_MS = 8;    // ms shaved off per level
  var MIN_STEP_MS = 70;     // speed ceiling
  var FOOD_PER_LEVEL = 3;
  var MAX_LEVEL = 12;

  var DEATH_MS = 760;       // game-over animation
  var COUNT_MS = 560;       // per countdown beat

  var KEY_BEST = 'neon-serpent:best';
  var KEY_MUTED = 'neon-serpent:muted';

  var DIRS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  var reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* ------------------------------------------------------------------ *
   * 2. Storage — localStorage with an in-memory fallback
   * ------------------------------------------------------------------ */

  var store = (function () {
    var memory = {};
    var persistent = false;
    try {
      var probe = '__neon_serpent_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      persistent = true;
    } catch (err) {
      persistent = false;
    }
    // `persistent` is public because it also drives the game-over notice, and a
    // write can fail long after the probe succeeded — a full quota, or Safari
    // revoking storage mid-session. The first failed write demotes the whole
    // session to memory so the notice is honest about where the score lives.
    var api = {
      persistent: persistent,
      get: function (key) {
        // Anything written this session is authoritative: after a failed write
        // localStorage holds a stale value, and returning it would lose points.
        if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
        if (api.persistent) {
          try { return window.localStorage.getItem(key); } catch (err) { /* fall through */ }
        }
        return null;
      },
      set: function (key, value) {
        memory[key] = String(value);
        if (api.persistent) {
          try {
            window.localStorage.setItem(key, String(value));
          } catch (err) {
            api.persistent = false;
          }
        }
      }
    };
    return api;
  }());

  /* ------------------------------------------------------------------ *
   * 3. Pixel font — 5x7 bitmap glyphs, each row is 5 bits (MSB = left)
   * ------------------------------------------------------------------ */

  var GLYPH_W = 5;
  var GLYPH_H = 7;
  var TRACKING = 1; // empty columns between glyphs

  var FONT = {
    'A': [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    'B': [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
    'C': [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
    'D': [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
    'E': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
    'F': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
    'G': [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0E],
    'H': [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    'I': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1F],
    'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
    'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
    'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
    'M': [0x11, 0x1B, 0x15, 0x11, 0x11, 0x11, 0x11],
    'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
    'O': [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    'P': [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
    'Q': [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
    'R': [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
    'S': [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
    'T': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
    'W': [0x11, 0x11, 0x11, 0x11, 0x15, 0x1B, 0x11],
    'X': [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
    'Y': [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
    'Z': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
    '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
    '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
    '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
    '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
    '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
    '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
    '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
    '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
    '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
    '?': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
    '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04],
    '-': [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
    ':': [0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00]
  };

  var TONES = {
    cyan:  { fill: '#5ef3ff', glow: 'rgba(94, 243, 255, 0.85)' },
    pink:  { fill: '#ff2d87', glow: 'rgba(255, 45, 135, 0.85)' },
    amber: { fill: '#ffc75a', glow: 'rgba(255, 199, 90, 0.75)' }
  };

  function glyphColumns(text) {
    return text.length * GLYPH_W + Math.max(0, text.length - 1) * TRACKING;
  }

  function stampGlyphs(ctx, text, scale, offsetX, offsetY) {
    var col = 0;
    for (var i = 0; i < text.length; i++) {
      var glyph = FONT[text[i]] || FONT['?'];
      for (var row = 0; row < GLYPH_H; row++) {
        var bits = glyph[row];
        if (!bits) continue;
        for (var c = 0; c < GLYPH_W; c++) {
          if (bits & (1 << (GLYPH_W - 1 - c))) {
            ctx.fillRect(offsetX + (col + c) * scale, offsetY + row * scale, scale, scale);
          }
        }
      }
      col += GLYPH_W + TRACKING;
    }
  }

  /** Padding around the glyphs, which the glow and the title's offset live in. */
  function pixelPad(scale) {
    return Math.max(2, Math.round(scale * 1.4));
  }

  /** CSS width the canvas will take for this text at this scale. */
  function pixelWidth(text, scale) {
    return glyphColumns(String(text).toUpperCase()) * scale + pixelPad(scale) * 2;
  }

  /**
   * Render pixel text into a canvas element.
   * `tone: 'title'` gets a chromatic pink offset behind a cyan gradient.
   */
  function renderPixelText(canvas, text, tone, scale) {
    text = String(text).toUpperCase();
    var isTitle = tone === 'title';
    var palette = TONES[tone] || TONES.cyan;
    var pad = pixelPad(scale);
    var cssW = pixelWidth(text, scale);
    var cssH = GLYPH_H * scale + pad * 2;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (isTitle) {
      ctx.fillStyle = 'rgba(255, 45, 135, 0.9)';
      stampGlyphs(ctx, text, scale, pad + scale, pad + scale);

      var grad = ctx.createLinearGradient(0, pad, 0, pad + GLYPH_H * scale);
      grad.addColorStop(0, '#d8feff');
      grad.addColorStop(0.55, '#5ef3ff');
      grad.addColorStop(1, '#2bb6cf');
      ctx.shadowColor = 'rgba(94, 243, 255, 0.55)';
      ctx.shadowBlur = scale * 2.2;
      ctx.fillStyle = grad;
      stampGlyphs(ctx, text, scale, pad, pad);
      ctx.shadowBlur = 0;
      return;
    }

    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = scale * 1.6;
    ctx.fillStyle = palette.fill;
    stampGlyphs(ctx, text, scale, pad, pad);
    ctx.shadowBlur = 0;
  }

  /**
   * Width budget for a pixel-text element. Its own box is shrink-wrapped around
   * the canvas we are about to size, so it cannot be the constraint — measure
   * the nearest ancestor whose width comes from the layout instead.
   */
  function measureContainer(el) {
    var host = el.closest('.overlay, .hud') || el.parentElement;
    if (!host || !host.clientWidth) return 280;
    var styles = window.getComputedStyle(host);
    var inner = host.clientWidth
      - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    return Math.max(0, (inner > 0 ? inner : 280) - rowReservation(el));
  }

  /**
   * Width a readout has to leave for whatever shares its row. The game-over
   * tally sets its score beside a label column, so the number gets the row
   * minus that column, not the whole screen — measured rather than assumed, so
   * it follows the stylesheet.
   */
  function rowReservation(el) {
    var row = el.closest('.tally__row');
    if (!row) return 0;
    var gap = parseFloat(window.getComputedStyle(row).columnGap) || 0;
    var taken = 0;
    for (var i = 0; i < row.children.length; i++) {
      var sibling = row.children[i];
      if (sibling === el || sibling.contains(el)) continue;
      taken += sibling.getBoundingClientRect().width + gap;
    }
    return taken;
  }

  /**
   * Largest integer scale at which this element's glyphs still fit. Asks the
   * renderer for the width it would produce rather than approximating it, so a
   * five-digit score cannot end up a pixel wider than its budget.
   */
  function fitScale(el, baseScale) {
    var text = String(el.dataset.pixel || '').toUpperCase() || '0';
    var budget = measureContainer(el);
    for (var scale = baseScale; scale > 1; scale--) {
      if (pixelWidth(text, scale) <= budget) return scale;
    }
    return 1;
  }

  function groupMembers(group) {
    return document.querySelectorAll('[data-pixel-group="' + group + '"]');
  }

  /**
   * Readouts that sit side by side (the scoreboard, the final tally) share one
   * scale, so a long score never renders smaller than the label next to it.
   */
  function scaleFor(el, baseScale) {
    var group = el.dataset.pixelGroup;
    if (!group) return fitScale(el, baseScale);

    var peers = groupMembers(group);
    var scale = baseScale;
    for (var i = 0; i < peers.length; i++) {
      scale = Math.min(scale, fitScale(peers[i], baseScale));
    }
    return scale;
  }

  /** Every [data-pixel] element owns one canvas that is re-fit on resize. */
  function paintPixelElement(el) {
    var text = String(el.dataset.pixel || '').toUpperCase();
    var tone = el.dataset.tone || 'cyan';
    var baseScale = parseInt(el.dataset.scale, 10) || 4;
    var canvas = el.querySelector('canvas');

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'pixel-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      el.appendChild(canvas);
      // The glyphs live in a canvas, so the element carries the text for
      // assistive tech. Headings keep their own role.
      if (!el.hasAttribute('role') && !/^H[1-6]$/.test(el.tagName)) {
        el.setAttribute('role', 'img');
      }
    }
    el.setAttribute('aria-label', text);

    renderPixelText(canvas, text, tone, scaleFor(el, baseScale));
  }

  function setPixelText(el, text) {
    if (String(el.dataset.pixel) === String(text)) return;
    el.dataset.pixel = String(text);

    // A longer value can shrink the whole group, so repaint its peers too.
    var group = el.dataset.pixelGroup;
    if (!group) { paintPixelElement(el); return; }
    var peers = groupMembers(group);
    for (var i = 0; i < peers.length; i++) paintPixelElement(peers[i]);
  }

  function repaintAllPixelText() {
    var nodes = document.querySelectorAll('[data-pixel]');
    for (var i = 0; i < nodes.length; i++) paintPixelElement(nodes[i]);
  }

  /* ------------------------------------------------------------------ *
   * 4. Audio — chiptune blips, created lazily on first user gesture
   * ------------------------------------------------------------------ */

  var MASTER_GAIN = 0.16;

  var audio = {
    ctx: null,
    master: null,
    muted: store.get(KEY_MUTED) === '1',

    context: function () {
      if (this.muted) return null;
      if (!this.ctx) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        try {
          this.ctx = new Ctor();
          this.master = this.ctx.createGain();
          this.master.gain.value = MASTER_GAIN;
          this.master.connect(this.ctx.destination);
        } catch (err) {
          this.ctx = null;
          return null;
        }
      }
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
      return this.ctx;
    },

    /**
     * Mute at the master gain, not only at the source. Effects are scheduled
     * ahead of time — the game-over fanfare queues a full second of notes in
     * one go — so refusing to create new ones leaves the tail of the last one
     * playing after the button already says SFX OFF. A short ramp rather than
     * a jump: cutting a live oscillator to zero in one sample block clicks.
     */
    setMuted: function (value) {
      this.muted = value;
      if (!this.master) return;
      var gain = this.master.gain;
      var now = this.ctx.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(value ? 0 : MASTER_GAIN, now + 0.02);
    },

    tone: function (opts) {
      var ctx = this.context();
      if (!ctx) return;
      var start = ctx.currentTime + (opts.delay || 0);
      var dur = opts.dur || 0.08;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = opts.type || 'square';
      osc.frequency.setValueAtTime(opts.freq, start);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, start + dur);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(opts.vol || 0.7, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + dur + 0.03);
    },

    eat: function () {
      this.tone({ freq: 660, dur: 0.06, vol: 0.5 });
      this.tone({ freq: 990, dur: 0.09, delay: 0.055, vol: 0.45 });
    },
    levelUp: function () {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], dur: 0.09, delay: i * 0.065, vol: 0.4 });
      }
    },
    start: function () {
      this.tone({ freq: 392, dur: 0.09, vol: 0.4 });
      this.tone({ freq: 587, dur: 0.14, delay: 0.09, vol: 0.4 });
    },
    countBeat: function (isFinal) {
      this.tone({ freq: isFinal ? 880 : 440, dur: isFinal ? 0.16 : 0.07, vol: 0.4 });
    },
    pause: function (resuming) {
      this.tone({ freq: resuming ? 440 : 330, dur: 0.07, type: 'triangle', vol: 0.5 });
    },
    gameOver: function () {
      var notes = [440, 349, 262, 175];
      for (var i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], dur: 0.18, delay: i * 0.12, type: 'sawtooth', vol: 0.35 });
      }
      this.tone({ freq: 90, to: 55, dur: 0.6, delay: 0.42, type: 'square', vol: 0.3 });
    },
    turn: function () {
      this.tone({ freq: 210, dur: 0.025, type: 'triangle', vol: 0.22 });
    }
  };

  /* ------------------------------------------------------------------ *
   * 5. DOM references
   * ------------------------------------------------------------------ */

  var cabinet = document.querySelector('.cabinet');
  var stage = document.getElementById('stage');
  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var overlay = document.getElementById('overlay');
  var statScore = document.getElementById('stat-score');
  var statBest = document.getElementById('stat-best');
  var statLevel = document.getElementById('stat-level');
  var finalScore = document.getElementById('final-score');
  var finalBest = document.getElementById('final-best');
  var recordBanner = document.getElementById('record-banner');
  var countdownText = document.getElementById('countdown-text');
  var storageNote = document.getElementById('storage-note');
  var sfxToggle = document.getElementById('sfx-toggle');
  var sfxText = document.getElementById('sfx-text');
  var actionBtn = document.getElementById('action-btn');
  var liveStatus = document.getElementById('live-status');

  /* ------------------------------------------------------------------ *
   * 6. Board sizing + rendering
   * ------------------------------------------------------------------ */

  var cell = 20;      // CSS px per grid cell
  var boardSize = 0;  // CSS px, square

  var BOARD_MAX = 580; // widest the cabinet ever goes, for legibility not fit
  var BOARD_MIN = 180; // below this the arena stops being readable

  /**
   * Give the cabinet the widest square board that still leaves room for the
   * marquee, HUD and controls stacked around it.
   *
   * It has to be measured rather than declared: the cabinet is as wide as the
   * board, and the chrome is as tall as that width makes it — the pixel title
   * drops to a smaller integer scale as it narrows, the controls rewrap. So the
   * size of the board depends on a height that depends on the size of the board.
   * Guessing a constant was wrong by up to 81px across the width range. Instead
   * start from the widest candidate and re-measure; the estimate only ever
   * shrinks, so it settles, in practice on the second pass.
   *
   * The side-by-side layout puts the chrome beside the board instead, which
   * breaks the circle — CSS sizes that one, and says so through --layout.
   */
  function fitCabinet() {
    if (window.getComputedStyle(cabinet).getPropertyValue('--layout').trim() === 'side') {
      cabinet.classList.remove('is-tight');
      cabinet.style.removeProperty('--board');
      return;
    }

    var page = window.getComputedStyle(document.body);
    var room = function (side) { return parseFloat(page['padding' + side]) || 0; };
    var availW = document.documentElement.clientWidth - room('Left') - room('Right');
    var availH = document.documentElement.clientHeight - room('Top') - room('Bottom');

    // Always weigh the full cabinet first, so growing the window undoes the trim.
    cabinet.classList.remove('is-tight');
    if (settle(availW, availH) <= BOARD_MIN) {
      // The board has hit its floor, which means the chrome no longer fits
      // around it: the cabinet sheds its trimmings and measures again rather
      // than push the controls off the bottom of the screen.
      cabinet.classList.add('is-tight');
      settle(availW, availH);
    }
  }

  /** Shrink --board until the chrome fits beside it; returns the size it settled on. */
  function settle(availW, availH) {
    var size = Math.min(availW, BOARD_MAX);

    for (var pass = 0; pass < 4; pass++) {
      cabinet.style.setProperty('--board', size + 'px');
      repaintAllPixelText(); // the title's scale follows the width it is given
      var chrome = cabinet.offsetHeight - stage.offsetHeight;
      var fits = Math.max(BOARD_MIN, Math.min(size, Math.floor(availH - chrome)));
      if (fits >= size) break;
      size = fits;
    }
    return size;
  }

  function resizeBoard() {
    var styles = window.getComputedStyle(stage);
    var inner = stage.clientWidth
      - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    cell = Math.max(6, Math.floor(inner / COLS));
    boardSize = cell * COLS;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = boardSize + 'px';
    canvas.style.height = boardSize + 'px';
    canvas.width = Math.round(boardSize * dpr);
    canvas.height = Math.round(boardSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBackdrop() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, boardSize, boardSize);

    // Grid
    ctx.strokeStyle = 'rgba(94, 243, 255, 0.075)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < COLS; i++) {
      var p = Math.round(i * cell) + 0.5;
      ctx.moveTo(p, 0); ctx.lineTo(p, boardSize);
      ctx.moveTo(0, p); ctx.lineTo(boardSize, p);
    }
    ctx.stroke();

    // Brighter tick at every fourth intersection — a subtle arcade lattice
    ctx.fillStyle = 'rgba(94, 243, 255, 0.16)';
    for (var gx = 4; gx < COLS; gx += 4) {
      for (var gy = 4; gy < ROWS; gy += 4) {
        ctx.fillRect(Math.round(gx * cell) - 1, Math.round(gy * cell) - 1, 2, 2);
      }
    }

    // Playfield wall
    ctx.strokeStyle = 'rgba(94, 243, 255, 0.22)';
    ctx.strokeRect(0.5, 0.5, boardSize - 1, boardSize - 1);
  }

  /**
   * Glow is dialled back behind the menu scrims — a wide bloom under a dim
   * overlay reads as a smudge rather than as neon.
   */
  function glowFactor() {
    return (phase === 'attract' || phase === 'over' || phase === 'paused') ? 0.25 : 1;
  }

  function drawFood(time) {
    if (!food) return;
    var pulse = reduceMotion.matches ? 0.5 : (Math.sin(time / 260) + 1) / 2;
    var cx = (food.x + 0.5) * cell;
    var cy = (food.y + 0.5) * cell;
    var r = cell * (0.26 + pulse * 0.05);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = 'rgba(255, 45, 135, 0.9)';
    ctx.shadowBlur = cell * (0.5 + pulse * 0.45) * glowFactor();
    ctx.fillStyle = '#ff2d87';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 214, 233, 0.92)';
    ctx.fillRect(-r * 0.34, -r * 0.34, r * 0.68, r * 0.68);
    ctx.restore();
  }

  function segmentPoint(index, alpha) {
    var current = snake[index];
    var previous = prevSnake[Math.min(index, prevSnake.length - 1)] || current;
    return {
      x: (previous.x + (current.x - previous.x) * alpha + 0.5) * cell,
      y: (previous.y + (current.y - previous.y) * alpha + 0.5) * cell
    };
  }

  var BODY_NEAR = [94, 243, 255];   // just behind the head
  var BODY_FAR = [16, 106, 134];    // tail
  var DYING_NEAR = [255, 45, 135];
  var DYING_FAR = [104, 16, 52];

  function mixRgb(a, b, t) {
    return 'rgb(' +
      Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  function tracePath(points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  }

  function drawSnake(alpha, time) {
    var points = [];
    for (var i = 0; i < snake.length; i++) points.push(segmentPoint(i, alpha));

    var head = points[0];
    var dying = phase === 'dying';
    var flashOn = dying && !reduceMotion.matches && Math.floor(deathElapsed / 90) % 2 === 0;
    var near = dying ? (flashOn ? [255, 255, 255] : DYING_NEAR) : BODY_NEAR;
    var far = dying ? (flashOn ? [255, 170, 205] : DYING_FAR) : BODY_FAR;
    var segments = Math.max(1, points.length - 1);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length > 1) {
      // 1. Soft halo along the whole body
      ctx.strokeStyle = dying ? 'rgba(255, 45, 135, 0.18)' : 'rgba(94, 243, 255, 0.13)';
      ctx.lineWidth = cell * 1.3;
      ctx.shadowColor = dying ? 'rgba(255, 45, 135, 0.75)' : 'rgba(94, 243, 255, 0.55)';
      ctx.shadowBlur = cell * (0.6 + eatFlash * 1.1) * glowFactor();
      tracePath(points);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 2. Tapered rim, then 3. the tapered body. Two passes so the rim never
      //    cuts into a segment that was drawn before it.
      var rim = Math.max(1.5, cell * 0.07);
      var width = function (i) { return cell * (0.72 - 0.2 * (i / segments)); };
      var pass;
      for (pass = 0; pass < 2; pass++) {
        for (var s = 0; s < segments; s++) {
          var t = s / segments;
          ctx.strokeStyle = pass === 0 ? 'rgba(4, 14, 20, 0.8)' : mixRgb(near, far, t);
          ctx.lineWidth = pass === 0 ? width(s) + rim * 2 : width(s);
          ctx.beginPath();
          ctx.moveTo(points[s].x, points[s].y);
          ctx.lineTo(points[s + 1].x, points[s + 1].y);
          ctx.stroke();
        }
      }

    }

    drawHead(head, dying, time);
  }

  function drawHead(head, dying, time) {
    var size = cell * 0.82;
    ctx.save();
    ctx.translate(head.x, head.y);

    ctx.shadowColor = dying ? 'rgba(255, 45, 135, 0.9)' : 'rgba(94, 243, 255, 0.85)';
    ctx.shadowBlur = cell * (0.6 + eatFlash * 1.4) * glowFactor();
    ctx.fillStyle = 'rgba(4, 7, 13, 0.95)';
    roundRect(ctx, -size / 2 - 1.5, -size / 2 - 1.5, size + 3, size + 3, cell * 0.26);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = dying ? '#ff2d87' : '#bffaff';
    roundRect(ctx, -size / 2, -size / 2, size, size, cell * 0.24);
    ctx.fill();

    // Eyes, oriented along travel direction
    var d = DIRS[dir] || DIRS.right;
    var eye = Math.max(1.5, cell * 0.12);
    var forward = cell * 0.17;
    var side = cell * 0.19;
    var blink = !dying && !reduceMotion.matches && (time % 4200) < 130;

    ctx.fillStyle = '#04141a';
    if (!blink) {
      ctx.fillRect(d.x * forward - d.y * side - eye / 2, d.y * forward - d.x * side - eye / 2, eye, eye);
      ctx.fillRect(d.x * forward + d.y * side - eye / 2, d.y * forward + d.x * side - eye / 2, eye, eye);
    } else {
      ctx.fillRect(-size * 0.3, -eye / 2, size * 0.6, Math.max(1, eye * 0.5));
    }
    ctx.restore();
  }

  function roundRect(context, x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function drawRipples() {
    for (var i = 0; i < ripples.length; i++) {
      var rip = ripples[i];
      var t = rip.age / rip.life;
      var radius = cell * (0.3 + t * 1.5);
      ctx.strokeStyle = 'rgba(255, 45, 135, ' + (0.75 * (1 - t)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, cell * 0.1 * (1 - t));
      ctx.strokeRect(
        (rip.x + 0.5) * cell - radius,
        (rip.y + 0.5) * cell - radius,
        radius * 2,
        radius * 2
      );
    }
  }

  function drawDeathVeil() {
    if (phase !== 'dying') return;
    var t = Math.min(1, deathElapsed / DEATH_MS);
    ctx.fillStyle = 'rgba(255, 45, 135, ' + (0.16 * (1 - t)).toFixed(3) + ')';
    ctx.fillRect(0, 0, boardSize, boardSize);
  }

  function render(alpha, time) {
    drawBackdrop();
    if (eatFlash > 0.01) {
      ctx.fillStyle = 'rgba(255, 45, 135, ' + (0.10 * eatFlash).toFixed(3) + ')';
      ctx.fillRect(0, 0, boardSize, boardSize);
    }
    drawRipples();
    drawFood(time);
    // The attract screen shows an empty arena — no snake has been summoned yet.
    if (phase !== 'attract') drawSnake(phase === 'playing' ? alpha : 1, time);
    drawDeathVeil();
  }

  /* ------------------------------------------------------------------ *
   * 7. Game state + logic
   * ------------------------------------------------------------------ */

  var phase = 'attract'; // attract | countdown | playing | paused | dying | over
  var snake = [];
  var prevSnake = [];
  var dir = 'right';
  var queuedDirs = [];
  var food = null;
  var score = 0;
  var best = parseInt(store.get(KEY_BEST), 10) || 0;
  var level = 1;
  var eaten = 0;
  var stepMs = BASE_STEP_MS;
  var accumulator = 0;
  var ripples = [];
  var eatFlash = 0;
  var deathElapsed = 0;
  var countdownQueue = [];
  var countdownElapsed = 0;
  var recordAtStart = 0;  // best score when this run began
  var pendingRecord = false;

  function announce(message) {
    liveStatus.textContent = message;
  }

  function setScreen(name) {
    overlay.dataset.screen = name;
  }

  function updateActionButton() {
    var label = 'Press Start';
    if (phase === 'playing' || phase === 'countdown') label = 'Pause';
    else if (phase === 'paused') label = 'Resume';
    else if (phase === 'over' || phase === 'dying') label = 'Play Again';
    actionBtn.textContent = label;
  }

  function bump(el) {
    if (reduceMotion.matches) return;
    el.classList.remove('is-bumped');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-bumped');
  }

  function syncScoreboard() {
    setPixelText(statScore, score);
    setPixelText(statBest, best);
    setPixelText(statLevel, level);
  }

  function emptyCells() {
    var occupied = {};
    for (var i = 0; i < snake.length; i++) occupied[snake[i].x + ',' + snake[i].y] = true;
    var free = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!occupied[x + ',' + y]) free.push({ x: x, y: y });
      }
    }
    return free;
  }

  function spawnFood() {
    var free = emptyCells();
    food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  function resetGame() {
    snake = [];
    var startX = Math.floor(COLS / 2) - Math.floor(START_LENGTH / 2);
    var startY = Math.floor(ROWS / 2);
    for (var i = 0; i < START_LENGTH; i++) snake.push({ x: startX - i, y: startY });
    prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });

    dir = 'right';
    queuedDirs = [];
    score = 0;
    level = 1;
    eaten = 0;
    stepMs = BASE_STEP_MS;
    accumulator = 0;
    ripples = [];
    eatFlash = 0;
    deathElapsed = 0;
    recordAtStart = best;
    pendingRecord = false;
    spawnFood();
    syncScoreboard();
  }

  function beginCountdown(beats) {
    countdownQueue = beats.slice();
    countdownElapsed = 0;
    phase = 'countdown';
    setPixelText(countdownText, countdownQueue[0]);
    restartCountdownAnimation();
    audio.countBeat(countdownQueue.length === 1);
    setScreen('countdown');
    updateActionButton();
  }

  function restartCountdownAnimation() {
    if (reduceMotion.matches) return;
    countdownText.style.animation = 'none';
    void countdownText.offsetWidth;
    countdownText.style.animation = '';
  }

  function startGame() {
    resetGame();
    audio.start();
    announce('Game started.');
    beginCountdown(['3', '2', '1', 'GO']);
  }

  function pauseGame() {
    if (phase !== 'playing' && phase !== 'countdown') return;
    phase = 'paused';
    accumulator = 0;
    setScreen('paused');
    updateActionButton();
    audio.pause(false);
    announce('Paused.');
  }

  function resumeGame() {
    if (phase !== 'paused') return;
    audio.pause(true);
    beginCountdown(['GO']);
  }

  function endGame() {
    phase = 'dying';
    deathElapsed = 0;
    audio.gameOver();
    if (!reduceMotion.matches) {
      stage.classList.add('is-shaking');
      window.setTimeout(function () { stage.classList.remove('is-shaking'); }, 460);
    }
    pendingRecord = score > 0 && score > recordAtStart;
    syncScoreboard();
    updateActionButton();
  }

  function showGameOver() {
    phase = 'over';
    setPixelText(finalScore, score);
    setPixelText(finalBest, best);
    recordBanner.hidden = !pendingRecord;
    storageNote.hidden = store.persistent;
    setScreen('over');
    updateActionButton();
    announce('Game over. Score ' + score + '. Best ' + best + '.');
  }

  function isReverse(next, current) {
    return DIRS[next].x === -DIRS[current].x && DIRS[next].y === -DIRS[current].y;
  }

  function queueDirection(next) {
    if (!DIRS[next]) return;
    if (phase === 'attract' || phase === 'over') { startGame(); return; }
    if (phase !== 'playing' && phase !== 'countdown') return;

    var reference = queuedDirs.length ? queuedDirs[queuedDirs.length - 1] : dir;
    if (next === reference || isReverse(next, reference)) return;
    if (queuedDirs.length >= 2) return;
    queuedDirs.push(next);
    audio.turn();
  }

  function step() {
    if (queuedDirs.length) dir = queuedDirs.shift();

    var delta = DIRS[dir];
    var head = { x: snake[0].x + delta.x, y: snake[0].y + delta.y };

    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) { endGame(); return; }

    // The tail cell frees up this tick unless the snake is growing into it.
    var willEat = !!food && head.x === food.x && head.y === food.y;
    var checkLength = willEat ? snake.length : snake.length - 1;
    for (var i = 0; i < checkLength; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) { endGame(); return; }
    }

    prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });
    snake.unshift(head);

    if (willEat) {
      eaten += 1;
      score += 10 + (level - 1) * 5;
      eatFlash = 1;
      if (score > best) {
        best = score;
        store.set(KEY_BEST, best);
        bump(statBest);
      }
      if (!reduceMotion.matches) ripples.push({ x: head.x, y: head.y, age: 0, life: 380 });
      audio.eat();
      bump(statScore);

      var nextLevel = Math.min(MAX_LEVEL, 1 + Math.floor(eaten / FOOD_PER_LEVEL));
      if (nextLevel !== level) {
        level = nextLevel;
        stepMs = Math.max(MIN_STEP_MS, BASE_STEP_MS - (level - 1) * STEP_DECAY_MS);
        audio.levelUp();
        bump(statLevel);
      }
      syncScoreboard();
      spawnFood();
      if (!food) { endGame(); return; } // board cleared — a perfect run
    } else {
      snake.pop();
    }
  }

  /* ------------------------------------------------------------------ *
   * 8. Input, loop and boot
   * ------------------------------------------------------------------ */

  function primaryAction() {
    if (phase === 'attract') startGame();
    else if (phase === 'playing' || phase === 'countdown') pauseGame();
    else if (phase === 'paused') resumeGame();
    // The action button already reads "Play Again" during the death animation.
    else if (phase === 'over' || phase === 'dying') startGame();
  }

  // Space and Enter belong to the focused control, not the game, whenever one
  // has keyboard focus — otherwise the d-pad and the mute toggle can never be
  // activated from the keyboard.
  var INTERACTIVE = 'button, a[href], input, select, textarea, [tabindex]';

  function isControlFocused(event) {
    var target = event.target;
    return !!(target && target.closest && target.closest(INTERACTIVE));
  }

  var KEY_DIRS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right'
  };

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    var key = event.key;
    var mapped = KEY_DIRS[key] || KEY_DIRS[key.toLowerCase && key.toLowerCase()];

    if (mapped) {
      event.preventDefault();
      queueDirection(mapped);
      return;
    }
    if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
      if (isControlFocused(event)) return; // let the control activate itself
      event.preventDefault();
      if (key === 'Enter' && (phase === 'over' || phase === 'attract')) startGame();
      else primaryAction();
      return;
    }
    if (key === 'm' || key === 'M') {
      event.preventDefault();
      toggleMute();
    }
  });

  // On-screen d-pad
  var dpadButtons = document.querySelectorAll('.dpad__btn');
  Array.prototype.forEach.call(dpadButtons, function (button) {
    var press = function (event) {
      event.preventDefault();
      button.classList.add('is-pressed');
      queueDirection(button.dataset.dir);
    };
    var release = function () { button.classList.remove('is-pressed'); };

    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Keyboard activation of a focused pad button (pointers are handled above;
    // a keyboard-synthesised click reports detail 0).
    button.addEventListener('click', function (event) {
      if (event.detail) return;
      queueDirection(button.dataset.dir);
    });
  });

  actionBtn.addEventListener('click', function (event) {
    primaryAction();
    if (event.detail) actionBtn.blur(); // keyboard users keep their focus ring
  });

  // Swipe + tap on the board
  var touchStart = null;
  var lastTouchAt = 0;
  stage.addEventListener('touchstart', function (event) {
    if (event.touches.length !== 1) return;
    var t = event.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });

  stage.addEventListener('touchmove', function (event) {
    if (touchStart) event.preventDefault();
  }, { passive: false });

  stage.addEventListener('touchend', function (event) {
    if (!touchStart) return;
    var t = event.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    var absX = Math.abs(dx);
    var absY = Math.abs(dy);
    touchStart = null;
    lastTouchAt = Date.now();

    if (Math.max(absX, absY) < 24) { primaryAction(); return; }
    if (absX > absY) queueDirection(dx > 0 ? 'right' : 'left');
    else queueDirection(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  // Clicks on the board start / pause for mouse users. Touch already handled
  // above, so ignore the synthetic click that follows a tap.
  stage.addEventListener('click', function () {
    if (Date.now() - lastTouchAt < 600) return;
    primaryAction();
  });

  function toggleMute() {
    audio.setMuted(!audio.muted);
    store.set(KEY_MUTED, audio.muted ? '1' : '0');
    syncMuteUI();
    if (!audio.muted) audio.tone({ freq: 660, dur: 0.06, vol: 0.4 });
  }

  function syncMuteUI() {
    sfxToggle.setAttribute('aria-pressed', audio.muted ? 'false' : 'true');
    sfxToggle.setAttribute('aria-label', 'Sound effects: ' + (audio.muted ? 'off' : 'on'));
    sfxText.textContent = audio.muted ? 'SFX OFF' : 'SFX ON';
  }

  sfxToggle.addEventListener('click', function (event) {
    toggleMute();
    if (event.detail) sfxToggle.blur(); // keyboard users keep their focus ring
  });

  // Pause whenever the tab or window loses focus
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseGame();
  });
  window.addEventListener('blur', function () { pauseGame(); });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      fitCabinet();
      repaintAllPixelText();
      resizeBoard();
    }, 80);
  });

  function advanceCountdown(dt) {
    countdownElapsed += dt;
    if (countdownElapsed < COUNT_MS) return;
    countdownElapsed -= COUNT_MS;
    countdownQueue.shift();

    if (!countdownQueue.length) {
      phase = 'playing';
      accumulator = 0;
      setScreen('playing');
      updateActionButton();
      announce('Go.');
      return;
    }
    setPixelText(countdownText, countdownQueue[0]);
    restartCountdownAnimation();
    audio.countBeat(countdownQueue.length === 1);
  }

  function updateEffects(dt) {
    if (eatFlash > 0) eatFlash = Math.max(0, eatFlash - dt / 320);
    for (var i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age >= ripples[i].life) ripples.splice(i, 1);
    }
  }

  var lastFrame = 0;

  function frame(now) {
    var dt = lastFrame ? Math.min(now - lastFrame, 250) : 16;
    lastFrame = now;

    if (phase === 'countdown') {
      advanceCountdown(dt);
    } else if (phase === 'playing') {
      accumulator += dt;
      var guard = 0;
      while (accumulator >= stepMs && phase === 'playing' && guard++ < 8) {
        accumulator -= stepMs;
        step();
      }
      if (phase !== 'playing') accumulator = 0;
    } else if (phase === 'dying') {
      deathElapsed += dt;
      if (deathElapsed >= DEATH_MS) showGameOver();
    }

    updateEffects(dt);
    render(phase === 'playing' ? Math.min(1, accumulator / stepMs) : 1, now);
    window.requestAnimationFrame(frame);
  }

  function boot() {
    fitCabinet();
    resizeBoard();
    resetGame();
    syncMuteUI();
    storageNote.hidden = store.persistent;
    repaintAllPixelText();
    setScreen('attract');
    updateActionButton();
    announce('Neon Serpent ready. Press space to start.');
    window.requestAnimationFrame(frame);
  }

  /**
   * Read-only snapshot of the simulation. The board is a canvas, so this is
   * the only sane seam for the automated browser tests to assert against.
   */
  window.neonSerpent = {
    snapshot: function () {
      return {
        phase: phase,
        dir: dir,
        score: score,
        best: best,
        level: level,
        stepMs: stepMs,
        cols: COLS,
        rows: ROWS,
        persistentStorage: store.persistent,
        muted: audio.muted,
        // Reads the live gain, so a test can tell a muted UI from a muted graph.
        masterGain: audio.master ? audio.master.gain.value : null,
        food: food ? { x: food.x, y: food.y } : null,
        snake: snake.map(function (s) { return { x: s.x, y: s.y }; })
      };
    }
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(repaintAllPixelText);
  }
  boot();
}());
