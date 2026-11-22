// The trip-let: one solid whose three shadows spell G, E and B (after the cover of
// Gödel, Escher, Bach). A cube of the grid is filled only where all three letters
// allow it, so looking along each axis you see exactly one letter.
//
// Corner of a room: left wall (x = 0) catches the G, right wall (z = 0) the E,
// floor (y = 0) the B. Rendered with a plain 2D canvas, orthographic camera.

export const N = 7;
const LETTERS = {
  G: ['#######', '#......', '#......', '#..####', '#.....#', '#.....#', '#######'],
  E: ['#######', '#......', '#......', '#####..', '#......', '#......', '#######'],
  B: ['######.', '#.....#', '#.....#', '#######', '#.....#', '#.....#', '######.'],
};
const on = (m, r, c) => m[r]?.[c] === '#';
// Each wall's mask in world grid coordinates, oriented so the letter reads
// left-to-right from the usual viewpoint (camera out along +x, +y, +z).
export const masks = {
  left: (z, y) => on(LETTERS.G, N - 1 - y, N - 1 - z),
  right: (x, y) => on(LETTERS.E, N - 1 - y, x),
  floor: (x, z) => on(LETTERS.B, z, x),
};
export const filled = (x, y, z) => masks.left(z, y) && masks.right(x, y) && masks.floor(x, z);

export function voxels() {
  const out = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) if (filled(x, y, z)) out.push([x, y, z]);
  return out;
}

// ------------------------------------------------------------------ drawing

const GAP = 3.2;            // space between block and the walls
const LIFT = 3.6;           // block's height above the floor
const ROOM = GAP + N + 3.4; // wall length
const WALL_H = LIFT + N + 2.2;

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function hexToRgb(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgba = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;

export function mountTriplet(canvas, { interactive = true, sway = true, zoom = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  const cubes = voxels().map(([x, y, z]) => [GAP + x, LIFT + y, GAP + z]);
  const has = new Set(voxels().map((v) => v.join()));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let theta = 45, phi = 28, userTheta = null, userPhi = null, drag = null, lastInput = -1e9;
  let palette;
  const readPalette = () => {
    const paper = hexToRgb(css('--paper', '#f7f3ea')), ink = hexToRgb(css('--ink', '#23201b'));
    const accent = hexToRgb(css('--accent', '#7a2e1d'));
    const dark = paper[0] < 100;
    const wood = dark ? [196, 132, 82] : [176, 110, 62];
    palette = {
      dark, ink, paper, accent,
      wallL: mix(paper, ink, dark ? 0.10 : 0.06), wallR: mix(paper, ink, dark ? 0.06 : 0.035), floor: mix(paper, ink, dark ? 0.14 : 0.09),
      top: mix(wood, [255, 236, 200], 0.28), sideX: wood, sideZ: mix(wood, [40, 20, 10], 0.32),
    };
  };
  readPalette();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', readPalette);
  addEventListener('geb:theme', readPalette);

  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const draw = () => {
    const t = (theta * Math.PI) / 180, p = (phi * Math.PI) / 180;
    const v = [Math.sin(t) * Math.cos(p), Math.sin(p), Math.cos(t) * Math.cos(p)]; // toward the camera
    const right = [Math.cos(t), 0, -Math.sin(t)];
    const up = [-Math.sin(p) * Math.sin(t), Math.cos(p), -Math.sin(p) * Math.cos(t)];
    const c = [ROOM * 0.48, WALL_H * 0.42, ROOM * 0.48];
    const scale = (zoom * Math.min(W, H * 1.15)) / (ROOM * 1.75);
    const P = ([x, y, z]) => {
      const d = [x - c[0], y - c[1], z - c[2]];
      return [W / 2 + (d[0] * right[0] + d[2] * right[2]) * scale, H / 2 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) * scale];
    };
    const poly = (pts, fill, stroke) => {
      ctx.beginPath();
      pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.75; ctx.lineJoin = 'round'; ctx.stroke(); }
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { wallL, wallR, floor } = palette;
    const edge = rgba(mix(palette.paper, palette.ink, 0.25), 0.8);
    // the room's corner
    poly([[0, 0, 0], [ROOM, 0, 0], [ROOM, 0, ROOM], [0, 0, ROOM]], rgba(floor), null);
    poly([[0, 0, 0], [0, WALL_H, 0], [0, WALL_H, ROOM], [0, 0, ROOM]], rgba(wallL), null);
    poly([[0, 0, 0], [ROOM, 0, 0], [ROOM, WALL_H, 0], [0, WALL_H, 0]], rgba(wallR), null);

    // shadows: each wall's cells in one opaque path, so neighbors merge without seams
    const shade = (wall, cells) => {
      ctx.beginPath();
      for (const pts of cells) pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      const c = rgba(mix(wall, palette.dark ? [0, 0, 0] : palette.ink, palette.dark ? 0.6 : 0.55));
      ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 0.8; ctx.lineJoin = 'round';
      ctx.fill(); ctx.stroke();
    };
    const L = [], R = [], F = [];
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      if (masks.left(a, b)) L.push([[0, LIFT + b, GAP + a], [0, LIFT + b + 1, GAP + a], [0, LIFT + b + 1, GAP + a + 1], [0, LIFT + b, GAP + a + 1]]);
      if (masks.right(a, b)) R.push([[GAP + a, LIFT + b, 0], [GAP + a, LIFT + b + 1, 0], [GAP + a + 1, LIFT + b + 1, 0], [GAP + a + 1, LIFT + b, 0]]);
      if (masks.floor(a, b)) F.push([[GAP + a, 0, GAP + b], [GAP + a, 0, GAP + b + 1], [GAP + a + 1, 0, GAP + b + 1], [GAP + a + 1, 0, GAP + b]]);
    }
    shade(wallL, L); shade(wallR, R); shade(floor, F);
    // wall edges
    ctx.lineWidth = 1;
    ctx.strokeStyle = edge;
    ctx.beginPath();
    for (const [a, b] of [[[0, 0, 0], [0, WALL_H, 0]], [[0, 0, 0], [ROOM, 0, 0]], [[0, 0, 0], [0, 0, ROOM]]]) {
      const [p1, p2] = [P(a), P(b)];
      ctx.moveTo(...p1); ctx.lineTo(...p2);
    }
    ctx.stroke();

    // the block: far cubes first; each cube draws only the faces that face us and touch air
    const depth = ([x, y, z]) => x * v[0] + y * v[1] + z * v[2];
    const sorted = cubes.slice().sort((a, b) => depth(a) - depth(b));
    const d0 = depth(sorted[0]), d1 = depth(sorted.at(-1)) || d0 + 1;
    for (const [x, y, z] of sorted) {
      const g = [x - GAP, y - LIFT, z - GAP];
      const free = (dx, dy, dz) => !has.has([g[0] + dx, g[1] + dy, g[2] + dz].join());
      // farther cubes are a little darker, so overlapping strokes of the letters stay apart
      const far = 1 - (depth([x, y, z]) - d0) / (d1 - d0 || 1);
      const shade = (c) => rgba(mix(c, [25, 12, 4], far * 0.32));
      const face = (pts, c) => { const f = shade(c); poly(pts, f, f); };
      if (v[0] > 0 && free(1, 0, 0)) face([[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], palette.sideX);
      if (v[0] < 0 && free(-1, 0, 0)) face([[x, y, z], [x, y + 1, z], [x, y + 1, z + 1], [x, y, z + 1]], palette.sideX);
      if (v[2] > 0 && free(0, 0, 1)) face([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], palette.sideZ);
      if (v[2] < 0 && free(0, 0, -1)) face([[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]], palette.sideZ);
      if (v[1] > 0 && free(0, 1, 0)) face([[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], palette.top);
    }
  };

  const tick = (now) => {
    const idle = now - lastInput > 2500;
    if (userTheta != null && idle) {
      // drift back toward the gentle sway after the visitor lets go
      userTheta = null; userPhi = null;
    }
    if (drag || userTheta != null) {
      theta += ((userTheta ?? theta) - theta) * 0.35; phi += ((userPhi ?? phi) - phi) * 0.35;
    } else if (sway && !reduce) {
      const want = 45 + 24 * Math.sin(now / 4200), wantPhi = 26 + 7 * Math.sin(now / 6100);
      theta += (want - theta) * 0.03; phi += (wantPhi - phi) * 0.03;
    }
    draw();
    frame = visible ? requestAnimationFrame(tick) : 0;
  };
  // Animate only while the canvas is on screen. Redrawing it every frame while the page
  // scrolls starves Firefox on Android, which then leaves the top of the page unpainted.
  let frame = 0, visible = true;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !frame) frame = requestAnimationFrame(tick);
  }).observe(canvas);
  frame = requestAnimationFrame(tick);

  if (interactive) {
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, t: theta, p: phi, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      userTheta = Math.max(4, Math.min(86, drag.t + (e.clientX - drag.x) * 0.35));
      userPhi = Math.max(2, Math.min(80, drag.p + (e.clientY - drag.y) * 0.3));
      lastInput = performance.now();
    });
    const end = () => { drag = null; lastInput = performance.now(); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // Phones: tilt to look around the block. iOS only allows this after a tap and a prompt.
  const tilt = async () => {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function' && (await DOE.requestPermission().catch(() => 'denied')) !== 'granted') return false;
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      userTheta = Math.max(4, Math.min(86, 45 + e.gamma * 1.1));
      userPhi = Math.max(2, Math.min(80, e.beta - 25));
      lastInput = performance.now();
    });
    return true;
  };

  // Look straight down one axis, so only one letter shows.
  return {
    tilt,
    look(letter) {
      const views = { G: [88, 1], E: [2, 1], B: [45, 89] };
      [userTheta, userPhi] = views[letter] || [45, 28];
      lastInput = performance.now() + 2000;
    },
  };
}
