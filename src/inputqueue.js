// A guest's inputs as the host plays them: in order, each for exactly the
// physics steps it covered on the guest, so the host's copy of the guest's
// character does what the guest's own prediction did and the guest is never
// pulled back for an input the host played differently.
//
// The guest sends one record per frame, [seq, steps, mx, my, turn, lunge,
// retract, vt, pa, pb] (pa and pb: Blaster's wormhole buttons), and repeats its last few in every message, so a lost or late
// message costs nothing. vt is the host time the guest's view was showing
// (for latency compensation), or null.
//
// Records arrive unevenly, so the host keeps a small buffer of them, like a
// jitter buffer. When the queue runs dry the guest's character waits where it
// is (it is not guessed at), and play resumes once `buffer` steps are queued;
// each time it runs dry the buffer grows, and it shrinks again after a calm
// second. When more than the buffer is queued (after a stall), two steps are
// played per host step until it is caught up. Only a queue far too deep is
// trimmed, and a thrust among the steps trimmed is latched onto the next one
// played, never lost.
//
// A record's vt is the view time at the end of its frame; the view moved on
// through the frame, so each step played is paired with its share of it, and
// the host's rewinds sweep the ball the guest saw step by step, not in
// frame-sized jumps a fast ball could slip between.
//
// The ack sent back is [seq, steps]: every record up to seq is done, and so
// are `steps` steps of the one after it. The guest replays the rest.

import { PHYSICS_DT } from './config.js';

export const ZERO = Object.freeze({ mx: 0, my: 0, turn: 0, lunge: false, retract: false });
/** The buffer, in physics steps (240 a second): at least a frame's worth, at most 200 ms. */
export const MIN_BUFFER = 4;
export const MAX_BUFFER = 48;
/** What the buffer grows by each time the queue runs dry, and how many calm steps take one off it. */
export const BUFFER_GROWTH = 4;
export const CALM_STEPS = 240;
/** Queued past the buffer by more than this, play two steps a host step to catch up. */
export const CATCH_UP_OVER = 8;
/** Queued past the buffer by more than this (half a second), trim down to the buffer. */
export const TRIM_OVER = 120;
/** Records a guest repeats in every message. */
export const REDUNDANCY = 6;

/** A record as a guest sends it, from its intent. */
export function inputRecord(seq, steps, it, vt) {
  return [seq, steps, +(+it.mx || 0).toFixed(3), +(+it.my || 0).toFixed(3), +(+it.turn || 0).toFixed(4), it.lunge ? 1 : 0, it.retract ? 1 : 0, vt == null ? null : Math.round(vt * 1000) / 1000, it.pa ? 1 : 0, it.pb ? 1 : 0];
}

export class InputQueue {
  constructor() {
    this.lastSeq = 0; // the newest record ever queued
    this.ack = 0; // the newest record fully played
    this.stats = { played: 0, waited: 0, starved: 0, caughtUp: 0, trimmed: 0, latched: 0, maxDepth: 0 }; // for the curious, and the tests
    this.newRound();
  }

  /** A new round: nothing queued or latched, and a fresh buffer. The sequence numbers carry on. */
  newRound() {
    this.q = [];
    this.latch = false;
    this.cur = ZERO;
    this.vt = null;
    this.buffer = MIN_BUFFER;
    this.waiting = true; // until the first steps are in hand
    this.calm = 0;
  }

  /** Steps queued and not yet played. */
  get depth() {
    let n = 0;
    for (const r of this.q) n += r.n - r.used;
    return n;
  }

  /** Take in records (any order, repeats welcome). Returns how many were new. */
  push(records) {
    if (!Array.isArray(records)) return 0;
    const fresh = records.filter((r) => Array.isArray(r) && r[0] > this.lastSeq).sort((a, b) => a[0] - b[0]);
    for (const r of fresh) {
      this.lastSeq = r[0];
      const n = Math.max(0, Math.min(16, r[1] | 0));
      if (!n) continue;
      this.q.push({ seq: r[0], n, used: 0, vt: r[7] == null ? null : Number(r[7]), intent: { mx: +r[2] || 0, my: +r[3] || 0, turn: +r[4] || 0, lunge: !!r[5], retract: !!r[6], pa: !!r[8], pb: !!r[9] } });
    }
    const depth = this.depth;
    if (depth > this.stats.maxDepth) this.stats.maxDepth = depth;
    if (depth > this.buffer + TRIM_OVER) {
      while (this.depth > this.buffer) {
        const h = this.q[0];
        if (h.intent.lunge && !this.cur.lunge && !this.latch) {
          this.latch = true;
          this.stats.latched++;
        }
        this.cur = h.intent;
        this.used(h);
        this.stats.trimmed++;
      }
    }
    return fresh.length;
  }

  used(h) {
    h.used++;
    if (h.used >= h.n) {
      this.q.shift();
      this.ack = h.seq;
    }
  }

  playOne() {
    const h = this.q[0];
    let intent = h.intent;
    if (this.latch) {
      intent = { ...intent, lunge: true };
      this.latch = false;
    }
    this.cur = h.intent;
    this.vt = h.vt == null ? null : h.vt - (h.n - 1 - h.used) * PHYSICS_DT;
    this.used(h);
    this.stats.played++;
    return { intent, vt: this.vt };
  }

  /**
   * What the guest's character plays in one host physics step: no steps
   * (it waits, the queue having run dry), one, or two (catching up). Each
   * is { intent, vt }.
   */
  next() {
    if (this.waiting) {
      if (this.depth < this.buffer) {
        this.stats.waited++;
        return [];
      }
      this.waiting = false;
    }
    if (!this.q.length) {
      // Ran dry: wait for a bigger cushion from now on.
      this.waiting = true;
      this.buffer = Math.min(MAX_BUFFER, this.buffer + BUFFER_GROWTH);
      this.calm = 0;
      this.stats.starved++;
      this.stats.waited++;
      return [];
    }
    if (++this.calm >= CALM_STEPS) {
      this.calm = 0;
      this.buffer = Math.max(MIN_BUFFER, this.buffer - 1);
    }
    const out = [this.playOne()];
    if (this.q.length && this.depth > this.buffer + CATCH_UP_OVER) {
      out.push(this.playOne());
      this.stats.caughtUp++;
    }
    return out;
  }

  /** What the host has played so far, as the guest needs it: [seq, steps of the next record]. */
  ackPair() {
    return [this.ack, this.q.length ? this.q[0].used : 0];
  }
}

/**
 * The guest's side of an ack: of the steps it predicted (each tagged with the
 * record it went out in), `keep` is every step not in a record the host has
 * finished, and `replay` those the host has not played at all yet. `ack` is
 * [seq, steps] or, from an older host, a bare seq.
 */
export function splitAck(steps, ack) {
  const [seq, extra] = Array.isArray(ack) ? ack : [Number(ack) || 0, 0];
  const keep = steps.filter((p) => p.seq > seq);
  return { keep, replay: keep.slice(Math.max(0, extra | 0)) };
}
