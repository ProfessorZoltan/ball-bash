import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PORTAL, aimPortal, framePortal, throughPortal, portalLocal, mouthOf, portalFighter, encodePortal, decodePortal, openPortals, partner, openedSegments, carve } from '../src/portals.js';
import { Fighter, createMover } from '../src/entities.js';
import { polygonEdges, resolveCircleVsSegments, ejectFromPolygon } from '../src/physics.js';
import { createGameState, versusColors, wellReturnSpot, COLOR_APART, RETURN_FROM_FIGHTERS } from '../src/gamestate.js';
import { colorDistance, lighter, darker } from '../src/color.js';
import { VERSUS_LEVELS, LEVELS } from '../src/levels.js';
import { VERSUS_CONDUITS } from '../src/conduits.js';

/** A plain room, 1000 by 600, as a game state the portal code can read. */
function room(movers = []) {
  const boundary = [[0, 0], [1000, 0], [1000, 600], [0, 600]];
  return { walls: polygonEdges(boundary, 'wall'), movers, portals: {} };
}

test('wormholes: through one mouth and out of the other, speed kept, direction and facing turned by the angle between them', () => {
  const A = { cx: 100, cy: 300, nx: 1, ny: 0 };
  const B = { cx: 500, cy: 100, nx: 0, ny: 1 };
  const o = throughPortal(A, B, 95, 300, -400, 0, Math.PI);
  assert.ok(Math.abs(o.x - 500) < 1e-9 && Math.abs(o.y - 105) < 1e-9, 'five behind A is five in front of B');
  assert.ok(Math.abs(o.vx) < 1e-9 && Math.abs(o.vy - 400) < 1e-9, 'into A is out of B, at the same speed');
  assert.ok(Math.abs(Math.cos(o.angle) - 0) < 1e-9 && Math.abs(Math.sin(o.angle) - 1) < 1e-9, 'the facing turns with it');
  // Two mouths facing each other (a quarter-turn apart, or head on): speed is always kept.
  const C = { cx: 900, cy: 300, nx: -1, ny: 0 };
  const h = throughPortal(A, C, 99, 310, -250, 30);
  assert.ok(Math.abs(Math.hypot(h.vx, h.vy) - Math.hypot(250, 30)) < 1e-9);
  assert.ok(portalLocal(C, h.x, h.y).v > 0, 'comes out on the room side');
});

test('wormholes: an end goes on the first surface straight ahead, lies along it, faces the fighter, and stays whole on the wall', () => {
  const g = room();
  const f = new Fighter({ x: 500, y: 300, angle: 0, slot: 'a' });
  const p = aimPortal(g, f, 0);
  assert.equal(p.host.kind, 'wall');
  assert.equal(p.cx, 1000);
  assert.equal(p.cy, 300);
  assert.deepEqual([p.nx, p.ny], [-1, 0]); // facing back into the room
  // Aimed near a corner, the mouth slides along the wall so all of it is on the wall.
  f.x = 900;
  f.y = 560;
  const q = aimPortal(g, f, 1);
  assert.equal(q.cx, 1000);
  assert.ok(q.cy <= 600 - PORTAL.halfWidth + 1e-9);
  assert.ok(PORTAL.halfWidth * 2 >= 56 + 20, 'wide enough for the biggest frame, with room to spare');
});

test('wormholes: a fighter walking into an open mouth comes out of the other end, and the grace stops it bouncing straight back', () => {
  const g = room();
  const walker = new Fighter({ x: 500, y: 300, angle: 0, slot: 'a' });
  g.portals.a = [aimPortal(g, walker, 0), null];
  walker.angle = -Math.PI / 2; // up
  g.portals.a[1] = aimPortal(g, walker, 1); // the top wall, facing down
  assert.equal(openPortals(g).length, 2);
  assert.equal(partner(g, g.portals.a[0]), g.portals.a[1]);
  // Walk right into the right-hand mouth.
  const f = new Fighter({ x: 950, y: 300, angle: 0, slot: 'c' });
  f.vx = 340;
  let warped = null;
  for (let i = 0; i < 120 && !warped; i++) {
    f.update(1 / 240, { mx: 1, my: 0, turn: 0 });
    warped = portalFighter(g, f).warp;
  }
  assert.ok(warped, 'it went through');
  assert.ok(Math.abs(f.x - 500) < PORTAL.halfWidth, 'it came out of the top mouth');
  assert.ok(f.y > 0 && f.y < f.r + 5, 'just below the top wall');
  assert.ok(f.vy > 300 && Math.abs(f.vx) < 1, 'heading down into the room at the speed it went in');
  assert.equal(f.warps, 1);
  assert.ok(f.portalGrace > 0);
  // Straight back up into the top mouth, within the grace: it does not go through again.
  f.vx = 0;
  f.vy = -340;
  f.y -= f.r + 4;
  assert.equal(portalFighter(g, f).warp, null);
  // One end alone is no opening at all.
  g.portals.a[1] = null;
  assert.equal(mouthOf(g, 990, 300, 22), null);
});

test('wormholes: an end on a moving part rides with it, and a guest finds the same wall a wall end sits on', () => {
  const piston = createMover({ type: 'piston', x: 500, y: 100, length: 400, thick: 10, axisAngle: Math.PI / 2, amp: 100, period: 4, phase: 0 });
  const g = room([piston]);
  const f = new Fighter({ x: 500, y: 400, angle: -Math.PI / 2, slot: 'a' });
  const p = aimPortal(g, f, 0);
  assert.equal(p.host.kind, 'mover');
  const y0 = p.cy;
  piston.update(1); // a quarter of its period: it has moved
  assert.ok(framePortal(g, p));
  assert.ok(Math.abs(p.cy - y0) > 20, `the end moved with the part (${y0} -> ${p.cy})`);
  assert.ok(p.ny > 0.99, 'still facing the fighter below');
  // Across the network: a wall end is sent as where it is, and the guest finds its own copy of that wall.
  const w = aimPortal(g, new Fighter({ x: 500, y: 300, angle: 0, slot: 'a' }), 1);
  const back = decodePortal(g, 'a', 1, encodePortal(w));
  assert.equal(back.host.seg, w.host.seg);
  const moved = decodePortal(g, 'a', 0, encodePortal(p));
  assert.ok(Math.abs(moved.cy - p.cy) < 1e-6);
});

/** One step of what main.js does for a fighter: through a mouth if it went in, then kept out of everything the mouth does not open. */
function settle(g, f) {
  for (const pair of Object.values(g.portals)) for (const p of pair) if (p) framePortal(g, p);
  const { mouth: hole, warp } = portalFighter(g, f);
  const walls = openedSegments(hole, g.walls);
  resolveCircleVsSegments(f, walls);
  for (const m of g.movers) resolveCircleVsSegments(f, openedSegments(hole, m.segments().map((sg) => ({ ...sg, thick: m.thick }))));
  resolveCircleVsSegments(f, walls);
  for (const poly of g.solidPolys || []) if (ejectFromPolygon(f, poly)) break;
  return warp;
}

test('wormholes: a thin moving part with the room wall just behind it still lets a fighter all the way through', () => {
  // Retracted, the slab's face is 20 px off the top wall: less than a body's radius.
  const piston = createMover({ type: 'piston', x: 500, y: 10, length: 400, thick: 10, axisAngle: Math.PI / 2, amp: 100, period: 400, phase: 0 });
  const g = room([piston]);
  const f = new Fighter({ x: 500, y: 300, angle: -Math.PI / 2, slot: 'a' });
  const top = aimPortal(g, f, 0);
  assert.equal(top.host.kind, 'mover');
  assert.ok(Math.abs(top.cy - 20) < 0.5, `on the slab's face (${top.cy})`);
  f.angle = Math.PI / 2;
  g.portals.a = [top, aimPortal(g, f, 1)]; // the bottom wall
  let warp = null;
  for (let i = 0; i < 240 && !warp; i++) {
    piston.update(1 / 240);
    f.update(1 / 240, { mx: 0, my: -1, turn: 0 });
    warp = settle(g, f);
  }
  assert.ok(warp, `it went through (stopped at ${f.y.toFixed(1)})`);
  assert.ok(f.y > 550 && f.vy < -300, 'and came up out of the floor, still heading up');
});

test('wormholes: in its grace a fighter goes no further in than halfway, and the host either side of the mouth still stands', () => {
  const g = room();
  const f = new Fighter({ x: 500, y: 300, angle: 0, slot: 'a' });
  g.portals.a = [aimPortal(g, f, 0), null];
  f.angle = -Math.PI / 2;
  g.portals.a[1] = aimPortal(g, f, 1);
  const right = g.portals.a[0];
  f.x = 1000 + 5; // centre through the right-hand mouth, but in its grace
  f.lastMouth = right.key;
  f.portalGrace = 0.2;
  const r = portalFighter(g, f);
  assert.equal(r.warp, null);
  assert.ok(Math.abs(f.x - 1000) < 1e-9, 'held on the surface, halfway in');
  assert.equal(f.lastMouth, right.key, 'and through as soon as the grace is over');
  // The jambs: what is left of the wall either side of the mouth.
  const seg = right.host.seg;
  const [j1, j2] = carve(right, seg);
  const len = (s) => Math.hypot(s.bx - s.ax, s.by - s.ay);
  assert.ok(Math.abs(len(j1) + len(j2) + 2 * PORTAL.halfWidth - len(seg)) < 1e-6);
  const open = openedSegments(mouthOf(g, 990, 300, 22), g.walls);
  assert.ok(!open.includes(seg) && open.length === g.walls.length + 1, 'the host is split in two, everything else stands');
  // Something in front of the mouth, a wall across a corner, is not part of the opening.
  assert.equal(carve(right, { ax: 950, ay: 250, bx: 950, by: 350 })[0].ax, 950);
});

test('wormholes: on a curved obstacle the mouth opens across every edge it spans, and a fighter can stop halfway in and stay there', () => {
  // A round pillar of short edges: one edge is far narrower than the mouth.
  const pillar = [];
  for (let i = 0; i < 24; i++) pillar.push([700 + Math.cos((i / 24) * 2 * Math.PI) * 90, 300 + Math.sin((i / 24) * 2 * Math.PI) * 90]);
  const g = room();
  g.walls.push(...polygonEdges(pillar, 'obstacle'));
  g.solidPolys = [pillar];
  const f = new Fighter({ x: 300, y: 300, angle: 0, slot: 'a' });
  const mouth = aimPortal(g, f, 0);
  assert.equal(mouth.host.seg.kind, 'obstacle');
  f.angle = -Math.PI / 2;
  g.portals.a = [mouth, aimPortal(g, f, 1)];
  // Walk in until halfway, then stand there for two seconds.
  let warp = null;
  let v = Infinity;
  for (let i = 0; i < 720 && !warp; i++) {
    v = portalLocal(mouth, f.x, f.y).v;
    f.update(1 / 240, { mx: v > 8 ? 1 : 0, my: 0, turn: 0 });
    warp = settle(g, f);
    f.finalizeStep(1 / 240);
  }
  assert.equal(warp, null);
  v = portalLocal(mouth, f.x, f.y).v;
  assert.ok(v > 0 && v < 9, `halfway in, and it stayed (v ${v.toFixed(1)})`);
  // One more push and it is through.
  for (let i = 0; i < 60 && !warp; i++) {
    f.update(1 / 240, { mx: 1, my: 0, turn: 0 });
    warp = settle(g, f);
  }
  assert.ok(warp, 'and then through');
});

test('player colours: in every arena no player wears the wall or obstacle colour, or anything close, and the players stay apart', () => {
  for (const def of VERSUS_LEVELS.concat(LEVELS, VERSUS_CONDUITS)) {
    const c = versusColors(def);
    assert.equal(c.length, 3);
    for (const x of c) for (const a of [def.palette.wall, def.palette.obstacle]) assert.ok(colorDistance(x, a) >= COLOR_APART, `${def.title}: ${x} against ${a}`);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(colorDistance(c[i], c[j]) >= COLOR_APART, `${def.title}: ${c[i]} and ${c[j]}`);
  }
  // A wormhole's two ends are the player's own colour made lighter and darker.
  assert.ok(colorDistance(lighter('#ff4fd8'), '#ffffff') < colorDistance('#ff4fd8', '#ffffff'));
  assert.ok(colorDistance(darker('#ff4fd8'), '#000000') < colorDistance('#ff4fd8', '#000000'));
});

test('Event Horizon: what the well takes comes back far from it, clear of everything, not heading straight back in', () => {
  const def = VERSUS_CONDUITS.find((d) => d.title === 'Event Horizon');
  assert.equal(def.wellReturns, true);
  const g = createGameState(def, {});
  const w = g.wells[0];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const vx = Math.cos(i) * 600;
    const vy = Math.sin(i) * 600;
    const s = wellReturnSpot(g, vx, vy, rand);
    assert.ok(s, 'somewhere to put it');
    const d = Math.hypot(s.x - w.x, s.y - w.y);
    assert.ok(d >= w.range, 'outside the pull');
    for (const f of g.fighters) assert.ok(Math.hypot(s.x - f.x, s.y - f.y) >= RETURN_FROM_FIGHTERS, 'not on top of anyone');
    assert.ok((vx * (w.x - s.x) + vy * (w.y - s.y)) / (600 * d) < 0.5, 'not heading straight back at the well');
  }
});
