/**
 * Browser tests for Neon Serpent.
 *
 * The game itself has zero dependencies; this optional harness needs Playwright:
 *
 *   npm init -y && npm i -D playwright && npx playwright install chromium
 *   node tests/browser-tests.mjs
 *
 * It serves the repo over http (localStorage is blocked on file://), drives the
 * game with a tail-following autopilot and asserts the rules of play, the input
 * model, persistence and the responsive/mobile behaviour. Screenshots land in
 * ./screenshots.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const URL = `http://127.0.0.1:${server.address().port}/index.html`;

const log = (...a) => console.log('•', ...a);
let failures = 0;
function check(name, cond) {
  if (cond) log('PASS', name);
  else { failures++; console.log('✗ FAIL', name); }
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

const snap = (page) => page.evaluate(() => window.neonSerpent.snapshot());
const label = (page, sel) => page.getAttribute(sel, 'aria-label');
const screenOf = (page) => page.getAttribute('#overlay', 'data-screen');

/** Master gain once the 20ms mute ramp has finished. */
async function settledGain(page) {
  await page.waitForTimeout(120);
  return (await snap(page)).masterGain;
}

/* ------------------------------ snake AI ------------------------------ */

const key = (x, y) => `${x},${y}`;

/** Can the head still reach the tail after this move? (classic safety test) */
function survives(state, move) {
  const eats = state.food && move.x === state.food.x && move.y === state.food.y;
  const body = [{ x: move.x, y: move.y }, ...state.snake];
  if (!eats) body.pop();

  const blocked = new Set(body.slice(0, -1).map((c) => key(c.x, c.y)));
  const target = body[body.length - 1];
  const start = body[0];

  const seen = new Set([key(start.x, start.y)]);
  const queue = [start];
  let reachable = 1;
  while (queue.length) {
    const p = queue.shift();
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = p.x + dx, ny = p.y + dy;
      const k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) continue;
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      reachable++;
      queue.push({ x: nx, y: ny });
    }
  }
  return { tailReachable: seen.has(key(target.x, target.y)), reachable };
}

function decide(state) {
  const head = state.snake[0];
  const occupied = new Set(state.snake.slice(0, -1).map((c) => key(c.x, c.y)));
  const back = DIRS[state.dir];

  const moves = Object.entries(DIRS)
    .filter(([, [dx, dy]]) => !(dx === -back[0] && dy === -back[1]))
    .map(([d, [dx, dy]]) => ({ d, x: head.x + dx, y: head.y + dy }))
    .filter((m) => m.x >= 0 && m.y >= 0 && m.x < state.cols && m.y < state.rows)
    .filter((m) => !occupied.has(key(m.x, m.y)));

  if (!moves.length) return null;

  const scored = moves.map((m) => {
    const s = survives(state, m);
    const d = state.food
      ? Math.abs(m.x - state.food.x) + Math.abs(m.y - state.food.y)
      : 0;
    return { ...m, ...s, dist: d };
  });

  const safe = scored.filter((m) => m.tailReachable);
  const pool = safe.length ? safe : scored;
  pool.sort((a, b) => a.dist - b.dist || b.reachable - a.reachable);
  return pool[0].d;
}

/**
 * Drive the snake. Returns the final snapshot.
 * `watch` runs on every simulation step and can assert invariants.
 */
async function playSmart(page, { untilScore = Infinity, maxSteps = 400, shot = null, watch = null } = {}) {
  let lastHead = '';
  let steps = 0;
  let shotTaken = false;
  let state = await snap(page);

  while (steps < maxSteps) {
    state = await snap(page);
    if (state.phase !== 'playing') break;
    if (watch) watch(state);

    if (shot && !shotTaken && state.score >= shot.score) {
      await page.screenshot({ path: shot.path });
      shotTaken = true;
      log('captured', shot.path.split('/').pop(), 'at score', state.score, 'length', state.snake.length);
    }
    if (state.score >= untilScore) break;

    const headKey = key(state.snake[0].x, state.snake[0].y);
    if (headKey !== lastHead) {
      lastHead = headKey;
      steps++;
      const move = decide(state);
      if (move) await page.keyboard.press(KEYS[move]);
    }
    await page.waitForTimeout(18);
  }
  return { state: await snap(page), shotTaken, steps };
}

async function freshGame(page) {
  await page.reload();
  await page.waitForTimeout(350);
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  return (await screenOf(page)) === 'playing';
}

/* ------------------------------ run ------------------------------ */

const browser = await chromium.launch();

/* desktop */
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => { failures++; console.log('✗ PAGE ERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });

await page.goto(URL);
await page.waitForTimeout(400);
check('attract screen shown', (await screenOf(page)) === 'attract');
await page.screenshot({ path: `${OUT}/desktop-attract.png` });

await page.keyboard.press('Space');
await page.waitForTimeout(250);
check('countdown after start', (await screenOf(page)) === 'countdown');
await page.screenshot({ path: `${OUT}/desktop-countdown.png` });
await page.waitForTimeout(2400);
check('playing after countdown', (await screenOf(page)) === 'playing');

// Invariants watched on every step of a long run
let foodInsideSnake = 0;
let outOfBounds = 0;
let duplicateCells = 0;
const lengths = [];
const speeds = new Map();
const run = await playSmart(page, {
  untilScore: 420,
  maxSteps: 900,
  shot: { score: 150, path: `${OUT}/desktop-playing.png` },
  watch: (s) => {
    if (s.food && s.snake.some((c) => c.x === s.food.x && c.y === s.food.y)) foodInsideSnake++;
    if (s.snake.some((c) => c.x < 0 || c.y < 0 || c.x >= s.cols || c.y >= s.rows)) outOfBounds++;
    if (new Set(s.snake.map((c) => key(c.x, c.y))).size !== s.snake.length) duplicateCells++;
    lengths.push(s.snake.length);
    speeds.set(s.level, s.stepMs);
  }
});
log('bot run:', 'score', run.state.score, 'level', run.state.level, 'length', run.state.snake.length);
check('captured desktop gameplay screenshot', run.shotTaken);
check('score increases by eating', run.state.score > 0);
check('snake grows while eating', Math.max(...lengths) > 4);
check('food never spawns inside the snake', foodInsideSnake === 0);
check('snake never leaves the board', outOfBounds === 0);
check('snake never overlaps itself', duplicateCells === 0);
check('level rises with score', run.state.level > 1);
const levels = [...speeds.keys()].sort((a, b) => a - b);
check('each level is faster than the last',
  levels.every((l, i) => i === 0 || speeds.get(l) < speeds.get(levels[i - 1])));
log('step interval per level:', JSON.stringify([...speeds.entries()]));

// Reversal guard — on a fresh game, because a long snake left wherever the bot
// parked it can hit a wall inside the window we are measuring.
check('fresh game for the reversal guard', await freshGame(page));
{
  const before = await snap(page);
  const opposite = { up: 'ArrowDown', down: 'ArrowUp', left: 'ArrowRight', right: 'ArrowLeft' }[before.dir];
  await page.keyboard.press(opposite);
  await page.waitForTimeout(260);
  const after = await snap(page);
  check('immediate reversal is ignored', after.phase === 'playing');
  check('direction did not flip 180°', after.dir !== { up: 'down', down: 'up', left: 'right', right: 'left' }[before.dir]);
}

/* pause / resume / tab visibility */
check('fresh game for pause tests', await freshGame(page));
await page.keyboard.press('Space');
await page.waitForTimeout(150);
check('space pauses', (await screenOf(page)) === 'paused');
const pausedA = (await snap(page)).snake[0];
await page.waitForTimeout(700);
const pausedB = (await snap(page)).snake[0];
check('the snake is frozen while paused', pausedA.x === pausedB.x && pausedA.y === pausedB.y);
await page.screenshot({ path: `${OUT}/desktop-paused.png` });
await page.keyboard.press('Space');
await page.waitForTimeout(900);
check('space resumes', (await screenOf(page)) === 'playing');

await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(120);
check('hidden tab pauses', (await screenOf(page)) === 'paused');
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

/* wall collision */
check('fresh game for wall test', await freshGame(page));
await page.keyboard.press('ArrowUp');
for (let i = 0; i < 40; i++) {
  if ((await screenOf(page)) !== 'playing') break;
  await page.waitForTimeout(80);
}
await page.waitForTimeout(1100);
check('wall collision ends the game', (await screenOf(page)) === 'over');
await page.screenshot({ path: `${OUT}/desktop-gameover.png` });
log('final score', await label(page, '#final-score'), 'best', await label(page, '#final-best'));

await page.keyboard.press('Enter');
await page.waitForTimeout(250);
check('enter restarts', (await screenOf(page)) === 'countdown');
check('score reset on restart', (await snap(page)).score === 0);
check('level reset on restart', (await snap(page)).level === 1);

/* mute: the button has to silence the audio graph, not just relabel itself —
   effects are scheduled ahead, so anything already queued would otherwise play
   on over an SFX OFF button. */
await page.click('#sfx-toggle');
check('mute toggles aria-pressed', (await page.getAttribute('#sfx-toggle', 'aria-pressed')) === 'false');
const muted = await settledGain(page);
check('the master gain is muted, not only the label', muted === 0);
await page.keyboard.press('m');
check('M key unmutes', (await page.getAttribute('#sfx-toggle', 'aria-pressed')) === 'true');
check('unmute restores the master gain', (await settledGain(page)) > 0.1);

/* high score persistence: score some points, then reload */
await page.waitForTimeout(2400);
await playSmart(page, { untilScore: 40, maxSteps: 150 });
const bestBefore = (await snap(page)).best;
check('best score tracks the live score', bestBefore > 0);
await page.reload();
await page.waitForTimeout(400);
check('high score persists across reload', (await snap(page)).best === bestBefore);

/* self collision */
check('fresh game for self-collision test', await freshGame(page));
await playSmart(page, { untilScore: 120, maxSteps: 300 });
if ((await screenOf(page)) === 'playing') {
  for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
    if ((await screenOf(page)) !== 'playing') break;
    await page.keyboard.press(k);
    await page.waitForTimeout(140);
  }
}
await page.waitForTimeout(1400);
check('self collision ends the game', (await screenOf(page)) === 'over');

await ctx.close();

/* mobile */
const mctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
});
const mpage = await mctx.newPage();
mpage.on('pageerror', (e) => { failures++; console.log('✗ MOBILE PAGE ERROR', e.message); });
await mpage.goto(URL);
await mpage.waitForTimeout(400);
check('mobile d-pad visible', await mpage.isVisible('.dpad'));
check('mobile fits without scrolling',
  await mpage.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1));
await mpage.screenshot({ path: `${OUT}/mobile-attract.png` });

await mpage.tap('#stage');
await mpage.waitForTimeout(250);
check('tap starts the game', (await screenOf(mpage)) === 'countdown');
await mpage.screenshot({ path: `${OUT}/mobile-countdown.png` });
await mpage.waitForTimeout(2400);
check('mobile game running', (await screenOf(mpage)) === 'playing');

// d-pad steering actually changes direction
const beforePad = await snap(mpage);
const padDir = beforePad.dir === 'up' || beforePad.dir === 'down' ? 'right' : 'up';
await mpage.tap(`[data-dir="${padDir}"]`);
await mpage.waitForTimeout(500);
check('d-pad changes direction', (await snap(mpage)).dir === padDir);

// swipe steering
const box = await mpage.locator('#stage').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
const currentDir = (await snap(mpage)).dir;
const swipeDir = (currentDir === 'up' || currentDir === 'down') ? 'right' : 'down';
await mpage.touchscreen.tap(cx, cy); // pause
await mpage.waitForTimeout(200);
check('tap on the board pauses', (await screenOf(mpage)) === 'paused');
await mpage.tap('#action-btn');
await mpage.waitForTimeout(900);
check('action button resumes', (await screenOf(mpage)) === 'playing');

await mpage.evaluate(({ cx, cy, dx, dy }) => {
  const stage = document.getElementById('stage');
  const mk = (type, x, y) => {
    const t = new Touch({ identifier: 1, target: stage, clientX: x, clientY: y });
    stage.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [t],
      changedTouches: [t],
      bubbles: true, cancelable: true
    }));
  };
  mk('touchstart', cx, cy);
  mk('touchmove', cx + dx, cy + dy);
  mk('touchend', cx + dx, cy + dy);
}, { cx, cy, dx: swipeDir === 'right' ? 90 : 0, dy: swipeDir === 'down' ? 90 : 0 });
await mpage.waitForTimeout(500);
check('swipe changes direction', (await snap(mpage)).dir === swipeDir);

const mrun = await playSmart(mpage, {
  untilScore: 300,
  maxSteps: 600,
  shot: { score: 120, path: `${OUT}/mobile-playing.png` }
});
log('mobile run: score', mrun.state.score, 'length', mrun.state.snake.length);
check('captured mobile gameplay screenshot', mrun.shotTaken);

await mctx.close();

/* the whole cabinet stays above the fold on every shape of viewport */
for (const vp of [
  { name: 'desktop 1280×900', width: 1280, height: 900 },
  { name: 'phone portrait 390×844', width: 390, height: 844, touch: true },
  { name: 'phone landscape 844×390', width: 844, height: 390, touch: true },
  { name: 'short window 1280×500', width: 1280, height: 500 },
  { name: 'small window 700×620', width: 700, height: 620 },
  // Widths where the chrome is tallest: the d-pad is on and the pixel title has
  // scaled up. A fixed chrome constant used to under-reserve here by up to 81px.
  { name: 'tablet portrait 760×900', width: 760, height: 900, touch: true },
  { name: 'tablet landscape 1024×768', width: 1024, height: 768, touch: true },
  { name: 'narrow window 560×900', width: 560, height: 900, touch: true },
  { name: 'small phone 360×640', width: 360, height: 640, touch: true },
  { name: 'tiny window 500×620', width: 500, height: 620 },
  // Shapes where the stacked chrome is taller than the whole screen: a square
  // foldable cover display, a handset in landscape, and the smallest phone
  // still in the wild — each has to reach the side-by-side layout or shed its
  // trimmings rather than push the controls below the fold.
  { name: 'square touch 390×390', width: 390, height: 390, touch: true },
  { name: 'pocket landscape 568×320', width: 568, height: 320, touch: true },
  { name: 'tiny phone 320×480', width: 320, height: 480, touch: true, minBoard: 160 }
]) {
  const lctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.touch,
    hasTouch: !!vp.touch
  });
  const lpage = await lctx.newPage();
  lpage.on('pageerror', (e) => { failures++; console.log('✗ LAYOUT PAGE ERROR', e.message); });
  await lpage.goto(URL);
  await lpage.waitForTimeout(400);
  const fit = await lpage.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const stage = box('.stage');
    const hits = (sel) => {
      const r = box(sel);
      return r.left < stage.right - 1 && r.right > stage.left + 1
        && r.top < stage.bottom - 1 && r.bottom > stage.top + 1;
    };
    return {
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      innerH: window.innerHeight,
      innerW: window.innerWidth,
      controlsBottom: box('.controls').bottom,
      marqueeTop: box('.marquee').top,
      board: box('#board').width,
      square: Math.abs(stage.width - stage.height) <= 1,
      overlapped: ['.marquee', '.hud', '.controls'].some(hits),
      // A narrow cabinet must make its contents smaller, not push them past its
      // own edges: the attract text has to wrap inside the bezel and the pad and
      // start button have to stay under the board.
      clipped: [...document.querySelectorAll('.screen--attract > *')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < stage.left - 1 || r.right > stage.right + 1);
      }),
      escaped: [...document.querySelectorAll('.cabinet > *, .dpad, .action')].some((el) => {
        const cab = box('.cabinet');
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < cab.left - 1 || r.right > cab.right + 1);
      }),
      // A pad drawn narrower than a fingertip is worse than no pad: where there
      // is no room for one the board takes the width back and swipe steers.
      key: getComputedStyle(document.querySelector('.dpad')).display === 'none'
        ? 0 : box('.dpad__btn').width
    };
  });
  check(`${vp.name}: fits without scrolling`,
    fit.scrollH <= fit.innerH + 1 && fit.scrollW <= fit.innerW + 1);
  check(`${vp.name}: marquee and controls are both on screen`,
    fit.marqueeTop >= -1 && fit.controlsBottom <= fit.innerH + 1);
  check(`${vp.name}: the board is still legible`, fit.board >= (vp.minBoard || 180));
  check(`${vp.name}: the stage stays square and clear of the chrome`,
    fit.square && !fit.overlapped);
  check(`${vp.name}: the attract screen reads inside the bezel`, !fit.clipped);
  check(`${vp.name}: nothing sticks out of the cabinet`, !fit.escaped);
  if (vp.touch) {
    check(`${vp.name}: the d-pad is either absent or big enough to hit`,
      fit.key === 0 || fit.key >= 40);
  }

  // The final tally sets the score beside a label, so the number's budget is the
  // row minus that label — not the whole screen, which used to run a five-digit
  // score off the edge of the smallest board.
  const tally = await lpage.evaluate(() => {
    document.querySelector('.overlay').dataset.screen = 'over';
    document.getElementById('final-score').dataset.pixel = '12345';
    document.getElementById('final-best').dataset.pixel = '12345';
    window.dispatchEvent(new Event('resize'));
    return new Promise((done) => setTimeout(() => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      const inside = [...document.querySelectorAll('.tally canvas')].every((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= stage.left - 1 && r.right <= stage.right + 1;
      });
      done(inside);
    }, 350));
  });
  check(`${vp.name}: a five-digit final score fits inside the bezel`, tally);
  await lctx.close();
}

/* the fit is recomputed when the window changes shape, not only on load */
const zctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: true });
const zpage = await zctx.newPage();
zpage.on('pageerror', (e) => { failures++; console.log('✗ RESIZE PAGE ERROR', e.message); });
await zpage.goto(URL);
for (const [w, h] of [[844, 390], [390, 844], [760, 900], [1280, 900]]) {
  await zpage.setViewportSize({ width: w, height: h });
  await zpage.waitForTimeout(300);
  const fit = await zpage.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    scrollW: document.documentElement.scrollWidth,
    innerH: window.innerHeight,
    innerW: window.innerWidth,
    board: document.querySelector('#board').getBoundingClientRect().width
  }));
  check(`resized to ${w}×${h}: still fits and stays legible`,
    fit.scrollH <= fit.innerH + 1 && fit.scrollW <= fit.innerW + 1 && fit.board >= 180);
}
await zctx.close();

/* Space and Enter belong to whichever control has keyboard focus */
const kctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const kpage = await kctx.newPage();
kpage.on('pageerror', (e) => { failures++; console.log('✗ KEYBOARD PAGE ERROR', e.message); });
await kpage.goto(URL);
await kpage.waitForTimeout(400);

await kpage.focus('#sfx-toggle');
await kpage.keyboard.press('Space');
await kpage.waitForTimeout(200);
check('space on the focused mute toggle mutes', (await kpage.getAttribute('#sfx-toggle', 'aria-pressed')) === 'false');
check('space on the focused mute toggle does not start the game', (await screenOf(kpage)) === 'attract');
check('keyboard activation keeps focus on the toggle',
  await kpage.evaluate(() => document.activeElement.id === 'sfx-toggle'));
await kpage.keyboard.press('Enter');
await kpage.waitForTimeout(200);
check('enter on the focused mute toggle unmutes', (await kpage.getAttribute('#sfx-toggle', 'aria-pressed')) === 'true');

await kpage.focus('.dpad__btn--down');
await kpage.keyboard.press('Space');
await kpage.waitForTimeout(200);
check('space on a focused d-pad button starts the game', (await screenOf(kpage)) === 'countdown');
await kpage.waitForTimeout(2500);
await kpage.focus('.dpad__btn--down');
await kpage.keyboard.press('Enter');
await kpage.waitForTimeout(400);
const kdown = await snap(kpage);
check('enter on a focused d-pad button steers instead of pausing',
  kdown.phase === 'playing' && kdown.dir === 'down');

await kpage.focus('#action-btn');
await kpage.keyboard.press('Space');
await kpage.waitForTimeout(250);
check('space on the focused action button pauses', (await screenOf(kpage)) === 'paused');
await kpage.evaluate(() => document.activeElement.blur());
await kpage.keyboard.press('Space');
await kpage.waitForTimeout(250);
check('space with nothing focused still drives the game',
  ['countdown', 'playing'].includes(await screenOf(kpage)));

/* "Play Again" works during the death animation, not only after it */
await kpage.reload();
await kpage.waitForTimeout(350);
await kpage.keyboard.press('Space');
await kpage.waitForTimeout(2500);
for (let i = 0; i < 40 && (await snap(kpage)).phase === 'playing'; i++) await kpage.waitForTimeout(60);
check('the death animation is reached', (await snap(kpage)).phase === 'dying');
check('the action button offers Play Again while dying',
  (await kpage.textContent('#action-btn')) === 'Play Again');
await kpage.click('#action-btn');
await kpage.waitForTimeout(250);
const restarted = await snap(kpage);
check('Play Again restarts during the death animation',
  restarted.phase === 'countdown' && restarted.score === 0);
await kctx.close();

/* reduced motion */
const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const rpage = await rctx.newPage();
rpage.on('pageerror', (e) => { failures++; console.log('✗ RM PAGE ERROR', e.message); });
await rpage.goto(URL);
await rpage.waitForTimeout(300);
await rpage.keyboard.press('Space');
await rpage.waitForTimeout(2500);
check('reduced motion still plays', (await screenOf(rpage)) === 'playing');
await rctx.close();

/* a write that fails after the probe succeeded (quota, revoked permission)
   must demote the session to memory rather than trust stale stored data */
const qctx = await browser.newContext({ viewport: { width: 1000, height: 820 } });
const qpage = await qctx.newPage();
qpage.on('pageerror', (e) => { failures++; console.log('✗ QUOTA PAGE ERROR', e.message); });
await qpage.goto(URL);
await qpage.waitForTimeout(300);
check('storage starts out persistent', (await snap(qpage)).persistentStorage === true);
await qpage.evaluate(() => {
  Object.defineProperty(window.localStorage, 'setItem', {
    configurable: true,
    value: () => { throw new Error('QuotaExceededError'); }
  });
});
await qpage.click('#sfx-toggle'); // persists the mute flag, and fails to
check('a failed write marks storage non-persistent',
  (await snap(qpage)).persistentStorage === false);
await qpage.keyboard.press('Space');
await qpage.waitForTimeout(2600);
await playSmart(qpage, { untilScore: 20, maxSteps: 120 });
check('the score still tracks in memory after storage fails',
  (await snap(qpage)).best > 0);
for (let i = 0; i < 90 && (await snap(qpage)).phase === 'playing'; i++) {
  await qpage.keyboard.press('ArrowUp'); // straight into the top wall
  await qpage.waitForTimeout(80);
}
await qpage.waitForTimeout(1200); // the death animation
check('the game-over screen owns up to the lost storage',
  (await screenOf(qpage)) === 'over'
  && await qpage.evaluate(() => !document.getElementById('storage-note').hidden));
await qctx.close();

/* file:// — localStorage is blocked there, the fallback must hold */
const fctx = await browser.newContext({ viewport: { width: 1000, height: 820 } });
const fpage = await fctx.newPage();
fpage.on('pageerror', (e) => { failures++; console.log('✗ FILE PAGE ERROR', e.message); });
await fpage.goto(`file://${path.join(ROOT, 'index.html')}`);
await fpage.waitForTimeout(400);
check('file:// loads', (await screenOf(fpage)) === 'attract');
await fpage.keyboard.press('Space');
await fpage.waitForTimeout(2600);
check('file:// gameplay runs', (await screenOf(fpage)) === 'playing');
log('file:// persistent storage available:', (await snap(fpage)).persistentStorage);
await fctx.close();

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
