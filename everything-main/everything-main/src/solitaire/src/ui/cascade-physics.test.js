import { describe, it, expect } from 'vitest';
import { stepCard, isSettled, launchVelocity, GRAVITY, MAX_STEP_MS } from './cascade-physics.js';
import { computeSizes } from './layout.js';

const bounds = { width: 1000, height: 800, cardW: 100, cardH: 140 };
const card = (over = {}) => ({ x: 500, y: 100, vx: 0, vy: 0, settled: false, ...over });

describe('stepCard', () => {
  it('accelerates downward under gravity', () => {
    const c = card();
    stepCard(c, 16, bounds);
    expect(c.vy).toBeCloseTo(GRAVITY * 16, 6);
    expect(c.y).toBeGreaterThan(100);
  });

  it('bounces off the floor, reversing and damping vertical velocity', () => {
    const c = card({ y: bounds.height - bounds.cardH - 1, vy: 1 });
    stepCard(c, 16, bounds);
    expect(c.y).toBeLessThanOrEqual(bounds.height - bounds.cardH);
    expect(c.vy).toBeLessThan(0);          // now moving up
    expect(Math.abs(c.vy)).toBeLessThan(1); // and slower than it arrived
  });

  it('bounces off the left wall', () => {
    const c = card({ x: 1, vx: -1 });
    stepCard(c, 16, bounds);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.vx).toBeGreaterThan(0);
  });

  it('bounces off the right wall', () => {
    const c = card({ x: bounds.width - bounds.cardW - 1, vx: 1 });
    stepCard(c, 16, bounds);
    expect(c.x).toBeLessThanOrEqual(bounds.width - bounds.cardW);
    expect(c.vx).toBeLessThan(0);
  });

  it('never leaves the viewport, however hard it is thrown', () => {
    const c = card({ vx: 50, vy: -50 });
    for (let i = 0; i < 2000; i++) stepCard(c, 16, bounds);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThanOrEqual(bounds.width - bounds.cardW);
    expect(c.y).toBeLessThanOrEqual(bounds.height - bounds.cardH);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });

  it('bounces off the ceiling, reversing and damping vertical velocity', () => {
    const c = card({ y: 1, vy: -1 });
    stepCard(c, 16, bounds);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.vy).toBeGreaterThan(0);        // now moving down
    expect(Math.abs(c.vy)).toBeLessThan(1); // and slower than it arrived
  });

  it('keeps y >= 0 across many steps of a hard upward throw', () => {
    const c = card({ y: 300, vx: 0.3, vy: -50 });
    for (let i = 0; i < 2000; i++) {
      stepCard(c, 16, bounds);
      expect(c.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('comes to rest on the floor rather than bouncing forever', () => {
    const c = card({ vx: 2, vy: -2 });
    let steps = 0;
    while (!isSettled(c, bounds) && steps < 5000) { stepCard(c, 16, bounds); steps++; }
    expect(steps).toBeLessThan(5000);
    expect(isSettled(c, bounds)).toBe(true);
    expect(c.y).toBeCloseTo(bounds.height - bounds.cardH, 0);
  });

  it('does nothing to a settled card', () => {
    const c = card({ settled: true, x: 10, y: 20 });
    stepCard(c, 16, bounds);
    expect(c.x).toBe(10);
    expect(c.y).toBe(20);
  });

  it('drags a card resting on the floor to rest via continuous sliding friction', () => {
    // A card that has already stopped bouncing vertically (resting on the
    // floor with vy at rest) no longer picks up impulsive FLOOR_FRICTION,
    // since that only fires on an actual bounce. Continuous SLIDE_DRAG must
    // decay a healthy sideways speed to rest within a bounded time on its
    // own, or the card would slide at constant speed until it happens to
    // reach a wall.
    const c = card({ y: bounds.height - bounds.cardH, vy: 0, vx: 0.6 });
    let steps = 0;
    while (!isSettled(c, bounds) && steps < 500) { stepCard(c, 16, bounds); steps++; }
    expect(steps).toBeLessThan(500);
    expect(isSettled(c, bounds)).toBe(true);
  });

  it('decays sliding speed and position identically regardless of step size', () => {
    // Velocity alone isn't enough here: using the end-of-step vx for the
    // whole step's displacement (vx*dt) matches at the velocity level but
    // silently drifts in position, since it's only a first-order
    // approximation of the exponential decay's integral.
    const maxY = bounds.height - bounds.cardH;
    const a = card({ y: maxY, vy: 0, vx: 0.5 });
    const b = card({ y: maxY, vy: 0, vx: 0.5 });
    for (let i = 0; i < 10; i++) stepCard(a, 32, bounds);
    for (let i = 0; i < 20; i++) stepCard(b, 16, bounds);
    expect(a.vx).toBeCloseTo(b.vx, 6);
    expect(a.x).toBeCloseTo(b.x, 6);
  });

  it('is frame-rate independent over the same elapsed time', () => {
    const a = card({ vx: 0.3, vy: -0.4 });
    const b = card({ vx: 0.3, vy: -0.4 });
    for (let i = 0; i < 10; i++) stepCard(a, 32, bounds);
    for (let i = 0; i < 20; i++) stepCard(b, 16, bounds);
    expect(a.y).toBeCloseTo(b.y, 0);
  });

  it('is frame-rate independent across a single floor bounce', () => {
    // The free-flight-only test above never nears a boundary, so it can't
    // catch a regression in the sub-step crossing resolution -- the exact
    // thing that fixes the energy-injection bug. This one actually bounces.
    const maxY = bounds.height - bounds.cardH;
    const a = card({ y: maxY - 45, vy: 0.35, vx: 0 });
    const b = card({ y: maxY - 45, vy: 0.35, vx: 0 });
    for (let i = 0; i < 4; i++) stepCard(a, 32, bounds);
    for (let i = 0; i < 8; i++) stepCard(b, 16, bounds);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.vy).toBeCloseTo(b.vy, 6);
  });

  it('is frame-rate independent across multiple floor and ceiling bounces', () => {
    const a = card({ y: 100, vy: -2, vx: 0 });
    const b = card({ y: 100, vy: -2, vx: 0 });
    for (let i = 0; i < 50; i++) stepCard(a, 32, bounds);
    for (let i = 0; i < 100; i++) stepCard(b, 16, bounds);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.vy).toBeCloseTo(b.vy, 6);
  });
});

describe('launchVelocity', () => {
  it('is deterministic given a deterministic random source', () => {
    expect(launchVelocity(() => 0.5)).toEqual(launchVelocity(() => 0.5));
  });

  it('always throws upward', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(launchVelocity(() => r).vy).toBeLessThan(0);
    }
  });

  it('throws both left and right across the random range', () => {
    const signs = new Set([0, 0.1, 0.4, 0.6, 0.9, 0.99].map(r => Math.sign(launchVelocity(() => r).vx)));
    expect(signs.size).toBeGreaterThan(1);
  });
});

describe('MAX_STEP_MS', () => {
  it('keeps a single step short enough that at most one wall crossing can happen per step', () => {
    // stepCard's overshoot-then-clamp wall handling (see the `card.x < 0`
    // branch) is exact only if a card cannot cross the whole gap between
    // walls within one animation step -- see MAX_STEP_MS's own comment in
    // cascade-physics.js. This asserts that invariant directly rather than
    // just trusting the comment: even launchVelocity()'s fastest possible
    // draw, run for a full MAX_STEP_MS, must land well short of the
    // narrowest gap the real app can plausibly present.
    const fastest = launchVelocity(() => 0.999999); // maxes both the dir and magnitude terms
    const worstCaseStepDisplacement = Math.abs(fastest.vx) * MAX_STEP_MS;

    // Ground "plausible" in the app's own sizing rather than a made-up
    // number: a small phone viewport is the narrowest gap the cascade ever
    // bounces a card across (main{padding:12px} at that breakpoint, per
    // layout.css).
    const viewportWidth = 320;
    const { cardW } = computeSizes(viewportWidth - 24);
    const narrowestPlausibleGap = viewportWidth - cardW;

    expect(worstCaseStepDisplacement).toBeLessThan(narrowestPlausibleGap / 4);
  });
});

describe('a full 52-card cascade', () => {
  it('settles every card well under the 20s safety timeout', () => {
    // Mirrors animate.js's own orchestration -- a card launches immediately,
    // then one more every 90ms until all 52 are out, every card stepped at
    // MAX_STEP_MS -- without any DOM, canvas, or atlas: this file only
    // touches the pure physics module, same as every other test here.
    const LAUNCH_INTERVAL_MS = 90;
    const CARD_COUNT = 52;
    const SAFETY_TIMEOUT_MS = 20000;

    const bounds = { width: 1280, height: 800, cardW: 96, cardH: 134 };
    const cards = [];
    const launch = () => {
      const { vx, vy } = launchVelocity();
      cards.push({ x: bounds.width / 2, y: 0, vx, vy, settled: false });
    };

    launch(); // the first card leaves immediately, exactly like animate.js's launchOne()
    let launched = 1;
    let elapsed = 0;
    let sinceLastLaunch = 0;

    while ((launched < CARD_COUNT || cards.some(c => !c.settled)) && elapsed <= SAFETY_TIMEOUT_MS) {
      elapsed += MAX_STEP_MS;
      sinceLastLaunch += MAX_STEP_MS;
      if (launched < CARD_COUNT && sinceLastLaunch >= LAUNCH_INTERVAL_MS) {
        sinceLastLaunch -= LAUNCH_INTERVAL_MS;
        launch();
        launched++;
      }
      for (const c of cards) stepCard(c, MAX_STEP_MS, bounds);
    }

    expect(launched).toBe(CARD_COUNT);
    expect(cards.every(c => isSettled(c, bounds))).toBe(true);
    // An independent simulation across eight viewport geometries measured
    // 8.4-12.5s to full settle; 18s leaves real headroom under the 20s
    // safety timeout without being a vacuous assertion.
    expect(elapsed).toBeLessThan(18000);
  });
});
