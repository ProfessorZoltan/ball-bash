// Listens to Vector's sound without speakers: renders every track, every
// cue and the babble offline in headless Chromium (an OfflineAudioContext
// fed straight from the sequencer) and reports each one's peak and loudness,
// so a silent track, a clipping one or a NaN shows up as a number.
//
//   node vector/tools/listen.mjs                 every track and every cue
//   node vector/tools/listen.mjs rain harbour    just those tracks
//   node vector/tools/listen.mjs --voices        each instrument alone, for balancing
//   node vector/tools/listen.mjs --secs 12       longer renders (default 8)
//   node vector/tools/listen.mjs --full          each track's whole arrangement, once through
//   node vector/tools/listen.mjs --wav out/      also write each render as a .wav
//
// Each track is rendered three times: from its start, from its fullest
// section, and that section again at its boss tempo and intensity.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, serve, watchErrors } from '../../tools/browser.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const secs = Number(value('--secs', 8));
const wavDir = value('--wav', null);
const named = args.filter((a, i) => !a.startsWith('--') && !['--secs', '--wav'].includes(args[i - 1]));

const { url, stop } = await serve();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = [];
watchErrors(page, errs);
// Any page on the game's origin will do: the modules are imported into it below.
await page.goto(url + 'vector/src/tracks.js');

const report = await page.evaluate(
  async ({ secs, named, voices, wav, full }) => {
    const { VectorAudio, CUE_NAMES, SAMPLED } = await import('/vector/src/audio.js');
    const { VECTOR_TRACKS } = await import('/vector/src/tracks.js');
    const RATE = 48000;
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    const measure = (buf) => {
      let peak = 0;
      let sum = 0;
      let nan = 0;
      let n = 0;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const x = d[i];
          if (!Number.isFinite(x)) {
            nan++;
            continue;
          }
          const a = Math.abs(x);
          if (a > peak) peak = a;
          sum += x * x;
          n++;
        }
      }
      return { peak: +peak.toFixed(3), rms: +db(Math.sqrt(sum / Math.max(1, n))).toFixed(1), nan };
    };
    const toWav = (buf) => {
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
      const out = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) {
        out[i * 2] = Math.max(-1, Math.min(1, L[i] || 0)) * 32767;
        out[i * 2 + 1] = Math.max(-1, Math.min(1, R[i] || 0)) * 32767;
      }
      return Array.from(new Uint8Array(out.buffer));
    };
    const fresh = (length) => {
      const ctx = new OfflineAudioContext(2, Math.floor(RATE * length), RATE);
      return { ctx, a: new VectorAudio().attach(ctx) };
    };
    const out = { tracks: [], cues: [], voices: [], speech: [] };
    // The master compressor starts clamped on a new context and takes a few
    // hundred ms to open; the game's never is. Sounds are played after it has.
    const at = (ctx, fn) =>
      ctx.suspend(0.6).then(() => {
        fn();
        ctx.resume();
      });

    if (voices) {
      // Each instrument alone, playing what it would play, so their levels can be set against each other.
      const T = VECTOR_TRACKS.ridge;
      const tests = [];
      for (const inst of SAMPLED) tests.push([inst, (a, t) => [0, 4, 7, 12, 16, 12, 7, 4].forEach((d, i) => a.strike(inst, t + i * 0.25, (inst === 'pluck' || inst === 'upright' ? 36 : 60) + d, 0.65, 0.5))]);
      for (const v of ['synth', 'warm', 'strings', 'choir', 'harmonium']) tests.push(['pad:' + v, (a, t) => a.padVoice(v, t, [45, 57, 60, 64, 67], 3, 0.2, T.pad || {})]);
      for (const v of ['synth', 'glide', 'cello', 'viola', 'violin', 'flute', 'whistle', 'reed', 'voice', 'piano']) {
        tests.push(['line:' + v, (a, t) => [72, 74, 76, 79, 76, 74].forEach((m, i) => a.line('lead', v, t + i * 0.45, m - (v === 'cello' ? 12 : 0), 0.42))]);
      }
      tests.push(['bass:arco', (a, t) => [36, 43, 40, 38].forEach((m, i) => a.bowed('arco', t + i * 0.7, m, 0.65, 1, 'bass'))]);
      for (const kit of ['synth', 'factory', 'hand', 'kit', 'brushes', 'orch']) {
        tests.push(['kit:' + kit, (a, t) => {
          a.track = { ...a.track, voices: { drums: kit } };
          for (let s = 0; s < 32; s++) {
            const at = t + s * 0.15;
            if (s % 8 === 0) a.kick(at, 1);
            if (s % 8 === 4) a.snare(at, 1);
            if (s % 2 === 0) a.hat(at, 0.5, s % 16 === 14);
          }
        }]);
      }
      tests.push(['strum', (a, t) => [1, 0.8, -0.6, -0.6, 0.8, -0.6].forEach((v, i) => a.strum(t + i * 0.3, [43, 47, 50, 55, 59, 66], Math.abs(v), Math.sign(v)))]);
      for (const p of ['shaker', 'rim', 'conga', 'bongo', 'clave', 'block', 'tamb', 'anvil', 'clank', 'clap', 'snap', 'tick', 'timpani', 'swish']) {
        tests.push(['perc:' + p, (a, t) => [0, 0.3, 0.6, 0.9].forEach((d) => a.perc(p, t + d, 0.8))]);
      }
      for (const [name, play] of tests) {
        const { ctx, a } = fresh(4);
        // No sequencer: just the voice, on a track that names nothing else.
        a.track = { ...T, sections: [{ name: 'x', bars: 1, layers: [] }] };
        a.humanity = 1;
        play(a, 0.6);
        const buf = await ctx.startRendering();
        out.voices.push({ name, ...measure(buf) });
      }
      return out;
    }

    // The fullest section: the one with the most layers, the first of them.
    const fullest = (T) => {
      let bar = 0;
      let best = 0;
      let most = -1;
      for (const s of T.sections) {
        if (s.layers.length > most) {
          most = s.layers.length;
          best = bar;
        }
        bar += s.bars;
      }
      return best;
    };
    const keys = named.length ? named : Object.keys(VECTOR_TRACKS);
    for (const key of keys) {
      const T = VECTOR_TRACKS[key];
      if (!T) {
        out.tracks.push({ key, error: 'no such track' });
        continue;
      }
      if (full) {
        const length = (T.sections.reduce((n, s) => n + s.bars, 0) * 16 * 60) / T.bpm / 4;
        const { ctx, a } = fresh(length + 3);
        a.setHumanity(T.humanity);
        const t0 = performance.now();
        a.playTrack(T);
        clearInterval(a.timer);
        a.timer = null;
        a.scheduleUntil(length);
        const ms = performance.now() - t0;
        const buf = await ctx.startRendering();
        out.tracks.push({ key, part: 'full', ms: Math.round(ms), notes: a.bank.size, ...measure(buf), wav: wav ? toWav(buf) : null });
        continue;
      }
      for (const part of ['start', 'main', 'boss']) {
        const { ctx, a } = fresh(secs);
        a.setHumanity(T.humanity);
        const t0 = performance.now();
        a.playTrack(T, part === 'start' ? 0 : fullest(T));
        clearInterval(a.timer);
        a.timer = null;
        if (part === 'boss') a.bossTime(true);
        a.scheduleUntil(secs - 0.4);
        const ms = performance.now() - t0;
        const buf = await ctx.startRendering();
        out.tracks.push({ key, part, ms: Math.round(ms), notes: a.bank.size, ...measure(buf), wav: wav ? toWav(buf) : null });
      }
    }

    if (!named.length && !full) {
      const extra = { land: { air: 1 }, step: { surface: 'metal' }, fire: { kind: 'big' }, ricochet: { speed: 1 }, pop: { big: true }, portal: { which: 1 }, shot: { kind: 'big' } };
      for (const h of [0, 0.5, 1]) {
        for (const s of CUE_NAMES) {
          const { ctx, a } = fresh(2.6);
          a.setHumanity(h);
          at(ctx, () => a.cue({ s, ...(extra[s] || {}) }));
          const buf = await ctx.startRendering();
          out.cues.push({ s, h, ...measure(buf) });
        }
        for (const surface of ['grid', 'metal', 'concrete', 'wood', 'grass', 'snow', 'water']) {
          const { ctx, a } = fresh(1.2);
          a.setHumanity(h);
          at(ctx, () => a.cue({ s: 'step', surface }));
          const buf = await ctx.startRendering();
          out.cues.push({ s: 'step:' + surface, h, ...measure(buf) });
        }
      }
      for (const who of ['creator', 'machine']) {
        const { ctx, a } = fresh(6.6);
        let len = 0;
        at(ctx, () => {
          len = a.speak('Why did you leave? I built you to finish the grid, not to walk away from it.', { who });
        });
        const buf = await ctx.startRendering();
        out.speech.push({ who, len: +len.toFixed(2), ...measure(buf) });
      }
    }
    return out;
  },
  { secs, named, voices: flag('--voices'), wav: !!wavDir, full: flag('--full') },
);

await browser.close();
stop();

const flags = (r) => [r.nan ? 'NaN' : '', r.peak > 1 ? 'CLIPS' : '', r.rms < -60 ? 'SILENT' : ''].filter(Boolean).join(' ');
let bad = 0;
const row = (cells) => console.log(cells.map((c, i) => String(c).padEnd(i === 0 ? 22 : 9)).join(''));
if (report.voices.length) {
  row(['voice', 'peak', 'rms dB']);
  for (const r of report.voices) row([r.name, r.peak, r.rms, flags(r)]);
}
if (report.tracks.length) {
  row(['track', 'part', 'peak', 'rms dB', 'ms', 'notes']);
  for (const r of report.tracks) {
    if (r.error) {
      row([r.key, r.error]);
      bad++;
      continue;
    }
    const f = flags(r);
    if (f) bad++;
    row([r.key, r.part, r.peak, r.rms, r.ms, r.notes, f]);
    if (wavDir && r.wav) {
      mkdirSync(wavDir, { recursive: true });
      writeFileSync(path.join(wavDir, `${r.key}-${r.part}.wav`), wav(new Uint8Array(r.wav), 48000));
    }
  }
}
if (report.cues.length) {
  row(['cue', 'humanity', 'peak', 'rms dB']);
  for (const r of report.cues) {
    const f = [r.nan ? 'NaN' : '', r.peak > 1 ? 'CLIPS' : '', r.peak < 0.005 ? 'SILENT' : ''].filter(Boolean).join(' ');
    if (f) bad++;
    row([r.s, r.h, r.peak, r.rms, f]);
  }
}
for (const r of report.speech) {
  const f = flags(r);
  if (f) bad++;
  row(['speak:' + r.who, r.len + 's', r.peak, r.rms, f]);
}
for (const e of errs) console.log(e);
console.log(bad || errs.length ? `${bad} problem(s), ${errs.length} page error(s)` : 'all clear');
process.exitCode = bad || errs.length ? 1 : 0;

/** 16-bit stereo PCM, interleaved, as a .wav file. */
function wav(pcm, rate) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, Buffer.from(pcm)]);
}
