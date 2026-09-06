# [<R/D>EF(L)/V]ECTOR

Spoken name: **Deflector**. The written mark is a small grammar: `<R/D>` pick
one, `(L)` optional, and the slash inside the square brackets chooses between
the whole left branch and `V`. It reads as REFLECTOR, DEFLECTOR, DEFECTOR or
VECTOR, and the title screen cycles through those readings.

A Pong-inspired arena game for browser and PC, built to move to mobile later.
An energy ball ricochets around a sealed neon room. You carry a paddle shield;
so does the boss. The ball only counts when it hits the boss's **body**, and the
boss's shield covers its front, so you bank shots off walls and angled
deflectors to strike from the side or behind. One hit clears the level.

No build step, no dependencies: plain ES modules, Canvas 2D and Web Audio.

## Run it

```bash
npm start            # serves http://localhost:8080
# or: python3 -m http.server 8080
npm test             # headless physics tests (node --test)
```

Open the URL in a desktop browser and press **Start**. (ES modules need `http://`,
so opening `index.html` straight from disk will not work.)

## Deploy

It is a static site, so Vercel (or Netlify, GitHub Pages) needs no build step:
import the repo, keep the framework preset on **Other**, leave the build command
empty, and serve the repository root. `server.js` is only for local use.

## Controls

| Action | Keys / pointer |
| --- | --- |
| Move | Arrow keys, or hold the mouse button / drag a finger toward where you want to go |
| Rotate character and shield | **A** (counter-clockwise) / **D** (clockwise) |
| Thrust the shield forward ("whack") | **W** or **Space** |
| Pull the shield in (soft return, slows the ball) | **S** |
| Pause / mute / restart | **P** / **M** / **R** |

On touch devices, touch anywhere on the arena and drag: the first touch becomes
a floating joystick and the drag direction steers, so your finger never has to
cover the character. Rotate, pull and whack buttons appear while a level is
running. **F** or the ⛶ button toggles fullscreen where the browser allows it;
iPhones have no fullscreen API for web pages, so use Share → Add to Home Screen,
which launches the game chrome-free thanks to `manifest.webmanifest`.

## The rules the physics follows

* Walls and obstacles: the ball leaves at exactly the speed it arrived, mirrored
  about the surface normal.
* Moving surfaces (a character's shield or body): the bounce is computed in the
  surface's frame of reference. A surface moving **toward** the ball adds
  speed; one moving **away** removes it. A rotating shield is a moving
  surface, so the tips of a swinging shield whack the ball hardest. The share
  of surface velocity transferred is `SURFACE_VELOCITY_FACTOR` in
  `src/config.js`: 1.0 is physically exact (twice the closing speed). The
  speed-up is tuned to 0.7 of that; the slow-down from a retreating surface
  stays at 1.0.
* During the launch countdown you can turn to aim but not move.
* The ball is clamped between a minimum and a maximum speed so it never stalls
  and never tunnels through a wall. Physics runs at a fixed 240 Hz.
* Every arena is a closed polygon; `test/physics.test.js` fires the ball at the
  maximum speed for two simulated minutes and asserts it never leaves the room.
* One hit on your body loses the level, just as one hit on the boss's body
  wins it. (`PLAYER.lives` in `src/config.js` if you ever want more.)

## Bosses

Each level's boss is a data block in `src/levels.js`:

| Parameter | Meaning |
| --- | --- |
| `r` | body size |
| `paddleWidth`, `paddleBase` | shield size and how far it is held out |
| `moveSpeed`, `turnSpeed` | movement and rotation limits |
| `reaction` | seconds of perception delay; the boss also only re-plans this often |
| `aggression` | chance it whacks an arriving ball |
| `aim` | 0 = just block, 1 = angle the shield to return the ball at you |
| `absorb`, `absorbSpeed` | chance it pulls its shield back to slow a hot ball |
| `threatRadius`, `leash` | how far it looks and how far it roams from home |

The boss predicts the ball's path (including wall bounces, so it also sees a
ball that will rebound off the wall behind it), moves onto that path and turns
to face it. To choose its return it scores candidate directions by how much open
space they cross, how close they pass to you, and whether they would rebound
back at itself, then tilts its shield to send the ball down the best lane. In
the last quarter second before impact it braces, holding the shield still, so
it cannot accidentally whack the ball at speed into its own walls.

## Music

Every level has its own soundtrack, generated live by `src/audio/engine.js`
from a track definition in `src/audio/tracks.js`. Nothing is sampled: kick,
snare, hats, side-chained pads, a detuned 16th-note arpeggio, a mono bass and a
lead line are all synthesised with oscillators, filters and noise, through a
synthesised reverb and a tempo-synced ping-pong delay.

The tempo follows the ball. Around the level's launch speed the track runs at its
written BPM; a faster ball pushes it up to 1.5x and a slow ball lets it sag to
0.72x, smoothed so each hit reads as a surge. Ball speed also opens the filters
and adds extra hi-hats, so the music brightens as the rally heats up. The HUD
shows the live BPM.

The title screen's **Soundtrack** button opens a jukebox: every level's track,
a play order you arrange yourself, a tempo slider that starts at each track's
own BPM, and one length slider for how long every track runs before the queue
advances. Esc returns to the menu, N skips.

Level 1, "Antechamber (Warden Theme)", is in D minor at 124 BPM, cycling
Dm - Bb - F - C through intro, build, drop, break and a second drop, then loops.
Level 2, "Prism Vault (Refractor Theme)", is in E minor at 132 BPM over
Em - C - Am - B, with a pulsing root/octave arpeggio and a pushed kick pattern.
Level 3, "Coolant Tunnels (Sump Theme)", is a half-time track in C minor at
96 BPM over Cm - Fm - Bb - Ab, with a short-gate "dripping" arpeggio.
Level 4, "Hollow Reactor (Sentinel Theme)", is A minor at 140 BPM over a
descending A - G - F - E bass, with a hammered stutter arpeggio.
Level 5, "Switchyard (Shunter Theme)", is G minor at 128 BPM over
Gm - Cm - D - Gm, with a chugging root/octave arpeggio and "chugga" hats.
Level 6, "Glass Cathedral (Choirmaster Theme)", is B minor at 118 BPM over
Bm - Em - A - F#, with a bell-like high/low arpeggio and long bass notes.

## Levels

| # | Title | Boss | Status |
| --- | --- | --- | --- |
| 1 | The Antechamber | The Warden | playable |
| 2 | Prism Vault | The Refractor | playable |
| 3 | Coolant Tunnels | The Sump | playable |
| 4 | The Hollow Reactor | Core Sentinel | playable |
| 5 | Switchyard | The Shunter | playable |
| 6 | Glass Cathedral | The Choirmaster | playable |
| 7 | The Undercroft | The Sexton | planned |
| 8 | Signal Spire | The Beacon | planned |
| 9 | Nullspace | The Absence | planned |
| 10 | The Last Arcade | The Architect | planned |

Level 2 introduces a moving obstacle: a prism bar spinning at the centre of the
vault. It is a moving surface like a paddle, so its tips add or remove ball
speed depending on which way they are travelling when the ball lands. Neither
the guide line nor the boss's path prediction accounts for it, so shots through
the centre are gambles and bank shots around the sides are the reliable play.

Level 3 is the first cave: an irregular outline, two chambers joined by two
tunnels through a rock divide, and "breathing" pistons that slide into the
tunnels on a slow cycle (a sliding slab is a moving surface too, so a closing
piston whacks the ball). The Sump is slow and huge with a strong absorb, and
every ball it blocks lays an ice trail for two seconds; each piece of ice melts
two seconds after it was laid. Touch the ice and you freeze for two seconds,
and you cannot be re-frozen until you have stepped off it. The Sump is immune.
All of those numbers live on the level's `ice` entry.

Level 4 is an elliptical ring chamber around a core. Four shield plates orbit
the core as one rigid rotation (moving surfaces again), and Core Sentinel's
home position patrols an ellipse instead of staying put, so its back keeps
swinging toward you as it passes. A boss orbit is declared on its `orbit`
entry.

Level 5 is a rail yard: three lanes divided by thin rails, two gaps in each
rail, and sliding doors (pistons in their `parallel` orientation) that close
the gaps on staggered seven-second cycles, so the open route to the Shunter's
flank keeps changing. The Shunter runs the lanes fast but turns slowly.

Level 6 introduces breakable stained glass. Obstacles marked `glass: true`
reflect a slow ball like any wall, but a ball at or above the level's
`glass.breakSpeed` smashes through, keeping `speedKeep` of its speed; the pane
reglazes after `glass.regrow` seconds (waiting if something is standing in it).
The guide line sees through glass once the ball is fast enough to break it.
The Choirmaster sits in an apse behind a curved screen of panes.

Adding a level means adding an entry to `LEVELS` in `src/levels.js` (boundary
polygon, obstacle polygons via `rect(cx, cy, w, h, angleDeg)`, optional
`movers`, spawns, boss parameters) and a track to `src/audio/tracks.js`. The
title screen lists every built level and lets you pick one.

## Name

The mark, its readings and the spoken name live in `src/config.js`
(`GAME_MARK`, `MARK_READINGS`, `GAME_NAME`). The page title, manifest and
home-screen icon use the spoken name; the title screen renders the mark.

## Layout

```
index.html, style.css      page shell, HUD, overlays, touch buttons
src/main.js                state machine, fixed-step loop, HUD/overlay wiring
src/sim.js                 ball advancement + collision dispatch (DOM-free)
src/physics.js             capsule/circle collision, moving-surface reflection, raycasts
src/entities.js            Ball, Fighter (player), Boss
src/ai.js                  boss perception delay, path prediction, brace/absorb
src/ice.js                 ice trail hazard (Coolant Tunnels)
src/levels.js              level data and the planned roster
src/input.js               keyboard, mouse, touch -> one intent object
src/render.js              Canvas 2D neon renderer with 2.5D wall extrusion
src/fx.js                  particles, rings, screen shake
src/audio/engine.js        Web Audio synths, sequencer, tempo-follow, SFX
src/audio/tracks.js        per-level track definitions
test/physics.test.js       node --test suite
server.js                  zero-dependency static server
```

## Mobile roadmap

The game logic never touches events directly, and the renderer scales the level
to any viewport, so the mobile build is mostly input and packaging:

1. Tune the touch layout further (the floating joystick and buttons are in;
   a two-thumb layout with rotation on a second stick is the next candidate).
2. Wrap with Capacitor for iOS/Android store builds; the manifest and icons
   already make it installable as a PWA.
3. Reduce glow (`shadowBlur`) on low-end devices if the FPS readout drops.
