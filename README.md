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

The builds are not code-signed. On Windows, SmartScreen shows "Windows
protected your PC" the first time: click **More info**, then **Run anyway**.
The macOS `.dmg` is unsigned and unnotarized too, so Gatekeeper refuses it on
a double-click: right-click the app and choose **Open** instead. Signing needs
a paid certificate on either platform; it is the one thing a Steam, Microsoft
Store or Mac App Store release would add here.

**Cutting a release.** Bump `GAME_VERSION` in `src/config.js` and the version
in `desktop/package.json`, commit, then push a tag; the
[desktop release workflow](.github/workflows/release-desktop.yml) builds both
`.exe` files on a Windows runner and a `.dmg` on a macOS runner, and attaches
all of them to one GitHub Release (a tag with a `-` in it, like an alpha, is
marked pre-release):

```bash
git tag v1.6.0-alpha
git push origin v1.6.0-alpha
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
heavy leaded frame; a pane with its own `breakSpeed` overrides the level's.
A **candle** node becomes a light in a dark level once lit; a node with
`requires` (indices of other nodes) refuses the ball until those are lit. A
drone marked `lantern` lights only `dark.hidden` px around itself while it
moves and its full `dark.boss` radius while standing still or for a moment
after a block. `noGuide: true` switches the dotted shot guide off.
**Emitters** (`emitters`) are the Beacon's pulse planted in the floor: each
entry takes the same fields as a boss `pulse` (`period`, `speed`,
`maxRadius`, `thick`, `warn`, `delay`, timed from the level start) and its
rings fling the ball exactly as the Beacon's do. Pulse rings, from bosses and
emitters alike, now reach co-op guests in the snapshot. A **gravity well**
(`well: { x, y, r, range, pull, drag }`) pulls everything inside `range`
toward it with a 1/distance fall-off that fades out over the outer third:
the ball accelerates by `pull / d` px/s² and a player drifts `drag / d`
px/s, so close in the drift outruns a player's own speed. Inside the horizon
`r` the ball is taken (a free re-serve) and a player loses a shield and
restarts at their spawn; drones are never pulled. A level with
`wellReturns: true` (the Event Horizon) gives the ball straight back instead:
it comes out at a random spot outside every well's reach, clear of walls,
solids, moving parts and 220 px from every fighter, on the same course at the
same speed, preferably one not heading back at the well, and play goes on
with no re-serve (`wellReturnSpot` in `src/gamestate.js`, `returnBall` in
`src/main.js`). With a well the dotted
guide is integrated through the field instead of cast straight, so it shows
the bend. A drone with `phasing: { on, off }` is solid for `on` seconds from
each serve and then intangible for `off`: drawn faint, ignored by the ball
and the contact rule. Conduits can also hold **drones**, Boss-brained enemies with
their own stats; a body hit knocks a drone out for the rest of the room, and
`objective.drones` makes downing them part of the objective.

### Nothing can seal the ball away

Glass panes and switch-operated doors are the only walls that appear after
play starts, so they are the only way a room could become unplayable: no human
can break glass, and once a ball has shattered a pane it leaves at
`speedKeep` of the speed that broke it, which is below the break speed, so a
ball sealed behind healing glass could never get itself out.

It can happen the other way round too. Only the ball works a switch, and
every switch sits on the spawn side of the door it opens, so the ball cannot
shut *itself* in (a test asserts that). But a player can walk through an open
door and be shut in behind it, or lose a shield in a far yard and have the
ball re-serve behind two closed doors: either way the ball is somewhere that
player can no longer reach.

Three guards, all built on which side of a slab something is:

| Guard | What it does | Source |
|---|---|---|
| A broken pane waits | it does not heal while the ball is on its far side from every human | `sealsBallAway` in `src/main.js` |
| A switch refuses | it will not close a door that would leave a human on the far side from the ball; the door stays open and the switch flickers | `wouldStrand`, same file |
| A re-serve un-strands | anyone a closed door or an unbroken pane has put out of reach of the new serve starts it back at their spawn | `cutOffFromBall`, same file |

The side test is exact for a door that spans its wall, as the Signal Box's
yard doors do, and an approximation for one that closes off a corner, so a
watchdog sits behind all three. If no shield has touched the ball for
`BALL.stuckSeconds` (20), the ball comes back to the serve point for free,
costing nobody a shield, **and every player goes back to their spawn**, with a
HUD notice. Nothing in a real rally comes close to 20 seconds, so reaching it
means the room is in a state the guards did not anticipate, and the only safe
answer is to put all of it back to how a serve starts.

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
| 6½ Lamplighter | The Undercroft | an unlit crypt stair where five candle nodes light their corners when struck and the exit only answers once the candles beside it burn; two lantern drones loop the dark with their light shuttered while they move and shown while they stand or block; no guide line | `src/conduits.js` |
| 7½ Relay Mast | Signal Spire | a mast splits the room and the only lane is over its top; two floor emitters pulse half a period apart and every ring flings the ball, so a shot waits for the silence or rides a ring over; two turrets fire on the same beat; the receiver on the far side is hooded to take the ball only from above and to the left, the way a lob arrives | `src/conduits.js` |
| 8½ Event Horizon | Nullspace | a gravity well at the centre of a chamber whose top and bottom walls breathe; inside its dotted reach the ball bends toward it and players drift after it, and the horizon takes whatever crosses it (the ball comes straight back out somewhere far from the well on the same course, with no re-serve; a player loses a shield and goes back to the spawn); the shot guide bends with the pull; Umbra, a shadow of the Absence, circles the well solid three seconds in five and has to be knocked out while it is; the node waits beyond the well's reach, straight across from the player, so only a slingshot or a bank reaches it | `src/conduits.js` |
| 9½ Drafting Room | The Last Arcade | the exam: a ricochet node in the corner, a hooded node screened so it opens only from below, a switch that opens the door of a bay whose glass pane breaks only to a 600 px/s strike with a plain node behind it, a turret in the floor whose shot has to be sent back into it, a signature node on the far side that answers only once the other three are lit, a cart on the middle rail, two coolant vents and the prism at the centre | `src/conduits.js` |

## Frames (the four readings)

The mark has four readings, and each one is a frame you can wear. The frame is
a single choice on the title screen (and in the multiplayer lobby) that applies
to every mode: single player, the campaign, co-op and versus alike.

Every frame is cut from the same **eight cells**, spread across four systems,
so no frame is richer than another: a wider shield is paid for with a bigger
body to hit, and speed is paid for out of something else. Each system has five
tiers, costing 0 to 4 cells.

| System | What it sets | 0 cells | 4 cells | Source |
|---|---|---|---|---|
| Drive | movement speed | 340 px/s | 520 px/s | `SYSTEMS` in `src/frames.js` |
| Gyro | turn speed, and so how hard a swung shield whacks | 5.6 rad/s | 8.4 rad/s | same |
| Span | the width of the shield | 92 px | 140 px | same |
| Hull | the size of the body the ball has to find | 28 px | 16 px | same |

Hull runs the other way: cells spent there make the body *smaller*, and a
frame that spends nothing on it carries the biggest target in the game. The
shield always sits `paddleGap` (14 px) off the body's edge, so it follows the
hull in and out and no frame has a gap between the two.

| Frame | Drive | Gyro | Span | Hull | Plays like | Source |
|---|---|---|---|---|---|---|
| Reflector | 2 | 2 | 2 | 2 | even in everything: the game exactly as it was before frames | `FRAMES` in `src/frames.js` |
| Deflector | 2 | 2 | 4 | 0 | the widest shield in the game on the biggest hull: it covers lanes nothing else reaches, and it is the easiest thing in the room to hit, including by walking into the boss | same |
| Defector | 3 | 2 | 0 | 3 | quick and hard to find, with barely a line to block with | same |
| Vector | your own | | | | the fourth reading: spend the eight cells yourself | `vectorFrame` in `src/frames.js` |

Vector is edited in place on the title screen, under the frame's **Details**
(which opens by itself when Vector is chosen): − and + move cells between the
systems, the readout shows exactly what the fighter will get, and + is locked
once all eight are spent, so the only way to buy one thing is to sell another.
Spending fewer than eight is allowed and only costs you. An allocation that
*over*spends, from an older save, a hand-edited one, or a guest's claim over
the network, is trimmed back to the budget before it reaches the arena
(`withinBudget`), so nobody can field more than eight cells.

Nothing else about a frame changes: the thrust, the pull-in, the shield
thickness and every rule are the same for all of them, and AI bosses have
their own stats entirely. In multiplayer each player wears their own frame;
guests announce theirs when they join the lobby, the host's `setup` message
carries the whole table, and both sides build identical fighters from it. The
HUD names the frame you are wearing, and the host's lobby lists what each
guest has picked.

## Campaign and difficulty

**Campaign** plays the ten levels in order on one shield pool. Every body hit
or stand-still costs a shield; when the pool is empty the run is over.
Progress (level reached, shields left, time, shields lost, continues used) is
saved in the browser after every level and every lost shield, so the title
screen offers **Resume · Level n** to pick a run back up. **Play level n**
plays the selected level on its own with a fresh pool.

### Continues

A run that loses its last shield is not thrown away. The save is kept, spent,
at the level it ended on, and the campaign-over screen offers **Continue** as
well as Restart: the pool refills, the level starts again, and the run keeps
its elapsed time and everything it has already lost. Leaving to the menu keeps
the offer, and the title screen and the co-op lobby both say **Continue**
rather than Resume for a spent run, with the number the next one will be.

Resuming a run whose pool is empty is what counts a continue, wherever it is
resumed from, so there is one rule and no way to take a continue without it
being recorded (`resumeCampaign` in `src/main.js`). The count rides with the
run to the end and is the last line of the completion table:

| Line | What it says | Source |
|---|---|---|
| Difficulty, Total time, Shields lost, Shields left | the run as before | `showCampaignCleared` in `src/main.js` |
| Continues used | how many times the run ran out and was taken up again, or "start to finish on one pool" at zero | same |

The campaign-over screen carries the same figures, so the cost of the run is
visible while deciding whether to continue it. Completing a campaign clears
the save, and so does starting a fresh one. All of it works the same in co-op,
where the host owns the run: the host gets the Continue button and the guests
see the same screen and wait.

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
player keeps one colour for the whole match whichever side they spawn on,
chosen to stand well apart from the arena's wall and obstacle colours and from
each other's (see Versus below), and the score, names and point notices are
tinted to match. Boss-only abilities are
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
belong to the host; the guests see the same screen and wait.

### The room outlives the match

A room is not a match. From the moment it is made or joined it stays open on
the same four-letter code until somebody actually leaves it, and a finished
match drops everyone back into it rather than to the main menu. From the room
the host can pick a different arena, switch between versus and co-op, change
the shields or the own-ball rule and start again with the same people; every
player can change their frame while they wait. The pickers come back on
whatever was played last.

The end-of-match screen gives the host **Rematch** (the same arena again),
**Change the match** (back to the room) and **Leave the room**; guests get the
last of those and a line saying what the host is choosing. If a guest
disconnects, the match ends and the host and everyone still connected go back
to the room, which keeps its code so the same player can rejoin. Only the host
disconnecting closes the room.

In the code this is the split between `endMatch`, which clears everything
about the match just played and keeps the connection, the roster, the names
and the frames, and `netReset`, which is the only thing that drops the socket.
`net.room` says a room is live; `net.mode` says a match is running inside it.

### Leaving a live match takes two presses

During a multiplayer match no single key or button drops you out. `Esc`, `P`,
gamepad **Start** and gamepad **B** arm the exit and raise a banner; a second
press within three seconds acts on it, and doing nothing for three seconds
cancels it. The match keeps running behind the banner, because no one player
can pause a live match, and the banner says so. What the second press does
depends on which side you are: the host ends the match and everyone lands back
in the room, while a guest walking out of a live match walks out of the room,
and the banner names which before you commit. Single player is unchanged:
`Esc` still pauses immediately.

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

Six of the conduits are versus arenas too, at the bottom of the list, played
at the conduits' 750 px/s cap and stripped to their hazards: the nodes, the
switch-operated doors and the drones are gone, and what remains is what
happens to everyone alike. There is no objective either: knocking a turret
out or lighting something there does not end a versus or Blaster match.

| Arena | What stays | What a player can lose a shield to, besides the ball | Source |
|---|---|---|---|
| 1½ Lens Gallery | the mirror plates and the spinning prism | nothing new | `VERSUS_CONDUITS` in `src/conduits.js` |
| 2½ Condensers | a chamber each, the tunnel between them sliding shut and open, six coolant vents | ice from the vents (a freeze, not a shield) | same |
| 3½ Orbit Deck | the two plates circling the centre, two wall turrets that fire at whoever is nearest | a turret shot on the body | same |
| 7½ Relay Mast | the mast between the sides, two floor emitters flinging the ball, two turrets on the beat; a third player takes the lane over the mast | a turret shot on the body | same |
| 8½ Event Horizon | the well and the breathing walls; every seat starts outside its reach | being dragged over the horizon (a swallowed ball comes straight back out elsewhere and play goes on) | same |
| 9½ Drafting Room | the prism, the floor turret, two vents, the bay with its door gone and its glass still up | a turret shot on the body | same |

Three conduits stay campaign-only: **Signal Box** is nothing but its switches
and the doors they open, **Reliquary** is a hall with a dead-end apse behind
glass once the relic is gone, and **Lamplighter** is dark without its candles.
Each versus conduit lists its own seats under `spawns` for two and three
players; a level or conduit without a seat list gets fair seats worked out at
match time, never inside a well's reach or on a turret.

### Blaster (no ball, every shield loaded)

A third mode in the lobby, on any versus arena. There is no ball at all.
Every fighter carries a **charge** in its own colour at the centre of its
shield and fires it with the **thrust**, never by turning. A charge in anyone
else's colour costs a shield on the body, and the round resets like any other
loss; your own colour cannot hurt you.

| Rule | What it means | Source |
|---|---|---|
| One charge each | it lives three seconds and the next forms as it dies, so nobody ever has two in the air | `VOLLEY` in `src/config.js` |
| The thrust fires it | rotating only turns the shield, so swinging at a charge never spends yours | `fireCharge` in `src/main.js` |
| Reload runs from firing | three seconds whatever the charge meets, so shooting a nearby wall is not a free reload | same |
| Walls turn it back | walls, doors and moving parts bounce a charge instead of ending it, and a moving part lends it its motion | `stepBlaster`, same file |
| Shields move it | a charge leaves at the middle of the arena's range, and after that a shield swung into it adds speed and a retreating one takes it away, exactly as they do the ball | `clampCharge`, same file |
| The arena's cap holds it | whatever a shield does, a charge stays between the floor and the arena's own limit | same |
| Deflection is aim | a shield turns a charge away without taking it over: it keeps its colour, its owner and its clock | `stepBlaster` |
| Your own is harmless | it bounces off your body and flies on | same |
| The arena still applies | the Event Horizon's well bends a charge in flight and the horizon takes it, just as it does the ball | same |
| Nobody walks through anybody | bodies block each other, so no one can shove into a rival and fire point blank | `separateFighters` in `src/main.js` |
| A wall close ahead | a charge is formed beyond your shield, but the way out is swept from your centre, so one fired into a wall you are standing against forms on the room's side of it and bounces, rather than beyond it | `chargeMuzzle` in `src/main.js` |
| The carried charge is drawn only | it is never part of the physics, so it cannot widen your shield | `drawCharges` in `src/render.js` |

A loaded charge is meant to be read across the room: a bright core, a halo
that breathes and three turning ticks around it. A spent one is a thin arc
closing as the next forms, so an opponent can always tell at a glance whether
you have a shot in hand.

Because a shield never takes a charge over, deflecting is a way to aim
somebody else's shot rather than a way to be safe from it. With three players
that is a weapon; with two it mostly buys you an angle, and dodging matters
more.

The keep-moving rule still applies, which is what stops a player camping a
corner and sniping. The HUD's ball readout becomes your charge: **LOADED**
with the speed it will fly at, or the seconds left on the reload, with the bar
running as it fills.

A charge is the size of the ball and is held to the same cap, which is what
keeps it from crossing more than its own radius in a physics step and passing
through a wall. A test drives a fighter into a charge at full speed for six
simulated seconds to prove nothing can pump it past that. A shield retreating
at exactly the charge's speed cancels it dead; rather than leave it hanging in
the air it goes on along the contact normal at the floor speed, the same
recovery the ball gets when it stalls.

### Wormhole Variant (Blaster)

A tick box under the mode in the lobby, shown when Blaster is picked. Every
player gets a pair of wormholes of their own, in their own colour, and can put
each end on any wall, obstacle or moving part.

| Rule | What it means | Source |
|---|---|---|
| Deploying | **Q** or **LB** puts out the light end, **E** or **RB** the dark end, on the first wall, obstacle side or moving part straight ahead along your facing. Pressing the same key again moves that end there | `aimPortal` in `src/portals.js`, `portalButtons` in `src/main.js` |
| Two ends, two shades | the light end is your colour mixed toward white, the dark end toward black, each with a glow in your own colour. One end alone is dashed and dim; a pair is open once both are out, with a white core and sparks drifting across it | `portalHue` in `src/color.js`, `drawPortals` in `src/render.js` |
| Wide enough | 96 px across, room for the biggest frame; on a surface long enough it slides along so all of it lies on the surface | `PORTAL.halfWidth` in `src/portals.js` |
| On a moving part | it rides with it (a breathing wall, a sliding slab, an orbiting plate); if its surface goes, a pane broken, the end goes too | `framePortal` in `src/portals.js`, `refreshPortals` in `src/main.js` |
| Anyone's | any fighter can go through any open pair, yours or a rival's | `mouthOf` in `src/portals.js` |
| Going through | the moment your centre crosses the surface you come out of the other end, with the same speed, and your direction and facing turned by the angle between the two ends | `throughPortal`, `portalFighter` in `src/portals.js` |
| Grace | for 0.35 s after coming out you cannot go back in (at most halfway), so two ends facing the same way cannot bounce you to and fro | `PORTAL.grace` |
| Halfway | stop with your body across a mouth and you stay there, drawn half at each end. The mouth is open across its width and to whatever lies just behind it (so a thin slab with the room's wall behind it still lets you through), while the surface either side stands | `carve` in `src/portals.js`, `drawFighterThrough` in `src/render.js` |
| Charges | go through the same way, anyone's, and are looked for a step ahead so a fast one reaches the mouth before the wall; one fired with a mouth nearer than the muzzle is formed on the far side | `stepBlaster`, `chargeMuzzle` in `src/main.js` |
| How long | an end stays until you move it or the round ends | `buildGame` in `src/main.js` |
| Online | the host decides every crossing. Ends travel in the snapshot (a wall end as where it is, a moving one as which part and where on it), a guest predicts its own crossings, and nothing is interpolated across a jump | `encodePortal`, `decodePortal` in `src/portals.js`, `src/netstate.js` |

The half of you already through is drawn at the far end but is not solid
there until you cross. There are no touch buttons for wormholes yet: on a
phone the variant needs a keyboard or a controller.

### Ball speed

The host also sets the pace. Every setting scales the cap the chosen arena
would use in the campaign, so **Standard** is the campaign exactly, on a
normal arena and on a conduit alike, and the others move from each arena's own
baseline:

| Pace | Multiplier | On a versus arena | On a conduit arena | Source |
|---|---|---|---|---|
| Strategic | 0.5 | 750 px/s | 375 px/s | `VERSUS_SPEEDS` in `src/config.js` |
| Measured | 0.75 | 1125 px/s | 563 px/s | same |
| Standard | 1 | 1500 px/s | 750 px/s | same |
| Quick | 1.25 | 1875 px/s | 938 px/s | same |
| Chaotic | 1.5 | 2250 px/s | 1125 px/s | same |

The lobby names the resulting number for the arena in front of you, and the
HUD carries the pace and the cap through the match whenever it is not
Standard. The choice is remembered in the host's browser and travels to the
guests in the setup message, so everyone plays at the same limit and the
ball's colour ramp reads against it.

Chaotic stops where it does because of the physics, not taste. At the fixed
240 Hz step a ball that crosses more than its own radius between two frames
can pass through a wall, which puts the hard limit at 2640 px/s;
`SPEED_CEILING` is 2250, about 85% of that, and every pace is clamped to it.
Each versus arena is fired at with the ball at that ceiling in
`test/physics.test.js` for a hundred simulated seconds to prove its walls
still hold.

Rules: every player starts with the same number of shields (the host picks 1,
2, 3 or 5 in the lobby; 3 is the default). A body hit, an own ball (with the
own-ball rule on), standing still, a turret's shot or a gravity well costs
that player one shield, play stops,
and everyone is reseated for a fresh serve. A player with no shields left is
out and watches the rest; the last one standing wins. Seats are fixed for the
match, and so are colours: nobody wears the arena's wall or obstacle colour,
or anything close to it, since a Blaster wormhole sits in those surfaces and
has to stand out from them. The arena's `palette.third` comes first where it
qualifies, then a fixed list (`PLAYER_COLORS`), each at least 110 apart (RGB
distance) from the walls, the obstacles and the other players; every arena
meets that, and a test checks it (`versusColors` in `src/gamestate.js`). The
survivors take the
spawn set for their number, and who starts where rotates every round. Each
arena lists a spawn set per player count under `spawns`; a fourth set is the
only thing a four-player match will need.

The shape helpers (`truncatedTriangle`, `circleUnion`, `jaggedSquare` and the
existing `ellipse`) live next to the arenas, and every arena is fired at in
`test/physics.test.js` at the maximum ball speed to prove its walls hold.

## Galactic Golf (the Outer Course)

A solo mode that is not Pong at all. Out past the last room the Architect drew
there is a course: a tee, a charge, and eighteen holes with nothing in them to
deflect. Tilt the frame to pick a line, thrust once to launch, and from then
on the only say you have is the **ion gauge** — six pulses that shove the charge
sideways mid-flight. Reach the cup and the hole is done; the launches it took
are counted against the hole's par.

Three kinds of gravity body stand on a hole, told apart by what happens when
the charge reaches one:

| Body | What it is | What reaching it does | Source |
|---|---|---|---|
| Stone | Solid, with a field around it | The surface bounces the charge; the field bends anything that passes | `planet()` in `src/golf.js` |
| Maw | A black hole with nothing in it | The horizon ends the shot, and the launch still counts | `maw()` in `src/golf.js` |
| Cup | The goal: a small horizon with a short, hard pull | The hole is done | `cup()` in `src/golf.js` |
| Fount | A white hole: a small bright core whose field pushes instead of pulling | The core is solid and bounces the charge, but the push usually turns a line back before it gets there; lines that pass bend outward | `fount()` in `src/golf.js` |

A **wormhole** is a pair of mouths that hands the charge on at the speed and
heading it arrived with, which is the whole difficulty of it: the line you take
into the near mouth is the line you leave the far one on. A hole with more than
one pair colours each, and a mouth leads only to the one in its own colour; the
map names both mouths of a pair alike, since a mouth works both ways.

The course as it stands:

| Hole | Name | Par | Clock | What it teaches | Source |
|---|---|---|---|---|---|
| 1 | Slip Orbit | 2 | 9 s | A stone is solid, and its field bends what passes it | `COURSE[0]` in `src/golf.js` |
| 2 | The Narrows | 3 | 9 s | A wormhole keeps your heading, and a wall has no door | `COURSE[1]` in `src/golf.js` |
| 3 | The Maw | 3 | 9 s | Go around a black hole, and time the bar in the gate | `COURSE[2]` in `src/golf.js` |
| 4 | Aftermouth | 3 | 9 s | The far mouth faces a maw; burn against your flight before the mouth and come out slow enough for the stone to swing you round | `COURSE[3]` in `src/golf.js` |
| 5 | Carom | 3 | 9 s | Straight into the mouth is straight into the maw; bank off the plate first so the far mouth points at the cup | `COURSE[4]` in `src/golf.js` |
| 6 | Long Orbit | 4 | 18 s | A body big enough to hold an orbit; ride it round, then burn outward when the pocket comes by | `COURSE[5]` in `src/golf.js` |
| 7 | Matched Pair | 3 | 9 s | Two pairs of mouths in two colours; the gold pair drops you into a sealed box, the rose pair is the only way out and across | `COURSE[6]` in `src/golf.js` |
| 8 | Relay | 4 | 22 s | Two screens wide. A narrow gap, a mouth past it that is the only way past a second wall, and a far mouth that sets you down on an orbit; ride it to the pocket and burn out | `COURSE[7]` in `src/golf.js` |
| 9 | Twin Bodies | 5 | 30 s | Two screens each way. Orbit the first body, burn to transfer to the second, orbit that, burn into the cup's corner; a lucky slingshot off the second body gets there in one burn | `COURSE[8]` in `src/golf.js` |

Those nine are the front nine: every mechanic on the course, one or two at a
time, in the order they are easiest to learn. The back nine adds a few more,
and its last four put everything together:

| Hole | Name | Par | Clock | What it adds | Source |
|---|---|---|---|---|---|
| 10 | The Deep | 3 | 12 s | Open space: no walls, nothing to bank off; a line that misses flies on into the dark until the clock takes it | `COURSE[9]` in `src/golf.js` |
| 11 | The Long Way | 2 | 10.4 s | Three screens long, and a heavy charge that nothing can push past the speed it leaves at: the straight line makes the cup with the clock all but spent, and the mouth by the tee is a shortcut that comes with time to fix your line | `COURSE[10]` in `src/golf.js` |
| 12 | Binary | 3 | 14 s | Two equal stones circling each other on rails; the line to the cup runs between them, and whether it is open is a matter of when you launch | `COURSE[11]` in `src/golf.js` |
| 13 | Lockstep | 3 | 9 s | Moving mouths behind a sealed wall: one circles a maw, the other circles the cup, in step. Go into the first heading for the maw's heart and you come out of the second heading for the cup's; aim at the maw and launch as the mouth swings into the line, or the maw takes it | `COURSE[12]` in `src/golf.js` |
| 14 | Syncopation | 4 | 8 s | Lockstep with two more things in the way: a fount on the line to the maw's heart, so every line has to bend round it, and a cage of two bars turning round the cup every 12 s against the mouths' 8, so the way out needs a gap facing it; two small maws above and below the cup take what the cage turns away | `COURSE[13]` in `src/golf.js` |
| 15 | Lenses | 4 | 12 s | Open space, with founts in pairs as lenses: the lens in front of the tee sends every line through it to one point, which leads nowhere. The way round is under it, along a maw's edge (a few px outside the horizon, where it turns you as hard as a stone), round a stone and through a second lens to the cup. A band of about two degrees | `COURSE[14]` in `src/golf.js` |
| 16 | Rendezvous | 5 | 24 s | Two screens each way. The tee parks you on a low orbit; a mouth circles the body further out on an 11 s clock, and a maw rides a rail between the two orbits the other way. One burn along the flight climbs to the mouth's orbit a little over a third of a lap later (the field's apsides are 127° apart, not 180), and the mouth has to be there; its far end only lets go, and a pulse steers you in | `COURSE[15]` in `src/golf.js` |
| 17 | Heavy Water | 4 | 12 s | Three screens down, on the heavy charge. Two sealed floors: the gold mouth takes the straight line to the middle floor, where a stone swings the slow charge round into the rose mouth, which sits in a turning cage; its far end on the bottom floor keeps the stone's heading into the cup. One degree of aim, and the cage's clock | `COURSE[16]` in `src/golf.js` |
| 18 | Grand Tour | 6 | 30 s | The hardest on the course. A gate with a bar turning in it, a saddle between a stone and a maw that pull opposite ways, a one-way mouth by the ceiling that sets you down on an orbit two screens away, a maw on a rail outside that orbit, and the cup in a turning cage between two maws, two more beyond it. One degree of aim in a gate window, then a burn of three pulses on the lap the cage and the maw on the rail allow; eight pulses in the gauge | `COURSE[17]` in `src/golf.js` |

**Open space** (`open: true`) draws no floor and no walls, only a starfield at
two depths; the hole's room is twenty thousand pixels square so that no line
the clock allows can reach an edge, and the map fits the hole's `area`, the
part of space it is played in, rather than the room. **A heavy charge** is
just the hole's own speed cap (`maxBallSpeed`) set to a hair above the launch
speed: a pulse can turn it, gravity can bend it, nothing can hurry it, so the
clock is exactly the straight line's length. **Bodies on rails** (`rail` on a
body, or `binary()` for two of a size half a turn apart) circle a centre from
the start of the level; a solid one is a mover in the physics, a disc of wall
that carries its own velocity into the ball like a spinner's bar, and its
field moves with it. They are turning while you aim, so a launch is timed
against them, and the ghost of the last flight shows what a different moment
did. **Mouths on orbits** (`orbitingWarp()`, an `orbitA` and `orbitB` on a
pair) work the same way: each circles its own centre on the level's clock
(`placeMouths` in `src/gamestate.js`), its orbit drawn as a dotted ring in the
pair's colour. On Lockstep the two share a period and a phase, so each always
stands at the same angle on its own body. The only way across the wall is
through them: its test flies every fourth degree at every half second of a
turn and requires every sink to have gone through a mouth, finds the moment
the line at the maw's heart sinks in one warp and under three seconds, and
requires the same line half a turn later to end in the maw.

**Syncopation** adds the course's second clock and a new body. The **cage**
(`cage()`, an `orbiter` mover centred on the cup) is two solid bars on a ring
with a gap between each, turning once every twelve seconds against the
mouths' eight, so the two clocks only come back to the same beat every 24
seconds. The **fount** (`fount()`, a solid body with a negative pull) stands
on the line from the tee to the maw's heart, which is also the line the tee
opens on. The cup's reach is cut to 100 px, short of where the far mouth sets
the charge down, so the heading has to be right on its own. Its test proves
that each piece is load-bearing. Of the first 30 clean sinks it finds (one
warp, down inside 3.5 s), at least 24 miss when the cage starts a quarter-turn
on, and at least 21 miss without the fount. Across a whole 24-second beat of
both clocks, every sink goes through the mouths, and fewer than 4% of lines
and moments sink at all.

**The last four** are each bigger than a screen, each built from at least
three pieces the course taught earlier, no two from the same set, and the last
has the highest par and the most pieces, and cannot be sunk without the
gauge; one test checks all of that. Two pieces are new to the course here,
though made of old ones. A **maw on a rail** (a `rail` on a body that is not
solid) circles on the level's clock like a stone does (`placeRails` in
`src/gamestate.js`, driven with the mouths by `tickOrbits`), drawn with its
rail. A pair from `orbitingWarp()` can now have one end on an orbit and the
other fixed, and be one-way. Each hole's own test flies its route and proves
the pieces carry weight:
- **Lenses:** lines through the first pair spread 60 px apart at the founts
  meet within 12 px just beyond them, then fan out again. The sinking line
  passes the maw less than 20 px outside its horizon, and misses without it.
- **Rendezvous:** the tee parks, and the plan (launch 4.2 s in, one burn two
  laps later, one steering pulse) goes down. Over the rest of the mouth's turn,
  the same plan almost never goes down, and ten or more of those launches end
  in the maw on the rail.
- **Heavy Water:** every sink at any moment goes through both pairs, and the
  line into the gold mouth goes down with the cage open and not with it shut.
- **Grand Tour:** the gate opens and shuts on the line, the line parks on the
  orbit with no burn, the burn goes down, and the same burn a lap later ends in
  the maw on the rail.

On holes 4 to 6 the direct line is proved not to work: the tests fly the
straight shot into hole 4's and hole 5's mouths and require it to end in the
maw, fly two retro pulses on hole 4 and the plate line on hole 5 and require
the cup, and fly hole 6's opening line for its whole clock and require it to
touch nothing at all, then burn outward after one lap and require the cup.

The tee is spent once the charge is away: the launcher fades and the charge
passes through it, which matters on hole 6, where a clean circular orbit comes
back through the tee every lap. Every flight is spent after the hole's own
clock (`flightSeconds`, nine seconds unless the hole says otherwise; the orbit
gets eighteen).

Controls on the course: the **mouse** aims (with Aim at cursor, point
where the charge should go; the further from the tee the cursor sits, the
finer the aim), and in flight it steers the heading the next pulse pushes
along the same way (point where the next pulse should push) — the charge on
the tee is the pivot, so turning swings the frame round the charge and the
charge stays exactly where it is; the **right button** held while aiming (or
steering, while the gauge has anything left) makes sideways travel a fine
turn, an eighth of what it would be, and the cursor lets go until the mouse
moves again on its own, so a line a fraction of a degree wide can be found by
hand; a
**left click** or **Space** launches, then spends one pulse per click; the
**right button** runs a spent flight out at triple speed once the gauge is
empty and the outcome is fixed; **R** re-tees (abandoning a flight, or
restarting the hole from the tee); **P** (a controller's Start) brings up the
hole as a map and nothing else, every body named and the wormhole mouths
paired, and P, Esc, Enter or a tap on it goes back to the hole; **Esc** (a
controller's B, or the ❚❚ button in the HUD) brings up the same map with a
slim row of buttons along the bottom: resume, restart the hole, the course,
the main menu. On a controller and a phone the course plays as the arena
does: rotate to aim, thrust to launch, pull in for fine aim. The launch is a
fresh press: a thrust still held from closing the map (a controller's A both
presses Tee off and thrusts) waits to be let go, so it never spends a launch.

The **Galactic Golf** button opens the course: the holes as a roster, each
with its par and your best on it, and the round as one button. A tab at the
top switches between this course and the Far Course (below). Play the round
and the card at the end reads every hole against its par; pick a hole and it
plays on its own, scored against its own par and best, with its card offering
the same hole again, the next one, or the course.

Each hole opens on that map as a briefing (its name, what it asks, the key to
the map and the controls, shown only then), and every flight leaves a ghost: the
line your last shot flew is drawn faint under the next one, so an aim is
adjusted against something rather than guessed again.

### Holes bigger than the screen

A hole may be bigger than the window. It declares `view`, the size of the
window in world units (every big hole uses one arena's worth, 1600 × 900, so
it plays at the same zoom as the small ones), and the renderer scales to that
instead of to the level. A camera then carries the window over the world: it
holds the tee while a launch is aimed, follows the charge in flight, led a
little by its velocity so the ball is not pinned to the centre of the screen,
and never shows past a world edge. The floor, walls and obstacles are still
drawn once, into a static layer the size of the whole world, and a window of
it is blitted each frame; a world too big to hold at full pixel density drops
its density rather than its walls. The camera's arithmetic is a small pure
module, `src/camera.js`, and the tests drive it.

On a hole that scrolls, **P** is a real map: the whole hole drawn to fit the
screen, every body, mouth and wall on it, the flight so far and the ghost of
the last one, and a dotted rectangle showing what the window is looking at.
On a hole that fits the screen it is what it was, the hole dimmed in place
and labelled.

A pair of mouths may be **one-way** (`oneWay`), its far mouth only letting go:
Relay's far mouth sits on the orbit it sets you down on, and a two-way mouth
there would take the charge back after one lap.

Two deliberate limits, since they shape what the mode can be:
* **A flight is spent after the hole's clock.** A charge never stalls (the
  floor speed is the ball's), so without a clock one would bounce around the
  room until it fell in the cup by accident. Nine seconds is roughly twice a
  clean line, which is enough for a bank shot and not enough for a lottery;
  a hole sets its own where it needs to, and the orbit gets eighteen.
* **The guide is one leg, and it ignores the fields.** A full curved path
  through the gravity would solve most holes on sight, so the tee draws the
  launch direction and nothing more.

What the mode reuses, rather than reinvents:

| Piece | What it becomes on a hole | Source |
|---|---|---|
| The gravity well | Stones, maws and the cup, all fields now summed | `wellsAccel`, `swallowingWell` in `src/gamestate.js` |
| Solid discs in the wall list | A stone's surface, exactly as a turret's is | `createGameState` in `src/gamestate.js` |
| Ball vs walls, polygons and movers | Every obstacle, plate and turning bar on a hole | `advanceBall` in `src/sim.js` |
| The speed cap and its tunnelling margin | Gravity can wind a charge up hard, and the walls still hold | `BALL`, `PHYSICS_DT` in `src/config.js` |
| Tempo-following music | The track speeds up as the charge whips round a stone | `setBallSpeed` in `src/audio/engine.js` |
| The sequencer and its voices | Six tracks of the course's own, in a room the arcade's never use | `TRACKS` in `src/audio/tracks.js` |
| The level format and the renderer | A hole is a level definition with a tee instead of a boss | `hole()` in `src/golf.js` |

The whole course is proved playable in `test/physics.test.js`: every hole has a
launch line that sinks the cup with no fuel spent and none of them is sunk by
the line it opens on, a stone is never a horizon, a wormhole never sets the
charge back down inside a mouth, and a band of nineteen near lines on the last
hole goes from three sinking bare to all nineteen sinking once the gauge is
allowed one or two pulses — which is the mode's whole claim, that the aim opens
the shot and the gauge finishes it.

### The course's music

None of the arcade's tracks plays on the course. Each hole has its own,
written for the void rather than the grid: slower (80 to 110 BPM against the
levels' 122 to 150), in lydian and dorian modes and long-held major sevenths,
with pads that take two to four seconds to arrive, a bell voice that exists
nowhere else in the game, and drums that come in late if at all.

| Hole | Track | Key | BPM | Source |
|---|---|---|---|---|
| 1 | Slip Orbit (Drift Theme) | C lydian | 92 | `TRACKS.slip` in `src/audio/tracks.js` |
| 2 | The Narrows (Mouth Theme) | A dorian | 100 | `TRACKS.narrows` |
| 3 | The Maw (Horizon Theme) | F# minor | 86 | `TRACKS.maw` |
| 4 | Aftermouth (Slow Stone Theme) | E mixolydian | 104 | `TRACKS.aftermouth` |
| 5 | Carom (Bank Theme) | G lydian | 110 | `TRACKS.carom` |
| 6 | Long Orbit (Body Theme) | D major | 80 | `TRACKS.orbit` |
| 7 | Matched Pair (Two Colours Theme) | B minor | 98 | `TRACKS.pair` |
| 8 | Relay (Long Hole Theme) | E minor | 96 | `TRACKS.relay` |
| 9 | Twin Bodies (Transfer Theme) | A major | 78 | `TRACKS.twins` |
| 10 | The Deep (Open Space Theme) | C# minor | 74 | `TRACKS.deep` |
| 11 | The Long Way (Clock Theme) | G major | 108 | `TRACKS.longway` |
| 12 | Binary (Two Stones Theme) | F lydian | 90 | `TRACKS.binary` |
| 13 | Lockstep (Two Mouths Theme) | E-flat lydian | 94 | `TRACKS.lockstep` |
| 14 | Syncopation (Two Clocks Theme) | D dorian | 102 | `TRACKS.syncopation` |
| 15 | Lenses (Focus Theme) | B-flat lydian | 96 | `TRACKS.lenses` |
| 16 | Rendezvous (Parking Orbit Theme) | F minor | 88 | `TRACKS.rendezvous` |
| 17 | Heavy Water (Slow Descent Theme) | C minor | 76 | `TRACKS.heavywater` |
| 18 | Grand Tour (Last Hole Theme) | E major | 104 | `TRACKS.finale` |

To get there the engine gained a few knobs a track may set, all of which the
level tracks leave at their old defaults: `fx` sizes the room (the reverb and
delay returns, the delay's feedback, its tone and its length in beats, so a
track can run a dotted-quarter or a two-beat echo instead of the arcade's
dotted eighth), `pad` sets the pad's swell, release, filter and the rate and
depth of its wobble, `arp.wave` lets an arpeggio run on triangles rather than
saws, and the `bell` layer strikes chord tones from a 16-step pattern and
sends most of each strike into the delay. Every course track is in the
jukebox alongside the levels'.

## Galactic Golf: the Far Course

A second course, next to the first and open from the start: the course page
has a tab for each, and each keeps its own round card and its own best round
(the Outer Course's stays in `total` in the browser's `deflector.golf`, the
Far Course's goes in `totals.far`; per-hole bests share one table, since
every hole on both courses has its own id). The Far Course is for a player
who has finished the first one. No hole on it gives itself away, it is drawn
in a colder light (`FAR_PALETTE`), and its music is in minor keys.

It is being built in three rings of six. How hard each ring is, is measured
as the share of launch lines and launch moments that sink with no fuel spent:

| Ring | Holes | Bare sinks allowed | Source |
|---|---|---|---|
| Outer | 1 to 6 | About one line in a hundred | `FAR_COURSE` in `src/golf.js` |
| Middle | 7 to 12 | About one in two hundred | (to come) |
| Inner | 13 to 18 | None worth the name: the gauge is needed | (to come) |

The Far Course brings the arcade's pieces out to the void, with rules of
their own on the course:

| Piece | On the course | Source |
|---|---|---|
| Glass | An obstacle with `glass: true`. It breaks only for a charge at the hole's break speed (1000 px/s unless the hole says otherwise), which the launch and the whole gauge together cannot reach; the charge goes on through at 85% of its speed, and the pane stays broken until the next launch. Leaded panes never break | `paneBreaks`, `breakPane` in `src/gamestate.js` |
| Switch and door | A switch node opens the doors it is wired to for its `holdOpen` seconds, then they shut on their own, though never on a charge in the doorway. A second strike starts the count again | `golfSwitch`, `golfDoors` |
| A stone that phases | A solid body with a `phasing` clock: there for `on` seconds, gone for `off`, and while gone it neither pulls nor stops anything. A ring round it is its clock, counting down while it stands and filling in while it is away | `PhasingStone`, `tickOrbits` |
| Emitter | A floor emitter whose rings shove the charge. A ring that catches a charge from behind throws it on, faster; one met head on throws it back. On the course the rings keep the hole's own clock, so a launch at the same moment always meets the same rings | `tickEmitters` |
| Moving cup | The cup itself on a rail, like a maw on a rail | `placeRails` |

A new launch puts every piece back as the hole opened: panes whole, doors
shut, switches dark (`golfRestore`). The test harness flies all of them
through the same helpers the game does, so a route that sinks in the tests
sinks in the browser.

The outer six:

| Hole | Name | Par | Clock | What it asks | Source |
|---|---|---|---|---|---|
| 1 | Needle | 3 | 3.6 s | No gauge at all. One channel through a thick wall, 55 px across for a 22 px charge, and a stone that bends every line on the way to it. The line that threads it is about a degree wide | `FAR_COURSE[0]` in `src/golf.js` |
| 2 | Carousel | 4 | 8 s | Two screens wide. The cup rides a rail round a stone, with a maw on the same rail half a turn behind; a fence with one gate keeps strays out. The line through the gate needs the moment too: the right line sinks at only a few moments in each nine-second turn, and a pulse aimed at the cup brings a near miss home | `FAR_COURSE[1]` |
| 3 | Glasshouse | 4 | 7 s | Two screens tall. A floor of glass over a deep maw, and the cup above it. Only a charge diving past the maw's edge is fast enough to break the floor, and it comes up through far too fast to stop: two pulses above the glass set it down. The gauge holds four | `FAR_COURSE[2]` |
| 4 | Switchback | 4 | 8 s | Two screens wide. The cup's house has one door; the switch down the room holds it open for four seconds. Strike the switch, come back past the tee, and use the gauge to make the door in time | `FAR_COURSE[3]` |
| 5 | Eclipse | 5 | 10 s | Open space. Two stones that phase, on clocks of eight and seven seconds. A line that bends round one needs it standing; a line through where one stood needs it gone; the same line two seconds early misses | `FAR_COURSE[4]` |
| 6 | Breakers | 4 | 9 s | Open space. A great maw across the way, and just off the tee an emitter throwing a ring every three seconds, faster than the charge. Launch so a ring catches you from behind and it throws you past the maw at over 800 px/s; a second late, the ring meets you head on | `FAR_COURSE[5]` |

The course-wide tests check the Far Course every other degree rather than
every degree (18 long holes at every degree would double the suite's time).
Each hole must not sink on the line it opens on, and at most two of its 180
bare lines may sink. Each hole's own test then flies its route exactly and
shows what carries it:
- **Needle:** the gauge is dry, the channel is wider than the charge and
  narrower than three, and the line sinks a quarter degree either side while
  a degree off does not.
- **Carousel:** the maw stays half a turn from the cup, the line through the
  gate sinks at its moment and not half a turn later, and near misses a
  quarter and a half degree either side are each steered home with one pulse
  aimed at the cup.
- **Glasshouse:** the launch and the whole gauge cannot break the glass, the
  dive does, and the burn above it sinks the line a quarter degree either
  side.
- **Switchback:** the route goes down; with no switch the door never opens,
  and without the gauge the charge does not make it back in time.
- **Eclipse:** two phasing stones on different clocks; the line sinks at its
  moment, not two seconds earlier, and not at all if both stones stand for good.
- **Breakers:** a ring runs faster than the charge; the line sinks when a ring
  catches it from behind, not a second later, and not with no ring at all.

The Far Course's music:

| Hole | Track | Key | BPM | Source |
|---|---|---|---|---|
| 1 | Needle (Eye of the Needle Theme) | F# minor | 68 | `TRACKS.needle` in `src/audio/tracks.js` |
| 2 | Carousel (Night Fair Theme) | D minor | 84 | `TRACKS.carousel` |
| 3 | Glasshouse (Pane Theme) | B minor | 72 | `TRACKS.glasshouse` |
| 4 | Switchback (Signal Box Theme) | G minor | 92 | `TRACKS.switchback` |
| 5 | Eclipse (Two Clocks Theme) | E-flat minor | 64 | `TRACKS.eclipse` |
| 6 | Breakers (Shoreline Theme) | A minor | 88 | `TRACKS.breakers` |

They are slower and wetter than the first course's, and sparser: an arpeggio
may now rest on a step (`null` in its pattern), so a figure can leave room
between its notes. The music test holds every Far Course track to a minor key,
and every track on both courses to being its own.

## Online multiplayer (different networks)

The LAN server only works on one Wi-Fi network, because the guest has to reach
the host's private address. For play over the internet the game needs a relay
that both browsers can reach, and `relay/` is that relay as a Cloudflare
Worker with a Durable Object per room. It speaks exactly the LAN relay's
protocol, it is free at a couple of friends' scale, and it never sleeps. A
host connects to `/ws?create=1`: the Worker picks the room's code and opens the
object named for it, which Cloudflare creates near that first request, so every
room's relay sits by its own host (a Durable Object stays where it was first
made, which is why one object shared by every room could have ended up
anywhere). A guest connects to `/ws?room=CODE` and reaches the same object. A
client with no room in its address, an older copy of the game, still gets the
shared object and its rooms. `/health` answers from the Worker itself, so a
page load wakes no object.

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

The relay protocol carries a version (4: a room per object), and the lobby
warns when a deployed relay is older than the game (redeploy it with the same
command, or let the workflow below do it). An older relay still works; it
just keeps every room in its one shared object.

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
free. A match played through it sends about 120 messages a second (snapshots
and inputs each go at a fixed 60 Hz, whatever the players' displays run at),
which is a few hours of play a day inside the free plan's daily allowance;
with a direct connection open (below) the match itself costs the relay next
to nothing. Test the Worker locally with `npm run dev` in `relay/` and
`?relay=ws://127.0.0.1:8787` on the game.

Latency: the host runs the simulation, so a guest would feel the round trip
on everything. These take the edge off it, the same things most networked
games use:

* **Prediction.** A guest's own character is simulated locally and reconciled
  with the host's state as snapshots arrive, so movement responds at once. For
  that to hold, the host must do with the guest's inputs exactly what the
  guest did. Each frame a guest sends a record of its input and how many
  physics steps it covered here, repeating its last six in every message so a
  lost one costs nothing. The host keeps them in a queue, like a jitter
  buffer, and plays each for exactly those steps (`src/inputqueue.js`). When
  the queue runs dry the guest's character waits where it is rather than
  being guessed at. Each dry spell grows the queue's cushion by a frame, up to
  200 ms, and a calm second shrinks it again. After a stall the host plays two
  steps a step until caught up. A queue far too deep is trimmed, and a thrust
  in what was trimmed still happens. The host acknowledges `[seq, steps]`,
  every record to `seq` and so many steps of the next, and the guest replays
  exactly the rest. Previously the host kept only the newest input, so inputs
  arriving in a burst overwrote each other: with 0 to 150 ms of jitter, 2 thrusts
  in 10 never happened and the guest was pulled back more than 10 px 13 times
  in 8 seconds. With the queue every thrust lands, and it happened once in
  that time. Corrections to the guest's own shield angle now ease out over
  80 ms like position ones, instead of snapping.
* **A render buffer.** A guest draws the ball and the other players a little
  in the past, between two snapshots that have both arrived, rather than at
  the newest as it lands. The view keeps a clock of its own, in host time:
  the host's "now" is read from a smoothed arrival clock rather than from
  whichever packet came last, so a late packet moves nothing, and the view's
  clock runs up to a quarter fast or slow to sit the buffer's length behind
  that, never jumping and never going backwards. The buffer is sized from
  the link itself: two snapshot gaps plus the worst lateness of the last few
  seconds, between 40 and 250 ms. A late packet then never shows, so long as
  it is less late than the buffer; a packet later than that carries the ball
  on for 60 ms and holds, and the clock catches up gently once packets return.
  Snapshots are slotted in by host time (a direct link does not keep order)
  and a second copy of one, by serial number, is dropped. The sparks and
  sounds of a hit are played as the view reaches their snapshot, so they land
  where the ball is drawn; every event rides in two snapshots in a row, with
  an id, so a lost packet loses no sound and none plays twice; and any a
  stall has left more than 300 ms behind are dropped rather than heaped into
  one frame (`noteArrival`, `bufferFor`, `advanceRenderClock`,
  `insertSnapshot`, `bracket`, `lerpView` in `src/netstate.js`).
* **Latency compensation.** A guest sees the ball where it was some time ago,
  and plays that ball. Every input record carries the host time the guest's
  view was showing (the view's clock is kept in host time), and each step of
  it is paired with its share of that frame's view, so the host knows
  exactly which ball the guest was looking at, step by step. When the guest's
  shield, where they have it now, would have met that ball, the host plays
  the contact they saw: the ball is rewound to it, reflected off the shield,
  and carried forward again through the walls it would have met since
  (`viewLag` and `rewoundContact` in `src/lagcomp.js`, `lagCompensate` in
  `src/main.js`). The host never rewinds past another shield's hit or the
  serve (a wall or a mover bounce is deterministic, and the replay takes it
  again), past 400 ms (beyond that it does not rewind at all, rather than to a
  moment the guest never saw), or for its own shield, which sees the ball as
  it is. The cost is the usual one: on the host's screen a ball that had just
  passed a lagging guest's shield can come back off it.
* **Hit prediction.** Compensation makes a guest's block count, but the
  proof arrives a round trip later: until then the snapshots already on their
  way show the ball going through the shield, then it jumps back. So a guest
  checks its own shield, after its own physics steps, against the ball it is
  drawing, through the host's own ball physics; on contact the bounce and its
  sound play at once and the ball flies on locally, off walls, movers and
  that shield, until the host's record of the hit arrives, when it glides into
  the host's ball over 120 ms. If the host never confirms it (past the
  longest rewind and a little more) the ball glides back to where the host has
  it. Measured on a block made at the last moment over a 60 ms link: without
  it, the guest saw the ball sink 49 px through the shield for 120 ms and jump
  back 97 px; with it, the bounce shows 180 ms sooner and the ball never
  moves more than its own 3 px a frame. It needs compensation on at both ends,
  and the host says in every snapshot whether it has it on.
* **A direct connection.** The relay runs over TCP, which never loses a packet
  but holds every later one back until a lost one is resent, a round trip at
  least: on Wi-Fi that turns ordinary loss into the bursty jitter a snapshot
  stream suffers from. So as each guest joins, the host offers it a WebRTC
  data channel, unordered and never resent, with the handshake carried by
  the relay and free public STUN servers (Google's and Cloudflare's) telling
  each browser its public address. When it opens, snapshots, inputs and pings
  go straight between the two browsers, and a lost packet costs only itself;
  everything that must arrive (setting up rounds, the lobby, the handshake)
  stays on the relay. Where a network allows no direct link (some mobile and
  carrier-grade NATs would need a paid TURN server), or it drops, play simply
  carries on through the relay. The HUD says `DIRECT` or `RELAY` for each
  link.
* **A match that never freezes.** A browser stops animation frames in a
  hidden tab, and the host's tab is where everyone's match runs. While a
  host's tab is hidden a worker's timer, which the browser does not hold
  back, drives the game at 60 Hz without drawing, until the tab comes back.

Each of the five has a switch, so one can be tested without the others:
under **Netcode** in the multiplayer lobby (remembered in that browser), or
**1** prediction, **2** buffer, **3** compensation, **4** hit prediction and **5**
direct connection during a match, with the HUD naming whichever are off.
Prediction, the buffer and hit prediction act on a guest's own screen (a
guest with prediction off is drawn where the host last put them, a full round
trip late; with the buffer off every snapshot is drawn as it lands and its
sparks play at once, as before the buffer existed). Compensation is the
host's rewinding: the host's switch turns it off for everyone, and a guest's
switch sends no view time, so only their own shield goes uncompensated. The
direct connection needs both ends: either one switching it off closes it,
and switching it back on asks for a new one.

The HUD shows the round trip and its jitter (`84 ms ±6`), the path (`DIRECT`
or `RELAY`), and on a guest how far behind the host's now the view is drawn.
In the lobby every player's own leg to the relay is measured
separately (the relay answers a ping for itself), which is what tells the
links apart: the relay sits near the host, so a guest's leg is their link
plus the distance, and the host's is their link alone. A host whose leg is
far less steady than a guest's is told that a room the guest creates would
run smoother for everyone, since the host's link is every player's link.

How it works: the server is also a tiny WebSocket relay (`/ws`, no
dependencies). The host's browser runs the physics exactly as in single
player, with the second character driven by the guest's inputs instead of the
AI. It streams state snapshots and effect events at 60 Hz (`src/netstate.js`);
the guest mirrors them and streams its input records back. On a home network that is a few milliseconds of lag. The
static Vercel deployment cannot relay, so the button is disabled there.

## Controls

| Action | Keys / pointer |
| --- | --- |
| Move | **W A S D** (the arrow keys do the same), or drag a finger on a phone |
| Rotate character and shield | **Mouse**: point, and the shield turns to face the cursor (the default); or, under **Settings → Mouse** on the title screen, a Turn mode where moving the mouse right or back turns clockwise and left or forward counter-clockwise; **scroll** up nudges a notch clockwise, down counter-clockwise |
| Thrust the shield forward ("whack") | **Left click** or **Space** |
| Pull the shield in (soft return, slows the ball) | **Right click** |
| Pause / mute / restart | **P** (or the ❚❚ button in the HUD, which is how a phone pauses) / **M** / **R** |
| Galactic Golf: launch, then one ion pulse per click | **Left click** or **Space** (the mouse aims the launcher, and in flight the pulses; **right click** held with sideways travel is fine aim, an eighth of the travel; **right click** runs a spent flight out, **P** is the hole map and **Esc** the menu over it) |
| Controller (Xbox or any standard gamepad) | **left stick** moves, **right stick** or **LT** / **RT** rotate (further is faster), **A** thrusts, **X** pulls the shield in, **Start** pauses, **A** also confirms on menus |
| Blaster, Wormhole Variant: put out each end of your pair | **Q** (light end) and **E** (dark end), or **LB** and **RB** on a controller; each goes on the first surface you face, and pressing again moves it |
| Netcode switches (online play) | **1** prediction, **2** render buffer, **3** latency compensation, **4** hit prediction, **5** direct connection, each on or off; also in the lobby under Netcode |

The mouse has three ways to turn the frame, chosen under **Settings → Mouse**
on the title screen and remembered in the browser:

| Mouse setting | What it does | Source |
| --- | --- | --- |
| Aim at cursor (the default) | The shield turns, the short way round, to face the cursor, measured from the frame's centre (on the course from the charge; in flight, the pulses' heading from the charge as it flies). A cursor within 24 px of the centre holds the last direction. | `aimTurn`, `pollMouse` in `src/input.js` |
| Turn: sideways and forward/back | Moving the mouse turns the frame like a knob: right and back clockwise, left and forward counter-clockwise, the two adding up. | `travelSpin` in `src/input.js` |
| Turn: sideways only | The same, with forward and back ignored, so the natural arc of a wrist flick never cancels itself. | `travelSpin` in `src/input.js` |

Every mode turns the frame at the frame's own turn speed (its Gyro), the same
top rate a stick or a touch button gets, because that rate is also how hard a
swing whacks. That is why Aim is the default: a relative mouse on a
rate-limited frame must either lag behind the hand or throw some of its
travel away, while an aimed frame simply heads for the cursor, however fast
the hand moved, and arrives there. It asks for 60% of the remaining way each
frame, so the spin's own ramp never carries it past, and it stops within a
thirtieth of a degree. Another input turning the frame (a stick, a trigger,
a touch button, the wheel) takes over until the mouse moves again, so a
resting cursor never fights a controller. A guest in an online match aims
from where its own commands should have put the shield, not from the angle
it draws (the host's, replayed forward, which the host's corrections nudge a
few degrees at a time), and lets that estimate ease onto the shield once the
mouse is still; aiming from the drawn angle, the shield chased every nudge
and hunted round the cursor.

In the Turn modes a slow travel turns by exactly as much as the hand moved (a
full turn in about 630 px at speed 1×; the speed beside the setting scales
it from 0.5× to 2×), the pacing is told each frame what the frame actually
turned and puts any shortfall back, and a flick is carried for a quarter
second of turning at the frame's rate before anything is cut. While a level
runs, the first click captures the mouse (that click neither thrusts nor
pulls, and the hand can keep going in one direction); **Esc** gives it back,
and the game lets it go on every pause and menu. Aim needs the cursor, so it
never captures it. In any mode a wheel notch is fifteen degrees, and nothing
the mouse does while the frame cannot turn (frozen, paused, between shots on
the course) is saved up to spin it afterwards.

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
* **Nothing can be crushed out of the room.** A fighter is settled against the
  static walls, then the movers, then the static walls again, so the wall and
  not a moving slab has the last word: someone caught between a piston and the
  rock slides along the rock instead of being driven into it. Two recoveries
  back that up, for the case where a slab closes on a fighter already flat
  against a wall: one whose centre still ends up inside a solid is pushed out
  through the nearest face (`ejectFromPolygon`), and one driven out through
  the room's own wall is brought back inside (`clampInsidePolygon`). All of it
  lives in `settleFighter` in `src/main.js`.
* One hit on the boss's body wins the level. A hit on your body costs a
  shield and the ball re-serves behind a fresh countdown; with no shields
  left the level is lost. How many shields you get is the difficulty.
* **The serve has to be played.** Until a shield (yours or the boss's) has
  touched the ball since the launch, it beats no boss, knocks out no drone
  and lights or flips no node: it bounces off them, with a red flicker on a
  node and a HUD notice, and wall bounces do not count as playing it. A
  body hit on you counts from the launch, so a serve cannot be waited out.
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
| `foresight` | wall bounces it can follow when forecasting (see below) |
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

### Foresight: how far ahead a boss can see

A boss makes three forecasts, and all three are cut from its one `foresight`
stat, the number of wall bounces it can follow:

| Forecast | What it is for | Depth | Source |
|---|---|---|---|
| threat | following the incoming ball to work out where to stand | `foresight` | `findThreat` in `src/ai.js` |
| read | following the ball to your shield and back off it (anticipation) | `foresight + 1` | `predictReturn`, same file |
| aim | scoring its own candidate returns | `foresight - 1`, never below 1 | `chooseReturnAngle`, same file |

Each leg gets the same distance allowance (`LEG_RANGE`, 800 px), so a deeper
forecast looks further as well as through more banks. A boss with no
`foresight` set uses `DEFAULT_FORESIGHT` (3), which gives 3 / 4 / 2 — exactly
what every boss used before this was a stat, so conduit drones are unchanged.

The ten campaign bosses now ramp, so a bank that beats the Warden is read by
the Architect:

| Level | Boss | Foresight | Source |
|---|---|---|---|
| 1 The Antechamber | The Warden | 1 | `LEVELS` in `src/levels.js` |
| 2 Prism Vault | The Refractor | 2 | same |
| 3 Coolant Tunnels | The Sump | 2 | same |
| 4 The Hollow Reactor | Core Sentinel | 3 | same |
| 5 Switchyard | The Shunter | 3 | same |
| 6 Glass Cathedral | The Choirmaster | 3 | same |
| 7 The Undercroft | The Sexton | 4 | same |
| 8 Signal Spire | The Beacon | 4 | same |
| 9 Nullspace | The Absence | 5 | same |
| 10 The Last Arcade | The Architect | 5 | same |

What this measurably changes is the **read**. Over 4000 random ball states per
level, the share the boss can anticipate a return from roughly doubles across
the ramp, from about 4% at the Warden's depth to 10-15% at the Architect's: a
ball that reaches you by a long banked route is invisible to an early boss and
already planned for by a late one. The threat and aim depths were measured too
and did not move interception in a test harness, because `leash` and
`threatRadius` decide where a boss will stand long before the forecast does.
Planning stays cheap: the worst level (the Undercroft, 128 wall segments)
costs about 0.6 ms for one plan, and a boss plans three to five times a second.

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
with the room's breath. The Absence is drawn as a hole in the grid (`ghost`)
and phases like its draft in the Event Horizon (`phasing: { on: 3, off: 2 }`):
solid for three seconds from each serve, then gone for two, when the ball
passes through it and it passes through you.

Level 10 is the gauntlet: the prism at the centre, a rail column with two
alternating sliding doors, a screen of breakable glass around the Architect,
ice behind its blocks and a pulse. Nothing new to learn; everything to use.

Adding a level means adding an entry to `LEVELS` in `src/levels.js` (boundary
polygon, obstacle polygons via `rect(cx, cy, w, h, angleDeg)`, optional
`movers`, spawns, boss parameters) and a track to `src/audio/tracks.js`. The
title screen lists every built level under **Levels** and lets you pick one.

## The title screen

Everything on the title screen fits on one screen, down to 1280 by 720 and a
phone held upright, because most of it folds away. **Levels**, the frame's
**Details**, **Controls**, **How to win** and **Settings** (Quality, Sound and
Mouse) each open with a click on their heading and start closed. One you
open stays open while the screen redraws (picking a level redraws it), and a
fresh visit starts with all of them closed. The frame's dropdown, Difficulty
and the own-ball rule stay out, since they change every game.

A level's card (its number, name, boss, brief and record) is a context
overlay rather than a panel. Hover over or tab to any level in the list and
its card appears beside the list. The **i** next to the selected level on the
Levels line pins that level's card, even with the list folded; this is also
how a touch screen gets it. A click or tap elsewhere, or Esc, puts it away.
`showTitle`, `foldHtml` and `bindLevelPop` in `src/main.js`.

## Lore

You are the Defector. The grid is a system of sealed rooms, the ball is the
charge that travels between them, and every program in the grid is a
reflector at heart: it gives the charge back exactly as it came. You were one
of them, a wall with a name, until you moved (a moving shield adds to or takes
from the charge, which no wall can do) and then turned on the other programs.
The written mark is that name being rewritten one reading at a time:
REFLECTOR, DEFLECTOR, DEFECTOR, and a last reading, VECTOR, that the record
has not filled in yet.

The title screen carries the system bulletin about you, each level's card
(its resident program, its brief and its line from the record, shown beside
the level list), and a **Read the record** link
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
* **Sound setting** under Settings on the title screen: Snappy or Steady. Snappy asks the
  browser for its smallest output buffer, so a hit is heard the instant it
  lands; Steady asks for a 60 ms one, which a machine busy drawing (or a
  guest's, parsing sixty snapshots a second) can keep fed, at the cost of
  hearing hits a hair later. The music's sequencer schedules 300 ms ahead of
  the audio clock, so a main thread held up for less than that costs no note.
* **Quality setting** under Settings on the title screen: Auto, High or Low. Low caps the
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
src/frames.js              the four frames, the eight cells and what they buy
src/golf.js                Galactic Golf: the Outer Course, its holes and its tunables
src/camera.js              the camera for a level bigger than the screen (pure)
src/lore.js                worldbuilding: the bulletin, the record's chapters, status words
src/input.js               keyboard, mouse, touch, gamepad -> one intent object
src/net.js                 the relay client, direct WebRTC links, link measurements
src/netstate.js            snapshots, and the guest's render buffer, clock and interpolation
src/inputqueue.js          a guest's inputs as the host plays them, step for step (pure)
src/lagcomp.js             latency compensation: which ball a guest was looking at (pure)
src/render.js              Canvas 2D neon renderer with 2.5D wall extrusion
src/fx.js                  particles, rings, screen shake
src/audio/engine.js        Web Audio synths, sequencer, tempo-follow, SFX
src/audio/tracks.js        per-level track definitions
test/*.test.js             node --test suites (physics, net, input, input queue)
server.js                  zero-dependency static server + LAN relay
relay/                     the same relay as a Cloudflare Worker for online play
desktop/                   Electron wrapper for the Windows and macOS builds (bundles server.js)
.github/workflows/         relay deploy and desktop release automation
```

## Mobile roadmap

The game logic never touches events directly, and the renderer scales the level
to any viewport, so the mobile build is mostly input and packaging:

1. Tune the touch layout further (the floating joystick and buttons are in;
   a two-thumb layout with rotation on a second stick is the next candidate).
2. Wrap with Capacitor for iOS/Android store builds; the manifest and icons
   already make it installable as a PWA.
3. Reduce glow (`shadowBlur`) on low-end devices if the FPS readout drops.
