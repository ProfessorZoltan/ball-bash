// Defector on a touchscreen: the move stick's sums and the pads' aim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH, stickIntent, padAim } from '../src/touch.js';

const R = TOUCH.stick;
const at = (deg, m) => [Math.cos((deg * Math.PI) / 180) * m * R, -Math.sin((deg * Math.PI) / 180) * m * R]; // degrees up from the right

test('a thumb resting on the move stick does nothing', () => {
  assert.deepEqual(stickIntent(0, 0), { mx: 0, run: false, jump: false, down: false });
  assert.deepEqual(stickIntent(...at(0, 0.15)), { mx: 0, run: false, jump: false, down: false });
});

test('tilted sideways the robot walks that way, harder the further, and runs when pushed nearly all the way', () => {
  const soft = stickIntent(...at(0, 0.4));
  const hard = stickIntent(...at(0, 0.7));
  assert.ok(soft.mx > 0 && hard.mx > soft.mx, `walks right, faster pushed further (${soft.mx.toFixed(2)}, ${hard.mx.toFixed(2)})`);
  assert.ok(!soft.run && !hard.run, 'and walks');
  const full = stickIntent(...at(180, 0.95));
  assert.ok(full.mx === -1 && full.run, 'all the way left: runs left');
  assert.ok(!full.jump && !full.down);
});

test('pushed up it jumps, straight up or up and to one side; level or a little up it does not', () => {
  const up = stickIntent(...at(90, 0.8));
  assert.ok(up.jump && Math.abs(up.mx) < 0.01, 'straight up: a jump on the spot');
  const upRight = stickIntent(...at(55, 0.9));
  assert.ok(upRight.jump && upRight.mx > 0.4, 'up and right: a jump going right');
  assert.ok(!stickIntent(...at(25, 0.9)).jump, 'a little up of level is a walk');
  assert.ok(!stickIntent(...at(90, 0.35)).jump, 'a nudge up is not a jump');
});

test('held down it drops through a thin platform; down and well to one side is a walk', () => {
  assert.ok(stickIntent(...at(-90, 0.7)).down, 'straight down');
  assert.ok(stickIntent(...at(-115, 0.7)).down, 'down and a little left');
  const low = stickIntent(...at(-20, 0.7));
  assert.ok(!low.down && low.mx > 0, 'down a little and right: walking right');
});

test('a drag from a pad points the way it goes; a short one is a tap', () => {
  assert.equal(padAim(5, 5), null, 'a tap');
  assert.equal(padAim(40, 0), 0, 'dragged right: aimed right');
  assert.ok(Math.abs(padAim(0, -40) + Math.PI / 2) < 1e-9, 'dragged up: aimed straight up');
  assert.ok(Math.abs(padAim(-30, 30) - (3 * Math.PI) / 4) < 1e-9, 'dragged down and left: aimed down and left');
});
