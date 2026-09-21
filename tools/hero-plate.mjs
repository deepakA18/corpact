#!/usr/bin/env node
/**
 * Generates the landing hero plates: apps/site/public/hero-pixels.png (night) and
 * hero-pixels-day.png (day).
 *
 * EVERYTHING is drawn in LOGICAL ART PIXELS on a 320x180 grid, and the renderer expands each art
 * pixel into a hard PX x PX block. The file that ships is 960x540, but the art is 320x180 - so a
 * source pixel is a chunky, deliberate block on screen, which is the 8-bit look the page is built
 * around, while the 3x file stays exact under nearest-neighbour upscaling and on retina.
 *
 * Do not draw sub-block detail. One art pixel is the smallest mark that exists.
 *
 * Both plates are the SAME geometry drawn twice through two palettes, so night and day can never
 * drift apart. Everything is seeded, so re-running reproduces the art exactly.
 *
 *   node tools/hero-plate.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Logical art grid, and the block size each art pixel expands to in the emitted file. */
const LW = 320;
const LH = 180;
const PX = 3;

/** Nothing structural rises above this: the top of the frame is the headline's open sky. */
const SKY_FLOOR = 83;
/** Where the city meets the ground, and where the foreground props stand. */
const GROUND_Y = 151;

const SLOTS = [
  'sky', 'star', 'disc', 'moon', 'moonShade',
  'far', 'farEdge',
  'near', 'nearEdge', 'nearDark',
  'windowDim', 'windowLit',
  'stone', 'stoneEdge', 'stoneDark',
  'dome', 'domeShade',
  'brick', 'brickShade',
  'gold', 'goldShade',
  'paper', 'paperShade',
  'leaf', 'leafDark', 'trunk',
  'ground', 'groundLine',
];

const PALETTES = {
  night: {
    sky: '#000000', star: '#3b4d6e',
    // Night paints the full disc as sky, so only the crescent drawn over it survives.
    disc: '#000000', moon: '#8db1f1', moonShade: '#5e718c',
    far: '#141f3a', farEdge: '#1b2947',
    near: '#2e3e59', nearEdge: '#3d5175', nearDark: '#1d2840',
    windowDim: '#235cbb', windowLit: '#edbc48',
    stone: '#3a4a67', stoneEdge: '#4d6187', stoneDark: '#232f47',
    dome: '#2f7d5a', domeShade: '#1d5540',
    brick: '#7a4a2a', brickShade: '#4e2f1b',
    gold: '#edbc48', goldShade: '#a8801f',
    paper: '#e8dcc0', paperShade: '#a89a78',
    leaf: '#2f7d5a', leafDark: '#1d5540', trunk: '#5a3520',
    ground: '#0a1020', groundLine: '#2e3e59',
  },
  day: {
    sky: '#e2e2e2', star: '#e2e2e2', // stars resolve to the sky, so daylight has none
    // Day paints the disc and the crescent alike, so the same geometry fills in as a sun.
    disc: '#f7f4e4', moon: '#f7f4e4', moonShade: '#e9e2c8',
    far: '#b8c8de', farEdge: '#c6d4e6',
    near: '#dbe5f1', nearEdge: '#eef3f9', nearDark: '#b3c3d8',
    windowDim: '#8fa3bd', windowLit: '#5e718c',
    stone: '#e4ebf4', stoneEdge: '#f4f8fc', stoneDark: '#b9c7da',
    dome: '#5f9e80', domeShade: '#427a61',
    brick: '#a97a55', brickShade: '#7d5537',
    gold: '#d9a93c', goldShade: '#a87d24',
    paper: '#f2ead6', paperShade: '#cdbf9e',
    leaf: '#5f9e80', leafDark: '#427a61', trunk: '#7d5537',
    ground: '#b3bdcc', groundLine: '#8fa3bd',
  },
};

/** Deterministic LCG - the two plates must agree pixel for pixel, so never Math.random. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A drawing surface: the op list plus the two primitives every landmark is built from. */
function makeCanvas(seed) {
  const ops = [];
  const r = rng(seed);
  const rect = (slot, x, y, w, h) => {
    if (w <= 0 || h <= 0) return;
    ops.push([slot, Math.round(x), Math.round(y), Math.round(w), Math.round(h)]);
  };
  /**
   * Filled disc in art pixels. `run` holds the x a span opened at and x starts at -rad, so the
   * "no span open" sentinel MUST be null - a negative sentinel eats the left half of the circle.
   */
  const disc = (slot, cx, cy, rad, test) => {
    for (let y = -rad; y <= rad; y++) {
      let run = null;
      for (let x = -rad; x <= rad + 1; x++) {
        const inside = x <= rad && x * x + y * y <= rad * rad && (!test || test(x, y));
        if (inside && run === null) run = x;
        if (!inside && run !== null) {
          rect(slot, cx + run, cy + y, x - run, 1);
          run = null;
        }
      }
    }
  };
  const pick = (min, max) => min + Math.floor(r() * (max - min + 1));
  return { ops, rect, disc, r, pick };
}

// ── Landmarks ────────────────────────────────────────────────────────────────────────────

function sky(g) {
  const { rect, r, pick } = g;

  const cx = 276, cy = 31, R = 13;

  // ---- stars: single art pixels (a few 2x2), high up and out at the sides only ----
  const SIDES = [[5, 74], [236, 313]];
  const stars = [];
  let guard = 0;
  while (stars.length < 41 && guard++ < 8000) {
    const band = SIDES[stars.length & 1];          // alternate sides: both fields stay equally full
    const x = pick(band[0], band[1]);
    const y = pick(4, 57);
    if (y > 42 && r() < 0.5) continue;              // thin them out toward the skyline
    const mx = x - cx, my = y - cy;
    if (mx * mx + my * my < 20 * 20) continue;      // keep clear of the celestial body
    let clear = true;
    for (const s of stars) {
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy < 56) { clear = false; break; }
    }
    if (!clear) continue;
    stars.push({ x, y, big: r() < 0.12 });
  }
  for (const s of stars) rect('star', s.x, s.y, s.big ? 2 : 1, s.big ? 2 : 1);

  // ---- one celestial body: crescent moon by night, round sun by day ----
  // The full disc goes down in 'disc' (= sky at night, = warm at day), then the lit crescent is
  // laid over its left side. At night only the crescent survives; by day the whole circle is one
  // warm colour. HALF is a hand-authored half-width table: its steps only ever grow toward the
  // poles, so the day sun has no bump in its outline the way a raw sqrt profile does.
  const HALF = [13, 13, 13, 12, 12, 12, 11, 11, 10, 9, 8, 7, 5, 3];
  const BX = 13, BR = Math.sqrt(R * R + BX * BX);   // the bite; its arc meets the disc at the poles

  for (let y = -R; y <= R; y++) {
    const W = HALF[Math.abs(y)];
    rect('disc', cx - W, cy + y, 2 * W + 1, 1);
  }
  for (let y = -R; y <= R; y++) {
    const W = HALF[Math.abs(y)];
    const edge = Math.min(W, Math.round(BX - Math.sqrt(BR * BR - y * y)));
    const w = edge + W + 1;
    if (w < 1) continue;
    rect('moon', cx - W, cy + y, w, 1);
    rect('moonShade', cx - W, cy + y, 1, 1);        // one-pixel rim on the outer limb, all the way round
  }
}

function clockTower(g, x, w, top) {
  const { rect } = g;
  const GROUND = 151;
  const L = x;
  const cx = x + ((w - 1) >> 1);
  const litW = Math.max(1, Math.floor(w * 0.09));
  const darkW = Math.max(1, Math.round(w * 0.13));

  const shaft = (by, bh) => {
    rect('stone', L, by, w, bh);
    rect('stoneEdge', L, by, litW, bh);
    rect('stoneDark', L + w - darkW, by, darkW, bh);
  };

  const band = (by, over) => {
    rect('stoneEdge', L - over, by, w + over * 2, 1);
    rect('stoneDark', L - over, by + 1, w + over * 2, 1);
  };

  // ---- key rows -------------------------------------------------------
  const belfryY = top + 5;
  const belfryH = 8;
  const corniceA = top + 14;
  const clockCy = top + 24;
  const corniceB = top + 33;
  const lanY = top + 36;
  const lanH = 17;
  const courseY = top + 55;
  const plinthY = top + 57;
  const doorY = plinthY + 1;

  // ---- pyramid roof (narrow apex, wide eaves) --------------------------
  for (let j = 0; j < 4; j++) {
    const ry = top - 1 - j;
    const rw = w - 6 * j;
    if (rw < 3) break;
    const rx = cx - ((rw - 1) >> 1);
    const le = Math.max(1, Math.round(rw * 0.35));
    const de = Math.max(1, Math.round(rw * 0.30));
    rect('stone', rx, ry, rw, 1);
    rect('stoneEdge', rx, ry, le, 1);
    rect('stoneDark', rx + rw - de, ry, de, 1);
  }
  // finial: gold tip at the apex
  rect('gold', cx - 1, top - 5, 3, 1);
  rect('goldShade', cx + 1, top - 5, 1, 1);

  // ---- eaves slab ------------------------------------------------------
  rect('stoneEdge', L - 2, top, w + 4, 1);
  rect('stoneDark', L - 2, top + 1, w + 4, 1);

  // ---- body ------------------------------------------------------------
  shaft(top + 2, GROUND - (top + 2) + 1);

  // ---- belfry louvres --------------------------------------------------
  const louvre = (ox) => {
    rect('stoneEdge', ox - 1, belfryY, 1, belfryH);
    rect('stoneDark', ox + 5, belfryY, 1, belfryH);
    rect('windowDim', ox + 1, belfryY, 3, 1);
    rect('windowDim', ox, belfryY + 1, 5, belfryH - 1);
    for (let yy = belfryY + 2; yy < belfryY + belfryH; yy += 2) rect('stoneDark', ox, yy, 5, 1);
  };
  louvre(cx - 7);
  louvre(cx + 3);
  rect('stoneEdge', L, belfryY + belfryH, w, 1);

  // ---- cornice above the clock stage -----------------------------------
  band(corniceA, 1);

  // ---- CLOCK -----------------------------------------------------------
  // Hand-tabled circles. disc(rad 6) steps 7 -> 1 at the poles, which renders a
  // 1px spike at 12 and 6 and a 3px-thick gold blob across the bottom of the
  // dial; these half-widths keep a clean rim exactly 1 art pixel thick all round.
  const ringHalf = [6, 6, 6, 5, 5, 4, 2];
  const dialHalf = [5, 5, 5, 4, 4, 3];
  for (let dy = -6; dy <= 6; dy++) {
    const hw = ringHalf[Math.abs(dy)];
    rect('gold', cx - hw, clockCy + dy, hw * 2 + 1, 1);
    const s = Math.max(-hw, 3 - dy);
    if (s <= hw) rect('goldShade', cx + s, clockCy + dy, hw - s + 1, 1);
  }
  for (let dy = -5; dy <= 5; dy++) {
    const hw = dialHalf[Math.abs(dy)];
    rect('paper', cx - hw, clockCy + dy, hw * 2 + 1, 1);
    const s = Math.max(-hw, 6 - dy);
    if (s <= hw) rect('paperShade', cx + s, clockCy + dy, hw - s + 1, 1);
  }
  // Hour marks sit on the diagonals: the cardinal ones are where the hands go,
  // and at this size a mark touching a hand just reads as a longer hand.
  rect('goldShade', cx - 3, clockCy - 3, 1, 1);
  rect('goldShade', cx + 3, clockCy - 3, 1, 1);
  rect('goldShade', cx - 3, clockCy + 3, 1, 1);
  rect('goldShade', cx + 3, clockCy + 3, 1, 1);
  // hands: long minute straight up, short hour to the right, plus a hub
  rect('brickShade', cx, clockCy - 4, 1, 4);
  rect('brickShade', cx + 1, clockCy, 2, 1);
  rect('brickShade', cx, clockCy, 1, 1);

  // ---- cornice below the clock stage -----------------------------------
  band(corniceB, 1);

  // ---- tall lancet windows ---------------------------------------------
  const lancet = (ox) => {
    rect('stoneEdge', ox - 1, lanY + 1, 1, lanH - 1);
    rect('stoneDark', ox + 3, lanY + 1, 1, lanH - 1);
    rect('windowDim', ox + 1, lanY, 1, 1);
    rect('windowDim', ox, lanY + 1, 3, lanH - 1);
    rect('windowLit', ox + 1, lanY + 2, 1, lanH - 3);
  };
  lancet(cx - 6);
  lancet(cx + 4);

  // ---- string course + plinth ------------------------------------------
  band(courseY, 1);
  rect('stone', L - 2, plinthY, w + 4, GROUND - plinthY + 1);
  rect('stoneEdge', L - 2, plinthY, w + 4, 1);
  rect('stoneEdge', L - 2, plinthY + 1, litW, GROUND - plinthY);
  rect('stoneDark', L + w + 2 - darkW, plinthY + 1, darkW, GROUND - plinthY);

  // ---- arched door ------------------------------------------------------
  rect('windowDim', cx - 1, doorY, 3, 1);
  rect('windowDim', cx - 2, doorY + 1, 5, GROUND - doorY);
  rect('windowLit', cx - 1, doorY + 2, 3, GROUND - doorY - 1);
}

function domeBuilding(g, cx, baseW, top) {
  const { rect } = g;
  const GY = 151;

  // ---------- proportions ----------
  const hw = baseW >> 1;
  const x0 = cx - hw;
  const bw = hw * 2 + 1;              // odd, so the whole pile centres on cx
  const capX = x0 - 2, capW = bw + 4; // projecting cornice
  const midX = x0 - 1, midW = bw + 2;
  const ftX = x0 - 3, ftW = bw + 6;   // footing, one step wider again

  const h = GY - top;
  const yCor  = top;            // cornice     2
  const yArch = top + 2;        // architrave  4
  const yShad = top + 6;        // shadow      1
  const yCol  = top + 7;        // colonnade
  const colH  = h - 14;
  const yPod  = yCol + colH;    // podium      2
  const yStep = yPod + 2;       // step cap    1
  const yPl   = yStep + 1;      // plinth      3
  const yBot  = GY - 1;         // shadow      1

  // ---------- base block ----------
  rect('stoneEdge', capX, yCor, capW, 2);
  rect('stone',     midX, yArch, midW, 4);
  rect('stoneDark', midX, yArch + 3, midW, 1);
  rect('stoneDark', x0,   yShad, bw, 1);
  rect('stoneDark', x0,   yCol, bw, colH);      // deep porch behind the columns
  rect('stone',     midX, yPod, midW, 2);
  rect('stoneEdge', capX, yStep, capW, 1);
  rect('stone',     ftX,  yPl, ftW, 3);
  rect('stoneDark', ftX,  yBot, ftW, 1);

  // ---------- colonnade ----------
  const period = 5, colW = 3, gapW = period - colW;
  const n = Math.floor((bw + gapW) / period);
  const span = period * n - gapW;
  const cs = cx - ((span - 1) >> 1);
  const mid = n >> 1;

  for (let i = 0; i < n; i++) {
    if (i === mid) continue;                        // central portal
    const x = cs + i * period;
    rect('stoneEdge', x, yCol, colW, 2);            // capital
    rect('stone',     x, yCol + 2, colW, colH - 4); // shaft
    rect('stoneEdge', x, yCol + 2, 1, colH - 4);    // lit edge of the shaft
    rect('stoneEdge', x, yCol + colH - 2, colW, 2); // base
  }

  // central arched portal
  const px0 = cs + mid * period - gapW;
  const pw = colW + gapW * 2;
  rect('stoneEdge', px0 - 1, yCol, pw + 2, 1);
  rect('stoneDark', px0 + 2, yCol + 1, pw - 4, 1);
  rect('stoneDark', px0 + 1, yCol + 2, pw - 2, 1);
  rect('stoneDark', px0,     yCol + 3, pw, colH - 3);
  rect('stoneEdge', px0 - 1, yCol + colH - 1, pw + 2, 1);

  // the doorway itself: windowLit is gold at night and deep slate by day, so the
  // entrance reads as an opening in BOTH palettes instead of a pale recess.
  const doorW = pw - 2;
  const doorH = Math.max(4, (colH >> 1) - 1);
  rect('windowLit', cx - (doorW >> 1), yCol + colH - 1 - doorH, doorW, doorH);

  // one lit bay either side of the portal, seated in a real gap between columns
  // (symmetric about cx), never painted over a shaft
  const bayY = yCol + 5, bayH = Math.max(3, colH - 12);
  rect('windowLit', cs + (mid - 1) * period - gapW, bayY, gapW, bayH);
  rect('windowLit', cs + (mid + 1) * period + colW, bayY, gapW, bayH);

  // ---------- drum ----------
  const domeR = Math.max(6, Math.round(baseW * 0.34));
  const drumH = 7;
  const drumTop = top - drumH;
  const drumHW = domeR - 1;
  rect('stone',     cx - drumHW, drumTop, drumHW * 2 + 1, drumH);
  rect('stoneEdge', cx - drumHW, drumTop, drumHW * 2 + 1, 1);
  for (let x = cx - drumHW + 2; x <= cx + drumHW - 2; x += 4) {
    rect('stoneDark', x, drumTop + 2, 1, drumH - 3);
  }

  const corY = drumTop - 2;
  const corHW = domeR + 2;
  rect('stone',     cx - corHW, corY + 1, corHW * 2 + 1, 1);
  rect('stoneEdge', cx - corHW, corY, corHW * 2 + 1, 1);

  // ---------- ribbed dome ----------
  const springY = corY - 1;
  const domeCy = springY - 2;             // two stilted rows: more than a hemisphere
  const domeTopRow = domeCy - domeR + 2;  // apex truncated; the lantern caps it
  const fracs = [0, 0.32, 0.6, 0.84];

  for (let y = domeTopRow; y <= springY; y++) {
    const dy = y - domeCy;
    const w = dy <= 0 ? Math.floor(Math.sqrt(domeR * domeR - dy * dy)) : domeR;
    rect('dome', cx - w, y, w * 2 + 1, 1);
    const s = Math.round(w * 0.46);
    rect('domeShade', cx + s, y, w - s + 1, 1);     // shaded right cheek
    // meridian ribs: x offset is a fraction of THIS row's half-width, so they fan
    // out at the springing and converge at the crown. Near the crown the fractions
    // collide, so drop any rib that would crowd its neighbour or hug the silhouette.
    let last = -99;
    for (const f of fracs) {
      const off = Math.round(f * w);
      if (off - last < 3 || off > w - 2) continue;
      last = off;
      for (const sg of off === 0 ? [1] : [1, -1]) {
        const o = sg * off;
        rect(o >= s ? 'dome' : 'domeShade', cx + o, y, 1, 1);
      }
    }
  }
  rect('domeShade', cx - domeR, springY, domeR * 2 + 1, 1);   // seated on the cornice

  // ---------- lantern ----------
  const lanPlY = domeTopRow - 2;
  const lanDy = domeCy - domeTopRow;
  const lanHW = Math.floor(Math.sqrt(domeR * domeR - lanDy * lanDy));
  rect('stoneEdge', cx - lanHW, lanPlY + 1, lanHW * 2 + 1, 1);
  rect('stone',     cx - lanHW + 2, lanPlY, lanHW * 2 - 3, 1);

  const bodyH = 4;
  const bodyY = lanPlY - bodyH;
  rect('stone',     cx - 4, bodyY, 9, bodyH);
  rect('stoneDark', cx - 3, bodyY + 1, 7, bodyH - 1);
  rect('stoneEdge', cx - 1, bodyY + 1, 1, bodyH - 1);
  rect('stoneEdge', cx + 1, bodyY + 1, 1, bodyH - 1);
  rect('stoneEdge', cx - 5, bodyY - 1, 11, 1);

  // gold tip
  rect('gold',      cx - 3, bodyY - 2, 7, 1);
  rect('goldShade', cx + 2, bodyY - 2, 2, 1);
  rect('gold',      cx - 1, bodyY - 3, 3, 1);
}

function archGate(g, x, w, top) {
  const { rect, pick } = g;
  const GROUND_Y = 151;
  const h = GROUND_Y - top;
  const cx = x + Math.floor(w / 2);

  // --- solid masonry block -------------------------------------------------
  rect('brick', x, top, w, h);

  // course lines: a shade line every 4 rows, vertical joints offset band to band
  for (let by = top + 3, course = 0; by < GROUND_Y; by += 4, course++) {
    rect('brickShade', x, by, w, 1);
    const off = course % 2 ? 0 : 3;
    for (let jx = x + off; jx < x + w; jx += 6) rect('brickShade', jx, by - 3, 1, 3);
  }
  rect('brickShade', x + w - 1, top, 1, h);

  // weathered blocks, kept inside the piers so they never smear the arch head
  for (let i = 0; i < 7; i++) {
    const a = pick(0, 4);
    const b = pick(0, h - 22);
    if (i % 2) continue;
    rect('brickShade', i % 4 ? x + w - 4 - a : x + 1 + a, top + 15 + b, 2, 2);
  }

  // --- attic cap -----------------------------------------------------------
  rect('brick', x - 1, top, w + 2, 3);
  rect('brickShade', x - 1, top + 3, w + 2, 1);
  rect('brickShade', x - 1, top, 1, 3);
  rect('brickShade', x + w, top, 1, 3);

  // --- plinth (the arch is cut through it below) ---------------------------
  rect('brickShade', x - 1, GROUND_Y - 5, w + 2, 1);
  rect('brick', x - 1, GROUND_Y - 4, w + 2, 4);
  rect('brickShade', x - 1, GROUND_Y - 4, 1, 4);
  rect('brickShade', x + w, GROUND_Y - 4, 1, 4);

  // --- row of small windows above the arch ---------------------------------
  const wy = top + 6;
  for (let i = 0; i < 5; i++) {
    const wx = cx - 15 + i * 7;
    rect('brickShade', wx - 1, wy - 1, 5, 6);
    rect(pick(0, 3) ? 'windowLit' : 'windowDim', wx, wy, 3, 4);
  }

  // gold string course, tucked under the window sills
  rect('gold', x + 1, top + 11, w - 2, 1);
  rect('goldShade', x + 1, top + 12, w - 2, 1);

  // --- the arch ------------------------------------------------------------
  // three hand-stepped profiles, crown row first; each runs on at its last
  // value down to the ground, so the ring can never drift off the opening.
  const S = top + 27;                                  // springing line
  const RING = [6, 6, 7, 8, 9, 9, 10, 10];             // stone archivolt, outer edge
  const REVEAL = [3, 5, 6, 6, 7, 7, 7];                // 1 px shadowed reveal
  const OPEN = [2, 4, 5, 5, 6, 6];                     // the lit opening itself
  const fill = (slot, prof, y0) => {
    for (let y = y0; y < GROUND_Y; y++) {
      const hw = prof[Math.min(y - y0, prof.length - 1)];
      rect(slot, cx - hw, y, hw * 2 + 1, 1);
    }
  };

  fill('stone', RING, S - 12);
  fill('nearDark', REVEAL, S - 7);
  fill('windowLit', OPEN, S - 6);
  rect('nearDark', cx - 6, GROUND_Y - 2, 13, 2);       // shadowed threshold

  // joints cut clean through the stone so it reads as stacked voussoirs
  for (let k = 0; k < 4; k++) {
    rect('stoneDark', cx - 10, S + k * 4, 3, 1);
    rect('stoneDark', cx + 8, S + k * 4, 3, 1);
  }
  rect('stoneDark', cx - 10, S - 4, 4, 1);
  rect('stoneDark', cx + 7, S - 4, 4, 1);
  rect('stoneDark', cx - 7, S - 8, 1, 2);
  rect('stoneDark', cx + 7, S - 8, 1, 2);
  rect('stoneDark', cx - 4, S - 12, 1, 2);
  rect('stoneDark', cx + 4, S - 12, 1, 2);

  // --- gold keystone, wedged into the crown of the ring --------------------
  rect('goldShade', cx - 2, S - 12, 5, 5);
  rect('gold', cx - 1, S - 12, 3, 4);
}

function plainTower(g, x, w, top, style) {
  const { rect, r } = g;
  const GROUND_Y = 151;
  const h = GROUND_Y - top;
  if (w < 10 || h < 16) return;

  // massing: body, shaded flank, lit parapet, lit windward corner
  rect('near', x, top, w, h);
  rect('nearDark', x + w - 2, top, 2, h);
  rect('nearEdge', x, top, w, 1);
  rect('nearEdge', x, top + 1, 1, h - 1);

  // window field: one fixed bay, one fixed pitch, centred between the lit
  // corner and the shaded flank so the two end piers weigh the same
  const bayW = style === 'strip' ? 3 : 2;
  const pitchX = style === 'strip' ? (w < 18 ? 5 : 6) : 4;
  const left = x + 2;
  const avail = w - 5;                      // x+2 .. x+w-4 inclusive
  const n = Math.max(1, Math.floor((avail - bayW) / pitchX) + 1);
  const span = (n - 1) * pitchX + bayW;
  const x0 = left + Math.round((avail - span) / 2);
  const cols = [];
  for (let i = 0; i < n; i++) cols.push(x0 + i * pitchX);

  const gTop = top + 3;
  const lobbyY = GROUND_Y - 3;              // lobby band, one row of sill below it

  if (style === 'strip') {
    // continuous light wells running the full shaft, piers between them
    for (const wx of cols) rect('windowDim', wx, gTop, bayW, lobbyY - gTop);
    // brighter floors on a beat measured UP from the lobby, so the spacing
    // above the street matches the spacing everywhere else
    let band = 0;
    for (let fy = lobbyY - 6; fy >= gTop + 2; fy -= 6, band++) {
      if (band % 2 === 1) continue;
      for (const wx of cols) {
        if (r() < 0.2) continue;
        rect('windowLit', wx, fy, bayW, 2);
      }
    }
  } else {
    // regular grid, also marched up from the lobby so no dead band opens up
    for (let wy = lobbyY - 4; wy >= gTop; wy -= 4) {
      for (const wx of cols) {
        const k = r();
        if (k < 0.07) continue;
        rect(k < 0.28 ? 'windowLit' : 'windowDim', wx, wy, bayW, 2);
      }
    }
  }
  // lobby glow at street level
  for (const wx of cols) rect('windowLit', wx, lobbyY, bayW, 2);
}

function decoTower(g, x, w, top) {
  const { rect, r } = g;
  const GROUND_Y = 151;
  const total = GROUND_Y - top;
  if (w < 18 || total < 34) return;

  const inset = Math.max(2, Math.round(w * 0.115));   // setback per side, scales with w
  const lobbyY = GROUND_Y - 3;
  const y2 = top + Math.round(total * 0.33);
  const y1 = y2 + Math.round(total * 0.30);
  const stages = [
    { sx: x, sw: w, sy: y1, sh: GROUND_Y - y1, base: true },
    { sx: x + inset, sw: w - inset * 2, sy: y2, sh: y1 - y2, base: false },
    { sx: x + inset * 2, sw: w - inset * 4, sy: top, sh: y2 - top, base: false },
  ];

  for (const st of stages) {
    rect('near', st.sx, st.sy, st.sw, st.sh);
    rect('nearDark', st.sx + st.sw - 2, st.sy, 2, st.sh);
    rect('nearEdge', st.sx, st.sy, st.sw, 1);
    // deco belt course at the setback, darkening as it wraps the shaded flank
    rect('gold', st.sx, st.sy + 1, st.sw - 2, 1);
    rect('goldShade', st.sx + st.sw - 2, st.sy + 1, 2, 1);
    rect('nearEdge', st.sx, st.sy + 2, 1, st.sh - 2);

    // vertical light strips fluting the stage: the pitch tightens as the
    // stages narrow, so every stage keeps a real field instead of two stripes
    const pitchX = st.sw < 16 ? 3 : 4;
    const avail = st.sw - 5;
    const n = Math.max(1, Math.floor((avail - 2) / pitchX) + 1);
    const span = (n - 1) * pitchX + 2;
    const x0 = st.sx + 2 + Math.round((avail - span) / 2);
    const cols = [];
    for (let i = 0; i < n; i++) cols.push(x0 + i * pitchX);

    const gTop = st.sy + 3;
    const gBot = st.base ? lobbyY : st.sy + st.sh - 1;   // a sill above each setback
    for (const wx of cols) rect('windowDim', wx, gTop, 2, gBot - gTop);
    // two lit floors per stage, aligned across it so they read as storeys
    for (let k = 0; k < 2; k++) {
      const fy = gTop + 2 + Math.round((gBot - gTop - 5) * (k ? 0.62 : 0.14));
      for (const wx of cols) {
        if (r() < 0.25) continue;
        rect('windowLit', wx, fy, 2, 3);
      }
    }
    if (st.base) for (const wx of cols) rect('windowLit', wx, lobbyY, 2, 2);
  }

  // crown: cornice tier, lantern tier with a lit slot, gold mast. Every tier
  // is centred on the TOP STAGE, and the silhouette steps 14 -> 10 -> 6 -> 2.
  const tsx = x + inset * 2;
  const tsw = w - inset * 4;
  const cen = (cw) => tsx + Math.floor((tsw - cw) / 2);
  const cA = Math.max(6, tsw - 4);
  const cB = Math.max(4, cA - 4);
  rect('near', cen(cA), top - 3, cA, 3);
  rect('nearDark', cen(cA) + cA - 2, top - 3, 2, 3);
  rect('nearEdge', cen(cA), top - 3, cA, 1);
  rect('near', cen(cB), top - 7, cB, 4);
  rect('nearDark', cen(cB) + cB - 2, top - 7, 2, 4);
  rect('nearEdge', cen(cB), top - 7, cB, 1);
  rect('windowLit', cen(2), top - 6, 2, 2);
  rect('gold', cen(2), top - 10, 2, 3);
}

// ── The scene ────────────────────────────────────────────────────────────────────────────

function buildScene() {
  const g = makeCanvas(20260921);
  const { ops, rect, pick } = g;

  sky(g);

  // Back skyline: flat silhouettes for depth, no windows.
  let bx = -14;
  while (bx < LW + 14) {
    const w = pick(17, 39);
    const top = pick(SKY_FLOOR + 13, 124);
    rect('far', bx, top, w, GROUND_Y - top);
    rect('farEdge', bx, top, w, 1);
    bx += w + pick(-3, 4);
  }

  // The city. Tall things sit at the sides; the centre stays low so the headline has open sky.
  plainTower(g, -7, 31, 107, 'grid');
  clockTower(g, 32, 25, 88);
  plainTower(g, 62, 28, 119, 'strip');
  decoTower(g, 94, 26, 93);
  plainTower(g, 124, 32, 127, 'grid');
  domeBuilding(g, 183, 44, 117);
  plainTower(g, 209, 29, 122, 'grid');
  decoTower(g, 241, 23, 100);
  archGate(g, 257, 38, 110);
  plainTower(g, 310, 30, 115, 'strip');

  // No ground band and no foreground props: the city runs straight off the bottom edge, and
  // render() extends the last city row downward to fill the rows below GROUND_Y.

  return ops;
}

// ── Rasteriser ───────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Rasterise the art grid into an indexed PNG, expanding each art pixel to PX x PX. */
function render(ops, palette) {
  const index = new Map(SLOTS.map((s, i) => [s, i]));
  const grid = new Uint8Array(LW * LH); // index 0 is the sky, so anything undrawn is sky
  for (const [slot, x, y, w, h] of ops) {
    const v = index.get(slot);
    if (v === undefined) throw new Error(`unknown slot ${slot}`);
    for (let yy = Math.max(0, y); yy < Math.min(LH, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(LW, x + w); xx++) grid[yy * LW + xx] = v;
    }
  }

  // The plate stays 16:9 so the page's hero measurements still hold, but there is no ground to
  // draw. Repeat the last city row through the rest of the frame, so the buildings simply run off
  // the bottom edge instead of standing on a band.
  const last = (GROUND_Y - 1) * LW;
  for (let yy = GROUND_Y; yy < LH; yy++) {
    for (let xx = 0; xx < LW; xx++) grid[yy * LW + xx] = grid[last + xx];
  }

  const W = LW * PX;
  const H = LH * PX;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  const plte = Buffer.alloc(SLOTS.length * 3);
  SLOTS.forEach((s, i) => {
    const hex = palette[s];
    plte[i * 3] = parseInt(hex.slice(1, 3), 16);
    plte[i * 3 + 1] = parseInt(hex.slice(3, 5), 16);
    plte[i * 3 + 2] = parseInt(hex.slice(5, 7), 16);
  });
  // Filter byte 0 (None) per scanline: flat colour regions deflate well without prediction.
  const raw = Buffer.alloc(H * (W + 1));
  for (let y = 0; y < H; y++) {
    const base = y * (W + 1);
    raw[base] = 0;
    const gy = Math.floor(y / PX) * LW;
    for (let x = 0; x < W; x++) raw[base + 1 + x] = grid[gy + Math.floor(x / PX)];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'site', 'public');
const scene = buildScene();
for (const [name, file] of [['night', 'hero-pixels.png'], ['day', 'hero-pixels-day.png']]) {
  const png = render(scene, PALETTES[name]);
  writeFileSync(join(out, file), png);
  console.log(`${file.padEnd(22)} ${LW * PX}x${LH * PX} (${LW}x${LH} art px)  ${(png.length / 1024).toFixed(1)} KB`);
}
