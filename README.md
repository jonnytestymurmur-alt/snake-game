# Neon Serpent

A retro 1980s arcade snake game built with plain HTML, CSS and vanilla JavaScript.
No frameworks, no libraries, no build step, no network calls — every asset (including
the pixel typeface and the chiptune sound effects) is generated in code.

## Run it

Open `index.html` in any modern browser. That's it.

```
git clone <this repo> && cd snake-game
open index.html          # macOS   (or: xdg-open index.html / just double-click it)
```

Serving the folder over http also works and is slightly better, because some browsers
disable `localStorage` on `file://` URLs (the game falls back to an in-memory high
score and says so on the game-over screen):

```
python3 -m http.server 8000     # then visit http://localhost:8000
```

## Controls

| Input | Action |
| --- | --- |
| `↑` `↓` `←` `→` or `W` `A` `S` `D` | Steer (180° reversals are ignored) |
| `Space` | Start · pause · resume |
| `Enter` | Start, or play again after a game over |
| `M` | Mute / unmute |
| Swipe on the board | Steer (touch) |
| Tap the board | Start · pause · resume (touch) |
| On-screen d-pad | Steer (shown on touch devices and narrow screens) |

The game also pauses itself whenever the tab or window loses focus.

## How it plays

- 21 × 21 arena. Eat the pink cell to grow; hitting a wall or your own body ends the run.
- Every 3 pieces of food raises the level, which shortens the step interval from 150 ms
  down to a 70 ms ceiling, and raises the points per food.
- The high score is stored in `localStorage` under `neon-serpent:best` and survives
  reloads. If storage is unavailable the game keeps the score in memory for the session
  and tells you on the game-over screen.
- Food is drawn from the list of *free* cells, so it can never spawn inside the snake.
  Filling the board ends the run as a perfect clear.

## Files

```
index.html   markup: marquee, scoreboard, canvas stage, overlay screens, d-pad
styles.css   design tokens, layout, CRT scanlines, responsive + reduced-motion rules
game.js      pixel font, audio engine, game loop, rendering, input
tests/       optional Playwright harness (not needed to play)
```

`game.js` is organised in labelled sections: config → storage → pixel font → audio →
DOM references → rendering → game logic → input/loop/boot.

Notable implementation details:

- **Fixed timestep.** The simulation advances in whole steps from an accumulator, so
  the snake moves at the same speed on a 60 Hz and a 144 Hz display. Rendering
  interpolates between the previous and current cell for smooth motion.
- **Pixel typography.** The title, scores and overlay headlines are drawn from a 5 × 7
  bitmap font defined in `game.js` and stamped into canvases at an integer scale that
  is re-fitted on resize, so the glyphs stay crisp at any size. No font files, no CDN.
- **Audio.** Square/triangle/saw blips are synthesised with the Web Audio API. The
  `AudioContext` is created lazily inside a user gesture, so nothing plays before the
  player interacts. The mute state persists in `localStorage`.
- **Reduced motion.** `prefers-reduced-motion: reduce` disables the shake, flicker,
  particles and score pops; the game stays fully playable.

## Tests

The game has no dependencies, but the browser tests use Playwright. From the repo root:

```
npm init -y && npm i -D playwright && npx playwright install chromium
node tests/browser-tests.mjs
```

The harness serves the repo on an ephemeral port, drives the snake with a
tail-following autopilot and asserts, among other things: food never spawns inside the
snake, the snake never leaves the board or overlaps itself, each level is faster than
the last, reversals are ignored, pause/resume/tab-blur freeze the simulation, wall and
self collisions end the run, restarts reset the score, the high score persists across a
reload, and the mobile layout, d-pad, tap-to-pause and swipe steering all work.
Screenshots are written to `screenshots/`.

To make that possible `game.js` exposes one read-only seam, `window.neonSerpent.snapshot()`,
which returns a copy of the current game state. It is the only way to assert against a
canvas game without guessing from pixels; nothing in the game reads it.
