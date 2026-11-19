// v1 renderer: the original fine ASCII grid. Glyphs only, each coloured from
// a palette authored for night; the day palette mirrors it, with a few
// hand-picked exceptions.
KPond.renderers.v1 = (() => {
  'use strict';
  const { sin, cos, atan2, sqrt, exp, abs, min, max, floor, ceil, round, PI, hypot, pow } = Math;
  const { TAU, LIGHT, REDUCED, clamp, lerp, code, angDiff, perm, vnoise, padToWorld } = KPond;
  const FONT_FAMILY = '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';
  const SPACE = 32;

  // world state, refreshed on every render
  let ctx = null, W = 0, H = 0, S = 1, time = 0;
  let pads = [], frogs = [], ripples = [], fireflies = [], drops = [];

  // Every colour is authored for the night pond. The day pond gets a mirror
  // image: same hue, lightness flipped around the background, so whatever
  // glowed brightly at night becomes the darkest ink by day. A few colours
  // pass an explicit day value instead.
  const BG = { dark: '#05141a', light: '#eef3ec' };
  const palette = [], paletteLight = [];
  const palMap = new Map();
  function pc(hex, dayHex) {
    const key = dayHex ? hex + '|' + dayHex : hex;
    let i = palMap.get(key);
    if (i === undefined) {
      i = palette.length;
      palette.push(hex);
      paletteLight.push(dayHex || toDay(hex));
      palMap.set(key, i);
    }
    return i;
  }
  function rgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toDay(hex) {
    const [r, g, b] = rgb(hex).map((v) => v / 255);
    const mx = max(r, g, b), mn = min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    const L = clamp(0.93 - (l - 0.07) * 0.95, 0.12, 0.9);
    const Sa = min(1, s * 1.1);
    const q = L < 0.5 ? L * (1 + Sa) : L + Sa - L * Sa, p = 2 * L - q;
    const hue = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return '#' + [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((v) => round(v * 255).toString(16).padStart(2, '0')).join('');
  }
  let theme = 'dark';
  let activePal = palette;
  function mix(a, b, t) {
    const A = rgb(a), B = rgb(b);
    return '#' + A.map((v, i) => round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join('');
  }
  function ramp(stops, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * (stops.length - 1);
      const k = min(stops.length - 2, floor(t));
      out.push(pc(mix(stops[k], stops[k + 1], t - k)));
    }
    return out;
  }

  const WATER = ramp(['#0e3340', '#1b5a6a', '#3d97a6'], 5);
  const WATER_CH = ['.', '-', '~', '~', '~'].map(code);
  const DEEP = pc('#123540');
  const RIPPLE = ramp(['#245f6e', '#7fd0dc', '#e2fbff'], 6);
  const SHADOW = pc('#0b2119', '#71897d');
  const SPLASH = ramp(['#4ea3b4', '#e8fcff'], 4);
  const TONGUE = pc('#ff7aa2');
  const TONGUE_TIP = pc('#ff4f86');
  const GLOW = ramp(['#1c3122', '#8f8a3c', '#f6f0a0'], 5);
  const FIREFLY = pc('#fffbd0', '#3d3a2c');
  const LINE = ['-', '\\', '|', '/'].map(code);
  const FILL_CH = ['.', ':', '-', '=', '+', '*'].map(code);
  const BODY_CH = ['o', '%', '#', '@'].map(code);
  const EYE_CH = code('O');
  const SAC_CH = code('o');


  // [night, day] pairs: flipping a pale lily would turn it black, so these are hand-picked
  const FLOWER_SCHEMES = [
    { outer: [['#f6c7da', '#e58fb3'], ['#f49ac0', '#d4648f'], ['#e3709f', '#b8436f']], inner: ['#ffe3ee', '#f0a9c6'], center: ['#ffd84a', '#d99a0b'] },
    { outer: [['#ffffff', '#9fb2bd'], ['#e9eef0', '#b5c4cc'], ['#c9d6dc', '#8197a3']], inner: ['#fff8e6', '#c9b98f'], center: ['#ffcf3a', '#d38f06'] },
    { outer: [['#ffb6d0', '#e07aa3'], ['#f08ab2', '#c94f80'], ['#d9578d', '#a32e5c']], inner: ['#ffd6e5', '#ea9bbb'], center: ['#ffe066', '#d6a10e'] },
    { outer: [['#fff3c4', '#d9bf55'], ['#f3e7a0', '#c4a838'], ['#d9c66a', '#a68a1f']], inner: ['#fffbe6', '#e3cf7a'], center: ['#ffb02e', '#c96f05'] },
  ].map((s) => ({ outer: s.outer.map((c) => pc(...c)), inner: pc(...s.inner), center: pc(...s.center) }));

  // `day` holds hand-picked daylight colours: flipped night colours leave frogs
  // looking washed out, and by day they should read as solid ink.
  const FROG_KINDS = [
    {
      weight: 5, scale: 1,
      body: ['#1f4f25', '#2f7a31', '#4fa83e', '#8ad655'], spot: '#173a1b', leg: '#3b8a35', eye: '#f5d74a', sac: '#e8e2b0', stripe: '#c4ea7f', wet: '#1f4c40',
      day: { body: ['#6aa84a', '#4a9134', '#367a26', '#25601a'], spot: '#173d12', leg: '#4f8f36', eye: '#c79a00', sac: '#b8a65e', stripe: '#8fbf3f' },
    },
    {
      weight: 2, scale: 1.08,
      body: ['#4a3a1c', '#7a6230', '#a88a4a', '#d8be7c'], spot: '#2e230f', leg: '#8a7038', eye: '#f0b84a', sac: '#efe2c0', stripe: '#e8d7a0', wet: '#2e4038',
      day: { body: ['#a8874a', '#8c6a30', '#6e5020', '#523a14'], spot: '#33230a', leg: '#8a6a34', eye: '#c27c00', sac: '#bfa978', stripe: '#c9a85e' },
    },
    {
      weight: 2, scale: 0.88,
      body: ['#1d6b2a', '#2fa23a', '#5fd34a', '#b8f77f'], spot: null, leg: '#3fbf45', eye: '#ff5a36', sac: '#fff0c8', stripe: null, wet: '#225846',
      day: { body: ['#4fbf3c', '#2fa42c', '#1f8a24', '#146e1c'], leg: '#2b9a2e', eye: '#e0401f', sac: '#c7b36f' },
    },
    {
      weight: 1, scale: 0.95,
      body: ['#6b4a0c', '#b07d16', '#e3ac2e', '#ffe08a'], spot: '#4a3005', leg: '#c99022', eye: '#fff4d6', sac: '#fff4d6', stripe: null, wet: '#3a4a34',
      day: { body: ['#d9a21e', '#c18610', '#a06a08', '#7d5004'], spot: '#4a2e02', leg: '#b8860f', eye: '#2a1c00', sac: '#c9a24a' },
    },
  ].map((k) => {
    const d = k.day;
    return {
      weight: k.weight,
      scale: k.scale,
      hasSpots: !!k.spot,
      canStripe: !!k.stripe,
      dry: {
        body: k.body.map((c, i) => pc(c, d.body[i])),
        spot: k.spot ? pc(k.spot, d.spot) : pc(k.body[0], d.body[0]),
        leg: pc(k.leg, d.leg),
        eye: pc(k.eye, d.eye),
        sac: pc(k.sac, d.sac),
        stripe: k.stripe ? pc(k.stripe, d.stripe) : pc(k.body[3], d.body[3]),
      },
      wet: {
        body: ramp([k.wet, mix(k.wet, '#7fb0a0', 0.35)], 4),
        spot: pc(k.wet),
        leg: pc(mix(k.wet, '#000000', 0.15)),
        eye: pc(k.eye, d.eye),
        sac: pc(k.sac, d.sac),
        stripe: pc(k.wet),
      },
    };
  });


  // ---------------------------------------------------------------- grid
  let fontSize = 10, font = '', cellW = 6, cellH = 12, yOff = 0, cols = 0, rows = 0;
  let chars = new Uint16Array(0), colors = new Uint16Array(0);
  let lines = [], lineMin = [], lineMax = [];

  function set(i, ch, k) {
    chars[i] = ch;
    colors[i] = k;
  }
  function cellAt(x, y) {
    const c = floor(x / cellW), r = floor(y / cellH);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return r * cols + c;
  }
  // pick a line glyph for a direction vector, accounting for the tall cells
  function lineCodeV(x, y) {
    let b = atan2(y / cellH, x / cellW);
    if (b < 0) b += PI;
    return LINE[round(b / (PI / 4)) & 3];
  }
  const lineCode = (a) => lineCodeV(cos(a), sin(a));
  // half the cell extent along a unit normal: the thinnest a line can be and still hit every cell
  const cellHalf = (nx, ny) => 0.5 * sqrt(nx * nx * cellW * cellW + ny * ny * cellH * cellH);

  function flush() {
    ctx.fillStyle = BG[theme];
    ctx.fillRect(0, 0, W, H);
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const used = [];
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      used.length = 0;
      for (let c = 0; c < cols; c++) {
        const ch = chars[base + c];
        if (ch === SPACE) continue;
        const k = colors[base + c];
        let L = lines[k];
        if (!L) {
          L = lines[k] = new Uint16Array(cols).fill(SPACE);
          lineMin[k] = -1;
        }
        if (lineMin[k] < 0) {
          lineMin[k] = c;
          used.push(k);
        }
        lineMax[k] = c;
        L[c] = ch;
      }
      const y = r * cellH + yOff;
      for (let u = 0; u < used.length; u++) {
        const k = used[u];
        const L = lines[k], a = lineMin[k], b = lineMax[k] + 1;
        ctx.fillStyle = activePal[k];
        ctx.fillText(String.fromCharCode.apply(null, L.subarray(a, b)), a * cellW, y);
        L.fill(SPACE, a, b);
        lineMin[k] = -1;
      }
    }
  }

  // ---------------------------------------------------------------- drawing
  function drawWater() {
    const tw = REDUCED ? time * 0.25 : time;
    for (const r of ripples) {
      const age = time - r.t0;
      r.R = r.r0 + r.speed * age;
      r.A = r.amp * exp(-age * r.decay);
      r.G1 = r.gap ?? 14 * S;
    }
    const nR = ripples.length;
    let i = 0;
    for (let row = 0; row < rows; row++) {
      const y = (row + 0.5) * cellH;
      const sy1 = sin(y * 0.021 + tw * 0.3) * 1.6;
      for (let c = 0; c < cols; c++, i++) {
        const x = (c + 0.5) * cellW;
        let w = sin(x * 0.009 + tw * 0.45 + sy1) + sin(y * 0.016 - tw * 0.38 + sin(x * 0.013 - tw * 0.22) * 1.3);
        w = (w * 0.25 + 0.5) * 0.65 + vnoise(x * 0.012 + tw * 0.08, y * 0.02 - tw * 0.05) * 0.35;

        let best = 0, bx = 0, by = 0;
        for (let k = 0; k < nR; k++) {
          const q = ripples[k];
          const dx = x - q.x, dy = y - q.y;
          const d = sqrt(dx * dx + dy * dy) || 1;
          const dd = d - q.R;
          const band = cellHalf(dx / d, dy / d) * 1.05;
          if (dd > band * 2.5 || dd < -(q.G1 + band * 2.5)) continue;
          const g1 = dd / band, g2 = (dd + q.G1) / band;
          const g = (exp(-g1 * g1) + 0.5 * exp(-g2 * g2)) * q.A;
          if (g > best) { best = g; bx = dx; by = dy; }
        }
        if (best > 0.3) {
          set(i, lineCodeV(-by, bx), RIPPLE[min(5, floor(best * 4.5))]);
          continue;
        }
        w += best * 0.6;
        if (w > 0.62) {
          const k = min(4, floor(((w - 0.62) / 0.38) * 5));
          set(i, WATER_CH[k], WATER[k]);
        } else {
          const hsh = perm[(c & 255) + perm[row & 255]];
          if (hsh < 5 && sin(time * 0.7 + hsh * 1.7) > -0.3) set(i, 46, DEEP);
          else chars[i] = SPACE;
        }
      }
    }
  }

  function drawPad(p) {
    const st = padStyle(p);
    const R = p.r * p.scale;
    const c0 = max(0, floor((p.x - R) / cellW)), c1 = min(cols - 1, floor((p.x + R) / cellW));
    const r0 = max(0, floor((p.y - R) / cellH)), r1 = min(rows - 1, floor((p.y + R) / cellH));
    if (c0 > c1 || r0 > r1) return;
    const notchA = p.rot + p.notch;
    const veinStep = TAU / st.veins;
    const cr = cos(-p.rot), sr = sin(-p.rot);
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * cellH, dy = y - p.y;
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * cellW, dx = x - p.x;
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const d = sqrt(d2) || 0.001;
        const ca = dx / d, sa = dy / d;
        const a = atan2(dy, dx);
        const la = angDiff(notchA, a);
        const al = abs(la);
        const t = d / R;
        const i = r * cols + c;
        if (t > 0.07) {
          if (al < p.notchW) continue; // the notch: open water
          if ((al - p.notchW) * d < cellHalf(-sa, ca)) {
            set(i, lineCodeV(ca, sa), st.rim[2]);
            continue;
          }
        }
        if (d > R - cellHalf(ca, sa) * 1.9) {
          const lit = 0.5 + 0.5 * cos(a - LIGHT);
          set(i, lineCodeV(-sa, ca), st.rim[min(3, floor(lit * 4))]);
          continue;
        }
        if (t > 0.14 && t < 0.86) {
          const va = la / veinStep;
          if (abs(va - round(va)) * veinStep * d < cellHalf(-sa, ca) * 0.85) {
            set(i, lineCodeV(ca, sa), st.vein);
            continue;
          }
        }
        const lx = dx * cr - dy * sr, ly = dx * sr + dy * cr;
        const n = vnoise(lx * 0.05 + p.seed, ly * 0.05);
        const L = clamp(0.55 + 0.25 * n - 0.25 * t * t + 0.18 * cos(a - LIGHT) * t, 0, 0.999);
        const k = floor(L * FILL_CH.length);
        set(i, FILL_CH[k], st.fill[k]);
      }
    }
    if (p.flower) drawFlower(p);
  }

  function drawFlower(p) {
    const fl = p.flower;
    const w = padToWorld(p, fl.lx, fl.ly);
    const fs = fl.fs * p.scale;
    const rot = p.rot + fl.spin;
    const sc = FLOWER_SCHEMES[fl.scheme];
    const c0 = max(0, floor((w.x - fs) / cellW)), c1 = min(cols - 1, floor((w.x + fs) / cellW));
    const r0 = max(0, floor((w.y - fs) / cellH)), r1 = min(rows - 1, floor((w.y + fs) / cellH));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * cellH - w.y;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cellW - w.x;
        const d = sqrt(dx * dx + dy * dy);
        if (d > fs) continue;
        const phi = atan2(dy, dx) - rot;
        const rOut = fs * (0.5 + 0.5 * pow(abs(cos((phi * fl.n) / 2)), 0.6));
        const rIn = fs * 0.62 * (0.5 + 0.5 * pow(abs(cos(((phi + PI / fl.n) * fl.n) / 2)), 0.6));
        const i = r * cols + c;
        if (d < fs * 0.2) set(i, 64, sc.center);
        else if (d < rIn) set(i, lineCodeV(dx, dy), sc.inner);
        else if (d < rOut) set(i, lineCodeV(dx, dy), sc.outer[min(2, floor((d / rOut) * 3))]);
      }
    }
    const ci = cellAt(w.x, w.y);
    if (ci >= 0) set(ci, 64, sc.center);
  }

  function drawShadow(f) {
    if (f.h < 1) return;
    const sc = f.size * (1 - f.h / (400 * S)) * 0.9;
    const sx = f.x + f.h * 0.12, sy = f.y + f.h * 0.18;
    const hc = cos(f.heading), hs = sin(f.heading);
    const Rb = sc * 1.1;
    const c0 = max(0, floor((sx - Rb) / cellW)), c1 = min(cols - 1, floor((sx + Rb) / cellW));
    const r0 = max(0, floor((sy - Rb) / cellH)), r1 = min(rows - 1, floor((sy + Rb) / cellH));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * cellH - sy;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cellW - sx;
        const u = (dx * hc + dy * hs) / (sc * 1.0);
        const v = (-dx * hs + dy * hc) / (sc * 0.62);
        if (u * u + v * v < 1) set(r * cols + c, 46, SHADOW);
      }
    }
  }

  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    const qx = ax + vx * t - px, qy = ay + vy * t - py;
    return sqrt(qx * qx + qy * qy);
  }

  function drawFrog(f) {
    const sc = f.size * (1 + (f.h / (160 * S)) * 0.55) * f.squash;
    const fx = f.x, fy = f.y - f.h * 0.35;
    const hc = cos(f.heading), hs = sin(f.heading);
    const kind = FROG_KINDS[f.kindIndex];
    const pal = f.inWater ? kind.wet : kind.dry;
    const e = f.ext;

    // leg joints in frog space (u forward, v to the side; mirrored for the other side)
    const segs = [
      [-0.5, 0.36, lerp(0.02, -1.2, e), lerp(0.8, 0.62, e), 0.19],
      [lerp(0.02, -1.2, e), lerp(0.8, 0.62, e), lerp(-0.42, -2.0, e), lerp(0.98, 0.48, e), 0.12],
      [0.36, 0.34, lerp(0.66, 1.08, e), lerp(0.7, 0.55, e), 0.1],
    ];
    const footU = segs[1][2], footV = segs[1][3];
    // per side: thickness (never thinner than a cell) and glyph
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
    const erx = max(er, cellW * 0.55), ery = max(er, cellH * 0.55);
    const sacR = 0.42 * f.croak;
    const lu = cos(LIGHT - f.heading), lv = sin(LIGHT - f.heading);
    const stripeHalf = max(0.06, (cellW * 0.5) / sc);
    const stripeCh = lineCode(f.heading);
    const footR = max(0.16, (cellW * 0.5) / sc);

    const Rb = 2.25 * sc;
    const c0 = max(0, floor((fx - Rb) / cellW)), c1 = min(cols - 1, floor((fx + Rb) / cellW));
    const r0 = max(0, floor((fy - Rb) / cellH)), r1 = min(rows - 1, floor((fy + Rb) / cellH));
    for (let r = r0; r <= r1; r++) {
      const py = (r + 0.5) * cellH, dy = py - fy;
      for (let c = c0; c <= c1; c++) {
        const px = (c + 0.5) * cellW, dx = px - fx;
        if (dx * dx + dy * dy > Rb * Rb) continue;
        const i = r * cols + c;

        // eyes (in screen space so they always land on at least one cell)
        let qx = (px - eyes[0]) / erx, qy = (py - eyes[1]) / ery;
        let eyeHit = qx * qx + qy * qy < 1;
        if (!eyeHit) {
          qx = (px - eyes[2]) / erx;
          qy = (py - eyes[3]) / ery;
          eyeHit = qx * qx + qy * qy < 1;
        }
        if (eyeHit) {
          set(i, EYE_CH, pal.eye);
          continue;
        }

        const u = (dx * hc + dy * hs) / sc, v = (-dx * hs + dy * hc) / sc, av = abs(v);

        // body + head
        const bu = (u + 0.15) / 0.8, bv = v / 0.58;
        const hu = (u - 0.5) / 0.45, hv = v / 0.48;
        const q = min(bu * bu + bv * bv, hu * hu + hv * hv);
        if (q < 1) {
          if (f.stripe && av < stripeHalf && u > -0.85 && u < 0.6) {
            set(i, stripeCh, pal.stripe);
            continue;
          }
          let spot = false;
          for (const s of f.spots) {
            const su = u - s.u, sv = v - s.v;
            if (su * su + sv * sv < s.r * s.r) { spot = true; break; }
          }
          const lit = clamp(0.15 + (1 - q) * 0.85 + 0.2 * ((u + 0.15) * lu + v * lv), 0, 0.999);
          const k = floor(lit * 4);
          set(i, BODY_CH[k], spot ? pal.spot : pal.body[k]);
          continue;
        }

        // vocal sac, puffing out under the chin
        if (sacR > 0.05) {
          const su = u - 0.86;
          if (su * su + v * v < sacR * sacR) {
            set(i, SAC_CH, pal.sac);
            continue;
          }
        }

        // legs
        const side = v < 0 ? 1 : 0;
        let legHit = -1;
        if (hypot(u - footU, av - footV) < footR) legHit = 99;
        else {
          for (let s = 0; s < 3; s++) {
            const g = segs[s];
            if (segDist(u, av, g[0], g[1], g[2], g[3]) < legT[s * 2 + side]) { legHit = s; break; }
          }
        }
        if (legHit === 99) {
          set(i, 42, pal.leg);
          continue;
        }
        if (legHit >= 0) {
          set(i, legCh[legHit * 2 + side], pal.leg);
          continue;
        }

        // a thin moat of darkness so frogs read against busy pads
        if (!f.inWater && q < 1.5) chars[i] = SPACE;
      }
    }

    if (f.tongue) {
      const tg = f.tongue;
      const reach = tg.t < 0.5 ? tg.t * 2 : (1 - tg.t) * 2;
      const mx = fx + hc * 0.92 * sc, my = fy + hs * 0.92 * sc;
      const tx = lerp(mx, tg.x, reach), ty = lerp(my, tg.y, reach);
      const len = hypot(tx - mx, ty - my);
      const n = ceil(len / (min(cellW, cellH) * 0.5));
      const ch = lineCodeV(tx - mx, ty - my);
      for (let k = 1; k <= n; k++) {
        const ci = cellAt(lerp(mx, tx, k / n), lerp(my, ty, k / n));
        if (ci >= 0) set(ci, ch, TONGUE);
      }
      const ti = cellAt(tx, ty);
      if (ti >= 0) {
        if (tg.caught) set(ti, 42, FIREFLY);
        else set(ti, SAC_CH, TONGUE_TIP);
      }
    }
  }

  function drawFireflies() {
    for (const fl of fireflies) {
      if (!fl.alive || fl.fade < 0.02) continue;
      if (theme === 'light') {
        // by day they're just flies: no glow, wings buzzing
        const ci = cellAt(fl.x, fl.y);
        if (ci >= 0 && fl.fade > 0.3) set(ci, sin(time * 40 + fl.phase) > 0 ? 120 : 43, FIREFLY);
        continue;
      }
      const pulse = 0.5 + 0.5 * sin(time * fl.freq + fl.phase);
      const b = fl.fade * (0.4 + 0.6 * pulse * pulse);
      const gx = cellW * (1.2 + 2.6 * b), gy = cellH * (0.7 + 1.4 * b);
      const c0 = max(0, floor((fl.x - gx) / cellW)), c1 = min(cols - 1, floor((fl.x + gx) / cellW));
      const r0 = max(0, floor((fl.y - gy) / cellH)), r1 = min(rows - 1, floor((fl.y + gy) / cellH));
      for (let r = r0; r <= r1; r++) {
        const qy = ((r + 0.5) * cellH - fl.y) / gy;
        for (let c = c0; c <= c1; c++) {
          const qx = ((c + 0.5) * cellW - fl.x) / gx;
          const q = qx * qx + qy * qy;
          const i = r * cols + c;
          if (q > 1 || chars[i] !== SPACE) continue;
          set(i, 46, GLOW[min(4, floor((1 - q) * b * 4.99))]);
        }
      }
      const ci = cellAt(fl.x, fl.y);
      if (ci >= 0) set(ci, b > 0.6 ? 42 : 43, b > 0.6 ? FIREFLY : GLOW[4]);
    }
  }

  function drawDrops() {
    for (const d of drops) {
      const ci = cellAt(d.x, d.y - d.z * 0.4);
      if (ci < 0) continue;
      set(ci, d.vz > 0 ? 39 : 46, SPLASH[clamp(3 - floor(d.life * 4), 0, 3)]);
    }
  }

  function draw() {
    drawWater();
    for (const p of pads) drawPad(p);
    for (const f of frogs) drawShadow(f);
    const order = frogs.slice().sort((a, b) => (a.inWater ? -1 : a.h) - (b.inWater ? -1 : b.h));
    for (const f of order) drawFrog(f);
    drawFireflies();
    drawDrops();
    applyFade();
    flush();
  }

  // pad colours are picked once per pad, from values the simulation gives it
  const padStyles = new WeakMap();
  function padStyle(p) {
    let s = padStyles.get(p);
    if (s) return s;
    const dark = mix('#123a20', '#2b3f17', p.pv);
    const mid = mix('#2f7a3a', '#4f8a2c', (p.seed * 0.618) % 1);
    const light = mix('#6dbb55', '#a6cf63', (p.seed * 0.382 + 0.5) % 1);
    s = {
      fill: ramp([mix(dark, '#000000', 0.25), dark, mid, mix(mid, light, 0.45)], 6),
      rim: p.red
        ? ramp(['#4a1f2a', '#8a3a3f', '#c0675a', '#e09a7a'], 4)
        : ramp([mix(dark, '#000000', 0.1), mid, light, mix(light, '#e8ffb0', 0.4)], 4),
      vein: pc(mix(mid, light, 0.55)),
    };
    padStyles.set(p, s);
    return s;
  }

  function resize(context, w, h) {
    ctx = context;
    W = w;
    H = h;
    fontSize = clamp(round(sqrt(W * H) / 105), 8, 13);
    font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.font = font;
    cellW = ctx.measureText('M').width || fontSize * 0.6;
    cellH = round(fontSize * 1.15 * 10) / 10;
    yOff = (cellH - fontSize) / 2;
    cols = ceil(W / cellW);
    rows = ceil(H / cellH);
    chars = new Uint16Array(cols * rows);
    colors = new Uint16Array(cols * rows);
    lines = [];
    lineMin = [];
    lineMax = [];
  }

  // near text, glyphs drop out in an ordered-dither pattern
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  let fade = null, fadeKey = '', avoid = [], avoidVer = -1;
  function applyFade() {
    const key = `${avoidVer}:${cols}x${rows}`;
    if (key !== fadeKey) {
      fade = KPond.fadeField(cols, rows, cellW, cellH, avoid, 64);
      fadeKey = key;
    }
    for (let r = 0, i = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        if (fade[i] < 1 && BAYER[((r & 3) << 2) | (c & 3)] > fade[i]) chars[i] = SPACE;
      }
    }
  }

  function render(context, world) {
    ctx = context;
    ({ W, H, S, time, pads, frogs, ripples, fireflies, drops, theme, avoid, avoidVer } = world);
    activePal = theme === 'light' ? paletteLight : palette;
    draw();
  }

  return { bg: (t) => BG[t], resize, render };
})();
