// Helpers shared by the pond simulation (pond.js) and its renderers
// (render-v1.js, render-v2.js). Plain scripts rather than modules, so the
// page still works when opened straight from disk.
window.KPond = (() => {
  'use strict';
  const { sin, cos, sqrt, floor, random, PI } = Math;

  const rand = (a = 1, b) => (b === undefined ? random() * a : a + random() * (b - a));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (arr) => arr[floor(random() * arr.length)];
  const code = (s) => s.charCodeAt(0);

  function angDiff(a, b) {
    let d = (b - a) % (PI * 2);
    if (d > PI) d -= PI * 2;
    else if (d < -PI) d += PI * 2;
    return d;
  }

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
  const hash3 = (a, b, c) => perm[(perm[(perm[a & 255] + (b & 255)) & 511] + (c & 255)) & 511];

  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    const qx = ax + vx * t - px, qy = ay + vy * t - py;
    return sqrt(qx * qx + qy * qy);
  }

  function padToWorld(p, lx, ly) {
    const c = cos(p.rot), s = sin(p.rot);
    return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c };
  }

  return {
    TAU: PI * 2,
    LIGHT: -2.3, // light comes from the upper left
    REDUCED: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    rand, clamp, lerp, pick, code, angDiff, perm, vnoise, hash3, segDist, padToWorld,
    renderers: {},
  };
})();
