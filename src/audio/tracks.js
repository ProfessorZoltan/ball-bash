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

  prism: {
    title: 'Prism Vault (Refractor Theme)',
    bpm: 132,
    progression: [
      { chord: [52, 55, 59], pad: [52, 55, 59, 64], bass: 40, bars: 2 }, // E minor
      { chord: [48, 52, 55], pad: [48, 52, 55, 60], bass: 36, bars: 2 }, // C major
      { chord: [57, 60, 64], pad: [45, 52, 57, 60], bass: 45, bars: 2 }, // A minor
      { chord: [59, 63, 66], pad: [47, 54, 59, 63], bass: 47, bars: 2 }, // B major (the tension chord)
    ],
    arp: {
      octave: 12,
      gate: 0.45,
      // Pulsing root/octave figure that climbs through the chord.
      pattern: [0, 3, 0, 3, 1, 4, 1, 4, 2, 5, 2, 5, 1, 4, 3, 0],
    },
    bass: {
      pattern: [
        [0, 2], 0, [0, 2], 0,
        [0, 1], [12, 1], [0, 2], 0,
        [0, 2], 0, [0, 2], 0,
        [0, 1], [7, 1], [12, 1], [0, 1],
      ],
    },
    drums: {
      // Pushed kick: 1, the "a" of 2, the "and" of 3, 4.
      kick: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.4, 1, 0, 0, 0],
      hat: [0.8, 0.3, 0.5, 0.3, 0.8, 0.3, 0.5, 0.3, 0.8, 0.3, 0.5, 0.3, 0.8, 0.3, 0.5, 0.6],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    lead: {
      length: 128,
      notes: [
        // bar 0-1 (E minor)
        [0, 76, 4], [4, 79, 4], [8, 78, 2], [10, 76, 6],
        [16, 71, 8], [24, 74, 4], [28, 76, 4],
        // bar 2-3 (C)
        [32, 79, 6], [38, 76, 6], [44, 72, 4],
        [48, 74, 8], [56, 76, 8],
        // bar 4-5 (A minor)
        [64, 81, 6], [70, 79, 2], [72, 76, 8],
        [80, 72, 4], [84, 74, 4], [88, 76, 8],
        // bar 6-7 (B major: the D# pulls back to E)
        [96, 78, 6], [102, 75, 6], [108, 71, 4],
        [112, 78, 8], [120, 79, 4], [124, 78, 4],
      ],
    },
    sections: [
      { name: 'intro', bars: 4, layers: ['pad', 'arp'], arpDensity: 8, riser: true },
      { name: 'build', bars: 8, layers: ['pad', 'arp', 'kick', 'bass', 'hat'], fill: true, riser: true },
      { name: 'drop', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
      { name: 'break', bars: 8, layers: ['pad', 'lead', 'arp', 'hat'], arpDensity: 8, arpOctave: 12, riser: true },
      { name: 'drop2', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
    ],
    loopFrom: 1,
  },

  coolant: {
    title: 'Coolant Tunnels (Sump Theme)',
    bpm: 96,
    progression: [
      { chord: [48, 51, 55], pad: [48, 55, 60, 63], bass: 36, bars: 2 }, // C minor
      { chord: [53, 56, 60], pad: [53, 56, 60, 65], bass: 41, bars: 2 }, // F minor
      { chord: [46, 50, 53], pad: [46, 53, 58, 62], bass: 46, bars: 2 }, // Bb major
      { chord: [44, 48, 51], pad: [44, 51, 56, 60], bass: 44, bars: 2 }, // Ab major
    ],
    arp: {
      octave: 12,
      gate: 0.3,
      // Wide leaps with a short gate: "drips" that the delay smears into the dark.
      pattern: [0, 5, 2, 4, 1, 3, 0, 5, 2, 4, 1, 3, 0, 5, 2, 4],
    },
    bass: {
      pattern: [
        [0, 4], 0, 0, 0,
        0, 0, [0, 2], 0,
        [0, 2], 0, 0, [0, 1],
        0, [7, 1], [0, 2], 0,
      ],
    },
    drums: {
      // Half-time: kick on 1 with a pickup, snare on 3, busy hats.
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      hat: [0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.4],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    lead: {
      length: 128,
      notes: [
        // bar 0-1 (C minor)
        [0, 67, 12], [12, 70, 4], [16, 72, 12], [28, 70, 4],
        // bar 2-3 (F minor)
        [32, 68, 8], [40, 65, 8], [48, 72, 12], [60, 68, 4],
        // bar 4-5 (Bb)
        [64, 74, 8], [72, 70, 8], [80, 65, 12], [92, 67, 4],
        // bar 6-7 (Ab)
        [96, 68, 8], [104, 72, 8], [112, 75, 8], [120, 74, 4], [124, 70, 4],
      ],
    },
    sections: [
      { name: 'intro', bars: 4, layers: ['pad', 'arp'], arpDensity: 8, riser: true },
      { name: 'build', bars: 8, layers: ['pad', 'arp', 'kick', 'bass', 'hat'], arpDensity: 8, fill: true, riser: true },
      { name: 'drop', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 0.6 },
      { name: 'break', bars: 8, layers: ['pad', 'lead', 'arp'], arpDensity: 8, arpOctave: 12, riser: true },
      { name: 'drop2', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 0.6 },
    ],
    loopFrom: 1,
  },

  reactor: {
    title: 'Hollow Reactor (Sentinel Theme)',
    bpm: 140,
    progression: [
      { chord: [57, 60, 64], pad: [45, 52, 57, 60], bass: 45, bars: 2 }, // A minor
      { chord: [57, 60, 64], pad: [43, 52, 57, 60], bass: 43, bars: 2 }, // A minor over G
      { chord: [53, 57, 60], pad: [53, 57, 60, 65], bass: 41, bars: 2 }, // F major
      { chord: [52, 56, 59], pad: [52, 56, 59, 64], bass: 40, bars: 2 }, // E major (the leading tone)
    ],
    arp: {
      octave: 12,
      gate: 0.5,
      // Stuttering rise: each chord tone hammered, then the octave.
      pattern: [0, 0, 3, 0, 1, 1, 4, 1, 2, 2, 5, 2, 3, 3, 0, 3],
    },
    bass: {
      pattern: [
        [0, 1], [12, 1], [0, 1], [12, 1],
        [0, 1], [12, 1], [0, 1], [12, 1],
        [0, 1], [12, 1], [0, 1], [12, 1],
        [0, 1], [12, 1], [7, 1], [12, 1],
      ],
    },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.5],
      hat: [0.9, 0.4, 0.6, 0.4, 0.9, 0.4, 0.6, 0.4, 0.9, 0.4, 0.6, 0.4, 0.9, 0.4, 0.6, 0.5],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    lead: {
      length: 128,
      notes: [
        // bar 0-1 (A minor)
        [0, 76, 8], [8, 74, 4], [12, 72, 4], [16, 74, 8], [24, 69, 8],
        // bar 2-3 (A minor / G)
        [32, 72, 6], [38, 71, 2], [40, 72, 8], [48, 76, 12], [60, 74, 4],
        // bar 4-5 (F)
        [64, 77, 8], [72, 76, 4], [76, 74, 4], [80, 72, 8], [88, 69, 8],
        // bar 6-7 (E: the G# pulls home)
        [96, 68, 8], [104, 71, 8], [112, 76, 12], [124, 74, 2], [126, 72, 2],
      ],
    },
    sections: [
      { name: 'intro', bars: 4, layers: ['pad', 'arp'], arpDensity: 8, riser: true },
      { name: 'build', bars: 8, layers: ['pad', 'arp', 'kick', 'bass', 'hat'], fill: true, riser: true },
      { name: 'drop', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
      { name: 'break', bars: 8, layers: ['pad', 'lead', 'arp', 'hat'], arpDensity: 8, arpOctave: 12, riser: true },
      { name: 'drop2', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 1 },
    ],
    loopFrom: 1,
  },

  switchyard: {
    title: 'Switchyard (Shunter Theme)',
    bpm: 128,
    progression: [
      { chord: [55, 58, 62], pad: [43, 50, 55, 58], bass: 43, bars: 2 }, // G minor
      { chord: [48, 51, 55], pad: [48, 55, 60, 63], bass: 36, bars: 2 }, // C minor
      { chord: [50, 54, 57], pad: [50, 57, 62, 66], bass: 38, bars: 2 }, // D major
      { chord: [55, 58, 62], pad: [43, 50, 55, 58], bass: 43, bars: 2 }, // G minor
    ],
    arp: {
      octave: 12,
      gate: 0.4,
      // Chugging root/octave with the third and fifth on the off-beats.
      pattern: [0, 3, 0, 3, 0, 3, 1, 4, 0, 3, 0, 3, 2, 5, 2, 5],
    },
    bass: {
      pattern: [
        [0, 1], 0, [0, 1], 0,
        [0, 1], 0, [0, 1], [7, 1],
        [0, 1], 0, [0, 1], 0,
        [0, 1], [12, 1], [0, 1], 0,
      ],
    },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.4, 1, 0, 0, 0],
      // "Chugga": accents on the beat and the "a".
      hat: [0.9, 0, 0.5, 0.7, 0.9, 0, 0.5, 0.7, 0.9, 0, 0.5, 0.7, 0.9, 0, 0.5, 0.7],
      hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    lead: {
      length: 128,
      notes: [
        // bar 0-1 (G minor)
        [0, 74, 6], [6, 77, 2], [8, 79, 8], [16, 77, 4], [20, 74, 4], [24, 70, 8],
        // bar 2-3 (C minor)
        [32, 72, 8], [40, 75, 4], [44, 72, 4], [48, 79, 12], [60, 77, 4],
        // bar 4-5 (D major: the F# leans home)
        [64, 78, 8], [72, 81, 4], [76, 78, 4], [80, 74, 8], [88, 72, 4], [92, 70, 4],
        // bar 6-7 (G minor)
        [96, 67, 6], [102, 70, 2], [104, 74, 8], [112, 79, 8], [120, 77, 4], [124, 74, 4],
      ],
    },
    sections: [
      { name: 'intro', bars: 4, layers: ['pad', 'arp'], arpDensity: 8, riser: true },
      { name: 'build', bars: 8, layers: ['pad', 'arp', 'kick', 'bass', 'hat'], fill: true, riser: true },
      { name: 'drop', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 0.8 },
      { name: 'break', bars: 8, layers: ['pad', 'lead', 'arp', 'hat'], arpDensity: 8, arpOctave: 12, riser: true },
      { name: 'drop2', bars: 16, layers: ['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab'], fill: true, padBright: 0.8 },
    ],
    loopFrom: 1,
  },
};
