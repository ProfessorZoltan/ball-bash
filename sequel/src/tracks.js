// Defector's soundtrack: one track per level, and one for the title. The
// format is Deflector's own (see src/audio/tracks.js for every field), and
// the engine that plays it is the same. These are written calmer and more
// spacious than the arcade's: 72 to 100 BPM, long pads, bells, triangle
// arpeggios, a big room, and drums that stay light. At the boss the engine
// runs the same track at twice its tempo (DefectorAudio.bossTime).

const DRUMS_SOFT = {
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0],
  hat: [0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0, 0.35, 0],
  hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const SEQUEL_TRACKS = {
  defector: {
    key: 'E dorian',
    title: 'Defector (Title)',
    bpm: 88,
    fx: { reverb: 0.9, delay: 0.6, feedback: 0.6, tone: 3000, delayBeats: 1.5 },
    pad: { attack: 2.4, release: 3.2, lfoRate: 0.07, lfoDepth: 380, cutoff: 480, detune: 14 },
    progression: [
      { chord: [64, 67, 71, 74], pad: [40, 52, 55, 59, 66], bass: 28, bars: 2 }, // Em9
      { chord: [57, 61, 64, 66], pad: [45, 52, 57, 61, 66], bass: 33, bars: 2 }, // A6: the dorian lift
      { chord: [60, 64, 67, 71], pad: [48, 55, 59, 64, 67], bass: 36, bars: 2 }, // Cmaj7
      { chord: [62, 66, 69, 73], pad: [50, 57, 62, 66, 69], bass: 38, bars: 2 }, // D(add9)
    ],
    arp: { octave: 12, gate: 0.9, wave: 'triangle', delay: 0.55, reverb: 0.3, pattern: [0, 2, 4, 1, 3, 5, 2, 4, 0, 3, 1, 5, 2, 0, 4, 1] },
    bell: { octave: 24, ring: 14, pattern: [0, null, null, null, null, null, 2, null, null, null, 1, null, null, null, null, null] },
    bass: { pattern: [[0, 6], 0, 0, 0, 0, 0, 0, 0, [0, 4], 0, 0, 0, [7, 2], 0, 0, 0] },
    drums: DRUMS_SOFT,
    lead: {
      length: 128,
      notes: [[0, 79, 12], [16, 78, 8], [24, 76, 8], [32, 73, 16], [48, 76, 16], [64, 79, 10], [76, 83, 4], [80, 81, 16], [96, 78, 12], [112, 74, 16]],
    },
    sections: [
      { name: 'wake', bars: 8, layers: ['pad', 'bell'] },
      { name: 'walk', bars: 8, layers: ['pad', 'bell', 'arp'], arpDensity: 8 },
      { name: 'out', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'lead'], arpDensity: 8, padBright: 0.3 },
    ],
    loopFrom: 1,
  },

  orchard: {
    key: 'F lydian',
    title: 'Orchard Lights (Gardener Theme)',
    bpm: 90,
    fx: { reverb: 0.85, delay: 0.6, feedback: 0.55, tone: 3400, delayBeats: 1.5 },
    pad: { attack: 1.8, release: 2.6, lfoRate: 0.09, lfoDepth: 420, cutoff: 540, detune: 12 },
    progression: [
      { chord: [53, 57, 60, 64], pad: [41, 53, 57, 60, 64], bass: 29, bars: 2 }, // Fmaj7
      { chord: [55, 59, 62, 65], pad: [41, 55, 59, 62, 67], bass: 29, bars: 2 }, // G over F: the lydian B
      { chord: [57, 60, 64, 67], pad: [45, 52, 57, 60, 64], bass: 33, bars: 2 }, // Am7
      { chord: [55, 59, 62, 67], pad: [43, 50, 55, 59, 62], bass: 31, bars: 2 }, // G
    ],
    arp: { octave: 12, gate: 0.7, wave: 'triangle', delay: 0.5, reverb: 0.25, pattern: [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 5, 3, 1, 2, 4] },
    bell: { octave: 24, ring: 12, pattern: [0, null, null, null, 2, null, null, null, null, null, 4, null, null, null, null, null] },
    bass: { pattern: [[0, 3], 0, 0, [0, 1], 0, 0, [7, 2], 0, [0, 3], 0, 0, [12, 1], 0, 0, [7, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0],
      hat: [0.3, 0, 0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0, 0.45, 0.25],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    lead: {
      length: 128,
      notes: [[0, 72, 6], [8, 76, 8], [16, 79, 12], [30, 77, 2], [32, 71, 16], [48, 74, 8], [56, 76, 8], [64, 76, 6], [72, 79, 8], [80, 84, 12], [96, 83, 8], [104, 79, 8], [112, 74, 16]],
    },
    sections: [
      { name: 'dew', bars: 8, layers: ['pad', 'bell'] },
      { name: 'rows', bars: 8, layers: ['pad', 'bell', 'arp', 'kick'], arpDensity: 8 },
      { name: 'orchard', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.35 },
      { name: 'shade', bars: 8, layers: ['pad', 'bell', 'lead'], arpOctave: 12 },
      { name: 'orchard2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.45 },
    ],
    loopFrom: 1,
  },

  market: {
    key: 'A dorian',
    title: 'Rain Market (Lantern Theme)',
    bpm: 84,
    fx: { reverb: 0.8, delay: 0.66, feedback: 0.62, tone: 2400, delayBeats: 0.75 },
    pad: { attack: 1.6, release: 2.8, lfoRate: 0.12, lfoDepth: 480, cutoff: 460, detune: 15 },
    progression: [
      { chord: [57, 60, 64, 67, 71], pad: [45, 55, 60, 64, 71], bass: 33, bars: 2 }, // Am9
      { chord: [62, 66, 69, 72, 76], pad: [50, 60, 64, 66, 69], bass: 38, bars: 2 }, // D9
      { chord: [57, 60, 64, 67], pad: [45, 55, 60, 64], bass: 33, bars: 2 }, // Am7
      { chord: [64, 67, 71, 74], pad: [40, 52, 55, 59, 62], bass: 28, bars: 2 }, // Em7
    ],
    arp: { octave: 12, gate: 0.45, wave: 'triangle', delay: 0.7, reverb: 0.2, pattern: [0, null, 3, null, 1, null, 4, 2, null, 5, null, 3, 1, null, 4, null] },
    bell: { octave: 24, ring: 8, pattern: [null, null, 1, null, null, null, null, 3, null, null, 0, null, null, 4, null, null] },
    bass: { pattern: [[0, 2], 0, 0, [0, 1], 0, 0, [0, 2], 0, 0, [7, 1], 0, 0, [10, 2], 0, [12, 1], 0] },
    drums: {
      // Rain on the awnings: soft sixteenths that never quite line up with the kick.
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
      hat: [0.2, 0.35, 0.15, 0.3, 0.2, 0.35, 0.15, 0.3, 0.2, 0.35, 0.15, 0.3, 0.2, 0.35, 0.15, 0.3],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    lead: {
      length: 128,
      notes: [[0, 76, 8], [10, 79, 6], [16, 81, 14], [32, 78, 10], [44, 76, 4], [48, 74, 16], [64, 72, 6], [72, 74, 8], [80, 76, 14], [96, 79, 8], [104, 78, 8], [112, 76, 16]],
    },
    sections: [
      { name: 'drizzle', bars: 8, layers: ['pad', 'bell', 'hat'] },
      { name: 'stalls', bars: 8, layers: ['pad', 'bell', 'arp', 'hat', 'kick'] },
      { name: 'downpour', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.3 },
      { name: 'awning', bars: 8, layers: ['pad', 'lead', 'bell'] },
      { name: 'downpour2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.4 },
    ],
    loopFrom: 1,
  },

  transit: {
    key: 'E mixolydian',
    title: 'Transit Loop (Conductor Theme)',
    bpm: 96,
    fx: { reverb: 0.7, delay: 0.55, feedback: 0.5, tone: 3600, delayBeats: 0.5 },
    pad: { attack: 1.2, release: 2, lfoRate: 0.16, lfoDepth: 500, cutoff: 560, detune: 11 },
    progression: [
      { chord: [52, 56, 59, 62], pad: [40, 52, 56, 59, 62], bass: 28, bars: 2 }, // E7
      { chord: [50, 54, 57, 62], pad: [38, 50, 54, 57, 62], bass: 26, bars: 2 }, // D
      { chord: [57, 61, 64, 69], pad: [45, 52, 57, 61, 64], bass: 33, bars: 2 }, // A
      { chord: [50, 54, 57, 61], pad: [38, 50, 54, 57, 61], bass: 26, bars: 2 }, // Dmaj7
    ],
    arp: { octave: 12, gate: 0.4, wave: 'triangle', delay: 0.5, reverb: 0.18, pattern: [0, 3, 0, 3, 1, 4, 1, 4, 2, 5, 2, 5, 1, 4, 3, 0] },
    bell: { octave: 24, ring: 6, pattern: [0, null, null, null, null, null, null, null, 2, null, null, null, null, null, 1, null] },
    // The chug of a train on the rail.
    bass: { pattern: [[0, 1], 0, [0, 1], 0, [0, 1], 0, [0, 1], [12, 1], [0, 1], 0, [0, 1], 0, [7, 1], 0, [10, 1], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0.2],
      hat: [0.4, 0.15, 0.3, 0.15, 0.4, 0.15, 0.3, 0.15, 0.4, 0.15, 0.3, 0.15, 0.4, 0.15, 0.3, 0.15],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    lead: {
      length: 128,
      notes: [[0, 71, 8], [8, 74, 4], [12, 76, 12], [28, 74, 4], [32, 69, 8], [40, 71, 8], [48, 66, 16], [64, 69, 8], [72, 73, 8], [80, 76, 12], [92, 78, 4], [96, 76, 8], [104, 74, 8], [112, 71, 16]],
    },
    sections: [
      { name: 'platform', bars: 8, layers: ['pad', 'bell', 'hat'] },
      { name: 'departing', bars: 8, layers: ['pad', 'bell', 'arp', 'bass', 'hat'], arpDensity: 8 },
      { name: 'loop', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.4 },
      { name: 'tunnel', bars: 8, layers: ['pad', 'bass', 'lead'] },
      { name: 'loop2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.5 },
    ],
    loopFrom: 1,
  },

  tide: {
    key: 'D major',
    title: 'Tidepool Light (Keeper Theme)',
    bpm: 80,
    fx: { reverb: 0.95, delay: 0.55, feedback: 0.62, tone: 2600, delayBeats: 2 },
    pad: { attack: 2.6, release: 3.6, lfoRate: 0.06, lfoDepth: 360, cutoff: 420, detune: 16 },
    progression: [
      { chord: [62, 66, 69, 73], pad: [38, 50, 57, 61, 66], bass: 26, bars: 2 }, // Dmaj7
      { chord: [59, 62, 66, 69], pad: [35, 47, 54, 57, 62], bass: 23, bars: 2 }, // Bm7
      { chord: [55, 59, 62, 66], pad: [43, 50, 55, 59, 62], bass: 31, bars: 2 }, // Gmaj7
      { chord: [57, 61, 64, 69], pad: [45, 52, 57, 61, 64], bass: 33, bars: 2 }, // A
    ],
    arp: { octave: 12, gate: 1, wave: 'triangle', delay: 0.6, reverb: 0.4, pattern: [0, 5, 2, 4, 1, 3, 5, 0, 2, 4, 0, 3, 5, 1, 4, 2] },
    bell: { octave: 24, ring: 16, pattern: [0, null, null, null, null, null, null, null, 2, null, null, null, null, null, null, null] },
    bass: { pattern: [[0, 8], 0, 0, 0, 0, 0, 0, 0, [0, 6], 0, 0, 0, 0, 0, [7, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0],
      hat: [0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    lead: {
      length: 128,
      notes: [[0, 78, 16], [20, 81, 12], [32, 83, 16], [52, 81, 12], [64, 79, 16], [84, 78, 12], [96, 76, 20], [120, 73, 8]],
    },
    sections: [
      { name: 'low tide', bars: 8, layers: ['pad', 'bell'] },
      { name: 'pools', bars: 8, layers: ['pad', 'bell', 'arp'], arpDensity: 8 },
      { name: 'the light', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat'], arpDensity: 8, padBright: 0.25 },
      { name: 'swell', bars: 8, layers: ['pad', 'lead', 'bell'] },
      { name: 'the light2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], arpDensity: 8, padBright: 0.35 },
    ],
    loopFrom: 1,
  },

  greenhouse: {
    key: 'G lydian',
    title: 'Greenhouse Arcology (Bloom Theme)',
    bpm: 92,
    fx: { reverb: 0.8, delay: 0.62, feedback: 0.58, tone: 3800, delayBeats: 0.75 },
    pad: { attack: 1.4, release: 2.2, lfoRate: 0.18, lfoDepth: 560, cutoff: 600, detune: 10 },
    progression: [
      { chord: [55, 59, 62, 66], pad: [43, 55, 59, 62, 66], bass: 31, bars: 2 }, // Gmaj7
      { chord: [57, 61, 64, 67], pad: [43, 57, 61, 64, 69], bass: 31, bars: 2 }, // A over G: the lydian C#
      { chord: [52, 55, 59, 62], pad: [40, 52, 55, 59, 62], bass: 28, bars: 2 }, // Em7
      { chord: [50, 54, 57, 62], pad: [38, 50, 54, 57, 62], bass: 26, bars: 2 }, // D
    ],
    arp: { octave: 12, gate: 0.55, wave: 'triangle', delay: 0.55, reverb: 0.22, pattern: [0, 4, 1, 5, 2, 3, 0, 5, 1, 4, 2, 0, 3, 5, 1, 4] },
    bell: { octave: 24, ring: 9, pattern: [0, null, 2, null, null, null, 4, null, 1, null, null, null, 3, null, null, null] },
    bass: { pattern: [[0, 2], 0, [0, 1], 0, [7, 2], 0, 0, [0, 1], [0, 2], 0, [0, 1], 0, [7, 1], 0, [12, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0],
      hat: [0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0.45],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    lead: {
      length: 128,
      notes: [[0, 74, 8], [8, 78, 4], [12, 79, 12], [28, 81, 4], [32, 76, 8], [40, 73, 8], [48, 74, 16], [64, 71, 8], [72, 74, 8], [80, 79, 12], [92, 81, 4], [96, 78, 8], [104, 76, 8], [112, 74, 16]],
    },
    sections: [
      { name: 'seed', bars: 8, layers: ['pad', 'bell'] },
      { name: 'shoot', bars: 8, layers: ['pad', 'bell', 'arp', 'kick'], arpDensity: 8 },
      { name: 'canopy', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.5 },
      { name: 'dew', bars: 8, layers: ['pad', 'bell', 'lead', 'arp'], arpDensity: 8, arpOctave: 12 },
      { name: 'canopy2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.6 },
    ],
    loopFrom: 1,
  },

  observatory: {
    key: 'C# minor',
    title: 'Observatory Heights (Astronomer Theme)',
    bpm: 76,
    fx: { reverb: 0.98, delay: 0.5, feedback: 0.66, tone: 1900, delayBeats: 1 },
    pad: { attack: 3, release: 4, lfoRate: 0.05, lfoDepth: 300, cutoff: 380, detune: 18, q: 2 },
    progression: [
      { chord: [61, 64, 68, 75], pad: [37, 49, 56, 63, 64], bass: 25, bars: 4 }, // C#m(add9), and it stays
      { chord: [57, 61, 64, 68], pad: [45, 52, 57, 61, 68], bass: 33, bars: 2 }, // Amaj7
      { chord: [59, 63, 66, 71], pad: [47, 54, 59, 63, 66], bass: 35, bars: 2 }, // B
    ],
    arp: { octave: 12, gate: 1, wave: 'triangle', delay: 0.6, reverb: 0.45, pattern: [0, null, 3, null, 5, null, 2, null, 4, null, 1, null, 3, null, 0, null] },
    bell: { octave: 24, ring: 16, pattern: [0, null, null, null, null, null, null, null, 3, null, null, null, null, null, null, null] },
    bass: { pattern: [[0, 8], 0, 0, 0, 0, 0, 0, 0, [0, 6], 0, 0, 0, 0, 0, [-5, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0],
      hat: [0, 0, 0, 0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    lead: {
      length: 128,
      notes: [[0, 73, 16], [20, 76, 12], [32, 80, 16], [52, 78, 12], [64, 76, 16], [84, 75, 12], [96, 73, 20], [120, 68, 8]],
    },
    sections: [
      { name: 'dome', bars: 8, layers: ['pad', 'bell'] },
      { name: 'aperture', bars: 8, layers: ['pad', 'bell', 'arp'] },
      { name: 'parallax', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat'], padBright: 0.2 },
      { name: 'horizon', bars: 8, layers: ['pad', 'lead', 'bell'] },
      { name: 'parallax2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.3 },
    ],
    loopFrom: 1,
  },

  carnival: {
    key: 'B-flat major',
    title: 'Carnival of Echoes (Ringmaster Theme)',
    bpm: 100,
    fx: { reverb: 0.75, delay: 0.6, feedback: 0.55, tone: 3600, delayBeats: 0.75 },
    pad: { attack: 1, release: 1.8, lfoRate: 0.35, lfoDepth: 380, cutoff: 620, detune: 13 },
    progression: [
      { chord: [58, 62, 65, 70], pad: [46, 58, 62, 65, 69], bass: 34, bars: 2 }, // Bbmaj7
      { chord: [55, 58, 62, 65], pad: [43, 55, 58, 62, 65], bass: 31, bars: 2 }, // Gm7
      { chord: [51, 55, 58, 62], pad: [39, 51, 55, 58, 62], bass: 27, bars: 2 }, // Ebmaj7
      { chord: [53, 57, 60, 63], pad: [41, 53, 57, 60, 63], bass: 29, bars: 2 }, // F7
    ],
    arp: { octave: 12, gate: 0.5, wave: 'triangle', delay: 0.45, reverb: 0.2, pattern: [0, 1, 2, 3, 2, 1, 0, 1, 3, 4, 5, 4, 3, 2, 1, 2] },
    bell: { octave: 24, ring: 6, pattern: [0, null, null, 2, null, null, 4, null, null, 2, null, null, 0, null, 3, null] },
    // Oom-pah: the root on the beat, the fifth between.
    bass: { pattern: [[0, 1], 0, [7, 1], 0, [0, 1], 0, [7, 1], 0, [0, 1], 0, [7, 1], 0, [12, 1], 0, [7, 1], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0],
      hat: [0, 0, 0.4, 0, 0, 0, 0.4, 0, 0, 0, 0.4, 0, 0, 0, 0.4, 0],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    lead: {
      length: 128,
      notes: [[0, 77, 4], [4, 79, 4], [8, 81, 8], [16, 82, 12], [28, 81, 4], [32, 79, 8], [40, 74, 8], [48, 77, 16], [64, 75, 4], [68, 77, 4], [72, 79, 8], [80, 82, 8], [88, 86, 8], [96, 84, 8], [104, 81, 8], [112, 77, 16]],
    },
    sections: [
      { name: 'gates', bars: 8, layers: ['pad', 'bell', 'bass'] },
      { name: 'midway', bars: 8, layers: ['pad', 'bell', 'arp', 'bass', 'kick'] },
      { name: 'big top', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.45 },
      { name: 'wheel', bars: 8, layers: ['pad', 'lead', 'bell'] },
      { name: 'big top2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], padBright: 0.55 },
    ],
    loopFrom: 1,
  },

  deep: {
    key: 'F# minor',
    title: 'Deep Relay (Angler Theme)',
    bpm: 72,
    fx: { reverb: 1, delay: 0.5, feedback: 0.7, tone: 1500, delayBeats: 1.5 },
    pad: { attack: 3.2, release: 4.5, lfoRate: 0.04, lfoDepth: 260, cutoff: 340, detune: 20, q: 2.4 },
    progression: [
      { chord: [54, 57, 61, 64], pad: [30, 42, 49, 54, 57], bass: 30, bars: 4 }, // F#m7
      { chord: [50, 54, 57, 61], pad: [38, 45, 50, 54, 61], bass: 26, bars: 2 }, // Dmaj7
      { chord: [49, 53, 56, 61], pad: [37, 44, 49, 53, 56], bass: 25, bars: 2 }, // C#
    ],
    arp: { octave: 12, gate: 1, wave: 'triangle', delay: 0.65, reverb: 0.5, pattern: [0, null, null, 3, null, null, 5, null, 2, null, null, 4, null, null, 1, null] },
    bell: { octave: 12, ring: 16, pattern: [0, null, null, null, null, null, null, null, null, null, null, null, 2, null, null, null] },
    bass: { pattern: [[0, 12], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, [-5, 4], 0, 0, 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0],
      hat: [0, 0, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0, 0, 0.2, 0],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    lead: {
      length: 128,
      notes: [[0, 69, 20], [24, 73, 8], [32, 71, 24], [64, 69, 16], [84, 66, 12], [96, 64, 24], [120, 61, 8]],
    },
    sections: [
      { name: 'cable', bars: 8, layers: ['pad', 'bell'] },
      { name: 'descent', bars: 8, layers: ['pad', 'bell', 'arp'] },
      { name: 'relay', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat'], padBright: 0.1 },
      { name: 'pressure', bars: 8, layers: ['pad', 'lead', 'bass'] },
      { name: 'relay2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.2 },
    ],
    loopFrom: 1,
  },

  folded: {
    key: 'E-flat lydian',
    title: 'Folded City (Cartographer Theme)',
    bpm: 88,
    fx: { reverb: 0.85, delay: 0.66, feedback: 0.6, tone: 3000, delayBeats: 1.5 },
    pad: { attack: 1.8, release: 2.8, lfoRate: 0.1, lfoDepth: 460, cutoff: 500, detune: 14 },
    progression: [
      { chord: [51, 55, 58, 62], pad: [39, 51, 55, 58, 62], bass: 27, bars: 2 }, // Ebmaj7
      { chord: [53, 57, 60, 65], pad: [39, 53, 57, 60, 65], bass: 27, bars: 2 }, // F over Eb: the lydian A
      { chord: [48, 51, 55, 58], pad: [36, 48, 51, 55, 58], bass: 24, bars: 2 }, // Cm7
      { chord: [46, 50, 53, 58], pad: [34, 46, 50, 53, 57], bass: 34, bars: 2 }, // Bb
    ],
    arp: { octave: 12, gate: 0.6, wave: 'triangle', delay: 0.6, reverb: 0.28, pattern: [0, 3, 1, 4, 2, 5, 1, 3, 0, 4, 2, 5, 3, 1, 4, 2] },
    bell: { octave: 24, ring: 10, pattern: [null, null, null, 0, null, null, null, null, null, 2, null, null, null, null, 4, null] },
    bass: { pattern: [[0, 3], 0, 0, [0, 1], 0, 0, [0, 2], 0, [0, 3], 0, 0, [12, 1], 0, 0, [7, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0],
      hat: [0.35, 0, 0.5, 0, 0.35, 0, 0.5, 0, 0.35, 0, 0.5, 0, 0.35, 0, 0.5, 0.3],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    lead: {
      length: 128,
      notes: [[0, 74, 6], [8, 77, 8], [16, 79, 12], [30, 77, 2], [32, 76, 12], [48, 79, 8], [56, 81, 8], [64, 82, 12], [80, 79, 8], [88, 77, 8], [96, 76, 8], [104, 72, 8], [112, 74, 14]],
    },
    sections: [
      { name: 'crease', bars: 8, layers: ['pad', 'bell'] },
      { name: 'fold', bars: 8, layers: ['pad', 'bell', 'arp', 'kick'], arpDensity: 8 },
      { name: 'avenues', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare'], padBright: 0.4 },
      { name: 'upside', bars: 8, layers: ['pad', 'bell', 'lead', 'arp'], arpDensity: 8, arpOctave: 12 },
      { name: 'avenues2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.5 },
    ],
    loopFrom: 1,
  },

  source: {
    key: 'D minor',
    title: 'The Source (Administrator Theme)',
    bpm: 98,
    fx: { reverb: 0.85, delay: 0.55, feedback: 0.55, tone: 3400, delayBeats: 0.75 },
    pad: { attack: 1.6, release: 2.6, lfoRate: 0.12, lfoDepth: 480, cutoff: 560, detune: 12 },
    // Deflector's first progression, the one the Antechamber played: where the Defector came from.
    progression: [
      { chord: [50, 53, 57, 60], pad: [38, 50, 53, 57, 64], bass: 26, bars: 2 }, // Dm7
      { chord: [46, 50, 53, 57], pad: [34, 46, 50, 53, 57], bass: 34, bars: 2 }, // Bbmaj7
      { chord: [53, 57, 60, 64], pad: [41, 53, 57, 60, 64], bass: 29, bars: 2 }, // Fmaj7
      { chord: [48, 52, 55, 62], pad: [36, 48, 52, 55, 62], bass: 24, bars: 2 }, // C(add9)
    ],
    arp: { octave: 12, gate: 0.7, wave: 'triangle', delay: 0.5, reverb: 0.3, pattern: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3] },
    bell: { octave: 24, ring: 12, pattern: [0, null, null, null, null, null, 2, null, null, null, 4, null, null, null, null, null] },
    bass: { pattern: [[0, 2], 0, [0, 1], [0, 1], 0, [0, 1], 0, [0, 1], [0, 2], 0, [0, 1], [0, 1], 0, [12, 1], 0, [0, 1]] },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
      hat: [0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0.4],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    lead: {
      length: 128,
      notes: [[0, 69, 6], [6, 74, 10], [16, 77, 4], [20, 76, 4], [24, 74, 8], [32, 70, 6], [38, 74, 10], [48, 77, 12], [60, 79, 4], [64, 81, 8], [72, 79, 4], [76, 77, 4], [80, 76, 6], [86, 72, 10], [96, 67, 6], [102, 72, 6], [108, 76, 4], [112, 74, 12], [124, 72, 2], [126, 69, 2]],
    },
    sections: [
      { name: 'signal', bars: 8, layers: ['pad', 'bell'] },
      { name: 'carrier', bars: 8, layers: ['pad', 'bell', 'arp', 'kick'], arpDensity: 8 },
      { name: 'source', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.5 },
      { name: 'quiet', bars: 8, layers: ['pad', 'bell', 'lead'] },
      { name: 'source2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], padBright: 0.6 },
    ],
    loopFrom: 1,
  },
};
