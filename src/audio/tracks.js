// Soundtrack definitions, one per level. Everything here is data that the
// engine in engine.js turns into sound at runtime.
//
// Format
//  bpm          base tempo (the engine scales it with the ball speed)
//  progression  chord loop: `chord` = arpeggio/stab tones (midi), `pad` = pad
//               voicing, `bass` = bass root, `bars` = length
//  arp          16-step index pattern into [r, 3, 5, r+12, 3+12, 5+12]
//  bass         16-step pattern of [semitone offset from root, length in steps]
//  drums        16-step velocity patterns
//  lead         melody as [step, midi, lengthInSteps] over `length` steps
//  sections     song structure; each names the active layers
//  loopFrom     section index the song loops back to after the last section

export const TRACKS = {
  antechamber: {
    title: 'Antechamber (Warden Theme)',
    bpm: 124,
    progression: [
      { chord: [50, 53, 57], pad: [50, 53, 57, 62], bass: 38, bars: 2 }, // D minor
      { chord: [46, 50, 53], pad: [46, 50, 53, 58], bass: 34, bars: 2 }, // Bb major
      { chord: [53, 57, 60], pad: [53, 57, 60, 65], bass: 41, bars: 2 }, // F major
      { chord: [48, 52, 55], pad: [48, 52, 55, 60], bass: 36, bars: 2 }, // C major
    ],
    arp: {
      octave: 12,
      gate: 0.55,
      pattern: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3],
    },
    bass: {
      pattern: [
        [0, 2], 0, [0, 1], [0, 1],
        0, [0, 1], 0, [0, 1],
        [0, 2], 0, [0, 1], [0, 1],
        0, [12, 1], 0, [0, 1],
      ],
    },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0.5, 0, 0.9, 0, 0.5, 0, 0.9, 0, 0.5, 0, 0.9, 0, 0.5, 0, 0.9, 0.6],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    lead: {
      length: 128,
      notes: [
        // bar 0-1  (D minor)
        [0, 69, 6], [6, 74, 10],
        [16, 77, 4], [20, 76, 4], [24, 74, 8],
        // bar 2-3  (Bb)
        [32, 70, 6], [38, 74, 10],
        [48, 77, 12], [60, 79, 4],
        // bar 4-5  (F)
        [64, 81, 8], [72, 79, 4], [76, 77, 4],
        [80, 76, 6], [86, 72, 10],
        // bar 6-7  (C)
        [96, 67, 6], [102, 72, 6], [108, 76, 4],
        [112, 74, 12], [124, 72, 2], [126, 69, 2],
      ],
    },
    sections: [
      { name: 'intro', bars: 8, layers: ['pad', 'arp'], arpDensity: 8, riser: true },
      { name: 'build', bars: 8, layers: ['pad', 'arp', 'kick', 'bass', 'hat'], fill: true, riser: true },
      { name: 'drop', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
      { name: 'break', bars: 8, layers: ['pad', 'lead', 'arp'], arpDensity: 8, arpOctave: 12, riser: true },
      { name: 'drop2', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
    ],
    loopFrom: 1,
  },
};
