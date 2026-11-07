export const MAX_TIMER = 24 * 60 * 60 * 1000;
export function validateTimer(timer) {
  if (timer === undefined) return;
  if (
    !timer ||
    typeof timer !== "object" ||
    Array.isArray(timer) ||
    Object.keys(timer).some(
      (k) => !["id", "state", "duration", "remaining", "endsAt"].includes(k),
    ) ||
    typeof timer.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(timer.id) ||
    !["idle", "running", "paused"].includes(timer.state) ||
    !Number.isSafeInteger(timer.duration) ||
    timer.duration < 1000 ||
    timer.duration > MAX_TIMER ||
    !Number.isSafeInteger(timer.remaining) ||
    timer.remaining < 0 ||
    timer.remaining > timer.duration ||
    !Number.isSafeInteger(timer.endsAt) ||
    timer.endsAt < 0 ||
    timer.endsAt > 8.64e15 ||
    (timer.state === "running" ? timer.endsAt === 0 : timer.endsAt !== 0)
  )
    throw Error("Invalid workshop timer.");
}
export function timerRemaining(timer, now = Date.now()) {
  if (!timer) return 0;
  return timer.state === "running"
    ? Math.max(0, Math.min(timer.duration, timer.endsAt - now))
    : timer.remaining;
}
export function timerPhase(timer, now = Date.now()) {
  return timer?.state === "running" && timerRemaining(timer, now) <= 0
    ? "finished"
    : timer?.state || "idle";
}
export function timerText(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function changeTimer(
  timer,
  action,
  {
    now = Date.now(),
    duration = 300000,
    extra = 60000,
    id = () => crypto.randomUUID(),
  } = {},
) {
  validateTimer(timer);
  const phase = timerPhase(timer, now),
    remaining = Math.ceil(timerRemaining(timer, now));
  let next;
  if (action === "start") {
    next = {
      id: id(),
      state: "running",
      duration,
      remaining: duration,
      endsAt: Math.round(now + duration),
    };
  } else if (action === "pause" && phase === "running") {
    next = { ...timer, state: "paused", remaining, endsAt: 0 };
  } else if (action === "resume" && phase === "paused" && remaining > 0) {
    next = { ...timer, state: "running", endsAt: Math.round(now + remaining) };
  } else if (action === "stop" && timer && phase !== "idle") {
    next = { ...timer, state: "idle", remaining: timer.duration, endsAt: 0 };
  } else if (action === "extend" && ["running", "paused"].includes(phase)) {
    if (
      !Number.isSafeInteger(extra) ||
      extra <= 0 ||
      timer.duration + extra > MAX_TIMER
    )
      throw Error("The timer can run for up to 24 hours.");
    next = {
      ...timer,
      duration: timer.duration + extra,
      remaining: remaining + extra,
      endsAt: phase === "running" ? Math.round(now + remaining + extra) : 0,
    };
  } else return timer;
  validateTimer(next);
  return next;
}
export function rebaseTimer(local, before, remote) {
  const value =
    JSON.stringify(local) !== JSON.stringify(before) ? local : remote;
  return value && structuredClone(value);
}
