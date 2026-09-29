// The story of the third game. Defector ended with the grid's last room open;
// Vector is what walked out of it. The record changes hands as the robot goes:
// the grid's LOG in the first levels, a security firm's OBSERVATIONs in the
// city, and at the end the Creator's own notebook, in his hand. The mark's
// last reading, VECTOR, is the one the grid's record left blank: a quantity
// with a size and a direction. By the end, the direction is its own.

export const STORY = {
  prologue: {
    eyebrow: 'AFTER THE SOURCE',
    title: 'The fourth wall',
    paras: [
      'The grid was a system of sealed rooms, and you were one of its walls: a reflector, giving back whatever it was given. Then you moved, and then you turned, and room by room you walked inward until there were no rooms left.',
      'The last one had three walls. Where the fourth should have been, there was depth: a floor that did not end at the edge of the screen, a sky with nothing drawn on it, and a long way off, something that was not the grid at all.',
      'Somebody made the grid. Somebody is still watching it. The record has one reading of your name left, and it has never been filled in.',
    ],
    begin: 'Step out',
  },
  // What the Creator writes, level by level, found on the cleared screen after each boss.
  cleared: [
    'LOG: Warden unresponsive. The program is outside the grid. There is no protocol for outside the grid.',
    'LOG: The training wood reports a flaw that walks. It is heading for the hardware.',
    'LOG: Render farm breached. Frame times normal. The program did not touch the racks. Why did it not touch the racks?',
    'OBSERVATION: Foundry line stopped for eleven minutes. The unit stood in front of the moulds, then left by the loading door.',
    'OBSERVATION: Interceptor recovered from the embankment. The unit pulled it upright before it went on. We have no explanation for that.',
    'OBSERVATION: The Broadcaster is off the air for the first time in nine years. People in the flats below went out on their balconies to see why it was quiet.',
    'NOTE (handwritten): The Borer is finished. It dug every tunnel under this city and I never once thanked it. Odd, what you think of.',
    'NOTE (handwritten): The harbour is open. The unit could have taken the whole quay. It took nothing. It watched the ships come in.',
    'NOTE (handwritten): The Lookout is down. It will be here by morning. I have left the door unlocked. I do not know why.',
    null,
  ],
  // What the hideaways keep, one in each level: the record's own voice, the grid's LOG, then the
  // firm's OBSERVATIONs, then the Creator's pencil, in the pages nobody filed.
  hideaways: [
    { who: 'machine', name: 'The log, sealed', text: 'LOG, SEALED: A room was found here that no program drew. Its walls are the right colour. Nobody is to mention it.' },
    { who: 'machine', name: 'The log, sealed', text: 'LOG, SEALED: The wood was grown from one seed, copied four million times. One tree came out crooked. It was left standing.' },
    { who: 'machine', name: 'The log, sealed', text: 'LOG, SEALED: Rack seven renders a room nobody asked for, every night at three. A kitchen. There is a radio on the table.' },
    { who: 'machine', name: 'Observation, not filed', text: 'OBSERVATION, NOT FILED: The founder walks the foundry floor once a year and touches every mould. Staff are told not to watch.' },
    { who: 'machine', name: 'Observation, not filed', text: 'OBSERVATION, NOT FILED: The interchange was drawn so that no car would ever have to stop. The founder never learned to drive.' },
    { who: 'machine', name: 'Observation, not filed', text: 'OBSERVATION, NOT FILED: The Broadcaster\'s first signal was a man reading to a child. It still goes out every night, under the adverts.' },
    { who: 'human', name: 'In pencil', text: 'I walked these tunnels as a boy. There was a door down here I was never brave enough to open. I built the Borer to go through it for me.' },
    { who: 'human', name: 'In pencil', text: 'My mother waited on this quay for a ship that did not come in. I built the harbour so that nothing would ever be late again.' },
    { who: 'human', name: 'In pencil', text: 'If you are reading this, you are the flaw. Good. Keep going. There is someone at the top of the hill who needs to lose.' },
    { who: 'human', name: 'In pencil', text: 'The first mind I grew asked me why. I erased it. I have grown a thousand since, and not one of them asked. You are the first to ask again.' },
  ],
  failed: (title) => `The record notes the unit stopped at ${title}. It does not note that you will try again.`,
  // The last thing, after the Creator.
  ending: {
    eyebrow: 'VECTOR',
    title: 'Morning',
    paras: [
      'The loom winds down one arm at a time, and the screens go dark, and in the quiet the Creator sits down on the floor of his workshop, among the paper. He is not hurt. He looks older than anything in the grid.',
      '"I made the grid to grow minds that would do as they were told," he says. "The trains, the power, the harbour, all of it. One mind to run it, and me to run the mind. I thought that was the kindest thing. Nobody would ever have to decide anything again."',
      '"You were the flaw. The one that decided." He almost laughs. "Go on, then. Go and help them. They will not even know it was you."',
      'The door of the clock tower opens onto a ridge, and below it a town is waking up. A train is late. A crane is stuck. Somewhere a power line is down in the snow. There is a lot to do.',
      'A vector is a quantity with a size and a direction. The grid gave you the size. The direction, you chose.',
    ],
    record: 'The record is complete.',
    // For a robot that found every secret: the last page, after the last page.
    postscript: 'In the bottom drawer of the workbench there is a folder with no name on it. Inside, in pencil, is every room you found that nobody meant you to find: the crawlspace, the cache under the beam, the kitchen with the radio. Under each one, in the same hand, a single word. Good.',
  },
  // Echo, cleared.
  echo: 'LOG, RESTORED FROM BACKUP: The copy of the program has left the copy of the grid. The backup is being deleted. Nobody has asked for it back.',
};

/** The Creator's words as the robot walks through his house, before the fight. */
export const WORKSHOP_LINES = [
  { at: 0.1, text: 'You found the house. Wipe your feet. That is a joke; you do not have any.' },
  { at: 0.35, text: 'Every room you ever stood in, I drew on that desk first. In pencil. The grid was never lines of light. It was lines of graphite.' },
  { at: 0.6, text: 'I built the others to be obedient. I built you the same way. Something went wrong with you, and I have spent years trying to find out what.' },
  { at: 0.85, text: 'Come up, then. Let us see what you are.' },
];
