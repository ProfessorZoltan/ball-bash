# Tools

Scripts used to build and check the game. None of them ship: Vercel serves
the repo root but nothing links here, and the desktop build copies only the
files its `extraResources` filter names. Run everything from the repo root.

## Golf design (`tools/golf/`)

These run the same physics the game does, in Node, with no browser. They take
a hole id (`g1`…`g18` for the Outer Course, `f1`…`f18` for the Far Course) or
the path of a draft module (see `draft.mjs`) wherever they take a hole.
Angles are in degrees, and times in seconds. A launch moment is the hole's
clock at launch, which matters on a hole with moving parts.

| Script | What it does | Example |
| --- | --- | --- |
| `fly.mjs` | The library behind the others. `fly(def, angle, opts)` flies one charge exactly as `golfFly` in `test/physics.test.js` does, and returns the end, the time, warps, bounces, events, top speed, closest pass and (with `trace`) the path. Pulses can be fixed headings, headings relative to the travel, or aimed at a mark or the cup the way a player aims by eye; `plan[i].used` records the heading each pulse fired on. | `import { fly, byId, R } from './fly.mjs'` |
| `sweep.mjs` | Bare launches round the whole circle: how each ends, and which sink. This checks the bare-sink caps the tests enforce. | `node tools/golf/sweep.mjs f13 2 0,5` |
| `bare.mjs` | Bare launches over angles × launch moments: ends, the wormhole pairs they reach, and every sink. | `node tools/golf/bare.mjs f14 0 10 1 1` |
| `tsweep.mjs` | For fixed launch lines, the launch moments that sink bare. | `node tools/golf/tsweep.mjs f11 40,41 0 9 0.05` |
| `pin.mjs` | Flies a route, prints the headings its pulses fired on (ready to paste into a test), then flies it ±0.25° and ±1 frame. | `node tools/golf/pin.mjs f15 104.5 0 '[{"at":0.05,"a":104.5},{"at":1.68,"a":104.7}]'` |
| `plot.mjs` | The hole as a plan: fields, rails, mouths, glass, doors and cages, with flights drawn over it, coloured by how each ended. Needs Playwright. | `node tools/golf/plot.mjs f17 f17.png '[{"a":-90,"pulses":[{"at":0.6,"a":-40.4}]}]'` |
| `draft.mjs` | The parts `src/golf.js` builds holes from (`farHole`, `planet`, `maw`, `cup`, `slots`…), for drafting a hole in its own module. A draft exports `def`; `draft-example.mjs` is one to copy. | `node tools/golf/sweep.mjs tools/golf/draft-example.mjs` |
| `route.mjs` | Flies a route in the real game in headless Chromium, the way a player would, and reports how it ended and when each pulse went. The harness and the browser should agree. Needs Playwright. | `node tools/golf/route.mjs f15 104.5 0 '[{"at":0.05,"a":104.5},{"at":1.68,"a":104.7}]' shot` |
| `holes.mjs` | Screenshots from the real game: the course page, and each hole's brief and bare map. Needs Playwright. | `node tools/golf/holes.mjs f13,f14 shots/` or `node tools/golf/holes.mjs far shots/` |

Pulses in the JSON arguments take these forms:

- `{"at": t, "a": deg}`: a fixed heading. With `rel` as `pin.mjs`'s last argument (or `"rel": true` on a `plot.mjs` flight), the heading is relative to the direction of travel: 0 forward, 180 a retro burn.
- `{"at": t, "toward": [x, y]}` or `{"at": t, "toward": "cup"}`: pointed at a mark from wherever the charge is.
- `{"at": t, "steer": [x, y]}` or `{"at": t, "steer": "cup"}`: pointed so the velocity swings onto the mark.

A route found with `toward`, `steer` or `rel` pulses should be pinned with
`pin.mjs`, which gives the fixed headings a test can fly.

The usual loop for a new hole:

1. Draft it.
2. Run `sweep.mjs` and `bare.mjs` until the bare lines are gone.
3. Find the route with `plot.mjs`.
4. Pin the route with `pin.mjs`.
5. Move the hole into `src/golf.js` and write its test.
6. Check it in the game with `route.mjs` and `holes.mjs`.

## Screenshots (`tools/shots/`)

| Script | What it does | Example |
| --- | --- | --- |
| `blaster.mjs` | Staged screenshots of a three-player Blaster match with the Wormhole Variant, on the LAN relay. It writes the ends placed, and a shot frozen as it comes out of a wormhole, from each seat. `LOBBY=1` adds the lobby, and `STRADDLE=<slot>` adds a fighter halfway through its own wormhole. It has plans for Event Horizon and Trefoil; any other arena needs a `PLAN` (see the file's header). | `LOBBY=1 node tools/shots/blaster.mjs "Event Horizon" shots/` |

## What the browser tools need

**Playwright with Chromium.** `tools/browser.mjs` finds Playwright in the
repo's `node_modules` or in the global install. In Claude Code on the web,
both Playwright and Chromium come preinstalled. Anywhere else:

```bash
npm install --no-save playwright
npx playwright install chromium
```

**The game on a local server.** Each tool uses `DEFLECTOR_URL` if it is set,
then any server already listening on port 8099. Failing both, it starts
`server.js` on 8099 for as long as it runs. That same server is the LAN
relay, so the multiplayer screenshots need nothing else.

`window.__game` is the handle the browser tools use. It exposes `state`,
`game`, `net`, `golfRound`, `startGolf(index, course)`, `startGolfHole`,
`golfPulse`, `startLevel`, `renderer`, `input` and `audio`.
