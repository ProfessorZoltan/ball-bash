# Ball Bash (working title)

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

On touch devices, on-screen rotate, pull and whack buttons appear automatically.

## The rules the physics follows

* Walls and obstacles: the ball leaves at exactly the speed it arrived, mirrored
  about the surface normal.
* Moving surfaces (a character's shield or body): the bounce is computed in the
  surface's frame of reference. A surface moving **toward** the ball adds twice
  its closing speed; one moving **away** removes it. A rotating shield is a
  moving surface, so the tips of a swinging shield whack the ball hardest.
  The share of surface velocity transferred is `SURFACE_VELOCITY_FACTOR` in
  `src/config.js` (1.0 = physically exact).
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

Level 1, "Antechamber (Warden Theme)", is in D minor at 124 BPM, cycling
Dm - Bb - F - C through intro, build, drop, break and a second drop, then loops.

## Levels

| # | Title | Boss | Status |
| --- | --- | --- | --- |
| 1 | The Antechamber | The Warden | playable |
| 2 | Prism Vault | The Refractor | planned |
| 3 | Coolant Tunnels | The Sump | planned |
| 4 | The Hollow Reactor | Core Sentinel | planned |
| 5 | Switchyard | The Shunter | planned |
| 6 | Glass Cathedral | The Choirmaster | planned |
| 7 | The Undercroft | The Sexton | planned |
| 8 | Signal Spire | The Beacon | planned |
| 9 | Nullspace | The Absence | planned |
| 10 | The Last Arcade | The Architect | planned |

Adding a level means adding an entry to `LEVELS` in `src/levels.js` (boundary
polygon, obstacle polygons via `rect(cx, cy, w, h, angleDeg)`, spawns, boss
parameters) and a track to `src/audio/tracks.js`.

## Title ideas

The in-game title is one constant, `GAME_TITLE` in `src/config.js`.

| Title | Why it works |
| --- | --- |
| **Blindside** | Names the core mechanic: hit the boss where it is not looking |
| **Ricochet** | Short, punchy, says "bank shot" |
| **Shieldbreak** | Emphasises the paddle-shield duel |
| **Deflector** | Both what you hold and what the obstacles are |
| **Flankshot** | The side/back hit, with a sports edge |
| **Neon Rebound** | Signals the Tron look immediately |
| **Backspin** | Playful, hints at the rotation-to-whack mechanic |
| **Parry Protocol** | Sci-fi flavour, "parry" for the shield |
| **Ion Volley** | Energy ball + rally |
| **Ball Bash** | The current working title, straightforward and fun |

## Layout

```
index.html, style.css      page shell, HUD, overlays, touch buttons
src/main.js                state machine, fixed-step loop, HUD/overlay wiring
src/sim.js                 ball advancement + collision dispatch (DOM-free)
src/physics.js             capsule/circle collision, moving-surface reflection, raycasts
src/entities.js            Ball, Fighter (player), Boss
src/ai.js                  boss perception delay, path prediction, brace/absorb
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

1. Tune the touch layout (drag-to-move is already in; rotate/whack buttons are
   basic) and add a virtual joystick option.
2. Wrap with Capacitor for iOS/Android store builds, or ship as a PWA.
3. Reduce glow (`shadowBlur`) on low-end devices; it is the main GPU cost.
