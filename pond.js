// k-pond — an ASCII pond where frogs hop between lily pads.
//
// This file runs the pond: lily pads, frogs, ripples, fireflies, input,
// sound and controls. Drawing is done by one of two renderers that read the
// same world, so switching between them keeps the scene exactly as it is:
//   v1 (render-v1.js): the original fine ASCII grid
//   v2 (render-v2.js): a coarse grid of coloured tiles under glyphs
(() => {
  'use strict';

  const canvas = document.getElementById('pond');
  const ctx = canvas.getContext('2d', { alpha: false });
  const { sin, cos, atan2, sqrt, exp, abs, min, max, floor, round, PI, hypot, random } = Math;
  const { TAU, rand, clamp, lerp, pick, angDiff, padToWorld, renderers } = KPond;

  // Frog kinds, shared by both renderers (which colour them by index):
  // green, brown, red-eyed tree frog, gold.
  const FROG_KINDS = [
    { weight: 5, scale: 1, spots: true, stripe: true },
    { weight: 2, scale: 1.08, spots: true, stripe: true },
    { weight: 2, scale: 0.88, spots: false, stripe: false },
    { weight: 1, scale: 0.95, spots: true, stripe: false },
  ];

  let W = 0, H = 0, dpr = 1;
  let S = 1, FR = 52, JMAX = 330;
  let style = 'v2'; // which renderer is drawing: 'v1' or 'v2'

  // Text on the page (anything marked data-pond-avoid): pads drift away
  // from it and the renderers fade the pond out around it.
  let avoid = [], avoidVer = 0;
  function measureAvoid() {
    avoid = [...document.querySelectorAll('[data-pond-avoid]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    avoidVer++;
  }
  // distance from a point to the nearest text block, and the direction away from it
  function awayFromText(x, y) {
    let best = Infinity, ax = 0, ay = 0;
    for (const b of avoid) {
      const dx = x < b.left ? x - b.left : x > b.right ? x - b.right : 0;
      const dy = y < b.top ? y - b.top : y > b.bottom ? y - b.bottom : 0;
      let d = hypot(dx, dy);
      let nx = dx, ny = dy;
      if (d === 0) {
        // inside the block: head for its nearest edge
        const e = [x - b.left, b.right - x, y - b.top, b.bottom - y];
        const k = e.indexOf(Math.min(...e));
        nx = k === 0 ? -1 : k === 1 ? 1 : 0;
        ny = k === 2 ? -1 : k === 3 ? 1 : 0;
        d = -e[k];
      }
      if (d < best) {
        best = d;
        const l = hypot(nx, ny) || 1;
        ax = nx / l;
        ay = ny / l;
      }
    }
    return { d: best, ax, ay };
  }
  // wakes live in v2's grid; it keeps them fading even while v1 is showing
  const wake = (x, y, amt, radius) => renderers.v2.deposit(x, y, amt, radius);


  // ---------------------------------------------------------------- scene
  let pads = [], frogs = [], ripples = [], fireflies = [], drops = [];
  let time = 0, ambientT = 2, frogId = 0;

  function targetWorld(tg) {
    return tg.pad ? padToWorld(tg.pad, tg.lx, tg.ly) : tg;
  }

  function makePad(x, y, r) {
    const p = {
      x, y, r,
      rot: rand(TAU),
      vr: rand(-0.015, 0.015),
      vx: rand(-3, 3) * S,
      vy: rand(-3, 3) * S,
      notch: 0,
      notchW: rand(0.12, 0.2),
      veins: 6 + floor(rand(4)),
      seed: rand(200),
      pv: random(),
      red: random() < 0.3,
      scale: 1,
      bounce: 0,
      bounceT: 0,
      landable: r >= FR * 1.5,
      flower: null,
    };
    if (r > 48 * S && random() < 0.28) {
      const a = rand(0.7, TAU - 0.7); // stay clear of the notch (at local angle 0)
      const d = r * rand(0.3, 0.55);
      p.flower = {
        lx: cos(a) * d,
        ly: sin(a) * d,
        fs: max(r * rand(0.28, 0.38), 20 * S),
        n: pick([8, 10, 12]),
        spin: rand(TAU),
        scheme: floor(rand(4)),
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
    if (kind.spots) {
      for (let n = 3 + floor(rand(4)); n > 0; n--) spots.push({ u: rand(-0.8, 0.35), v: rand(-0.38, 0.38), r: rand(0.1, 0.17) });
    }
    return {
      id: frogId++,
      kind,
      kindIndex: FROG_KINDS.indexOf(kind),
      size: FR * rand(0.88, 1.08) * kind.scale,
      spots,
      stripe: kind.stripe && random() < 0.5,
      pitch: rand(0.8, 1.25),
      x: 0, y: 0, h: 0,
      heading: rand(TAU), lh: 0,
      pad: null, lx: 0, ly: 0,
      inWater: false,
      state: 'sit', stateT: 0,
      timer: rand(3, 22), // staggered so the first leaps don't come together
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
      gap: o.gap, // each renderer picks a default that suits its grid
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
    wake(x, y, 0.9, 1);
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
    const rMin = 34 * S, rMax = 118 * S;
    const target = W * H * 0.2; // leave plenty of open water
    let covered = 0;
    for (let n = 0; n < 1600 && covered < target; n++) {
      const r = max(rMin, rMax * (1 - (n / 1600) * 0.75) * rand(0.7, 1));
      const x = rand(-r * 0.3, W + r * 0.3), y = rand(-r * 0.3, H + r * 0.3);
      if (pads.some((p) => hypot(p.x - x, p.y - y) < (p.r + r) * 1.06 + 6 * S)) continue;
      if (awayFromText(x, y).d < r * 0.9) continue;
      pads.push(makePad(x, y, r));
      covered += PI * r * r;
    }
    if (!pads.some((p) => p.landable)) {
      pads.sort((a, b) => b.r - a.r).slice(0, 3).forEach((p) => { p.landable = true; });
    }
    const landable = pads.filter((p) => p.landable);
    const nFrogs = clamp(round(landable.length * 0.45), 3, 8);
    for (let i = 0; i < nFrogs; i++) {
      const f = makeFrog();
      for (let t = 0; t < 30; t++) {
        const s = findSpot(pick(landable), f);
        if (s) { attach(f, s); frogs.push(f); break; }
      }
    }
    const nFlies = clamp(round((W * H) / 320000), 2, 5);
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

    renderers.v1.resize(ctx, W, H);
    renderers.v2.resize(ctx, W, H);
    measureAvoid();

    S = clamp(sqrt(W * H) / 1100, 0.6, 1.5);
    FR = 52 * S;
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
      wake(f.x, f.y, 0.6, 1);
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
    } else if (f.tongueCD <= 0 && !f.tongue && random() < dt * 0.6) {
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
      } else if (random() < dt * 0.025) {
        f.turnTo = f.heading + rand(-1.1, 1.1);
      }
      if (f.croakT <= 0 && random() < dt * 0.01) {
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
          f.timer = rand(12, 30); // mostly still: a leap breaks the quiet now and then
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
        wake(f.x - cos(f.heading) * f.size * 0.7, f.y - sin(f.heading) * f.size * 0.7, 0.06);
        f.rippleT -= dt;
        if (f.rippleT <= 0) {
          f.rippleT = 0.5;
          addRipple(f.x - cos(f.heading) * f.size * 0.6, f.y - sin(f.heading) * f.size * 0.6, { amp: 0.5, speed: 26 * S, decay: 1.7, r0: 4 });
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
      p.vx += rand(-1, 1) * S * dt * 1.5;
      p.vy += rand(-1, 1) * S * dt * 1.5;
      const sp = hypot(p.vx, p.vy), cap = 3.5 * S;
      if (sp > cap) { p.vx *= cap / sp; p.vy *= cap / sp; }
      const m = p.r * 0.2;
      if (p.x < -m) p.vx += 10 * S * dt;
      if (p.x > W + m) p.vx -= 10 * S * dt;
      if (p.y < -m) p.vy += 10 * S * dt;
      if (p.y > H + m) p.vy -= 10 * S * dt;
      const t = awayFromText(p.x, p.y), reach = p.r + 30 * S;
      if (t.d < reach) {
        const push = (1 - t.d / reach) * 26 * S * dt;
        p.vx += t.ax * push;
        p.vy += t.ay * push;
      }
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
        wake(d.x, d.y, 0.25);
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
    renderers.v2.diffuse(dt);

    // water striders & falling seeds: the odd ripple on open water
    ambientT -= dt;
    if (ambientT <= 0) {
      ambientT = rand(5, 10);
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
    wake(x, y, 0.5);
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
    if (dragging && !padAt(x, y)) {
      wake(x, y, 0.18);
      if (time - lastDrag > 0.09) {
        addRipple(x, y, { amp: 0.7, speed: 40 * S, decay: 1.6, r0: 1 });
        lastDrag = time;
      }
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

  const soundBtn = document.getElementById('sound');
  soundBtn.addEventListener('click', () => {
    sfx.on = !sfx.on;
    if (sfx.on) sfx.init();
    soundBtn.setAttribute('aria-pressed', String(sfx.on));
  });

  // theme: follow the system until the viewer picks one, then remember it
  let theme = 'dark';
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
    document.documentElement.dataset.theme = t;
    syncPageColour();
    themeBtn.setAttribute('aria-label', t === 'light' ? 'Switch to night' : 'Switch to day');
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


  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(setup, 150);
  });

  // style: which renderer draws the pond; remembered like the theme
  const STYLE_KEY = 'k-pond-style';
  const styleBtns = [...document.querySelectorAll('[data-style]')];
  function syncPageColour() {
    const bg = renderers[style].bg(theme);
    document.documentElement.style.setProperty('--bg', bg);
    if (themeMeta) themeMeta.content = bg;
  }
  function applyStyle(s) {
    style = s;
    for (const b of styleBtns) b.setAttribute('aria-pressed', String(b.dataset.style === s));
    syncPageColour();
  }
  function setStyle(s) {
    try {
      localStorage.setItem(STYLE_KEY, s);
    } catch {
      /* private mode: the switch still works for this visit */
    }
    applyStyle(s);
  }
  try {
    const s = localStorage.getItem(STYLE_KEY);
    if (s === 'v1' || s === 'v2') style = s;
  } catch {
    /* no storage: start on v2 */
  }
  for (const b of styleBtns) b.addEventListener('click', () => setStyle(b.dataset.style));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'v' && !e.metaKey && !e.ctrlKey && !e.altKey) setStyle(style === 'v1' ? 'v2' : 'v1');
  });

  function render() {
    renderers[style].render(ctx, { W, H, S, time, theme, pads, frogs, ripples, fireflies, drops, avoid, avoidVer });
  }

  // ---------------------------------------------------------------- loop
  applyStyle(style);
  setup();
  // web fonts can shift the text a little once they arrive
  if (document.fonts) document.fonts.ready.then(measureAvoid);
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
