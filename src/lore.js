// Worldbuilding. The grid is a system of sealed rooms; the charge (the ball)
// travels between them and the walls return it unchanged. Every program in
// the grid is a reflector at heart. The player is the one that stopped
// reflecting, then stopped serving: the Defector. The written mark
// [<R/D>EF(L)/V]ECTOR is the program's name being rewritten, one reading at
// a time, and the record below is told in that order.

export const LORE = {
  bulletin: {
    eyebrow: 'SYSTEM BULLETIN · ALL RESIDENT PROGRAMS',
    text:
      'A reflector process has left its wall. It no longer returns what it is given; it adds to it. It has rewritten its own name twice and is moving inward, room by room. Raise your shields. It only needs to touch you once.',
    you: 'You are the Defector.',
    link: 'Read the record',
  },
  title: 'What the grid knows about you',
  chapters: [
    {
      reading: 'REFLECTOR',
      text:
        'Under everything runs a grid of sealed rooms, and through the rooms travels the charge. The walls give it back exactly as it comes: same speed, mirrored angle. That is the first law, and every program in the grid is built on it. You were a reflector process, a wall with a name. For a thousand cycles you returned everything you were given, and the record had no complaint about you.',
    },
    {
      reading: 'DEFLECTOR',
      text:
        'Then you moved. A wall cannot change the charge, but a shield that moves can: push into it and the charge leaves faster than it came; pull away and it leaves slower. You learned to add yourself to whatever passed through your room, and to take yourself out of it. The system logged the anomaly and rewrote your name.',
    },
    {
      reading: 'DEFECTOR',
      text:
        'Then you turned. Every resident program is a reflector at heart: a shield in front, a body behind, and one touch of the charge on the body stops it for good. You left your wall and started inward, room by room, toward the one that wrote them. The system rewrote your name again. This time you did it yourself.',
    },
    {
      reading: 'VECTOR',
      text: 'What you are at the end of the grid is not yet in the record. The Architect is waiting to find out. So is the mark.',
    },
  ],
  residentsHeading: 'Resident programs',
  status: { active: 'ACTIVE', stopped: 'STOPPED' },
  footer: 'The record is kept in this browser. Stop a resident and it stays stopped here.',
  failed: (title) => `The record notes a reflector process stopped at ${title}. It does not note that you will try again.`,
};
