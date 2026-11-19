// v2 renderer: a coarser grid where each cell can hold a coloured tile and a
// glyph. Tiles carry shape and colour; glyphs, inked in a darker shade of
// their own tile, carry texture and direction. Open water stays mostly
// empty, so ripples and wakes read clearly.
KPond.renderers.v2 = (() => {
  'use strict';
  const { sin, cos, atan2, sqrt, exp, abs, min, max, floor, ceil, round, PI, hypot } = Math;
  const { TAU, LIGHT, REDUCED, clamp, lerp, code, angDiff, perm, vnoise, hash3, padToWorld } = KPond;
  const FONT_FAMILY = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  // world state, refreshed on every render
  let ctx = null, W = 0, H = 0, S = 1, time = 0, theme = 'dark';
  let pads = [], frogs = [], ripples = [], fireflies = [], drops = [];

  // ---------------------------------------------------------------- colour
  // Colours are packed 0xRRGGBB ints. Mix amounts are quantised so a frame
  // only uses a few hundred distinct colours, which keeps drawing batched.
  const hex = (h) => parseInt(h.slice(1), 16);
  function mixP(a, b, t) {
    t = t <= 0 ? 0 : t >= 1 ? 1 : round(t * 20) / 20;
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    return (
      (round(ar + (((b >> 16) & 255) - ar) * t) << 16) |
      (round(ag + (((b >> 8) & 255) - ag) * t) << 8) |
      round(ab + ((b & 255) - ab) * t)
    );
  }
  function inkP(c, k) {
    return (
      (min(255, round(((c >> 16) & 255) * k)) << 16) |
      (min(255, round(((c >> 8) & 255) * k)) << 8) |
      min(255, round((c & 255) * k))
    );
  }
  const cssCache = new Map();
  function css(c) {
    let s = cssCache.get(c);
    if (!s) {
      s = '#' + c.toString(16).padStart(6, '0');
      cssCache.set(c, s);
    }
    return s;
  }
  const hexAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hex(v)]));

  const THEMES = {
    dark: {
      bg: hex('#121a1b'),
      water: hex('#cfe3dc'),
      padA: hex('#3f7a45'),
      padB: hex('#7a9a3e'),
      padRed: hex('#a24f4a'),
      padTile: [0.3, 0.6], // [shaded, lit]: how much pad colour covers the background
      frogTile: [0.6, 0.98],
      flowerTile: [0.62, 0.95],
      ink: 0.42, // glyphs are their tile colour times this
      shadow: hex('#000000'),
      shadowAlpha: 0.42,
      firefly: hex('#fff0a0'),
      tongue: hex('#ef7aa0'),
      flowers: [
        { petal: '#f2a2c0', inner: '#ffd6e4', center: '#f5c842' },
        { petal: '#e9e5dc', inner: '#fffaf0', center: '#f5c842' },
        { petal: '#e070a0', inner: '#f6a8c6', center: '#ffd75a' },
        { petal: '#efd77a', inner: '#fff2bc', center: '#f29a2e' },
      ].map(hexAll),
    },
    light: {
      bg: hex('#f3f1ea'),
      water: hex('#2f5450'),
      padA: hex('#4f8f4a'),
      padB: hex('#86a63f'),
      padRed: hex('#b8665e'),
      padTile: [0.5, 0.26],
      frogTile: [0.92, 0.62],
      flowerTile: [0.88, 0.58],
      ink: 0.45,
      shadow: hex('#2d2a20'),
      shadowAlpha: 0.16,
      firefly: hex('#2b2a26'),
      tongue: hex('#d4497a'),
      flowers: [
        { petal: '#e27fa8', inner: '#f2b3cb', center: '#e0a514' },
        { petal: '#b4bfc4', inner: '#dfe5e6', center: '#e0a514' },
        { petal: '#c94f86', inner: '#e690b4', center: '#e8b020' },
        { petal: '#d6b443', inner: '#ecd889', center: '#d27a10' },
      ].map(hexAll),
    },
  };

  const FROG_KINDS = [
    {
      weight: 5, scale: 1, spots: true, stripe: true,
      dark: { body: '#5fb04a', spot: '#2f6e2c', stripe: '#b6e070', eye: '#f2d34a', pupil: '#141414', sac: '#ece4bc', leg: '#4f9a40' },
      light: { body: '#3f9a35', spot: '#1f5a1a', stripe: '#8cc04a', eye: '#e8b81a', pupil: '#1a1a14', sac: '#d8c88a', leg: '#3a8a32' },
    },
    {
      weight: 2, scale: 1.08, spots: true, stripe: true,
      dark: { body: '#b08a4e', spot: '#5e4520', stripe: '#e6cd92', eye: '#f0b84a', pupil: '#141414', sac: '#efe2c0', leg: '#9a7840' },
      light: { body: '#94703a', spot: '#4a3410', stripe: '#cfae6a', eye: '#e09a20', pupil: '#1a1410', sac: '#d9c39a', leg: '#86642e' },
    },
    {
      weight: 2, scale: 0.88, spots: false, stripe: false,
      dark: { body: '#6fd24f', spot: '#3f9a32', stripe: '#6fd24f', eye: '#ff5a36', pupil: '#1a0a06', sac: '#fff0c8', leg: '#5cc048' },
      light: { body: '#33ad2e', spot: '#1f7a1c', stripe: '#33ad2e', eye: '#e8401c', pupil: '#1a0a06', sac: '#d9c690', leg: '#2e9c2a' },
    },
    {
      weight: 1, scale: 0.95, spots: true, stripe: false,
      dark: { body: '#e6b23a', spot: '#8a5c0c', stripe: '#e6b23a', eye: '#3a2a10', pupil: '#f5e6b0', sac: '#fff2d0', leg: '#d09a28' },
      light: { body: '#d99a12', spot: '#6a4404', stripe: '#d99a12', eye: '#2a1c04', pupil: '#f5e6b0', sac: '#e8d090', leg: '#c08a10' },
    },
  ].map((k) => ({ ...k, dark: hexAll(k.dark), light: hexAll(k.light) }));

  // glyph ramps, from lit to shaded
  const PAD_RAMP = ['.', ':', ';', '=', '+', '*'].map(code);
  const FROG_RAMP = ['o', 'e', '%', '&', '8', '#', '@'].map(code);
  const LINE = ['-', '\\', '|', '/'].map(code);
  const CHS = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i));
  const DOT = 46, DASH = 45, TILDE = 126, COLON = 58, STAR = 42, PLUS = 43, TICK = 39, O_LOW = 111, AT = 64, X_LOW = 120;


  // ---------------------------------------------------------------- grid
  let cw = 12, ch = 15, font = '', cols = 0, rows = 0;
  let glyph = new Uint16Array(0), gcol = new Int32Array(0), tile = new Int32Array(0);
  let top = new Uint8Array(0), shade = new Uint8Array(0);
  let energy = new Float32Array(0), energyTmp = new Float32Array(0);
  const WATER_A = new Int32Array(11);


  function cellAt(x, y) {
    const c = floor(x / cw), r = floor(y / ch);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return r * cols + c;
  }
  // the stroke glyph closest to a direction, allowing for the cell's aspect
  function lineCodeV(x, y) {
    let b = atan2(y / ch, x / cw);
    if (b < 0) b += PI;
    return LINE[round(b / (PI / 4)) & 3];
  }
  const lineCode = (a) => lineCodeV(cos(a), sin(a));
  // half the cell's extent along a unit normal: the thinnest a line can be and still hit every cell
  const cellHalf = (nx, ny) => 0.5 * sqrt(nx * nx * cw * cw + ny * ny * ch * ch);

  const tileB = new Map(), glyphB = new Map();
  function bucket(map, key, i) {
    let a = map.get(key);
    if (!a) map.set(key, (a = []));
    a.push(i);
  }

  function flush(T) {
    ctx.fillStyle = css(T.bg);
    ctx.fillRect(0, 0, W, H);
    if (tileB.size > 3000) tileB.clear();
    if (glyphB.size > 3000) glyphB.clear();
    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      if (tile[i] >= 0) bucket(tileB, tile[i], i);
      if (glyph[i]) bucket(glyphB, gcol[i], i);
    }
    // tiles, inset by a pixel so the grid shows through
    for (const [k, a] of tileB) {
      if (!a.length) continue;
      ctx.fillStyle = css(k);
      for (let j = 0; j < a.length; j++) {
        const i = a[j];
        ctx.fillRect((i % cols) * cw + 1, ((i / cols) | 0) * ch + 1, cw - 1, ch - 1);
      }
      a.length = 0;
    }
    // shadows darken whatever tile they fall on
    ctx.globalAlpha = T.shadowAlpha;
    ctx.fillStyle = css(T.shadow);
    for (let i = 0; i < n; i++) {
      if (shade[i] && !top[i] && tile[i] >= 0) ctx.fillRect((i % cols) * cw + 1, ((i / cols) | 0) * ch + 1, cw - 1, ch - 1);
    }
    ctx.globalAlpha = 1;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ox = cw / 2, oy = ch / 2 + 1;
    for (const [k, a] of glyphB) {
      if (!a.length) continue;
      ctx.fillStyle = css(k);
      for (let j = 0; j < a.length; j++) {
        const i = a[j];
        ctx.fillText(CHS[glyph[i]], (i % cols) * cw + ox, ((i / cols) | 0) * ch + oy);
      }
      a.length = 0;
    }
  }

  // wakes: energy dropped into the grid, blurred and faded each frame
  function deposit(x, y, amt, radius = 0) {
    const c0 = floor(x / cw), r0 = floor(y / ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c;
        energy[i] = min(1.5, energy[i] + amt);
      }
    }
  }
  function diffuse(dt) {
    const k = exp(-1.1 * dt);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, e = energy[i];
        const l = c > 0 ? energy[i - 1] : e, rr = c < cols - 1 ? energy[i + 1] : e;
        const u = r > 0 ? energy[i - cols] : e, d = r < rows - 1 ? energy[i + cols] : e;
        energyTmp[i] = (4 * e + l + rr + u + d) * 0.125 * k;
      }
    }
    [energy, energyTmp] = [energyTmp, energy];
  }

  // ---------------------------------------------------------------- drawing
  // Water: faint drifting texture, wakes, and ripples drawn as a ring of
  // strokes with a trailing ring of dots.
  function drawWater(T) {
    const tw = REDUCED ? time * 0.25 : time;
    for (let k = 0; k <= 10; k++) WATER_A[k] = mixP(T.bg, T.water, k / 10);
    for (const r of ripples) {
      const age = time - r.t0;
      r.R = r.r0 + r.speed * age;
      r.A = r.amp * exp(-age * r.decay);
      r.G2 = r.gap ?? max(16 * S, ch * 1.1);
    }
    const nR = ripples.length;
    let i = 0;
    for (let row = 0; row < rows; row++) {
      const y = (row + 0.5) * ch;
      const sy1 = sin(y * 0.021 + tw * 0.3) * 1.6;
      for (let c = 0; c < cols; c++, i++) {
        glyph[i] = 0;
        tile[i] = -1;
        top[i] = 0;
        shade[i] = 0;
        const x = (c + 0.5) * cw;

        let g1 = 0, g2 = 0, bx = 0, by = 0;
        for (let k = 0; k < nR; k++) {
          const q = ripples[k];
          const dx = x - q.x, dy = y - q.y;
          const d = sqrt(dx * dx + dy * dy) || 1;
          const dd = d - q.R;
          const band = cellHalf(dx / d, dy / d) * 1.05;
          if (dd > band * 2.5 || dd < -(q.G2 + band * 2.5)) continue;
          const a1 = dd / band, a2 = (dd + q.G2) / band;
          const v1 = exp(-a1 * a1) * q.A, v2 = exp(-a2 * a2) * q.A;
          if (v1 > g1) { g1 = v1; bx = dx; by = dy; }
          if (v2 > g2) g2 = v2;
        }
        if (g1 > 0.28) {
          glyph[i] = lineCodeV(-by, bx);
          gcol[i] = WATER_A[clamp(round(2 + g1 * 4), 2, 8)];
          continue;
        }
        if (g2 > 0.22) {
          glyph[i] = DOT;
          gcol[i] = WATER_A[clamp(round(1 + g2 * 4), 1, 6)];
          continue;
        }
        const e = energy[i];
        if (e > 0.2) {
          glyph[i] = e > 0.5 ? DASH : DOT;
          gcol[i] = WATER_A[clamp(round(1 + e * 3.5), 1, 5)];
          continue;
        }
        let w = sin(x * 0.009 + tw * 0.45 + sy1) + sin(y * 0.016 - tw * 0.38 + sin(x * 0.013 - tw * 0.22) * 1.3);
        w = (w * 0.25 + 0.5) * 0.65 + vnoise(x * 0.012 + tw * 0.08, y * 0.02 - tw * 0.05) * 0.35;
        if (w > 0.74) {
          glyph[i] = TILDE;
          gcol[i] = WATER_A[w > 0.79 ? 2 : 1];
        } else if (w > 0.66 && ((c + row) & 1) === 0) {
          glyph[i] = DOT;
          gcol[i] = WATER_A[1];
        } else if (perm[(c & 255) + perm[row & 255]] < 3) {
          glyph[i] = DOT;
          gcol[i] = WATER_A[2];
        }
      }
    }
  }

  function drawPad(p, T) {
    const R = p.r * p.scale;
    const EDGE = sqrt(cw * cw + ch * ch) * 0.5;
    const ext = R + EDGE;
    const c0 = max(0, floor((p.x - ext) / cw)), c1 = min(cols - 1, floor((p.x + ext) / cw));
    const r0 = max(0, floor((p.y - ext) / ch)), r1 = min(rows - 1, floor((p.y + ext) / ch));
    if (c0 > c1 || r0 > r1) return;
    const base = mixP(T.padA, T.padB, p.pv);
    const rim = p.red ? T.padRed : inkP(base, 0.82);
    const [t0, t1] = T.padTile;
    const notchA = p.rot + p.notch;
    const veinStep = TAU / p.veins;
    const cr = cos(-p.rot), sr = sin(-p.rot);
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * ch, dy = y - p.y;
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * cw, dx = x - p.x;
        const d = sqrt(dx * dx + dy * dy) || 0.001;
        const sd = R - d;
        if (sd < -EDGE * 0.5) continue;
        const ca = dx / d, sa = dy / d;
        const a = atan2(dy, dx);
        const al = abs(angDiff(notchA, a));
        const t = d / R;
        // coverage: how much of the cell the leaf fills, for soft edges
        let cov = clamp(sd / EDGE + 0.5, 0, 1);
        let notchEdge = false;
        if (d > R * 0.07) {
          const nd = (al - p.notchW) * d;
          if (nd < sd) notchEdge = true;
          cov = min(cov, clamp(nd / EDGE + 0.5, 0, 1));
        }
        if (cov < 0.08) continue;
        const i = r * cols + c;
        const lx = dx * cr - dy * sr, ly = dx * sr + dy * cr;
        const n = vnoise(lx * 0.05 + p.seed, ly * 0.05);
        const h = clamp(0.55 + 0.4 * (n - 0.5) - 0.2 * t * t + 0.22 * cos(a - LIGHT) * t, 0, 1);
        const col = t > 0.78 ? mixP(base, rim, (t - 0.78) / 0.22) : base;
        const amt = lerp(t0, t1, h);
        const full = mixP(T.bg, col, amt);
        tile[i] = cov >= 0.97 ? full : mixP(T.bg, col, amt * cov);
        let g = 0, gc = inkP(full, T.ink);
        if (cov < 0.9) {
          if (cov > 0.4) g = notchEdge ? lineCodeV(ca, sa) : lineCodeV(-sa, ca);
        } else if (t > 0.14 && t < 0.84 && abs(al / veinStep - round(al / veinStep)) * veinStep * d < cellHalf(-sa, ca) * 0.8) {
          g = lineCodeV(ca, sa);
          gc = inkP(full, T.ink * 0.8);
        } else {
          const k = floor(clamp((1 - h) * 5 + (vnoise(lx * 0.12 + p.seed * 2, ly * 0.12) - 0.5) * 2.4, 0, 5.99));
          g = k >= 2 ? PAD_RAMP[k] : 0;
        }
        glyph[i] = g;
        gcol[i] = gc;
      }
    }
    if (p.flower) drawFlower(p, T);
  }

  function drawFlower(p, T) {
    const fl = p.flower;
    const w = padToWorld(p, fl.lx, fl.ly);
    const fs = fl.fs * p.scale;
    const rot = p.rot + fl.spin;
    const F = T.flowers[fl.scheme];
    const [t0, t1] = T.flowerTile;
    const c0 = max(0, floor((w.x - fs) / cw)), c1 = min(cols - 1, floor((w.x + fs) / cw));
    const r0 = max(0, floor((w.y - fs) / ch)), r1 = min(rows - 1, floor((w.y + fs) / ch));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ch - w.y;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - w.x;
        const d = sqrt(dx * dx + dy * dy);
        if (d > fs) continue;
        const phi = atan2(dy, dx) - rot;
        const rOut = fs * (0.5 + 0.5 * Math.pow(abs(cos((phi * fl.n) / 2)), 0.6));
        const rIn = fs * 0.62 * (0.5 + 0.5 * Math.pow(abs(cos(((phi + PI / fl.n) * fl.n) / 2)), 0.6));
        const i = r * cols + c;
        let tc;
        if (d < fs * 0.22) {
          tc = mixP(T.bg, F.center, t0);
          glyph[i] = O_LOW;
        } else if (d < rIn) {
          tc = mixP(T.bg, F.inner, lerp(t0, t1, 0.8));
          glyph[i] = lineCodeV(dx, dy);
        } else if (d < rOut) {
          tc = mixP(T.bg, F.petal, lerp(t1, t0, d / rOut));
          glyph[i] = lineCodeV(dx, dy);
        } else continue;
        tile[i] = tc;
        gcol[i] = inkP(tc, T.ink + 0.1);
      }
    }
    const ci = cellAt(w.x, w.y);
    if (ci >= 0) {
      tile[ci] = mixP(T.bg, F.center, t0);
      glyph[ci] = AT;
      gcol[ci] = inkP(tile[ci], T.ink + 0.1);
    }
  }

  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    const qx = ax + vx * t - px, qy = ay + vy * t - py;
    return sqrt(qx * qx + qy * qy);
  }

  const shadowMarks = [];
  function markShadowOf(i) {
    const c = i % cols, r = (i / cols) | 0;
    if (c + 1 < cols && r + 1 < rows) shadowMarks.push(i + cols + 1);
  }

  function drawJumpShadow(f) {
    if (f.h < 1) return;
    const sc = f.size * (1 - f.h / (400 * S)) * 0.9;
    const sx = f.x + f.h * 0.12, sy = f.y + f.h * 0.18;
    const hc = cos(f.heading), hs = sin(f.heading);
    const Rb = sc * 1.1;
    const c0 = max(0, floor((sx - Rb) / cw)), c1 = min(cols - 1, floor((sx + Rb) / cw));
    const r0 = max(0, floor((sy - Rb) / ch)), r1 = min(rows - 1, floor((sy + Rb) / ch));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ch - sy;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - sx;
        const u = (dx * hc + dy * hs) / sc;
        const v = (-dx * hs + dy * hc) / (sc * 0.62);
        if (u * u + v * v < 1) shadowMarks.push(r * cols + c);
      }
    }
  }

  function drawFrog(f, T) {
    const K = FROG_KINDS[f.kindIndex][theme];
    const [ft0, ft1] = T.frogTile;
    const sub = f.inWater ? 0.4 : 1; // swimming frogs sit low in the water
    const sitting = f.h < 1;
    const sc = f.size * (1 + (f.h / (160 * S)) * 0.55) * f.squash;
    const fx = f.x, fy = f.y - f.h * 0.35;
    const hc = cos(f.heading), hs = sin(f.heading);
    const e = f.ext;

    // leg joints in frog space (u forward, v to the side; mirrored for the other side)
    const segs = [
      [-0.5, 0.36, lerp(0.02, -1.2, e), lerp(0.8, 0.62, e), 0.19],
      [lerp(0.02, -1.2, e), lerp(0.8, 0.62, e), lerp(-0.42, -2.0, e), lerp(0.98, 0.48, e), 0.12],
      [0.36, 0.34, lerp(0.66, 1.08, e), lerp(0.7, 0.55, e), 0.1],
    ];
    const footU = segs[1][2], footV = segs[1][3];
    const legT = [], legCh = [];
    for (const s of segs) {
      const lu = s[2] - s[0], lv = s[3] - s[1];
      for (const side of [1, -1]) {
        const wa = f.heading + atan2(lv * side, lu);
        legT.push(max(s[4], cellHalf(-sin(wa), cos(wa)) / sc));
        legCh.push(lineCode(wa));
      }
    }

    const eyes = [];
    for (const side of [1, -1]) {
      const u = 0.6, v = 0.34 * side;
      eyes.push(fx + (u * hc - v * hs) * sc, fy + (u * hs + v * hc) * sc);
    }
    const er = 0.17 * sc;
    const erx = max(er, cw * 0.55), ery = max(er, ch * 0.55);
    const sacR = 0.42 * f.croak;
    const lu = cos(LIGHT - f.heading), lv = sin(LIGHT - f.heading);
    const stripeHalf = max(0.06, (cw * 0.5) / sc);
    const stripeCh = lineCode(f.heading);
    const footR = max(0.16, (cw * 0.5) / sc);
    const legTile = mixP(T.bg, K.leg, lerp(ft0, ft1, 0.5) * sub);
    const legInk = inkP(mixP(T.bg, K.leg, lerp(ft0, ft1, 0.5)), T.ink);

    const Rb = 2.3 * sc;
    const c0 = max(0, floor((fx - Rb) / cw)), c1 = min(cols - 1, floor((fx + Rb) / cw));
    const r0 = max(0, floor((fy - Rb) / ch)), r1 = min(rows - 1, floor((fy + Rb) / ch));
    for (let r = r0; r <= r1; r++) {
      const py = (r + 0.5) * ch, dy = py - fy;
      for (let c = c0; c <= c1; c++) {
        const px = (c + 0.5) * cw, dx = px - fx;
        if (dx * dx + dy * dy > Rb * Rb) continue;
        const i = r * cols + c;

        // eyes, in screen space so they always land on at least one cell
        let qx = (px - eyes[0]) / erx, qy = (py - eyes[1]) / ery;
        let eyeHit = qx * qx + qy * qy < 1;
        if (!eyeHit) {
          qx = (px - eyes[2]) / erx;
          qy = (py - eyes[3]) / ery;
          eyeHit = qx * qx + qy * qy < 1;
        }
        if (eyeHit) {
          tile[i] = mixP(T.bg, K.eye, ft1);
          glyph[i] = O_LOW;
          gcol[i] = K.pupil;
          top[i] = 1;
          if (sitting && !f.inWater) markShadowOf(i);
          continue;
        }

        const u = (dx * hc + dy * hs) / sc, v = (-dx * hs + dy * hc) / sc, av = abs(v);

        // body + head
        const bu = (u + 0.15) / 0.8, bv = v / 0.58;
        const hu = (u - 0.5) / 0.45, hv = v / 0.48;
        const q = min(bu * bu + bv * bv, hu * hu + hv * hv);
        if (q < 1) {
          const lit = clamp(0.15 + (1 - q) * 0.85 + 0.2 * ((u + 0.15) * lu + v * lv), 0, 1);
          let col = K.body, g;
          const jit = hash3(round(u * 5), round(v * 5), f.id);
          if (f.stripe && av < stripeHalf && u > -0.85 && u < 0.6) {
            col = K.stripe;
            g = stripeCh;
          } else {
            for (const s of f.spots) {
              const su = u - s.u, sv = v - s.v;
              if (su * su + sv * sv < s.r * s.r) { col = K.spot; break; }
            }
            g = FROG_RAMP[clamp(round((1 - lit) * 4) + (jit % 3), 0, 6)];
          }
          const amt = lerp(ft0, ft1, lit);
          const full = mixP(T.bg, col, amt);
          tile[i] = f.inWater ? mixP(T.bg, col, amt * sub) : full;
          glyph[i] = f.inWater ? (jit % 3 === 0 ? TILDE : 0) : g;
          gcol[i] = inkP(full, T.ink);
          top[i] = 1;
          if (sitting && !f.inWater) markShadowOf(i);
          continue;
        }

        // vocal sac, puffing out under the chin
        if (sacR > 0.05) {
          const su = u - 0.86;
          if (su * su + v * v < sacR * sacR) {
            tile[i] = mixP(T.bg, K.sac, ft1);
            glyph[i] = sacR > 0.3 ? 79 : O_LOW;
            gcol[i] = inkP(tile[i], T.ink + 0.15);
            top[i] = 1;
            continue;
          }
        }

        // legs
        const side = v < 0 ? 1 : 0;
        let legHit = -1;
        if (hypot(u - footU, av - footV) < footR) legHit = 3;
        else {
          for (let s = 0; s < 3; s++) {
            const g = segs[s];
            if (segDist(u, av, g[0], g[1], g[2], g[3]) < legT[s * 2 + side]) { legHit = s; break; }
          }
        }
        if (legHit >= 0) {
          tile[i] = legTile;
          glyph[i] = legHit === 3 ? STAR : legCh[legHit * 2 + side];
          gcol[i] = legInk;
          top[i] = 1;
          if (sitting && !f.inWater) markShadowOf(i);
          continue;
        }

        // a soft edge so frogs separate from busy pads
        if (!f.inWater && q < 1.32) {
          tile[i] = mixP(T.bg, K.body, 0.18);
          glyph[i] = 0;
          top[i] = 1;
        }
      }
    }

    if (f.tongue) {
      const tg = f.tongue;
      const reach = tg.t < 0.5 ? tg.t * 2 : (1 - tg.t) * 2;
      const mx = fx + hc * 0.92 * sc, my = fy + hs * 0.92 * sc;
      const tx = lerp(mx, tg.x, reach), ty = lerp(my, tg.y, reach);
      const len = hypot(tx - mx, ty - my);
      const n = ceil(len / (min(cw, ch) * 0.5));
      const g = lineCodeV(tx - mx, ty - my);
      const tt = mixP(T.bg, T.tongue, 0.35);
      for (let k = 1; k <= n; k++) {
        const ci = cellAt(lerp(mx, tx, k / n), lerp(my, ty, k / n));
        if (ci < 0) continue;
        tile[ci] = tt;
        glyph[ci] = g;
        gcol[ci] = T.tongue;
        top[ci] = 1;
      }
      const ti = cellAt(tx, ty);
      if (ti >= 0) {
        tile[ti] = mixP(T.bg, T.tongue, 0.85);
        glyph[ti] = tg.caught ? STAR : O_LOW;
        gcol[ti] = inkP(T.tongue, 0.4);
      }
    }
  }

  function drawFireflies(T) {
    const day = theme === 'light';
    for (const fl of fireflies) {
      if (!fl.alive || fl.fade < 0.02) continue;
      const ci = cellAt(fl.x, fl.y);
      if (day) {
        // by day they're just flies: no glow, wings buzzing
        if (ci >= 0 && fl.fade > 0.3) {
          glyph[ci] = sin(time * 40 + fl.phase) > 0 ? X_LOW : PLUS;
          gcol[ci] = T.firefly;
          tile[ci] = -1;
          top[ci] = 1;
        }
        continue;
      }
      const pulse = 0.5 + 0.5 * sin(time * fl.freq + fl.phase);
      const b = fl.fade * (0.4 + 0.6 * pulse * pulse);
      const gx = cw * (1.2 + 2.4 * b), gy = ch * (0.8 + 1.6 * b);
      const c0 = max(0, floor((fl.x - gx) / cw)), c1 = min(cols - 1, floor((fl.x + gx) / cw));
      const r0 = max(0, floor((fl.y - gy) / ch)), r1 = min(rows - 1, floor((fl.y + gy) / ch));
      for (let r = r0; r <= r1; r++) {
        const qy = ((r + 0.5) * ch - fl.y) / gy;
        for (let c = c0; c <= c1; c++) {
          const qx = ((c + 0.5) * cw - fl.x) / gx;
          const q = qx * qx + qy * qy;
          const i = r * cols + c;
          if (q > 1 || tile[i] >= 0) continue;
          tile[i] = mixP(T.bg, T.firefly, 0.09 * (1 - q) * b);
          if (q < 0.4) {
            glyph[i] = DOT;
            gcol[i] = mixP(T.bg, T.firefly, 0.45 * b);
          }
        }
      }
      if (ci >= 0) {
        tile[ci] = mixP(T.bg, T.firefly, 0.12 + 0.18 * b);
        glyph[ci] = b > 0.6 ? STAR : PLUS;
        gcol[ci] = mixP(T.bg, T.firefly, 0.55 + 0.45 * b);
        top[ci] = 1;
      }
    }
  }

  function drawDrops() {
    for (const d of drops) {
      const ci = cellAt(d.x, d.y - d.z * 0.4);
      if (ci < 0) continue;
      glyph[ci] = d.vz > 0 ? TICK : DOT;
      gcol[ci] = WATER_A[clamp(8 - floor(d.life * 8), 3, 8)];
    }
  }

  function draw() {
    const T = THEMES[theme];
    drawWater(T);
    for (const p of pads) drawPad(p, T);
    shadowMarks.length = 0;
    for (const f of frogs) drawJumpShadow(f);
    const order = frogs.slice().sort((a, b) => (a.inWater ? -1 : a.h) - (b.inWater ? -1 : b.h));
    for (const f of order) drawFrog(f, T);
    drawFireflies(T);
    drawDrops();
    // shadows that land on open water show as a faint ':'
    const sg = mixP(T.bg, T.shadow, 0.5);
    for (const i of shadowMarks) {
      if (top[i]) continue;
      shade[i] = 1;
      if (tile[i] < 0) {
        glyph[i] = COLON;
        gcol[i] = sg;
      }
    }
    flush(T);
  }

  function resize(context, w, h) {
    ctx = context;
    W = w;
    H = h;
    cw = clamp(round(W / 120), 8, 12);
    ch = round(cw * 1.25);
    font = `600 ${round(ch * 0.74)}px ${FONT_FAMILY}`;
    cols = ceil(W / cw);
    rows = ceil(H / ch);
    const n = cols * rows;
    glyph = new Uint16Array(n);
    gcol = new Int32Array(n);
    tile = new Int32Array(n);
    top = new Uint8Array(n);
    shade = new Uint8Array(n);
    energy = new Float32Array(n);
    energyTmp = new Float32Array(n);
    tileB.clear();
    glyphB.clear();
  }

  function render(context, world) {
    ctx = context;
    ({ W, H, S, time, pads, frogs, ripples, fireflies, drops, theme } = world);
    draw();
  }

  return { bg: (t) => css(THEMES[t].bg), resize, render, deposit, diffuse };
})();
