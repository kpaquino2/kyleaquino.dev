// k-pond — an ASCII pond where frogs hop between lily pads.
// Everything is drawn into a character grid, then flushed to a canvas one
// colour-run per row so it stays fast at full-screen sizes.
(() => {
  'use strict';

  const canvas = document.getElementById('pond');
  const ctx = canvas.getContext('2d', { alpha: false });
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT_FAMILY = '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

  const { sin, cos, atan2, sqrt, exp, abs, min, max, floor, ceil, round, PI, hypot, random, pow } = Math;
  const TAU = PI * 2;
  const LIGHT = -2.3; // light comes from the upper left

  // ---------------------------------------------------------------- helpers
  const rand = (a = 1, b) => (b === undefined ? random() * a : a + random() * (b - a));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (arr) => arr[floor(random() * arr.length)];
  const code = (s) => s.charCodeAt(0);
  const SPACE = 32;

  function angDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > PI) d -= TAU;
    else if (d < -PI) d += TAU;
    return d;
  }

  // value noise
  const perm = new Uint8Array(512);
  {
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) {
      const j = floor(random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  function vnoise(x, y) {
    const ix = floor(x), iy = floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const X = ix & 255, Y = iy & 255;
    const a = perm[X + perm[Y]], b = perm[X + 1 + perm[Y]];
    const c = perm[X + perm[Y + 1]], d = perm[X + 1 + perm[Y + 1]];
    return (a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy) / 255;
  }

  // ---------------------------------------------------------------- palette
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
  let W = 0, H = 0, dpr = 1, fontSize = 10, font = '', cellW = 6, cellH = 12, yOff = 0;
  let cols = 0, rows = 0;
  let chars = new Uint16Array(0), colors = new Uint16Array(0);
  let lines = [], lineMin = [], lineMax = [];
  let S = 1, FR = 40, JMAX = 330;

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

  // ---------------------------------------------------------------- scene
  let pads = [], frogs = [], ripples = [], fireflies = [], drops = [];
  let time = 0, ambientT = 2;

  function padToWorld(p, lx, ly) {
    const c = cos(p.rot), s = sin(p.rot);
    return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c };
  }
  function targetWorld(tg) {
    return tg.pad ? padToWorld(tg.pad, tg.lx, tg.ly) : tg;
  }

  function makePad(x, y, r) {
    const dark = mix('#123a20', '#2b3f17', random());
    const mid = mix('#2f7a3a', '#4f8a2c', random());
    const light = mix('#6dbb55', '#a6cf63', random());
    const reddish = random() < 0.3;
    const p = {
      x, y, r,
      rot: rand(TAU),
      vr: rand(-0.035, 0.035),
      vx: rand(-3, 3) * S,
      vy: rand(-3, 3) * S,
      notch: 0,
      notchW: rand(0.12, 0.2),
      veins: 6 + floor(rand(4)),
      seed: rand(200),
      scale: 1,
      bounce: 0,
      bounceT: 0,
      landable: r >= FR * 1.5,
      fill: ramp([mix(dark, '#000000', 0.25), dark, mid, mix(mid, light, 0.45)], 6),
      rim: reddish
        ? ramp(['#4a1f2a', '#8a3a3f', '#c0675a', '#e09a7a'], 4)
        : ramp([mix(dark, '#000000', 0.1), mid, light, mix(light, '#e8ffb0', 0.4)], 4),
      vein: pc(mix(mid, light, 0.55)),
      flower: null,
    };
    if (r > 48 * S && random() < 0.28) {
      const a = rand(0.7, TAU - 0.7); // stay clear of the notch (at local angle 0)
      const d = r * rand(0.3, 0.55);
      p.flower = {
        lx: cos(a) * d,
        ly: sin(a) * d,
        fs: max(r * rand(0.26, 0.36), cellH * 1.4),
        n: pick([8, 10, 12]),
        spin: rand(TAU),
        scheme: pick(FLOWER_SCHEMES),
      };
    }
    return p;
  }

  function makeFrog() {
    let total = 0;
    for (const k of FROG_KINDS) total += k.weight;
    let roll = rand(total), kind = FROG_KINDS[0];
    for (const k of FROG_KINDS) {
      if ((roll -= k.weight) <= 0) { kind = k; break; }
    }
    const spots = [];
    if (kind.hasSpots) {
      for (let n = 3 + floor(rand(4)); n > 0; n--) spots.push({ u: rand(-0.8, 0.35), v: rand(-0.38, 0.38), r: rand(0.09, 0.16) });
    }
    return {
      kind,
      size: FR * rand(0.88, 1.08) * kind.scale,
      spots,
      stripe: kind.canStripe && random() < 0.5,
      pitch: rand(0.8, 1.25),
      x: 0, y: 0, h: 0,
      heading: rand(TAU), lh: 0,
      pad: null, lx: 0, ly: 0,
      inWater: false,
      state: 'sit', stateT: 0,
      timer: rand(1, 7),
      squash: 1, ext: 0,
      croakT: 0, croak: 0,
      turnTo: null,
      hunt: null, tongue: null, tongueCD: rand(2, 5),
      jump: null, swimPad: null, rippleT: 0,
      away: null, noWater: false,
    };
  }

  function attach(f, spot) {
    f.pad = spot.pad;
    f.lx = spot.lx;
    f.ly = spot.ly;
    f.lh = f.heading - spot.pad.rot;
    const w = padToWorld(spot.pad, spot.lx, spot.ly);
    f.x = w.x;
    f.y = w.y;
  }

  function spotTaken(x, y, f) {
    for (const o of frogs) {
      if (o === f) continue;
      const need = (o.size + f.size) * 1.05;
      if (hypot(o.x - x, o.y - y) < need) return true;
      if (o.jump) {
        const t = targetWorld(o.jump.target);
        if (hypot(t.x - x, t.y - y) < need) return true;
      }
    }
    return false;
  }

  function findSpot(p, f) {
    if (!p.landable) return null;
    for (let k = 0; k < 16; k++) {
      const rho = sqrt(random()) * p.r * 0.5;
      const a = rand(TAU);
      if (rho > p.r * 0.18 && abs(angDiff(p.notch, a)) < p.notchW + 0.45) continue;
      const lx = cos(a) * rho, ly = sin(a) * rho;
      if (p.flower && hypot(lx - p.flower.lx, ly - p.flower.ly) < p.flower.fs + f.size * 0.9) continue;
      const w = padToWorld(p, lx, ly);
      if (spotTaken(w.x, w.y, f)) continue;
      return { pad: p, lx, ly };
    }
    return null;
  }

  function nearestLandable(f, exclude) {
    let best = null, bd = Infinity;
    for (const p of pads) {
      if (!p.landable || p === exclude) continue;
      const d = hypot(p.x - f.x, p.y - f.y) - p.r;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function chooseTarget(f, opts = {}) {
    if (!opts.noWater && random() < 0.06) {
      for (let k = 0; k < 10; k++) {
        const a = rand(TAU), d = rand(0.45, 0.9) * JMAX;
        const x = f.x + cos(a) * d, y = f.y + sin(a) * d;
        if (x < 40 || y < 40 || x > W - 40 || y > H - 40) continue;
        if (pads.some((p) => hypot(p.x - x, p.y - y) < p.r + f.size * 1.2)) continue;
        return { x, y, water: true };
      }
    }
    const cands = [];
    for (const p of pads) {
      if (p === f.pad || !p.landable) continue;
      const dx = p.x - f.x, dy = p.y - f.y;
      const d = hypot(dx, dy);
      let score = d * rand(0.6, 1.5);
      if (d > JMAX + p.r * 0.5) score += 10000 + d; // too far: fallback only
      if (opts.away) {
        const ax = f.x - opts.away.x, ay = f.y - opts.away.y;
        const cosv = (dx * ax + dy * ay) / (d * hypot(ax, ay) || 1);
        score -= cosv * JMAX * 0.9;
      }
      cands.push({ p, score });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const c of cands) {
      const s = findSpot(c.p, f);
      if (s) return s;
    }
    return null;
  }

  function addRipple(x, y, o = {}) {
    ripples.push({
      x, y,
      t0: time,
      r0: o.r0 ?? 2,
      speed: o.speed ?? 50 * S,
      amp: o.amp ?? 1,
      decay: o.decay ?? 1.1,
      gap: o.gap ?? 14 * S,
      R: 0, A: 0,
    });
    if (ripples.length > 70) ripples.shift();
  }

  function splash(x, y, s = 1) {
    for (let i = 0; i < 16; i++) {
      const a = rand(TAU), sp = rand(40, 130) * S * s;
      drops.push({ x, y, z: 0, vx: cos(a) * sp, vy: sin(a) * sp * 0.7, vz: rand(90, 210) * S, life: 0 });
    }
    addRipple(x, y, { amp: 1.3, speed: 70 * S, decay: 0.95 });
    addRipple(x, y, { amp: 0.9, speed: 42 * S, decay: 1.2, r0: 0 });
  }

  function makeFirefly() {
    const fl = { x: 0, y: 0, vx: 0, vy: 0, wa: 0, speed: 0, phase: 0, freq: 0, alive: false, fade: 0, respawn: 0, hunter: null };
    spawnFirefly(fl);
    return fl;
  }
  function spawnFirefly(fl) {
    fl.x = rand(W * 0.08, W * 0.92);
    fl.y = rand(H * 0.08, H * 0.92);
    fl.wa = rand(TAU);
    fl.speed = rand(14, 30) * S;
    fl.phase = rand(TAU);
    fl.freq = rand(1.2, 2.6);
    fl.alive = true;
    fl.fade = 0;
    fl.hunter = null;
  }

  function buildScene() {
    pads = []; frogs = []; ripples = []; fireflies = []; drops = [];
    const rMin = 34 * S, rMax = 112 * S;
    const target = W * H * 0.34;
    let covered = 0;
    for (let n = 0; n < 1600 && covered < target; n++) {
      const r = max(rMin, rMax * (1 - (n / 1600) * 0.75) * rand(0.7, 1));
      const x = rand(-r * 0.3, W + r * 0.3), y = rand(-r * 0.3, H + r * 0.3);
      if (pads.some((p) => hypot(p.x - x, p.y - y) < (p.r + r) * 1.06 + 6 * S)) continue;
      pads.push(makePad(x, y, r));
      covered += PI * r * r;
    }
    if (!pads.some((p) => p.landable)) {
      pads.sort((a, b) => b.r - a.r).slice(0, 3).forEach((p) => { p.landable = true; });
    }
    const landable = pads.filter((p) => p.landable);
    const nFrogs = clamp(round(landable.length * 0.5), 3, 14);
    for (let i = 0; i < nFrogs; i++) {
      const f = makeFrog();
      for (let t = 0; t < 30; t++) {
        const s = findSpot(pick(landable), f);
        if (s) { attach(f, s); frogs.push(f); break; }
      }
    }
    const nFlies = clamp(round((W * H) / 160000), 3, 10);
    for (let i = 0; i < nFlies; i++) fireflies.push(makeFirefly());
  }

  function setup() {
    dpr = min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = round(W * dpr);
    canvas.height = round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const area = sqrt(W * H);
    fontSize = clamp(round(area / 105), 8, 13);
    font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.font = font;
    cellW = ctx.measureText('M').width || fontSize * 0.6;
    cellH = round(fontSize * 1.15 * 10) / 10;
    yOff = (cellH - fontSize) / 2;
    cols = ceil(W / cellW);
    rows = ceil(H / cellH);
    chars = new Uint16Array(cols * rows);
    colors = new Uint16Array(cols * rows);
    lines = []; lineMin = []; lineMax = [];

    S = clamp(area / 1100, 0.6, 1.5);
    FR = 46 * S;
    JMAX = 330 * S;
    buildScene();
  }

  // ---------------------------------------------------------------- sound
  const sfx = (() => {
    let ac = null, master = null, noiseBuf = null;
    const api = { on: false };
    api.init = () => {
      if (ac) {
        if (ac.state === 'suspended') ac.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5;
      const comp = ac.createDynamicsCompressor();
      master.connect(comp).connect(ac.destination);
      noiseBuf = ac.createBuffer(1, floor(ac.sampleRate * 0.5), ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = random() * 2 - 1;
    };
    const ready = () => api.on && ac && ac.state === 'running';
    function out(x) {
      const g = ac.createGain();
      if (ac.createStereoPanner) {
        const pn = ac.createStereoPanner();
        pn.pan.value = clamp((x / W) * 2 - 1, -1, 1) * 0.7;
        g.connect(pn).connect(master);
      } else {
        g.connect(master);
      }
      return g;
    }
    api.plop = (x, pitch = 1, vol = 0.3) => {
      if (!ready()) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = out(x);
      const f0 = rand(520, 760) * pitch;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.25, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.2);
    };
    api.splash = (x) => {
      if (!ready()) return;
      const t = ac.currentTime;
      const s = ac.createBufferSource();
      s.buffer = noiseBuf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(1800, t);
      bp.frequency.exponentialRampToValueAtTime(450, t + 0.35);
      const g = out(x);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.45, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      s.connect(bp).connect(g);
      s.start(t);
      s.stop(t + 0.45);
      api.plop(x, 0.6, 0.35);
    };
    api.croak = (x, pitch = 1) => {
      if (!ready()) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 105 * pitch;
      const lfo = ac.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 32 * pitch;
      const lg = ac.createGain();
      lg.gain.value = 30 * pitch;
      lfo.connect(lg).connect(o.frequency);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;
      lp.Q.value = 4;
      const g = out(x);
      g.gain.setValueAtTime(0.0001, t);
      for (const b of [0.1, 0.55]) {
        g.gain.setValueAtTime(0.0001, t + b);
        g.gain.exponentialRampToValueAtTime(0.3, t + b + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + b + 0.2);
      }
      o.connect(lp).connect(g);
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.85);
      lfo.stop(t + 0.85);
    };
    return api;
  })();

  // ---------------------------------------------------------------- behaviour
  const CROAK_DUR = 0.9;

  function turn(f, d) {
    f.heading += d;
    if (f.pad) f.lh += d;
  }
  const canJump = (f) => (f.state === 'sit' || f.state === 'land') && !f.tongue;

  function startJump(f, target, small = false) {
    if (f.hunt) { f.hunt.hunter = null; f.hunt = null; }
    f.tongue = null;
    f.croakT = 0;
    f.croak = 0;
    f.turnTo = null;
    f.jump = { target, small, prep: small ? 0.1 : rand(0.14, 0.22), sx: 0, sy: 0, dur: 1, H: 0 };
    f.state = 'prep';
    f.stateT = 0;
  }

  function launch(f) {
    const j = f.jump;
    const tw = targetWorld(j.target);
    j.sx = f.x;
    j.sy = f.y;
    const d = hypot(tw.x - f.x, tw.y - f.y);
    j.dur = clamp(0.3 + d / (650 * S), 0.34, 0.95) * (j.small ? 0.75 : 1);
    j.H = j.small ? 14 * S : clamp(d * 0.36, 26 * S, 150 * S);
    if (f.pad) {
      f.pad.bounce = max(f.pad.bounce, 0.5);
      f.pad.bounceT = 0;
      f.pad = null;
    }
    if (f.inWater) {
      f.inWater = false;
      addRipple(f.x, f.y, { amp: 0.9, speed: 45 * S });
    }
    f.state = 'jump';
    f.stateT = 0;
    f.squash = 1.05;
  }

  function land(f) {
    const tg = f.jump.target;
    f.jump = null;
    f.h = 0;
    f.ext = 0;
    f.stateT = 0;
    if (tg.water) {
      f.x = tg.x;
      f.y = tg.y;
      f.inWater = true;
      f.state = 'swim';
      f.swimPad = nearestLandable(f);
      f.rippleT = 0.2;
      splash(f.x, f.y, 1);
      sfx.splash(f.x);
      return;
    }
    attach(f, tg);
    f.state = 'land';
    f.squash = 0.78;
    tg.pad.bounce = 1;
    tg.pad.bounceT = 0;
    addRipple(tg.pad.x, tg.pad.y, { r0: tg.pad.r * 0.98, amp: 0.8, speed: 38 * S, decay: 1.3 });
    sfx.plop(f.x, FR / f.size);
  }

  function sitUpdate(f, dt) {
    f.timer -= dt;
    f.squash = lerp(f.squash, 1, min(1, dt * 6));

    if (f.hunt) {
      const fl = f.hunt;
      if (!fl.alive || fl.hunter !== f) {
        f.hunt = null;
      } else if (!f.tongue) {
        const d = angDiff(f.heading, atan2(fl.y - f.y, fl.x - f.x));
        turn(f, clamp(d, -dt * 7, dt * 7));
        if (hypot(fl.x - f.x, fl.y - f.y) > f.size * 4.4) {
          fl.hunter = null;
          f.hunt = null;
        } else if (abs(d) < 0.25) {
          f.tongue = { t: 0, fly: fl, x: fl.x, y: fl.y, caught: false };
        }
      }
    } else if (f.tongueCD <= 0 && !f.tongue && random() < dt * 1.5) {
      for (const fl of fireflies) {
        if (!fl.alive || fl.hunter || fl.fade < 0.6) continue;
        if (hypot(fl.x - f.x, fl.y - f.y) < f.size * 3.6) {
          fl.hunter = f;
          f.hunt = fl;
          break;
        }
      }
    }

    if (!f.hunt && !f.tongue) {
      if (f.turnTo !== null) {
        const d = angDiff(f.heading, f.turnTo);
        turn(f, clamp(d, -dt * 2.2, dt * 2.2));
        if (abs(d) < 0.03) f.turnTo = null;
      } else if (random() < dt * 0.07) {
        f.turnTo = f.heading + rand(-1.1, 1.1);
      }
      if (f.croakT <= 0 && random() < dt * 0.03) {
        f.croakT = CROAK_DUR;
        sfx.croak(f.x, f.pitch);
      }
    }

    if (f.timer <= 0 && !f.tongue) {
      const tg = chooseTarget(f, { away: f.away, noWater: f.noWater || !!f.away });
      f.away = null;
      f.noWater = false;
      if (tg) startJump(f, tg);
      else f.timer = rand(1, 3);
    }
  }

  function tongueUpdate(f, dt) {
    const tg = f.tongue;
    tg.t += dt / 0.34;
    if (tg.t < 0.5 && tg.fly.alive) {
      tg.x = tg.fly.x;
      tg.y = tg.fly.y;
    }
    if (!tg.caught && tg.t >= 0.5) {
      tg.caught = tg.fly.alive && tg.fly.hunter === f;
      if (tg.caught) {
        tg.fly.alive = false;
        tg.fly.respawn = rand(4, 10);
        sfx.plop(f.x, 1.8, 0.15);
      }
    }
    if (tg.t >= 1) {
      if (tg.fly.hunter === f) tg.fly.hunter = null;
      f.tongue = null;
      f.hunt = null;
      f.tongueCD = rand(3, 7);
      if (tg.caught) f.squash = 0.9;
    }
  }

  function updateFrog(f, dt) {
    if (f.pad) {
      const w = padToWorld(f.pad, f.lx, f.ly);
      f.x = w.x;
      f.y = w.y;
      f.heading = f.lh + f.pad.rot;
    }
    f.stateT += dt;
    if (f.tongueCD > 0) f.tongueCD -= dt;

    switch (f.state) {
      case 'sit':
        sitUpdate(f, dt);
        break;
      case 'land':
        f.squash = lerp(f.squash, 1, min(1, dt * 12));
        if (f.stateT > 0.22) {
          f.state = 'sit';
          f.squash = 1;
          f.timer = rand(2, 8);
        }
        break;
      case 'prep': {
        const tw = targetWorld(f.jump.target);
        turn(f, angDiff(f.heading, atan2(tw.y - f.y, tw.x - f.x)) * min(1, dt * 16));
        f.squash = lerp(f.squash, 0.84, min(1, dt * 18));
        if (f.stateT >= f.jump.prep) launch(f);
        break;
      }
      case 'jump': {
        const j = f.jump;
        const tw = targetWorld(j.target);
        const t = min(1, f.stateT / j.dur);
        f.x = lerp(j.sx, tw.x, t);
        f.y = lerp(j.sy, tw.y, t);
        f.h = 4 * j.H * t * (1 - t);
        turn(f, angDiff(f.heading, atan2(tw.y - j.sy, tw.x - j.sx)) * min(1, dt * 10));
        f.ext = t < 0.15 ? t / 0.15 : max(0.1, 1 - (t - 0.15) / 0.7);
        f.squash = lerp(f.squash, 1, min(1, dt * 10));
        if (t >= 1) land(f);
        break;
      }
      case 'swim': {
        let p = f.swimPad;
        if (!p) p = f.swimPad = nearestLandable(f);
        if (!p) break;
        turn(f, clamp(angDiff(f.heading, atan2(p.y - f.y, p.x - f.x)), -dt * 3, dt * 3));
        const sp = 42 * S;
        f.x += cos(f.heading) * sp * dt;
        f.y += sin(f.heading) * sp * dt;
        f.ext = 0.45 + 0.45 * sin(time * 8 + f.pitch * 10);
        f.rippleT -= dt;
        if (f.rippleT <= 0) {
          f.rippleT = 0.4;
          addRipple(f.x - cos(f.heading) * f.size * 0.6, f.y - sin(f.heading) * f.size * 0.6, { amp: 0.55, speed: 26 * S, decay: 1.7, r0: 4 });
        }
        if (hypot(p.x - f.x, p.y - f.y) < p.r + f.size * 0.2) {
          const s = findSpot(p, f);
          if (s) startJump(f, s, true);
          else f.swimPad = nearestLandable(f, p);
        }
        break;
      }
    }

    if (f.croakT > 0) {
      f.croakT -= dt;
      const ph = 1 - max(0, f.croakT) / CROAK_DUR;
      f.croak = abs(sin(ph * TAU));
    } else {
      f.croak = 0;
    }
    if (f.tongue) tongueUpdate(f, dt);
  }

  function updatePads(dt) {
    for (const p of pads) {
      p.vx += rand(-1, 1) * S * dt * 3;
      p.vy += rand(-1, 1) * S * dt * 3;
      const sp = hypot(p.vx, p.vy), cap = 6 * S;
      if (sp > cap) { p.vx *= cap / sp; p.vy *= cap / sp; }
      const m = p.r * 0.2;
      if (p.x < -m) p.vx += 10 * S * dt;
      if (p.x > W + m) p.vx -= 10 * S * dt;
      if (p.y < -m) p.vy += 10 * S * dt;
      if (p.y > H + m) p.vy -= 10 * S * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.bounce > 0.002) {
        p.bounceT += dt;
        p.bounce *= exp(-dt * 3.5);
        p.scale = 1 - 0.045 * p.bounce * cos(p.bounceT * 16);
      } else {
        p.bounce = 0;
        p.scale = 1;
      }
    }
    for (let i = 0; i < pads.length; i++) {
      for (let j = i + 1; j < pads.length; j++) {
        const a = pads[i], b = pads[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = hypot(dx, dy) || 1;
        const need = (a.r + b.r) * 1.03;
        if (d < need) {
          const push = (need - d) * 0.5, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          a.vx -= nx * 2 * S; a.vy -= ny * 2 * S;
          b.vx += nx * 2 * S; b.vy += ny * 2 * S;
        }
      }
    }
  }

  function updateFireflies(dt) {
    for (const fl of fireflies) {
      if (!fl.alive) {
        fl.respawn -= dt;
        if (fl.respawn <= 0) spawnFirefly(fl);
        continue;
      }
      fl.fade = min(1, fl.fade + dt * 0.6);
      fl.wa += rand(-1, 1) * dt * 3;
      if (fl.x < 0) fl.wa = 0;
      else if (fl.x > W) fl.wa = PI;
      if (fl.y < 0) fl.wa = PI / 2;
      else if (fl.y > H) fl.wa = -PI / 2;
      // a hunted firefly dawdles, which is fair
      const sp = fl.speed * (fl.hunter ? 0.4 : 1);
      fl.vx = lerp(fl.vx, cos(fl.wa) * sp, min(1, dt * 1.5));
      fl.vy = lerp(fl.vy, sin(fl.wa) * sp, min(1, dt * 1.5));
      fl.x += fl.vx * dt;
      fl.y += fl.vy * dt;
    }
  }

  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life += dt;
      d.vz -= 520 * S * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.z < 0) {
        if (random() < 0.3) addRipple(d.x, d.y, { amp: 0.45, speed: 20 * S, decay: 2, r0: 1 });
        drops.splice(i, 1);
      }
    }
  }

  function update(dt) {
    time += dt;
    updatePads(dt);
    for (const f of frogs) updateFrog(f, dt);
    updateFireflies(dt);
    updateDrops(dt);

    // water striders & falling seeds: the odd ripple on open water
    ambientT -= dt;
    if (ambientT <= 0) {
      ambientT = rand(1.5, 4);
      for (let k = 0; k < 8; k++) {
        const x = rand(W), y = rand(H);
        if (padAt(x, y)) continue;
        addRipple(x, y, { amp: 0.6, speed: 28 * S, decay: 1.4, r0: 1 });
        break;
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      if (r.amp * exp(-(time - r.t0) * r.decay) < 0.08) ripples.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- drawing
  function drawWater() {
    const tw = REDUCED ? time * 0.25 : time;
    for (const r of ripples) {
      const age = time - r.t0;
      r.R = r.r0 + r.speed * age;
      r.A = r.amp * exp(-age * r.decay);
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
          if (dd > band * 2.5 || dd < -(q.gap + band * 2.5)) continue;
          const g1 = dd / band, g2 = (dd + q.gap) / band;
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
    const R = p.r * p.scale;
    const c0 = max(0, floor((p.x - R) / cellW)), c1 = min(cols - 1, floor((p.x + R) / cellW));
    const r0 = max(0, floor((p.y - R) / cellH)), r1 = min(rows - 1, floor((p.y + R) / cellH));
    if (c0 > c1 || r0 > r1) return;
    const notchA = p.rot + p.notch;
    const veinStep = TAU / p.veins;
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
            set(i, lineCodeV(ca, sa), p.rim[2]);
            continue;
          }
        }
        if (d > R - cellHalf(ca, sa) * 1.9) {
          const lit = 0.5 + 0.5 * cos(a - LIGHT);
          set(i, lineCodeV(-sa, ca), p.rim[min(3, floor(lit * 4))]);
          continue;
        }
        if (t > 0.14 && t < 0.86) {
          const va = la / veinStep;
          if (abs(va - round(va)) * veinStep * d < cellHalf(-sa, ca) * 0.85) {
            set(i, lineCodeV(ca, sa), p.vein);
            continue;
          }
        }
        const lx = dx * cr - dy * sr, ly = dx * sr + dy * cr;
        const n = vnoise(lx * 0.05 + p.seed, ly * 0.05);
        const L = clamp(0.55 + 0.25 * n - 0.25 * t * t + 0.18 * cos(a - LIGHT) * t, 0, 0.999);
        const k = floor(L * FILL_CH.length);
        set(i, FILL_CH[k], p.fill[k]);
      }
    }
    if (p.flower) drawFlower(p);
  }

  function drawFlower(p) {
    const fl = p.flower;
    const w = padToWorld(p, fl.lx, fl.ly);
    const fs = fl.fs * p.scale;
    const rot = p.rot + fl.spin;
    const sc = fl.scheme;
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
    const pal = f.inWater ? f.kind.wet : f.kind.dry;
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

  function render() {
    drawWater();
    for (const p of pads) drawPad(p);
    for (const f of frogs) drawShadow(f);
    const order = frogs.slice().sort((a, b) => (a.inWater ? -1 : a.h) - (b.inWater ? -1 : b.h));
    for (const f of order) drawFrog(f);
    drawFireflies();
    drawDrops();
    flush();
  }

  // ---------------------------------------------------------------- input
  function padAt(x, y) {
    for (let i = pads.length - 1; i >= 0; i--) {
      const p = pads[i];
      if (hypot(p.x - x, p.y - y) < p.r) return p;
    }
    return null;
  }
  function frogAt(x, y) {
    let best = null, bd = Infinity;
    for (const f of frogs) {
      const d = hypot(f.x - x, f.y - f.h * 0.35 - y);
      if (d < f.size * 1.3 && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function tap(x, y) {
    const f = frogAt(x, y);
    if (f) {
      if (canJump(f)) {
        const tg = chooseTarget(f);
        if (tg) startJump(f, tg);
      }
      return;
    }
    const p = padAt(x, y);
    if (p) {
      p.bounce = max(p.bounce, 0.7);
      p.bounceT = 0;
      if (!p.landable) return;
      let best = null, bd = Infinity;
      for (const o of frogs) {
        if (!canJump(o) || o.pad === p) continue;
        const d = hypot(o.x - p.x, o.y - p.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        const s = findSpot(p, best);
        if (s) startJump(best, s);
      }
      return;
    }
    addRipple(x, y, { amp: 1.1, speed: 60 * S, decay: 1.0 });
    sfx.plop(x, 0.8, 0.12);
    for (const o of frogs) {
      if (canJump(o) && hypot(o.x - x, o.y - y) < 190 * S) {
        o.timer = rand(0.03, 0.3);
        o.away = { x, y };
      }
    }
  }

  function leapAll() {
    for (const f of frogs) {
      if (!canJump(f)) continue;
      f.timer = rand(0, 0.35);
      f.noWater = true;
      f.hunt = null;
    }
  }

  let dragging = false, lastDrag = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastDrag = time;
    tap(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    const x = e.clientX, y = e.clientY;
    if (dragging && time - lastDrag > 0.07 && !padAt(x, y)) {
      addRipple(x, y, { amp: 0.7, speed: 40 * S, decay: 1.6, r0: 1 });
      lastDrag = time;
    }
    canvas.style.cursor = frogAt(x, y) || padAt(x, y) ? 'pointer' : 'default';
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    canvas.addEventListener(ev, () => { dragging = false; });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      leapAll();
    }
  });
  document.getElementById('leap').addEventListener('click', leapAll);

  const soundBtn = document.getElementById('sound');
  soundBtn.addEventListener('click', () => {
    sfx.on = !sfx.on;
    if (sfx.on) sfx.init();
    soundBtn.textContent = sfx.on ? 'sound on' : 'sound off';
    soundBtn.setAttribute('aria-pressed', String(sfx.on));
  });

  // theme: follow the system until the viewer picks one, then remember it
  const THEME_KEY = 'k-pond-theme';
  const systemLight = window.matchMedia('(prefers-color-scheme: light)');
  const themeBtn = document.getElementById('theme');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  function storedTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : null;
    } catch {
      return null;
    }
  }
  function applyTheme(t) {
    theme = t;
    activePal = t === 'light' ? paletteLight : palette;
    document.documentElement.dataset.theme = t;
    if (themeMeta) themeMeta.content = BG[t];
    themeBtn.textContent = t === 'light' ? 'day' : 'night';
    themeBtn.title = `Switch to ${t === 'light' ? 'night (dark)' : 'day (light)'} mode`;
    themeBtn.setAttribute('aria-label', themeBtn.title);
  }
  applyTheme(storedTheme() || (systemLight.matches ? 'light' : 'dark'));
  systemLight.addEventListener('change', (e) => {
    if (!storedTheme()) applyTheme(e.matches ? 'light' : 'dark');
  });
  themeBtn.addEventListener('click', () => {
    const next = theme === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: the toggle still works for this visit */
    }
    applyTheme(next);
  });

  const hint = document.getElementById('hint');
  setTimeout(() => hint.classList.add('dim'), 8000);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(setup, 150);
  });

  // ---------------------------------------------------------------- loop
  setup();
  let last = performance.now();
  function frame(now) {
    const dt = min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
