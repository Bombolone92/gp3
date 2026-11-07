// Pixels and milliseconds. y grows downward, so gravity is positive.
//
// Tuning history, measured settle-time distributions, and the reasoning
// behind every non-default constant below are in task-1-report.md.
export const GRAVITY = 0.0022;        // px/ms^2
export const BOUNCE_DAMPING = 0.78;   // vertical energy kept per floor/ceiling bounce
export const WALL_DAMPING = 0.72;     // horizontal energy kept per wall bounce
export const FLOOR_FRICTION = 0.87;   // horizontal drag applied on each floor contact
export const REST_SPEED = 0.04;       // px/ms below which a floored card is at rest
// Continuous sliding friction while resting on the floor. FLOOR_FRICTION
// alone is impulsive (applied once per bounce), but a card that reaches
// vertical rest (the Zeno branch in stepVertical) never bounces again, so
// without this it would slide at constant speed until it happened to reach
// a wall.
export const SLIDE_DRAG = 0.0025;     // per ms; exponential decay of vx while resting

// The wall-collision overshoot-then-clamp handling below (see the `card.x <
// 0` branch of stepCard) is only exact when at most one wall crossing
// happens per animation step -- otherwise a card could cross a wall, bounce,
// and cross the opposite wall within the same step without either bounce
// being resolved. That correctness argument depends entirely on the caller
// (animate.js) never handing stepCard a `dt` above this cap: it is exported
// here, rather than left as a bare literal at the call site, so raising it
// is a deliberate, visible edit to the module whose comments explain why the
// cap exists, not an accidental one-line change to an unrelated file. See
// cascade-physics.test.js for the invariant this depends on: even
// launchVelocity()'s fastest possible card cannot cross a plausible board's
// width in a single MAX_STEP_MS-length step.
export const MAX_STEP_MS = 34;

export function launchVelocity(random = Math.random) {
  const dir = random() < 0.5 ? -1 : 1;
  return {
    vx: dir * (0.22 + random() * 0.38),
    vy: -(0.18 + random() * 0.42),
  };
}

export function stepCard(card, dt, bounds) {
  if (card.settled) return;
  const maxX = bounds.width - bounds.cardW;
  const maxY = bounds.height - bounds.cardH;

  // A card resting on the floor (vertically settled via the Zeno branch in
  // stepVertical) no longer contacts the floor to pick up impulsive
  // FLOOR_FRICTION, so model continuous sliding friction directly. vx decays
  // exponentially; the displacement while resting must use the closed-form
  // integral of that decay (not vx*dt, which uses the end-of-step velocity
  // for the whole step and is only a first-order approximation) so that
  // position, not just velocity, composes exactly across sub-steps:
  // (v/k)*(1-exp(-k*a)) + (v*exp(-k*a)/k)*(1-exp(-k*b)) === (v/k)*(1-exp(-k*(a+b))).
  const resting = card.y >= maxY - 1e-6 && Math.abs(card.vy) <= REST_SPEED;
  if (resting) {
    const decay = Math.exp(-SLIDE_DRAG * dt);
    card.x += (card.vx / SLIDE_DRAG) * (1 - decay);
    card.vx *= decay;
  } else {
    card.x += card.vx * dt;
  }

  // Horizontal motion has no acceleration between wall touches, so
  // overshoot-then-clamp is exact *as long as at most one wall crossing
  // happens per step* — impact speed then always equals departure speed,
  // so WALL_DAMPING decays it monotonically with no discretization
  // artifact. That assumption is not self-evidently true for arbitrary dt:
  // it holds here only because the caller caps dt low enough (Task 2 caps
  // it around 34ms) that even launchVelocity()'s fastest card cannot cross
  // the board in one step. If that cap is ever removed, this needs the
  // same sub-step treatment stepVertical already has.
  if (card.x < 0) { card.x = 0; card.vx = -card.vx * WALL_DAMPING; }
  else if (card.x > maxX) { card.x = maxX; card.vx = -card.vx * WALL_DAMPING; }

  stepVertical(card, dt, maxY);

  if (isSettled(card, bounds)) {
    card.settled = true;
    card.y = maxY;
    card.vx = 0;
    card.vy = 0;
  }
}

// Advances vertical motion by `dt`, resolving floor/ceiling bounces at
// their exact sub-step crossing time rather than letting the card
// overshoot past the boundary for up to a full `dt` before clamping.
//
// This must be exact, not approximate: an "advance by dt, then clamp if
// past the boundary" scheme lets the card travel further into the
// boundary than it should before the bounce is detected, which injects
// extra energy into the impact speed on every bounce. That extra energy
// can exactly offset what BOUNCE_DAMPING removes, producing a bounce
// cycle that never decays below REST_SPEED no matter how long it runs
// (see task-1-report.md for the derivation and the failure rate this
// caused before this fix). Resolving the exact crossing time removes the
// injected energy: free flight between bounces exactly conserves energy
// (impact speed always equals departure speed), so BOUNCE_DAMPING alone
// drives strict geometric decay every single bounce.
function stepVertical(card, dt, maxY) {
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 64) {
    // A card already resting on the floor with negligible vertical speed is
    // a degenerate case for the crossing-time quadratic below: y0 equals
    // the target, so the quadratic has a double root at tau=0 (the parabola
    // is tangent to the floor there), and every tau>0 is already past it.
    // There is no well-defined "future crossing" to solve for — physically,
    // this is a card continuously re-contacting the floor in vanishingly
    // small bounces (a "Zeno's bouncing ball" limit), which converges to
    // simply resting at the floor. Model that directly instead of chasing
    // the degeneracy, which otherwise reads as "no crossing" and lets the
    // card fall straight through the floor unclamped.
    if (card.y >= maxY - 1e-6 && Math.abs(card.vy) <= REST_SPEED) {
      card.y = maxY;
      card.vy = 0;
      break;
    }

    const floorT = crossingTime(card.y, card.vy, maxY, remaining);
    const ceilT = crossingTime(card.y, card.vy, 0, remaining);

    let t = remaining;
    let hit = null;
    if (floorT !== null && floorT <= t) { t = floorT; hit = 'floor'; }
    if (ceilT !== null && ceilT < t) { t = ceilT; hit = 'ceil'; }

    card.y += card.vy * t + 0.5 * GRAVITY * t * t;
    card.vy += GRAVITY * t;
    remaining -= t;

    if (hit === 'floor') {
      card.y = maxY;
      card.vy = -card.vy * BOUNCE_DAMPING;
      card.vx *= FLOOR_FRICTION;
    } else if (hit === 'ceil') {
      card.y = 0;
      card.vy = -card.vy * BOUNCE_DAMPING;
    } else {
      break; // reached the end of the window with no further crossing
    }
  }
}

// Smallest positive tau <= maxT solving y0 + v0*tau + 0.5*GRAVITY*tau^2 ==
// target, or null if no such crossing exists within (0, maxT].
function crossingTime(y0, v0, target, maxT) {
  const a = 0.5 * GRAVITY;
  const b = v0;
  const c = y0 - target;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  const EPS = 1e-9;
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo > EPS && lo <= maxT) return lo;
  if (hi > EPS && hi <= maxT) return hi;
  return null;
}

export function isSettled(card, bounds) {
  if (card.settled) return true;
  const onFloor = card.y >= bounds.height - bounds.cardH - 0.5;
  return onFloor && Math.abs(card.vy) < REST_SPEED && Math.abs(card.vx) < REST_SPEED;
}
