# Deflector

A browser arena game. Its modes are:

- the campaign: ten levels with bosses, and conduits between them
- versus and co-op multiplayer
- Blaster, and its Wormhole Variant
- Galactic Golf: the Outer Course and the Far Course

The code is plain ES modules. There is no build step and there are no runtime
dependencies. Vercel serves the repo root, and `main` deploys on every push.
`README.md` is the design document: every mode, rule and tunable is explained
there, and its "Layout" section maps the files.

## Run and test

- `npm start` serves the game and the LAN relay on port 8080 (`node server.js 8099` for another port).
- `npm test` runs the whole suite in about 3 minutes, most of it the golf sweeps in `test/physics.test.js`. Always use `npm test`: `node --test test/` does not work.
- `npm test -- --test-name-pattern="Far Course"` runs part of the suite.
- For browser checks, headless Chromium through Playwright works well. `window.__game` exposes the state machine and the live game. `tools/` has scripts that already do this; see `tools/README.md`.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/main.js` | The state machine, the fixed 240 Hz loop, collision dispatch, and all HUD and overlay wiring. It is the only big DOM module. |
| `src/sim.js`, `src/physics.js`, `src/entities.js`, `src/gamestate.js` | Physics and level state. They are DOM-free, and the tests import them directly. Keep them that way. |
| `src/levels.js`, `src/conduits.js`, `src/golf.js` | Level, conduit and golf hole data, and the helpers that build them. |
| `src/render.js`, `src/fx.js`, `src/camera.js` | The Canvas 2D renderer. |
| `src/audio/engine.js`, `src/audio/tracks.js` | The procedural music engine, and one track per level and hole. |
| `src/net.js`, `src/netstate.js`, `src/inputqueue.js`, `src/lagcomp.js`, `src/portals.js` | Multiplayer: the relay and WebRTC client, snapshots, guest input replay, lag compensation and Blaster wormholes. |
| `server.js` | The static server and LAN relay. |
| `relay/` | The same relay protocol, as a Cloudflare Worker. |
| `desktop/` | The Electron wrapper. |
| `tools/` | Design and screenshot scripts. They are not shipped. |
| `sequel/` | Defector, the sequel: `index.html`, `style.css`, `src/`, `test/` and `tools/`. Its DOM modules are `main.js`, `render.js`, `art.js`, `input.js` and `audio.js`; the rest of `sequel/src/` is DOM-free. |

## Conventions

- **Commit and push each finished change.** Push to `main` (Vercel deploys it) and to the session's working branch: `git push origin HEAD:main HEAD:<working-branch>`. The relay deploy workflow commits to `main` itself, so if a push is rejected, fetch and rebase first.
- **Attribution.** Follow the session's instructions for commit trailers. Never put model names or IDs anywhere else: not in code, comments, docs or commit text.
- **Never commit credentials.** Relay secrets live in the repository's Actions secrets.
- **Don't commit `relay/package-lock.json`.**
- **Version.** Bump it only when asked. It lives in:
  - `GAME_VERSION` in `src/config.js`
  - `package.json`
  - `desktop/package.json`
  - both version fields at the top of `desktop/package-lock.json`
  - the tag example in the README's "Cutting a release"
- **Relay protocol.** Bump `RELAY_PROTOCOL` in `src/config.js` when the relay's message format changes, because the game uses it to detect an out-of-date relay.
- **Style.** Match the surrounding code:
  - two-space indent, single quotes and semicolons
  - comments that say why, in the game's own voice
  - test names that read as sentences
- **Documentation.** A change players can see goes in the README too.
- **Tables.** Tables in docs and replies put the reference source in a separate column, never in the same cell as the data.

## Golf design rules

A hole is data in `src/golf.js`. The tests hold every hole to these rules:

- **The tee never points at the answer.**
- **Bare sinks are capped.** A bare sink is a launch that reaches the cup without a pulse. The Far Course's 2° sweep allows at most 2 of 180 bare sinks on holes 1–6 and at most 1 on holes 7–12. Holes 13–18 are `noBareLine`, which allows none. An Outer Course hole needs at least one bare line, unless it is `noBareLine`, which allows at most 2 of 360. Check with `node tools/golf/sweep.mjs <id>` and `bare.mjs` before writing the test.
- **Each hole has its own test.** It flies the hole's route, ideally at ±0.25° and ±1 physics frame as well. It also has negative cases for the hole's tricks: the same route a second late, or with a burn missing.
- **Three flight loops must agree.** `golfFly` in `test/physics.test.js` and `fly()` in `tools/golf/fly.mjs` mirror the golf flight in `src/main.js` (`golfTick` and the fixed-step loop). If that loop changes, change all three.
- **The minimum speed leaks energy.** The ball's minimum speed (`BALL.minSpeed`, 150) is clamped after every step, so a charge that falls nearly radially, or slows at the far end of an eccentric orbit, gains energy. A maw on a rail can pump energy in too. Never trust a long orbit to stay bounded. Give it a backstop (a central maw, a wall, the clock), and sweep launch moments as well as angles.
- **Each new hole also needs** a track in `src/audio/tracks.js`, its README entry (the hole and the music table), and a look in the real game (`tools/golf/route.mjs`, `tools/golf/holes.mjs`) for its brief text and map labels.

## Defector design rules

Defector is the sequel, in `sequel/` (its README section is "Defector (the
sequel)"). The tests hold its levels and bosses to these rules:

- **Every level can be crossed.** `sequel/tools/reach.mjs` flies the robot's own physics over everything it can stand on. A level that fails it has a jump nobody can make.
- **A puzzle is a link.** A section that only a wormhole or a switch gets you past records itself in `bp.portalLinks`; `sequel/tools/solve.mjs` must solve every one in the real game, and the level must not be crossable without it. A new kind of puzzle needs its answer in `solve.mjs`, and a switch meant to take a bank or a curve must be out of every straight line (or every shot without its black hole).
- **Blinking platforms keep time.** `reach.mjs` takes a blinking platform as always there; `sequel/tools/timed.mjs` must cross every blinking stretch with the clock running.
- **Every boss can be beaten.** `sequel/tools/fight.mjs` fights it in the real game. A wormhole-only boss must also lose to it only with wormholes.
- **Lengths stay in their bands.** `estimateSeconds` in `sequel/src/build.js`: early levels 3 to 5 minutes, middle 4 to 8, late 8 to 15. Tune a level's `count`, not the estimate.
- **Levels are seeded.** Changing a level's `seed`, `count` or palette rebuilds its run; check it with the tools above and `node sequel/tools/shots.mjs level <id> out/`.
- **Every versus map can be played from every spawn.** In `sequel/src/maps.js`, every spawn and every power-up spot must be reached from every spawn by `reach.mjs`, and standing still on any of them must be safe (`sequel/test/versus.test.js`).
- **Multiplayer mirrors the one real game.** The host's `Game` is the only one that decides anything; a guest predicts only its own robot's movement (`Mirror` in `sequel/src/netplay.js`). Whatever a guest's robot stands on or goes through must reach it in the snapshot, and `sequel/test/netplay.test.js` must keep its predicted robot within a pixel of the host's. Defector's messages start with `dx`.

## A sequel or a new game

Build it inside this repo, in its own folder with its own page (for example
`sequel/index.html` with `sequel/src/`), reached from a button on the main
menu:

- **Imports go one way only.** The sequel may import from `src/` (physics, input, audio engine, relay client), but nothing in `src/` imports from the sequel. That keeps it easy to split into its own repo later.
- **Give it its own tests** under `test/` or `sequel/test/`, runnable by `npm test`.
- **Give it its own storage keys and its own relay room messages**, so saves and multiplayer never collide with the game's.
- **Ship it in the desktop app** by adding its folder to the `extraResources` filter in `desktop/package.json`. The filter lists every file the app copies, and anything missing from it is silently left out.
- **Vercel needs nothing**: it serves the whole root.
