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
  },
};

/** The Creator's words as the robot walks through his house, before the fight. */
export const WORKSHOP_LINES = [
  { at: 0.1, text: 'You found the house. Wipe your feet. That is a joke; you do not have any.' },
  { at: 0.35, text: 'Every room you ever stood in, I drew on that desk first. In pencil. The grid was never lines of light. It was lines of graphite.' },
  { at: 0.6, text: 'I built the others to be obedient. I built you the same way. Something went wrong with you, and I have spent years trying to find out what.' },
  { at: 0.85, text: 'Come up, then. Let us see what you are.' },
];
