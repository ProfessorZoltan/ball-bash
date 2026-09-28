// Vector's soundtrack: the title, one track per level, the Creator's fight
// and the ending. The format is Deflector's (src/audio/tracks.js has every
// field the engine reads), played by VectorAudio (./audio.js), which adds:
//
//  humanity   0 to 1: how far from the grid the music has come. It picks each
//             voice's timbre when `voices` doesn't, fades the kick's pump, and
//             adds a player's timing and touch to the human voices
//  voices     { pad, pad2, arp, bell, bass, lead, counter, stab, riser, strum,
//             drums, kick, snare, hat }: a timbre per slot (VOICES in audio.js);
//             'synth' is the engine's own. A section may override them too
//  bossTempo  how much bossTime(true) speeds the track: 2 on the grid, 1.5 in
//             the middle, 1.25 near the end, 1 for the Creator's own piece
//  pump       how deep the synth kick ducks the pads, 0 to 1 (else by humanity)
//  swing      how late the odd sixteenths fall, in steps; `shuffle` the same
//             for the off-beat eighths
//  ambience   { kind: level }: a bed under the music (AMBIENCE in audio.js)
//  arp.vel, arp.ring, bell.vel
//             a played arpeggio's touch, and how many steps its notes ring
//  counter    a second melody, like `lead`, on its own voice ('counter' layer)
//  strum      16-step strokes for the guitar, + down and - up ('strum' layer),
//             of each chord's `guitar` voicing (or its `chord`)
//  perc       { name: 16-step velocities }: hand percussion ('perc' layer)
//  pad2       a second pad over the chords, a choir by default ('pad2' layer),
//             { vowel } one of VOWELS in audio.js
//
// The journey: the first levels are Deflector's own sound, saw arpeggios and
// pumping pads; kalimba, marimba and metal creep in; then electric piano and
// hand drums; then strings, guitar and brushes; and the Creator's house is
// all piano, strings and a ticking clock. The last room of the grid and the
// Creator's workshop share a harmony (A minor falling through F and C to E):
// the grid was written there.

const ZERO = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const VECTOR_TRACKS = {
  vector: {
    key: 'F# minor',
    title: 'Vector (Title)',
    bpm: 84,
    humanity: 0.5,
    bossTempo: 1.5,
    // The title is half grid and half people, so the grid still pumps.
    pump: 0.6,
    fx: { reverb: 0.9, delay: 0.55, feedback: 0.55, tone: 3200, delayBeats: 1.5, room: 0.3 },
    pad: { attack: 2, release: 3, lfoRate: 0.08, lfoDepth: 380, cutoff: 480, detune: 13 },
    voices: { pad: 'synth', arp: 'synth', bell: 'synth', bass: 'synth', lead: 'synth', counter: 'piano', drums: 'synth' },
    progression: [
      { chord: [54, 57, 61, 68], pad: [42, 54, 61, 64, 68], bass: 42, bars: 2 }, // F#m9
      { chord: [50, 54, 57, 61], pad: [38, 50, 57, 61, 66], bass: 38, bars: 2 }, // Dmaj7
      { chord: [57, 61, 64, 66], pad: [45, 57, 61, 64, 66], bass: 45, bars: 2 }, // A6
      { chord: [56, 59, 64, 66], pad: [44, 56, 59, 64, 68], bass: 44, bars: 2 }, // E/G#
    ],
    arp: { octave: 12, gate: 0.8, wave: 'triangle', delay: 0.5, reverb: 0.3, pattern: [0, 2, 4, 6, 3, 5, 7, 5, 0, 2, 4, 6, 1, 3, 5, 3] },
    bell: { octave: 24, ring: 14, pattern: [0, null, null, null, null, null, 2, null, null, null, 1, null, null, null, null, null] },
    bass: { pattern: [[0, 6], 0, 0, 0, 0, 0, [12, 2], 0, [0, 4], 0, 0, 0, [7, 2], 0, [12, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0],
      hat: [0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0, 0.35, 0],
      hatOpen: ZERO,
    },
    // The grid calls; two bars later the piano answers it.
    lead: {
      length: 128,
      notes: [[0, 73, 4], [4, 78, 4], [8, 80, 4], [12, 81, 8], [20, 80, 4], [24, 76, 8], [64, 76, 4], [68, 81, 4], [72, 83, 4], [76, 85, 8], [84, 83, 4], [88, 81, 8]],
    },
    counter: {
      length: 128,
      notes: [[32, 74, 4], [36, 78, 4], [40, 81, 6], [46, 80, 2], [48, 78, 8], [56, 73, 8], [96, 80, 6], [102, 83, 2], [104, 80, 4], [108, 78, 4], [112, 76, 8], [120, 73, 8]],
    },
    sections: [
      { name: 'grid', bars: 8, layers: ['pad', 'arp', 'bell', 'lead'], arpDensity: 8 },
      { name: 'answer', bars: 8, layers: ['pad', 'arp', 'bell', 'lead', 'counter'], arpDensity: 8 },
      { name: 'both', bars: 16, layers: ['pad', 'arp', 'bell', 'kick', 'bass', 'hat', 'snare', 'lead', 'counter'], padBright: 0.3, voices: { pad: 'strings', bass: 'pluck' } },
      // The machine's own phrase, played on the piano: it has learned.
      { name: 'one', bars: 8, layers: ['pad', 'lead', 'counter', 'bass'], voices: { pad: 'strings', lead: 'piano', bass: 'upright' } },
    ],
    loopFrom: 1,
  },

  edge: {
    key: 'A minor',
    title: 'Edge of the Grid (Warden Theme)',
    bpm: 104,
    humanity: 0,
    bossTempo: 2,
    // The grid's last room opens onto depth: the biggest hall on the soundtrack.
    fx: { reverb: 0.95, delay: 0.5, feedback: 0.5, tone: 3800, delayBeats: 0.75 },
    pad: { attack: 1.4, release: 2.4, lfoRate: 0.11, lfoDepth: 520, cutoff: 540, detune: 12 },
    progression: [
      { chord: [57, 60, 64], pad: [45, 57, 60, 64, 71], bass: 33, bars: 2 }, // Am(add9)
      { chord: [53, 57, 60], pad: [41, 53, 57, 60, 67], bass: 29, bars: 2 }, // F
      { chord: [55, 60, 64], pad: [36, 48, 55, 60, 64], bass: 36, bars: 2 }, // C
      { chord: [55, 59, 62], pad: [43, 55, 59, 62, 69], bass: 31, bars: 1 }, // G
      { chord: [56, 59, 64], pad: [40, 52, 56, 59, 64], bass: 28, bars: 1 }, // E: the pull back home
    ],
    arp: { octave: 12, gate: 0.5, pattern: [0, 3, 1, 4, 2, 5, 1, 4, 0, 3, 2, 5, 4, 1, 3, 5] },
    bell: { octave: 24, ring: 10, pattern: [null, null, null, null, 0, null, null, null, null, null, null, null, 2, null, null, null] },
    bass: { pattern: [[0, 2], 0, [12, 1], [0, 1], [0, 2], 0, [12, 1], [7, 1], [0, 2], 0, [12, 1], [0, 1], [0, 1], [12, 1], [7, 1], [12, 1]] },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0.4, 0.2, 0.8, 0.2, 0.4, 0.2, 0.8, 0.2, 0.4, 0.2, 0.8, 0.2, 0.4, 0.2, 0.8, 0.5],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    lead: {
      length: 128,
      notes: [
        [0, 76, 6], [6, 81, 6], [12, 83, 4], [16, 84, 8], [24, 83, 4], [28, 79, 4],
        [32, 81, 12], [44, 77, 4], [48, 76, 4], [52, 77, 4], [56, 81, 8],
        [64, 79, 6], [70, 84, 6], [76, 88, 4], [80, 86, 8], [88, 84, 4], [92, 83, 4],
        [96, 83, 8], [104, 86, 8], [112, 83, 8], [120, 80, 8],
      ],
    },
    sections: [
      { name: 'void', bars: 8, layers: ['pad', 'arp', 'bell'], arpDensity: 8, riser: true },
      { name: 'floor', bars: 8, layers: ['pad', 'arp', 'bell', 'kick', 'bass', 'hat'], fill: true, riser: true },
      { name: 'depth', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
      { name: 'horizon', bars: 8, layers: ['pad', 'bell', 'lead', 'arp'], arpDensity: 8, arpOctave: 12, riser: true },
      { name: 'depth2', bars: 16, layers: ['pad', 'arp', 'bell', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
    ],
    loopFrom: 1,
    ambience: { hum: 0.5 },
  },

  wilds: {
    key: 'D dorian',
    title: 'Wireframe Wilds (Stag Theme)',
    bpm: 92,
    humanity: 0.1,
    bossTempo: 2,
    fx: { reverb: 0.85, delay: 0.6, feedback: 0.55, tone: 3000, delayBeats: 0.75 },
    pad: { attack: 1.8, release: 2.6, lfoRate: 0.09, lfoDepth: 420, cutoff: 500, detune: 12 },
    // The first sound that isn't a synthesiser: a kalimba, plucked somewhere in the wire trees.
    voices: { bell: 'kalimba' },
    // Climbing the dorian steps, i ii III IV, like a path uphill through the trees.
    progression: [
      { chord: [50, 53, 57, 64], pad: [38, 50, 57, 60, 64], bass: 38, bars: 2 }, // Dm9
      { chord: [52, 55, 59, 62], pad: [40, 52, 59, 62, 67], bass: 40, bars: 2 }, // Em7
      { chord: [53, 57, 60, 64], pad: [41, 53, 57, 64, 67], bass: 41, bars: 2 }, // Fmaj7
      { chord: [55, 59, 62, 64], pad: [43, 55, 59, 64, 69], bass: 43, bars: 2 }, // G6: the dorian B
    ],
    arp: { octave: 12, gate: 0.6, wave: 'triangle', delay: 0.55, reverb: 0.25, ring: 4, pattern: [0, null, 2, 4, null, 3, 5, null, 1, null, 4, 6, null, 2, 7, null] },
    bell: { octave: 12, ring: 10, vel: 0.7, pattern: [0, null, null, 2, null, null, 1, null, 3, null, null, 2, null, null, 4, null] },
    // Three, three, two: the stag's gait.
    bass: { pattern: [[0, 3], 0, 0, [0, 3], 0, 0, [7, 2], 0, [0, 3], 0, 0, [12, 3], 0, 0, [7, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0],
      hat: [0.35, 0, 0.2, 0, 0.35, 0, 0.2, 0.15, 0.35, 0, 0.2, 0, 0.35, 0, 0.2, 0.15],
      hatOpen: ZERO,
    },
    lead: {
      length: 128,
      notes: [
        [0, 69, 4], [4, 72, 4], [8, 74, 8], [16, 76, 6], [22, 74, 2], [24, 72, 4], [28, 69, 4],
        [32, 71, 8], [40, 67, 4], [44, 71, 4], [48, 74, 12], [60, 72, 4],
        [64, 72, 4], [68, 76, 4], [72, 79, 8], [80, 77, 6], [86, 76, 2], [88, 72, 8],
        [96, 74, 8], [104, 71, 4], [108, 74, 4], [112, 76, 12], [124, 74, 4],
      ],
    },
    sections: [
      { name: 'canopy', bars: 8, layers: ['pad', 'bell'] },
      { name: 'river', bars: 8, layers: ['pad', 'bell', 'arp', 'hat'] },
      { name: 'wilds', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead'], padBright: 0.35 },
      // In the clearing the arpeggio is plucked too.
      { name: 'clearing', bars: 8, layers: ['pad', 'arp', 'bass', 'bell'], voices: { arp: 'kalimba' } },
      { name: 'wilds2', bars: 16, layers: ['pad', 'bell', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], padBright: 0.45 },
    ],
    loopFrom: 1,
    ambience: { stream: 0.5, data: 0.6 },
  },

  farm: {
    key: 'C minor',
    title: 'Render Farm (Scheduler Theme)',
    bpm: 112,
    humanity: 0.22,
    bossTempo: 2,
    fx: { reverb: 0.6, delay: 0.45, feedback: 0.45, tone: 3600, delayBeats: 0.75, room: 0.2 },
    pad: { attack: 1.2, release: 2, lfoRate: 0.14, lfoDepth: 420, cutoff: 560, detune: 10 },
    // Racks computing the grid: a marimba running sixteenths like a process
    // that never ends, over a pedal C, and a long slow tune on top.
    voices: { pad: 'synth', arp: 'marimba', bell: 'synth', bass: 'synth', lead: 'synth', drums: 'synth' },
    progression: [
      { chord: [48, 51, 55, 62], pad: [36, 48, 55, 58, 62], bass: 36, bars: 2 }, // Cm(add9)
      { chord: [48, 51, 56, 60], pad: [36, 48, 56, 60, 63], bass: 36, bars: 2 }, // Ab over C
      { chord: [48, 53, 56, 63], pad: [41, 53, 56, 60, 63], bass: 41, bars: 2 }, // Fm7
      { chord: [50, 53, 55, 60], pad: [43, 50, 55, 60, 65], bass: 43, bars: 1 }, // G7sus4
      { chord: [50, 53, 55, 59], pad: [43, 50, 53, 59, 62], bass: 43, bars: 1 }, // G7
    ],
    arp: { octave: 12, gate: 0.9, ring: 2, vel: 0.6, pattern: [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 6, 1, 3, 5, 7] },
    bell: { octave: 24, ring: 8, pattern: [null, null, null, 3, null, null, null, null, null, null, null, 1, null, null, null, null] },
    bass: { pattern: [[0, 2], 0, [0, 2], 0, [12, 2], 0, [0, 2], 0, [0, 2], 0, [0, 2], 0, [12, 2], 0, [7, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0],
      hat: [0.5, 0.2, 0.3, 0.2, 0.5, 0.2, 0.3, 0.2, 0.5, 0.2, 0.3, 0.2, 0.5, 0.2, 0.3, 0.2],
      hatOpen: ZERO,
    },
    // Relays clicking over, never quite in time with the music.
    perc: { tick: [0.5, 0, 0, 0.3, 0, 0.4, 0, 0, 0.5, 0, 0.3, 0, 0, 0, 0.4, 0] },
    lead: {
      length: 128,
      notes: [[0, 75, 16], [16, 74, 16], [32, 72, 24], [56, 70, 8], [64, 68, 16], [80, 72, 16], [96, 74, 12], [108, 72, 4], [112, 74, 16]],
    },
    sections: [
      { name: 'boot', bars: 8, layers: ['pad', 'arp'], arpDensity: 8 },
      { name: 'racks', bars: 8, layers: ['pad', 'arp', 'kick', 'hat', 'perc'] },
      { name: 'compute', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'perc'], padBright: 0.4 },
      { name: 'cooling', bars: 8, layers: ['pad', 'arp', 'bell', 'bass'], arpDensity: 8 },
      { name: 'compute2', bars: 16, layers: ['pad', 'arp', 'bell', 'kick', 'bass', 'hat', 'snare', 'lead', 'perc', 'stab'], padBright: 0.5 },
    ],
    loopFrom: 1,
    ambience: { fans: 0.8 },
  },

  foundry: {
    key: 'D phrygian',
    title: 'The Foundry (Forgewright Theme)',
    bpm: 96,
    humanity: 0.35,
    bossTempo: 1.5,
    fx: { reverb: 0.7, delay: 0.4, feedback: 0.45, tone: 2600, delayBeats: 0.75, room: 0.3 },
    pad: { attack: 1, release: 1.8, lfoRate: 0.2, lfoDepth: 300, cutoff: 460, detune: 10 },
    // Where the robot's body was made: an anvil on the backbeat, a press for a
    // kick, hand drums round them, and still a synth bass underneath.
    voices: { pad: 'warm', arp: 'synth', bass: 'synth', lead: 'glide', bell: 'glock', drums: 'factory' },
    progression: [
      { chord: [50, 53, 57], pad: [38, 50, 57, 62, 65], bass: 38, bars: 2 }, // Dm
      { chord: [51, 55, 58], pad: [39, 51, 58, 63, 67], bass: 39, bars: 2 }, // Eb: the phrygian step
      { chord: [50, 53, 57], pad: [38, 50, 53, 57, 62], bass: 38, bars: 2 }, // Dm
      { chord: [50, 53, 58], pad: [34, 50, 53, 58, 62], bass: 34, bars: 1 }, // Bb
      { chord: [49, 52, 57], pad: [33, 49, 52, 57, 64], bass: 33, bars: 1 }, // A
    ],
    arp: { octave: 12, gate: 0.4, pattern: [0, null, 0, 3, null, 0, 2, null, 0, null, 0, 3, null, 1, 2, null] },
    bell: { octave: 24, ring: 6, vel: 0.5, pattern: [0, null, null, null, null, null, null, null, null, null, 1, null, null, null, null, null] },
    bass: { pattern: [[0, 1], [0, 1], 0, [12, 1], 0, [0, 1], [7, 1], 0, [0, 1], [0, 1], 0, [12, 1], 0, [7, 1], [0, 1], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.4],
      hat: [0.5, 0, 0.3, 0, 0.5, 0, 0.3, 0.2, 0.5, 0, 0.3, 0, 0.5, 0, 0.3, 0.2],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    perc: {
      conga: [0, 0, 0.5, 0, 0, 0.4, 0, 0.6, 0, 0, 0.5, 0, 0, 0.4, 0.6, 0],
      bongo: [0, 0.3, 0, 0, 0.35, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0.35],
    },
    lead: {
      length: 128,
      notes: [
        [0, 74, 6], [6, 75, 2], [8, 74, 4], [12, 72, 4], [16, 69, 12], [28, 70, 4],
        [32, 70, 6], [38, 72, 2], [40, 75, 8], [48, 74, 4], [52, 72, 4], [56, 70, 8],
        [64, 69, 4], [68, 74, 4], [72, 77, 8], [80, 74, 4], [84, 72, 4], [88, 74, 8],
        [96, 77, 6], [102, 74, 2], [104, 70, 8], [112, 73, 8], [120, 76, 4], [124, 73, 4],
      ],
    },
    sections: [
      { name: 'furnace', bars: 8, layers: ['pad', 'perc', 'bass'] },
      { name: 'anvil', bars: 8, layers: ['pad', 'perc', 'kick', 'snare', 'bass', 'bell'] },
      { name: 'forge', bars: 16, layers: ['pad', 'perc', 'kick', 'snare', 'hat', 'bass', 'arp', 'lead', 'bell'], padBright: 0.3, fill: true },
      // Quenched: the hammering stops and a marimba cools in the steam.
      { name: 'quench', bars: 8, layers: ['pad', 'bell', 'arp', 'hat'], arpDensity: 8, voices: { arp: 'marimba' } },
      { name: 'forge2', bars: 16, layers: ['pad', 'perc', 'kick', 'snare', 'hat', 'bass', 'arp', 'lead', 'bell', 'stab'], padBright: 0.4, fill: true },
    ],
    loopFrom: 1,
    ambience: { furnace: 0.7 },
  },

  freeway: {
    key: 'F minor',
    title: 'Night Freeway (Interceptor Theme)',
    bpm: 100,
    humanity: 0.45,
    bossTempo: 1.5,
    swing: 0.06,
    fx: { reverb: 0.6, delay: 0.5, feedback: 0.5, tone: 3000, delayBeats: 0.75, room: 0.25 },
    pad: { attack: 1.2, release: 2, lfoRate: 0.1, lfoDepth: 300, cutoff: 600, detune: 9 },
    // Half a kit: a real kick and snare, the grid's hats still ticking over them.
    voices: { pad: 'warm', arp: 'epiano', bass: 'pluck', lead: 'glide', bell: 'vibes', kick: 'kit', snare: 'kit', hat: 'synth' },
    progression: [
      { chord: [56, 60, 63, 67], pad: [41, 56, 60, 63, 67], bass: 41, bars: 2 }, // Fm9
      { chord: [53, 56, 60, 63], pad: [37, 53, 56, 60, 65], bass: 37, bars: 2 }, // Dbmaj9
      { chord: [49, 53, 56, 60], pad: [34, 49, 53, 56, 60], bass: 34, bars: 2 }, // Bbm9
      { chord: [53, 55, 58, 60], pad: [36, 53, 55, 58, 60], bass: 36, bars: 1 }, // C7sus4
      { chord: [52, 55, 58, 61], pad: [36, 52, 55, 58, 61], bass: 36, bars: 1 }, // C7(b9)
    ],
    arp: { octave: 12, gate: 0.9, ring: 3, vel: 0.55, pattern: [0, null, null, 2, null, null, 1, null, null, 3, null, null, 2, null, 4, null] },
    bell: { octave: 12, ring: 12, vel: 0.45, pattern: [null, null, null, null, null, null, null, null, 4, null, null, null, null, null, null, null] },
    bass: { pattern: [[0, 2], 0, [0, 1], [12, 1], 0, [0, 1], [7, 2], 0, [0, 2], 0, [0, 1], [12, 1], 0, [7, 1], [0, 1], [12, 1]] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0.4, 0.25, 0.6, 0.25, 0.4, 0.25, 0.6, 0.25, 0.4, 0.25, 0.6, 0.25, 0.4, 0.25, 0.6, 0.25],
      hatOpen: ZERO,
    },
    perc: { tamb: [0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0.2] },
    lead: {
      length: 128,
      notes: [
        [0, 72, 4], [4, 75, 4], [8, 79, 6], [14, 77, 2], [16, 75, 8], [24, 72, 4], [28, 70, 4],
        [32, 72, 8], [40, 77, 4], [44, 75, 4], [48, 72, 8], [56, 68, 8],
        [64, 73, 6], [70, 72, 2], [72, 70, 8], [80, 68, 4], [84, 70, 4], [88, 73, 8],
        [96, 72, 6], [102, 70, 2], [104, 67, 8], [112, 70, 4], [116, 73, 4], [120, 76, 4], [124, 79, 4],
      ],
    },
    sections: [
      { name: 'onramp', bars: 8, layers: ['pad', 'bass', 'hat'] },
      { name: 'overpass', bars: 8, layers: ['pad', 'arp', 'bass', 'kick', 'hat'] },
      { name: 'freeway', bars: 16, layers: ['pad', 'arp', 'bass', 'kick', 'snare', 'hat', 'lead', 'perc'], padBright: 0.3 },
      // Under the sodium lights the tune goes to the vibraphone.
      { name: 'sodium', bars: 8, layers: ['pad', 'arp', 'bell', 'lead'], voices: { lead: 'vibes' } },
      { name: 'freeway2', bars: 16, layers: ['pad', 'arp', 'bass', 'kick', 'snare', 'hat', 'lead', 'perc', 'bell'], padBright: 0.4 },
    ],
    loopFrom: 1,
    ambience: { traffic: 0.7 },
  },

  rain: {
    key: 'E-flat major',
    title: 'Rain City (Broadcaster Theme)',
    bpm: 76,
    humanity: 0.55,
    bossTempo: 1.5,
    swing: 0.16,
    fx: { reverb: 0.75, delay: 0.5, feedback: 0.5, tone: 2400, delayBeats: 1.5, room: 0.35 },
    pad: { attack: 1.6, release: 2.6, lfoRate: 0.1, lfoDepth: 300, cutoff: 460, detune: 12 },
    voices: { pad: 'warm', arp: 'epiano', bass: 'pluck', lead: 'vibes', bell: 'synth', drums: 'brushes' },
    // A ballad's changes, lazily swung: the city's jazz, played to an empty rooftop.
    progression: [
      { chord: [55, 58, 62, 65], pad: [39, 55, 58, 62, 65], bass: 39, bars: 2 }, // Ebmaj9
      { chord: [56, 60, 62, 65], pad: [38, 53, 56, 60, 65], bass: 38, bars: 1 }, // Dm7b5
      { chord: [53, 56, 59, 62], pad: [43, 53, 56, 59, 62], bass: 43, bars: 1 }, // G7b9
      { chord: [51, 55, 58, 62], pad: [36, 51, 55, 58, 62], bass: 36, bars: 2 }, // Cm9
      { chord: [55, 58, 60, 63], pad: [44, 55, 58, 60, 63], bass: 44, bars: 1 }, // Abmaj9
      { chord: [51, 55, 56, 60], pad: [34, 51, 55, 56, 60], bass: 34, bars: 1 }, // Bb13sus
    ],
    arp: { octave: 12, gate: 1, ring: 6, vel: 0.5, pattern: [0, null, null, 2, null, null, null, 1, null, null, 3, null, null, null, null, null] },
    bell: { octave: 24, ring: 16, pattern: [null, null, null, null, null, null, null, null, null, null, 2, null, null, null, null, null] },
    bass: { pattern: [[0, 6], 0, 0, 0, 0, 0, [7, 2], 0, [0, 3], 0, 0, [12, 1], 0, 0, [7, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0.5, 0, 0, 0, 0.6, 0, 0, 0.35, 0.5, 0, 0, 0, 0.6, 0, 0, 0.35],
      hatOpen: ZERO,
    },
    perc: { swish: [0.35, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0] },
    lead: {
      length: 128,
      notes: [
        [0, 70, 3], [3, 74, 3], [6, 77, 6], [12, 75, 4], [16, 74, 10], [28, 72, 4],
        [32, 72, 4], [36, 68, 4], [40, 65, 6], [46, 67, 2], [48, 71, 8], [56, 74, 4], [60, 72, 4],
        [64, 70, 12], [76, 67, 4], [80, 74, 6], [86, 72, 2], [88, 70, 8],
        [96, 72, 6], [102, 70, 2], [104, 67, 8], [112, 68, 6], [118, 65, 2], [120, 70, 8],
      ],
    },
    sections: [
      { name: 'drizzle', bars: 8, layers: ['pad', 'arp', 'perc'] },
      { name: 'rooftops', bars: 8, layers: ['pad', 'arp', 'bass', 'snare', 'hat', 'perc'] },
      { name: 'downpour', bars: 16, layers: ['pad', 'arp', 'bass', 'kick', 'snare', 'hat', 'lead', 'perc'], padBright: 0.25 },
      // The last neon signs: for eight bars the grid's own voices come back.
      { name: 'last neon', bars: 8, layers: ['pad', 'bell', 'lead', 'bass'], voices: { pad: 'synth', lead: 'synth' } },
      { name: 'downpour2', bars: 16, layers: ['pad', 'arp', 'bass', 'kick', 'snare', 'hat', 'lead', 'perc', 'bell'], padBright: 0.35 },
    ],
    loopFrom: 1,
    ambience: { rain: 0.8, hum: 0.25 },
  },

  underline: {
    key: 'B minor',
    title: 'Underline (Borer Theme)',
    bpm: 104,
    humanity: 0.66,
    bossTempo: 1.25,
    shuffle: 0.3,
    fx: { reverb: 0.55, delay: 0.3, feedback: 0.4, tone: 2200, delayBeats: 0.75, room: 0.5 },
    // A trio on the platform: an upright bass walking, a kit, and a cello over them.
    voices: { pad: 'strings', arp: 'piano', bass: 'upright', lead: 'cello', bell: 'none', drums: 'kit' },
    progression: [
      { chord: [54, 57, 59, 62], pad: [47, 54, 57, 62], bass: 35, bars: 2 }, // Bm7
      { chord: [55, 59, 62, 64], pad: [52, 55, 59, 62], bass: 40, bars: 2 }, // Em7
      { chord: [57, 61, 64, 66], pad: [54, 57, 61, 64], bass: 42, bars: 2 }, // F#m7
      { chord: [55, 59, 62, 64], pad: [52, 55, 62, 64], bass: 40, bars: 1 }, // Em7
      { chord: [52, 58, 61, 66], pad: [54, 58, 61, 64], bass: 42, bars: 1 }, // F#7
    ],
    arp: { octave: 12, gate: 0.8, ring: 3, vel: 0.5, pattern: [null, null, 3, null, null, null, 1, null, null, null, 2, null, null, null, 0, null] },
    bass: { pattern: [[0, 4], 0, 0, 0, [7, 4], 0, 0, 0, [10, 4], 0, 0, 0, [7, 2], 0, [5, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.25],
      hat: [0.5, 0, 0.3, 0, 0.6, 0, 0.3, 0.2, 0.5, 0, 0.3, 0, 0.6, 0, 0.3, 0.2],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    perc: {
      rim: [0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0],
      shaker: [0.3, 0.15, 0.25, 0.15, 0.3, 0.15, 0.25, 0.15, 0.3, 0.15, 0.25, 0.15, 0.3, 0.15, 0.25, 0.15],
    },
    lead: {
      length: 128,
      notes: [
        [0, 62, 6], [6, 61, 2], [8, 62, 4], [12, 66, 4], [16, 69, 10], [26, 67, 2], [28, 66, 4],
        [32, 64, 8], [40, 67, 4], [44, 71, 4], [48, 69, 6], [54, 67, 2], [56, 66, 4], [60, 64, 4],
        [64, 61, 6], [70, 64, 2], [72, 69, 8], [80, 68, 4], [84, 69, 4], [88, 73, 8],
        [96, 71, 6], [102, 69, 2], [104, 67, 8], [112, 70, 4], [116, 73, 4], [120, 70, 4], [124, 66, 4],
      ],
    },
    sections: [
      { name: 'platform', bars: 8, layers: ['bass', 'perc', 'pad'] },
      { name: 'doors', bars: 8, layers: ['bass', 'perc', 'kick', 'hat', 'arp', 'pad'] },
      { name: 'express', bars: 16, layers: ['bass', 'kick', 'snare', 'hat', 'arp', 'pad', 'lead'], fill: true },
      { name: 'station', bars: 8, layers: ['bass', 'lead', 'arp'] },
      { name: 'express2', bars: 16, layers: ['bass', 'kick', 'snare', 'hat', 'arp', 'pad', 'lead', 'perc'], fill: true },
    ],
    loopFrom: 1,
    ambience: { tunnel: 0.7, drips: 0.5 },
  },

  harbour: {
    key: 'D major',
    title: 'Harbour at Dawn (Gantry Theme)',
    bpm: 88,
    humanity: 0.78,
    bossTempo: 1.25,
    shuffle: 0.25,
    fx: { reverb: 0.8, delay: 0.35, feedback: 0.4, tone: 2800, delayBeats: 1.5, room: 0.35 },
    // A shanty at first light: guitar, a squeezebox, a frame drum and strings.
    voices: { pad: 'strings', arp: 'guitar', bass: 'upright', lead: 'reed', counter: 'violin', bell: 'harp', drums: 'hand' },
    progression: [
      { chord: [50, 57, 62, 64], guitar: [50, 57, 62, 66], pad: [38, 50, 57, 62, 66], bass: 38, bars: 2 }, // D(add9)
      { chord: [54, 57, 61, 64], guitar: [42, 49, 52, 57, 61, 66], pad: [42, 54, 57, 61, 64], bass: 42, bars: 2 }, // F#m7
      { chord: [55, 59, 62, 66], guitar: [43, 47, 50, 55, 59, 66], pad: [43, 55, 59, 62, 66], bass: 43, bars: 2 }, // Gmaj7
      { chord: [57, 62, 64, 69], guitar: [45, 52, 57, 62, 64], pad: [45, 57, 62, 64, 69], bass: 45, bars: 1 }, // Asus4
      { chord: [57, 61, 64, 69], guitar: [45, 52, 57, 61, 64], pad: [45, 57, 61, 64, 69], bass: 45, bars: 1 }, // A
    ],
    arp: { octave: 12, gate: 1, ring: 6, vel: 0.6, pattern: [0, null, 2, null, 1, null, 3, null, 0, null, 2, 5, 1, null, 3, null] },
    bell: { octave: 24, ring: 16, vel: 0.4, pattern: [0, null, null, null, null, null, null, null, null, null, 1, null, null, null, null, null] },
    strum: { pattern: [1, 0, 0, 0, 0.8, 0, -0.6, 0, 0, 0, -0.6, 0, 0.8, 0, -0.6, 0] },
    bass: { pattern: [[0, 4], 0, 0, 0, 0, 0, [7, 2], 0, [0, 4], 0, 0, 0, [7, 2], 0, [12, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0],
      hat: [0.4, 0, 0.25, 0.15, 0.4, 0, 0.25, 0.15, 0.4, 0, 0.25, 0.15, 0.4, 0, 0.25, 0.15],
      hatOpen: ZERO,
    },
    perc: { tamb: [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0] },
    lead: {
      length: 128,
      notes: [
        [0, 69, 4], [4, 74, 4], [8, 74, 2], [10, 76, 2], [12, 78, 4], [16, 76, 6], [22, 74, 2], [24, 69, 8],
        [32, 69, 4], [36, 73, 4], [40, 76, 8], [48, 73, 4], [52, 71, 4], [56, 69, 8],
        [64, 71, 4], [68, 74, 4], [72, 78, 6], [78, 76, 2], [80, 74, 8], [88, 71, 8],
        [96, 74, 8], [104, 76, 4], [108, 74, 4], [112, 73, 8], [120, 76, 4], [124, 73, 4],
      ],
    },
    counter: {
      length: 128,
      notes: [[0, 78, 16], [16, 76, 16], [32, 76, 16], [48, 73, 16], [64, 74, 16], [80, 78, 16], [96, 76, 16], [112, 73, 16]],
    },
    sections: [
      { name: 'mooring', bars: 8, layers: ['arp'] },
      { name: 'tide', bars: 8, layers: ['arp', 'bass', 'pad', 'hat'] },
      { name: 'harbour', bars: 16, layers: ['strum', 'bass', 'kick', 'snare', 'hat', 'pad', 'lead', 'perc'] },
      { name: 'cranes', bars: 8, layers: ['arp', 'counter', 'pad', 'bell'] },
      { name: 'harbour2', bars: 16, layers: ['strum', 'bass', 'kick', 'snare', 'hat', 'pad', 'lead', 'counter', 'perc'] },
    ],
    loopFrom: 1,
    ambience: { water: 0.7, gulls: 0.6 },
  },

  ridge: {
    key: 'E minor',
    title: 'Pine Ridge (Lookout Theme)',
    bpm: 80,
    humanity: 0.9,
    bossTempo: 1.25,
    // Outdoors: a wide sky and almost no walls.
    fx: { reverb: 0.95, delay: 0.4, feedback: 0.45, tone: 2600, delayBeats: 1.5, room: 0.2 },
    voices: { pad: 'strings', arp: 'guitar', bass: 'upright', lead: 'flute', counter: 'cello', bell: 'glock', drums: 'brushes' },
    // Open guitar shapes, with a string or two left ringing through the changes.
    progression: [
      { chord: [52, 59, 64, 66], pad: [40, 52, 59, 64, 67], bass: 40, bars: 2 }, // Em(add9)
      { chord: [48, 55, 59, 64], pad: [36, 48, 55, 59, 64], bass: 36, bars: 2 }, // Cmaj7
      { chord: [47, 55, 59, 62], pad: [35, 47, 55, 62, 67], bass: 35, bars: 2 }, // G/B
      { chord: [45, 52, 55, 60], pad: [45, 52, 55, 60, 64], bass: 33, bars: 1 }, // Am7
      { chord: [50, 54, 57, 62], pad: [38, 50, 57, 62, 66], bass: 38, bars: 1 }, // D
    ],
    // Travis picking: the thumb alternating on the beat, the fingers between.
    arp: { octave: 12, gate: 1, ring: 5, vel: 0.62, pattern: [0, null, 3, null, 1, 5, 2, null, 0, null, 3, 6, 1, null, 2, null] },
    bell: { octave: 24, ring: 12, vel: 0.3, pattern: [null, null, null, null, null, null, 3, null, null, null, null, null, null, null, 1, null] },
    bass: { pattern: [[0, 6], 0, 0, 0, 0, 0, [7, 2], 0, [0, 6], 0, 0, 0, 0, 0, [7, 2], 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
      hat: [0.3, 0, 0.2, 0, 0.3, 0, 0.2, 0, 0.3, 0, 0.2, 0, 0.3, 0, 0.2, 0],
      hatOpen: ZERO,
    },
    perc: { shaker: [0.25, 0.1, 0.2, 0.1, 0.25, 0.1, 0.2, 0.1, 0.25, 0.1, 0.2, 0.1, 0.25, 0.1, 0.2, 0.1] },
    lead: {
      length: 128,
      notes: [
        [0, 71, 8], [8, 74, 4], [12, 76, 4], [16, 79, 12], [28, 78, 4],
        [32, 76, 8], [40, 74, 4], [44, 71, 4], [48, 72, 10], [58, 71, 2], [60, 67, 4],
        [64, 71, 6], [70, 74, 2], [72, 79, 8], [80, 78, 4], [84, 74, 4], [88, 71, 8],
        [96, 72, 6], [102, 71, 2], [104, 69, 8], [112, 74, 4], [116, 78, 4], [120, 76, 8],
      ],
    },
    counter: {
      length: 128,
      notes: [[0, 59, 16], [16, 62, 16], [32, 60, 16], [48, 59, 16], [64, 59, 16], [80, 62, 16], [96, 60, 16], [112, 57, 16]],
    },
    sections: [
      { name: 'switchback', bars: 8, layers: ['arp'] },
      { name: 'pines', bars: 8, layers: ['arp', 'pad', 'bass'] },
      { name: 'ridge', bars: 16, layers: ['arp', 'pad', 'bass', 'lead', 'kick', 'snare', 'hat', 'perc'] },
      // In the snow somebody whistles the tune.
      { name: 'snowfall', bars: 8, layers: ['pad', 'counter', 'bell', 'lead'], voices: { lead: 'whistle' } },
      { name: 'ridge2', bars: 16, layers: ['arp', 'pad', 'bass', 'lead', 'counter', 'kick', 'snare', 'hat', 'perc', 'bell'] },
    ],
    loopFrom: 1,
    ambience: { wind: 0.8 },
  },

  workshop: {
    key: 'A minor',
    title: 'The Workshop (Lamplight)',
    // Sixty to the minute, so the clock on the wall keeps the music's time.
    bpm: 60,
    humanity: 1,
    bossTempo: 1.25,
    fx: { reverb: 0.6, delay: 0.25, feedback: 0.35, tone: 2200, delayBeats: 1, room: 0.55 },
    voices: { pad: 'strings', arp: 'piano', bass: 'piano', lead: 'cello', counter: 'violin', bell: 'musicbox' },
    // The Edge of the Grid's harmony, where it was first written: A minor,
    // down through F and C, and the E that turns back home.
    progression: [
      { chord: [57, 60, 64, 71], pad: [45, 52, 57, 60, 64], bass: 45, bars: 2 }, // Am(add9)
      { chord: [53, 57, 60, 64], pad: [41, 53, 57, 64], bass: 41, bars: 2 }, // Fmaj7
      { chord: [52, 55, 60, 64], pad: [40, 52, 55, 60, 67], bass: 40, bars: 2 }, // C/E
      { chord: [50, 53, 57, 60], pad: [38, 50, 53, 57, 60], bass: 38, bars: 1 }, // Dm7
      { chord: [56, 59, 62, 65], pad: [40, 52, 56, 62, 65], bass: 40, bars: 1 }, // E7(b9)
    ],
    arp: { octave: 12, gate: 1, ring: 8, vel: 0.45, pattern: [null, null, 1, null, 2, null, 3, null, null, null, 2, null, 4, null, null, null] },
    bell: { octave: 24, ring: 16, vel: 0.35, pattern: [0, null, null, null, null, null, null, null, null, null, null, null, 2, null, null, null] },
    bass: { pattern: [[0, 6], 0, 0, 0, 0, 0, 0, 0, [7, 4], 0, 0, 0, [12, 4], 0, 0, 0] },
    lead: {
      length: 128,
      notes: [
        [0, 64, 12], [12, 67, 4], [16, 71, 12], [28, 69, 4],
        [32, 69, 8], [40, 67, 4], [44, 64, 4], [48, 65, 16],
        [64, 67, 8], [72, 72, 8], [80, 71, 12], [92, 67, 4],
        [96, 69, 12], [108, 72, 4], [112, 71, 12], [124, 68, 4],
      ],
    },
    counter: {
      length: 128,
      notes: [[0, 76, 16], [16, 74, 8], [24, 72, 8], [32, 72, 16], [48, 76, 16], [64, 79, 16], [80, 76, 16], [96, 77, 12], [108, 76, 4], [112, 74, 8], [120, 71, 8]],
    },
    sections: [
      { name: 'lamplight', bars: 8, layers: ['arp', 'bass', 'bell'] },
      { name: 'papers', bars: 8, layers: ['arp', 'bass', 'pad', 'lead'] },
      { name: 'workshop', bars: 16, layers: ['arp', 'bass', 'pad', 'lead', 'counter'], padBright: 0.2 },
      { name: 'blueprint', bars: 8, layers: ['bell', 'pad', 'lead'] },
      { name: 'workshop2', bars: 16, layers: ['arp', 'bass', 'pad', 'lead', 'counter', 'bell'], padBright: 0.3 },
    ],
    loopFrom: 1,
    ambience: { clock: 0.8, room: 0.6 },
  },

  creator: {
    key: 'D minor',
    title: 'The Loom (Creator Theme)',
    bpm: 126,
    humanity: 1,
    // The Creator's fight is its own piece: it doesn't hurry, it was always this fast.
    bossTempo: 1,
    fx: { reverb: 0.9, delay: 0.3, feedback: 0.35, tone: 2600, delayBeats: 0.75, room: 0.3 },
    voices: { pad: 'strings', pad2: 'choir', arp: 'piano', bass: 'arco', lead: 'violin', counter: 'cello', stab: 'piano', riser: 'roll', drums: 'orch' },
    pad2: { vowel: 'aah' },
    // Deflector's home key, where the grid began.
    progression: [
      { chord: [50, 53, 57, 62], pad: [38, 50, 57, 62, 65], bass: 38, bars: 2 }, // Dm
      { chord: [50, 53, 58, 62], pad: [34, 50, 53, 58, 62], bass: 34, bars: 1 }, // Bb
      { chord: [48, 52, 55, 60], pad: [36, 48, 55, 60, 64], bass: 36, bars: 1 }, // C
      { chord: [50, 55, 58, 62], pad: [43, 50, 55, 58, 62], bass: 31, bars: 1 }, // Gm
      { chord: [51, 55, 58, 63], pad: [39, 51, 55, 58, 63], bass: 39, bars: 1 }, // Eb: the Neapolitan's shadow
      { chord: [52, 55, 57, 61], pad: [33, 45, 52, 55, 61], bass: 33, bars: 2 }, // A7
    ],
    // A toccata: the hands alternating against the octave above, without a breath.
    arp: { octave: 12, gate: 1, ring: 2, vel: 0.5, pattern: [0, 4, 3, 4, 1, 4, 3, 4, 2, 4, 3, 4, 1, 4, 3, 4] },
    bass: { pattern: [[0, 8], 0, 0, 0, 0, 0, 0, 0, [0, 4], 0, 0, 0, [7, 4], 0, 0, 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0.4, 0, 0.3, 0, 0.4, 0, 0.3, 0.3, 0.4, 0, 0.3, 0, 0.4, 0.3, 0.3, 0.3],
      hatOpen: ZERO,
    },
    lead: {
      length: 128,
      notes: [
        [0, 74, 8], [8, 77, 8], [16, 76, 4], [20, 74, 4], [24, 73, 4], [28, 74, 4],
        [32, 77, 8], [40, 74, 8], [48, 79, 8], [56, 76, 8],
        [64, 82, 12], [76, 81, 4], [80, 79, 8], [88, 75, 8],
        [96, 76, 8], [104, 73, 8], [112, 69, 8], [120, 73, 4], [124, 76, 4],
      ],
    },
    counter: {
      length: 128,
      notes: [[0, 62, 16], [16, 65, 8], [24, 64, 8], [32, 62, 16], [48, 64, 16], [64, 62, 16], [80, 63, 16], [96, 61, 16], [112, 64, 16]],
    },
    sections: [
      { name: 'the loom', bars: 8, layers: ['pad', 'pad2', 'bass'], riser: true },
      { name: 'the rig', bars: 8, layers: ['pad', 'arp', 'bass', 'kick', 'hat'], riser: true },
      { name: 'creator', bars: 16, layers: ['pad', 'pad2', 'arp', 'bass', 'kick', 'snare', 'hat', 'lead', 'stab'], fill: true, padBright: 0.5 },
      // The robot says no: the orchestra drops away to a choir and a cello.
      { name: 'refusal', bars: 8, layers: ['pad2', 'counter', 'arp'], arpDensity: 8 },
      { name: 'creator2', bars: 16, layers: ['pad', 'pad2', 'arp', 'bass', 'kick', 'snare', 'hat', 'lead', 'counter', 'stab'], fill: true, padBright: 0.7 },
    ],
    loopFrom: 1,
    ambience: { hum: 0.4 },
  },

  ending: {
    key: 'D major',
    title: 'Morning (Ending)',
    bpm: 72,
    humanity: 1,
    bossTempo: 1,
    fx: { reverb: 0.95, delay: 0.3, feedback: 0.4, tone: 2600, delayBeats: 1.5, room: 0.4 },
    voices: { pad: 'strings', pad2: 'choir', arp: 'piano', bass: 'piano', lead: 'piano', counter: 'cello', bell: 'harp' },
    pad2: { vowel: 'ooh' },
    // The Creator's D minor, made major: the bass stepping down a scale, one chord a bar.
    progression: [
      { chord: [50, 54, 57, 62], pad: [38, 50, 57, 62, 66], bass: 38, bars: 1 }, // D
      { chord: [49, 52, 57, 61], pad: [37, 49, 57, 61, 64], bass: 37, bars: 1 }, // A/C#
      { chord: [47, 54, 57, 62], pad: [35, 47, 54, 62, 66], bass: 35, bars: 1 }, // Bm7
      { chord: [45, 54, 57, 61], pad: [33, 45, 54, 57, 61], bass: 33, bars: 1 }, // F#m/A
      { chord: [43, 55, 59, 66], pad: [31, 43, 55, 59, 66], bass: 31, bars: 1 }, // Gmaj7
      { chord: [42, 54, 57, 62], pad: [30, 42, 54, 57, 62], bass: 30, bars: 1 }, // D/F#
      { chord: [40, 55, 59, 62], pad: [28, 40, 55, 59, 62], bass: 28, bars: 1 }, // Em7
      { chord: [45, 55, 57, 62], pad: [33, 45, 55, 57, 64], bass: 33, bars: 1 }, // A7sus4
    ],
    arp: { octave: 12, gate: 1, ring: 6, vel: 0.42, pattern: [1, null, 2, null, 3, null, 5, null, 6, null, 5, null, 3, null, 2, null] },
    bell: { octave: 24, ring: 16, vel: 0.35, pattern: [null, null, null, null, null, null, null, null, 1, null, null, null, null, null, null, null] },
    bass: { pattern: [[0, 8], 0, 0, 0, 0, 0, 0, 0, [7, 8], 0, 0, 0, 0, 0, 0, 0] },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0],
      snare: ZERO,
      hat: ZERO,
      hatOpen: ZERO,
    },
    perc: { shaker: [0.2, 0, 0.12, 0, 0.2, 0, 0.12, 0, 0.2, 0, 0.12, 0, 0.2, 0, 0.12, 0.08] },
    lead: {
      length: 128,
      notes: [
        [0, 78, 6], [6, 76, 2], [8, 74, 8],
        [16, 76, 6], [22, 74, 2], [24, 73, 8],
        [32, 74, 6], [38, 73, 2], [40, 71, 4], [44, 74, 4],
        [48, 73, 12], [60, 69, 4],
        [64, 71, 6], [70, 74, 2], [72, 79, 8],
        [80, 78, 6], [86, 76, 2], [88, 74, 8],
        [96, 76, 4], [100, 79, 4], [104, 83, 8],
        [112, 81, 12], [124, 79, 4],
      ],
    },
    // The cello sings the bass line an octave up: the whole scale, walking down into the day.
    counter: {
      length: 128,
      notes: [[0, 62, 16], [16, 61, 16], [32, 59, 16], [48, 57, 16], [64, 55, 16], [80, 54, 16], [96, 55, 16], [112, 57, 16]],
    },
    sections: [
      { name: 'first light', bars: 8, layers: ['arp', 'bass', 'lead'] },
      { name: 'morning', bars: 8, layers: ['arp', 'bass', 'lead', 'pad'] },
      { name: 'the world', bars: 16, layers: ['arp', 'bass', 'pad', 'pad2', 'lead', 'counter', 'bell'], padBright: 0.3, voices: { lead: 'violin', bass: 'upright' } },
      // Voices take the tune.
      { name: 'hush', bars: 8, layers: ['arp', 'pad2', 'lead'], voices: { lead: 'voice' } },
      { name: 'the world2', bars: 16, layers: ['arp', 'bass', 'pad', 'pad2', 'lead', 'counter', 'bell', 'kick', 'perc'], padBright: 0.4, voices: { lead: 'violin', bass: 'upright', drums: 'brushes' } },
    ],
    loopFrom: 1,
    ambience: { birds: 0.6, wind: 0.2 },
  },
};

/** The level tracks in campaign order, 1 to 10. */
export const LEVEL_TRACKS = ['edge', 'wilds', 'farm', 'foundry', 'freeway', 'rain', 'underline', 'harbour', 'ridge', 'workshop'];
