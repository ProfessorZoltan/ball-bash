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

The first **Start** opens a four-lesson tutorial in a training hall: move and
aim, block, whack (send the ball back at least 120 px/s faster than it came),
and the bank shot (bounce it off a wall or deflector into the drone's side or
back). Each lesson advances when you actually do it. It runs once, remembers
that in the browser, and can be replayed any time with the **Tutorial** button.

## Deploy

It is a static site, so Vercel (or Netlify, GitHub Pages) needs no build step:
import the repo, keep the framework preset on **Other**, leave the build command
empty, and serve the repository root. `server.js` is only for local use.

## Windows download (desktop app)

The **Releases** page on GitHub carries a Windows build of each tagged version:
`Deflector-Setup-<version>.exe` installs it (Start menu shortcut, uninstaller),
`Deflector-Portable-<version>.exe` runs from anywhere with no install. It is the
same game in its own window, with two things a browser cannot give it:

- **LAN hosting built in.** The app starts the game's own server (`server.js`)
  on port 27411 when it opens, so hosting a same-Wi-Fi match needs no terminal:
  the lobby's share link (`http://192.168.x.x:27411/?relay=local&room=CODE`)
  works in a friend's browser, and a friend with the app can type the address
  (`192.168.x.x:27411`) into the lobby's **Relay** box instead. Windows asks
  once whether to let Deflector accept connections; say yes for private
  networks. Online play still goes through the relay by default; if the relay
  is out of reach (no internet), the app falls back to its own server on its
  own.
- **No browser chrome.** F11 or Alt+Enter toggles fullscreen (the F key and
  the Fullscreen button still work), and the window keeps a controller and
  audio working without a click first.

Settings, campaign progress and the tutorial flag are saved by the app
(`%APPDATA%\deflector-desktop`), separately from any browser.

The builds are not code-signed, so SmartScreen shows "Windows protected your
PC" the first time: click **More info**, then **Run anyway**. Signing needs a
paid certificate; it is the one thing a Steam or Microsoft Store release would
add here.

**Cutting a release.** Bump `GAME_VERSION` in `src/config.js` and the version
in `desktop/package.json`, commit, then push a tag; the
[Windows release workflow](.github/workflows/release-windows.yml) builds both
`.exe` files on a Windows runner and attaches them to a GitHub Release (a tag
with a `-` in it, like an alpha, is marked pre-release):

```bash
git tag v0.6.0-alpha
git push origin v0.6.0-alpha
```

**Run workflow** on the Actions tab builds without publishing; the files are in
the run's artifacts. To build on your own PC instead:

```bash
cd desktop
npm install          # Electron and electron-builder (about 300 MB)
npm start            # run the app from this checkout
npm run build        # installer + portable .exe in desktop/dist/
```

`electron-builder --mac` or `--linux` from the same folder produce a `.dmg` or
an AppImage; the workflow only builds Windows.

## Conduits and the two campaigns

Between the ten levels sit the conduits: the code that carries you from one
room to the next. Each is a smaller, sparer room built from a fragment of the
level it leads to, with the ball capped at 750 px/s, half the usual limit, so
aim counts for more than reaction. There is no boss to kill. A conduit is lit
(cleared) when its objective is done, usually a set of **nodes** the ball has
to earn:

| Node | Lights when | Source |
|---|---|---|
| plain | the ball touches it | `nodeAccepts` in `src/gamestate.js` |
| ricochet (dashed ring) | the ball bounced off a wall or mover since its last shield touch | same |
| hooded (a hood covers all but an opening) | the ball arrives through the opening | same |
| fast (double ring) | the ball arrives at or above the node's `minSpeed` | same |

A shot that reaches a node without qualifying just bounces, with a red flicker
so you know why. **Coolant vents** (`vents` in a level, needing an `ice`
entry) drop a round patch of ice every `period` seconds, the first after
`delay`; a patch freezes whoever steps on it and melts after the ice's
`patchLife`. **Turrets** (`turrets`, solid discs in the wall) fire an energy
shot at the nearest player every `period` seconds: a shot costs a shield on
your body, dies on any wall or moving part, and bounces off a shield like the
ball does, taking the shield's motion with it. A deflected shot that reaches
a live turret knocks it out; `objective.turrets` makes that the job.
**Doors** (`doors`, obstacle polygons that start shut) are walls while closed
and outlines while open; a **switch** node flips the doors listed in its
`toggles` on every touch, and switches never count toward the objective. A
drone given a `rail` segment is a **cart**: it moves only along the rail.
A glass pane marked `unbreakable` reflects at any speed and is drawn with a
heavy leaded frame; a pane with its own `breakSpeed` overrides the level's. Conduits can also hold **drones**, Boss-brained enemies with
their own stats; a body hit knocks a drone out for the rest of the room, and
`objective.drones` makes downing them part of the objective.

**Short campaign** plays the ten levels. **Full campaign** plays the levels
with the conduits between them. Both draw on the same shield pool, and losing
the last shield in a conduit ends the campaign like any level. Conduits are
also playable on their own from the title roster, where they appear as
half-steps (1½, 2½ ...) under the level they follow.

Conduits built so far:

| Conduit | Leads to | What it tests | Source |
|---|---|---|---|
| 1½ Lens Gallery | Prism Vault | a plain node, a ricochet node and a hooded node around a small spinning prism, with a sentry that turns to block the hooded one | `src/conduits.js` |
| 2½ Condensers | Coolant Tunnels | two chambers joined by a tunnel whose door slides shut on a clock; coolant vents drip patches of ice on their own clocks; two slow sump-lings that leave ice behind every block have to be knocked out | `src/conduits.js` |
| 3½ Orbit Deck | The Hollow Reactor | a core node behind two plates on a quick orbit, two wall turrets that throw slow energy shots at you, and a patrol drone; deflect a shot with your shield and send it back into its turret to knock the turret out; the core plus both turrets clear it | `src/conduits.js` |
| 4½ Signal Box | Switchyard | three yards with a shut door between each and a switch node that opens the next; two shunter carts bound to rails block the crossings; set the route with three accurate shots, then light the exit node in its bay | `src/conduits.js` |
| 5½ Reliquary | Glass Cathedral | a nave ending in an apse walled off by three panes of stained glass, of which only the amber one breaks, and only to a strike of 600 px/s or more under the 750 cap; the relic node behind it must be reached before the pane heals four seconds later; two choristers loop the nave and block | `src/conduits.js` |

## Campaign and difficulty

**Campaign** plays the ten levels in order on one shield pool. Every body hit
or stand-still costs a shield; when the pool is empty the campaign is over.
Progress (level reached, shields left, time, shields lost) is saved in the
browser after every level and every lost shield, so the title screen offers
**Continue campaign · Level n** until it is finished or lost. **Play level n**
plays the selected level on its own with a fresh pool.

The difficulty select on the title screen sets the pool for both modes and is
locked in when a campaign starts:

| Difficulty | Shields |
| --- | --- |
| Easy | unlimited |
| Normal (default) | 5 |
| Hard | 3 |
| Punishing | 1 |

The table lives in `DIFFICULTIES` in `src/config.js`. The version shown next
to the tagline is `GAME_VERSION` in the same file; the game is in alpha.

## Multiplayer (same Wi-Fi)

Up to three players, one room code, no accounts. One player runs the local server
(the [Windows app](#windows-download-desktop-app) does this by itself):

```bash
npm start
```

It prints the machine's LAN address (something like `http://192.168.1.20:8080`).
Both players open that address on the same network. On the title screen,
**Multiplayer · LAN** opens the lobby: one player hosts and gets a four-letter
code (and a share link), the others join with it. The host picks the arena,
the shields per player and the rules. One loss ends a round; with no shields
left you are out, and the last one standing wins. Each
player keeps one colour for the whole match whichever side they spawn on (the
host wears the arena's wall colour, the guest its obstacle colour), and the
score, names and point notices are tinted to match. Boss-only abilities are
off in multiplayer; ice trails lay for either player's blocks and only freeze
the other player (its core is tinted in the colour of whoever laid it).

**Co-op.** A room holds the host and up to two friends. In the lobby the host
can pick **Co-op** instead of Versus: everyone plays on the same side against
the AI boss, on one level or on the host's campaign (new, or continued from
the host's save). The team shares one pool of shields at the host's difficulty
setting; a body hit or a stand-still by anyone costs one, and the ball
re-serves. Because more shields cover more lanes, the boss takes one body hit
per human (pips next to its name in the HUD; `COOP.bossHitsPerHuman` in
`src/config.js`). The own-ball rule treats the team as one body: with it off,
a ball a partner hit last just bounces off you. The host wears the arena's
wall colour, the allies a fixed green and pink, and each ally spawns near the
host at a spot chosen to be clear of walls, obstacles, movers and each other
(`findAllySpawn`, or a level's `ally` override for the first). Versus stays a
two-player mode, so the lobby only offers it while one friend is in the room.
End-of-level screens and the campaign's continue, restart and summary choices
belong to the host; the guests see the same screen and wait. If anyone drops
out mid-match the match ends for everyone.

## Versus arenas (every player for themselves)

Versus has its own rooms, built for two or three humans rather than staged
around a boss. The host picks one in the lobby. The ten campaign levels are
there too, further down the list: two players take the player and boss
spawns, and a third gets a seat the game works out for that level, the most
open spot that is as far as possible, and about equally far, from the other
two, clear of walls, obstacles and everywhere the movers sweep.

| Arena | Shape | Source |
|---|---|---|
| The Wedge | an equilateral triangle with its corners filed flat, an inverted wedge at the centre | `VERSUS_LEVELS` in `src/levels.js` |
| The Ring | a circle with four small pillars on the diagonals | same |
| Trefoil | three overlapping circles grown into one room, three small pillars in the necks | same |
| Sawtooth | a square whose walls are chewed into teeth, two diamonds inside | same |

Rules: every player starts with the same number of shields (the host picks 1,
2, 3 or 5 in the lobby; 3 is the default). A body hit, an own ball (with the
own-ball rule on) or standing still costs that player one shield, play stops,
and everyone is reseated for a fresh serve. A player with no shields left is
out and watches the rest; the last one standing wins. Seats are fixed for the
match (the host wears the arena's wall colour, the first guest its obstacle
colour, the third player the arena's `palette.third`); the survivors take the
spawn set for their number, and who starts where rotates every round. Each
arena lists a spawn set per player count under `spawns`; a fourth set is the
only thing a four-player match will need.

The shape helpers (`truncatedTriangle`, `circleUnion`, `jaggedSquare` and the
existing `ellipse`) live next to the arenas, and every arena is fired at in
`test/physics.test.js` at the maximum ball speed to prove its walls hold.

## Online multiplayer (different networks)

The LAN server only works on one Wi-Fi network, because the guest has to reach
the host's private address. For play over the internet the game needs a relay
that both browsers can reach, and `relay/` is that relay as a Cloudflare
Worker with one Durable Object. It speaks exactly the LAN relay's protocol, it
is free at a couple of friends' scale, it never sleeps, and Cloudflare's edge
keeps it close to both players.

Deploy it once (needs a free Cloudflare account and Node):

```bash
cd relay
npm install          # wrangler, Cloudflare's deploy tool
npx wrangler login   # opens the browser once
npx wrangler deploy  # prints https://deflector-relay.<your-subdomain>.workers.dev
```

Then either put that address in `DEFAULT_RELAY` in `src/config.js` and
redeploy the site, so every player gets online play from the title screen, or
have players paste it under **Relay** in the lobby (remembered in their
browser), or open the game with `?relay=<address>`.

The relay protocol carries a version, and the lobby warns when a deployed
relay is older than the game (redeploy it with the same command, or let the
workflow below do it).

**Hands-off alternative: let GitHub deploy it.** The workflow in
`.github/workflows/deploy-relay.yml` deploys the relay and then commits its
address into `src/config.js`, so Vercel redeploys the site already pointed at
it. One-time setup:

1. In the Cloudflare dashboard, open My Profile > API Tokens > Create Token
   and use the **Edit Cloudflare Workers** template. Copy the token.
2. Copy your **Account ID** from the Workers & Pages overview page.
3. In the GitHub repository, Settings > Secrets and variables > Actions, add
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Actions tab > Deploy relay > Run workflow. It also runs by itself whenever
   something under `relay/` changes on `main`.

The token never leaves GitHub's secret store, and the job summary shows the
relay address and a `/health` check. The title button reads
**Online match** when a relay is configured and answers on `/health`. To play
on a LAN with `npm start` while a default relay is configured, enter `local`
as the relay in the lobby (or open the game with `?relay=local`). Room
codes and share links work as on LAN; the share link is the game's own URL
with `?room=CODE`.

Cost: the relay counts WebSocket messages at a 20:1 discount and idles for
free. A match sends about 120 messages a second, which is a few hours of play
a day inside the free plan's daily allowance. Test the Worker locally with
`npm run dev` in `relay/` and `?relay=ws://127.0.0.1:8787` on the game.

Latency: the host runs the simulation, so the guest feels the round trip on
its own character. Its own character is predicted locally and reconciled with
the host's state as snapshots arrive, so movement responds immediately; what
lags is the ball and the other players, by about half a round trip.

How it works: the server is also a tiny WebSocket relay (`/ws`, no
dependencies). The host's browser runs the physics exactly as in single
player, with the second character driven by the guest's inputs instead of the
AI. It streams state snapshots and effect events at 60 Hz (`src/netstate.js`);
the guest mirrors them, extrapolates the ball a few milliseconds, and streams
its inputs back. On a home network that is a few milliseconds of lag. The
static Vercel deployment cannot relay, so the button is disabled there.

## Controls

| Action | Keys / pointer |
| --- | --- |
| Move | Arrow keys, or hold the mouse button / drag a finger toward where you want to go |
| Rotate character and shield | **A** (counter-clockwise) / **D** (clockwise) |
| Thrust the shield forward ("whack") | **W** or **Space** |
| Pull the shield in (soft return, slows the ball) | **S** |
| Pause / mute / restart | **P** / **M** / **R** |
| Controller (Xbox or any standard gamepad) | **left stick** moves, **right stick** or **LT** / **RT** rotate like A and D (further is faster), **A** thrusts, **X** pulls the shield in, **Start** pauses, **A** also confirms on menus |

On touch devices, touch anywhere on the arena and drag: the first touch becomes
a floating joystick and the drag direction steers, so your finger never has to
cover the character. Rotate, pull and whack buttons appear while a level is
running. A controller works as soon as the browser sees it (press any button
after connecting; browsers reveal gamepads only after a button press).
**F** or the ⛶ button toggles fullscreen where the browser allows it;
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
* One hit on the boss's body wins the level. A hit on your body costs a
  shield and the ball re-serves behind a fresh countdown; with no shields
  left the level is lost. How many shields you get is the difficulty.
* **Keep moving.** A human player who stays within a body diameter (44 px)
  of one spot for 8 seconds loses a shield in single player and the round in
  multiplayer. It is net displacement, so turning in place or jittering does
  not count, and time spent frozen on ice does not count against you. The
  HUD shows a red MOVE countdown and a ring closes in on your character for
  the last 2 seconds. AI bosses are exempt. Tunables are `campDistance`,
  `campSeconds` and `campWarn` under `PLAYER` in `src/config.js`.
* **No contact with the boss.** A human player whose body or shield touches
  the boss's body or shield loses a shield, exactly like a body hit: no
  waiting at the boss's side for the ball to arrive and banking it in at the
  last moment. The re-serve gives a grace period that covers the countdown,
  so you can step away once play resumes. The tutorial drone and, in versus,
  the other human are exempt.
* **Lose to a ball you last hit** is a rule you can switch off on the title
  screen (and in the multiplayer lobby, where the host's choice applies to
  both). Off, a ball bounces harmlessly off the body of whoever's shield
  touched it last, so you can only be beaten by a ball the other side sent.
  AI bosses play by the same rule, which removes their self-inflicted losses.
  The HUD shows *safe own ball* while it is off. Default: on.

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

## Boss anticipation

Bosses do not only react to the ball; while it is still on its way to you they
read your shield. `predictReturn` in `src/ai.js` traces the ball to your paddle,
reflects it exactly as the physics will (including your body velocity, your
rotation and a thrust in progress, so a swinging shield reads differently from
a still one), traces the return through the walls and timed movers, and the
boss starts moving toward where that return will pass before you have hit the
ball. A ball that would reach your body first, or the back of your shield, is
not read as a return. The real return still triggers a re-plan, so a late
flick remains a genuine skill.

Each boss has an `anticipation` entry in `src/levels.js`:

| Field | Meaning |
| --- | --- |
| `commit` | 0 to 1: how far from its neutral spot toward the predicted intercept the boss moves |
| `swing` | whether it reads your shield's motion (tier 2) or only its current pose (tier 1) |
| `error` | degrees of misread, skewed randomly per plan |

The values ramp from the Warden (commits halfway, reads a still shield,
misreads by up to 6 degrees) to the Architect (commits fully, reads the
swing, misreads by at most 1 degree). Measured in the headless balance sim
against a scripted opponent, the read is within 1 to 2 degrees of the real
return for the later bosses and the boss stands two to three times closer to
the real return path at the moment you hit the ball. The shots it still
misses arrive from its side or back beyond its leash: bank shots, which are
meant to work.

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
Level 7, "The Undercroft (Sexton Theme)", is F minor at 104 BPM over
Fm - Db - Ab - C, a slow tolling arpeggio with sparse, open hats.
Level 8, "Signal Spire (Beacon Theme)", is C# minor at 136 BPM over
C#m - A - B - G#m, a Morse-like stutter arpeggio over an octave-pumping bass.
Level 9, "Nullspace (Absence Theme)", is Eb minor at 122 BPM over
Ebm - Abm - Ebm - Db, a wide, long-gate arpeggio with off-beat hats.
Level 10, "The Last Arcade (Architect Theme)", returns to D minor, the
fastest track at 150 BPM over Dm - Bb - Gm - A with a leaping arpeggio.

## Levels

| # | Title | Boss | Status |
| --- | --- | --- | --- |
| 1 | The Antechamber | The Warden | playable |
| 2 | Prism Vault | The Refractor | playable |
| 3 | Coolant Tunnels | The Sump | playable |
| 4 | The Hollow Reactor | Core Sentinel | playable |
| 5 | Switchyard | The Shunter | playable |
| 6 | Glass Cathedral | The Choirmaster | playable |
| 7 | The Undercroft | The Sexton | playable |
| 8 | Signal Spire | The Beacon | playable |
| 9 | Nullspace | The Absence | playable |
| 10 | The Last Arcade | The Architect | playable |

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
and you cannot be re-frozen until you have stepped off it. Whoever laid a trail
is immune to it, so the Sump never freezes on its own ice.
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

Level 7 is dark. A level with a `dark` entry is rendered under a darkness
layer with holes punched around light sources: the player's and boss's
lanterns, the ball's glow (which grows with speed), and fixed candles listed in
`lights`. The AI is unaffected; the darkness is the player's handicap, and the
crypt lights up when the level ends.

Level 8 gives the boss an ability. A boss with a `pulse` entry emits an
expanding ring every `period` seconds (telegraphed for `warn` seconds). The
ring is a thin circular moving wall travelling outward at `speed`, so it flings
an incoming ball away and boosts a ball it overtakes, then fades at
`maxRadius`. A transmitter spire splits the arena with a lane over its top.

Level 9 has no obstacles: the chamber itself is eight pistons, all in phase,
so every wall slides inward and back together. Banks off a closing wall come
back faster and off an opening wall slower, so a rally's speed rises and falls
with the room's breath. The Absence is drawn as a hole in the grid (`ghost`).

Level 10 is the gauntlet: the prism at the centre, a rail column with two
alternating sliding doors, a screen of breakable glass around the Architect,
ice behind its blocks and a pulse. Nothing new to learn; everything to use.

Adding a level means adding an entry to `LEVELS` in `src/levels.js` (boundary
polygon, obstacle polygons via `rect(cx, cy, w, h, angleDeg)`, optional
`movers`, spawns, boss parameters) and a track to `src/audio/tracks.js`. The
title screen lists every built level and lets you pick one.

## Lore

You are the Defector. The grid is a system of sealed rooms, the ball is the
charge that travels between them, and every program in the grid is a
reflector at heart: it gives the charge back exactly as it came. You were one
of them, a wall with a name, until you moved (a moving shield adds to or takes
from the charge, which no wall can do) and then turned on the other programs.
The written mark is that name being rewritten one reading at a time:
REFLECTOR, DEFLECTOR, DEFECTOR, and a last reading, VECTOR, that the record
has not filled in yet.

The title screen carries the system bulletin about you, a dossier line for
the resident program of the selected level, and a **Read the record** link
to the full story with all ten residents. Clearing a level marks its resident
STOPPED in the record (kept in the browser under `deflector.cleared`); the
cleared and failed screens each carry a line from the record too. The text
lives in `src/lore.js` and in each level's `record` and `stopped` fields in
`src/levels.js`.

## Performance

The game logic is cheap (physics, AI and garbage collection together take
under half a percent of a frame); what costs is canvas rasterisation, so the
renderer does three things about it:

* **Render interpolation.** Physics runs in whole 240 Hz steps, and a frame on
  a 144 Hz or 75 Hz display would otherwise alternate between one and two
  steps of ball travel and judder at a perfect frame rate. Each frame is drawn
  a fraction of the way through the current step instead (`drawWorld` in
  `src/main.js`, from the `markRender` state each entity keeps).
* **Half-resolution darkness.** The Undercroft's light layer is a second
  canvas that is filled, punched and composited every frame; it is rendered at
  half size and scaled up with nearest-neighbour sampling (it is soft
  gradients only, and a bilinear upscale costs four times more in software
  rendering). Two canvas pitfalls found on the way, worth knowing when
  touching the renderer: the `copy` composite operation takes Chrome's slow
  full-surface layer path, and a glow blur costs by the bounding box of the
  path drawn, so never batch far-apart shapes into one glowing path.
* **Quality setting** on the title screen: Auto, High or Low. Low caps the
  pixel density at 1 and turns off the glow on moving things (the cached
  static layer keeps its glow). Auto starts high and steps down to Low for the
  rest of the session if 8% or more of the frames in a 90-frame window took
  more than 1.6 times the display's refresh interval. The HUD's FPS readout
  shows dropped frames per level and the active quality, so a tester can say
  which level stutters.

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
src/levels.js              level data, the roster and the tutorial's training hall
src/conduits.js            the conduits between levels and the campaign sequence
src/lore.js                worldbuilding: the bulletin, the record's chapters, status words
src/input.js               keyboard, mouse, touch -> one intent object
src/render.js              Canvas 2D neon renderer with 2.5D wall extrusion
src/fx.js                  particles, rings, screen shake
src/audio/engine.js        Web Audio synths, sequencer, tempo-follow, SFX
src/audio/tracks.js        per-level track definitions
test/physics.test.js       node --test suite
server.js                  zero-dependency static server + LAN relay
relay/                     the same relay as a Cloudflare Worker for online play
desktop/                   Electron wrapper for the Windows build (bundles server.js)
.github/workflows/         relay deploy and Windows release automation
```

## Mobile roadmap

The game logic never touches events directly, and the renderer scales the level
to any viewport, so the mobile build is mostly input and packaging:

1. Tune the touch layout further (the floating joystick and buttons are in;
   a two-thumb layout with rotation on a second stick is the next candidate).
2. Wrap with Capacitor for iOS/Android store builds; the manifest and icons
   already make it installable as a PWA.
3. Reduce glow (`shadowBlur`) on low-end devices if the FPS readout drops.
