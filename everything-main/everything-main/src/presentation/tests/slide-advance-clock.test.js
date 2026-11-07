import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlideAdvanceClock } from "../src/slide-advance-clock.js";

beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
  }),
);
afterEach(() => vi.useRealTimers());
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("slide advance clock", () => {
  it.each([0, 1, 275, 8000])(
    "advances once after an authored %s ms delay",
    async (delay) => {
      const advance = vi.fn();
      const clock = createSlideAdvanceClock(advance);
      clock.select(delay);
      if (delay > 0) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(advance).not.toHaveBeenCalled();
      }
      await vi.advanceTimersByTimeAsync(delay > 0 ? 1 : 0);
      expect(advance).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(advance).toHaveBeenCalledTimes(1);
      clock.dispose();
    },
  );
  it("omitted timing does not schedule an advance", async () => {
    const advance = vi.fn();
    const clock = createSlideAdvanceClock(advance);
    clock.select(undefined);
    await vi.advanceTimersByTimeAsync(10000);
    expect(advance).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("starts dwell only after actual effects complete", async () => {
    const ready = deferred(),
      advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(750, ready.promise);
    await vi.advanceTimersByTimeAsync(10000);
    expect(advance).not.toHaveBeenCalled();
    ready.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(749);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("ignores an old effect's completion after navigation", async () => {
    const ready = deferred(),
      advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(50, ready.promise);
    clock.select(500);
    ready.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(499);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("navigation cancels the outgoing slide's timer", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(500);
    await vi.advanceTimersByTimeAsync(450);
    clock.select(700);
    await vi.advanceTimersByTimeAsync(699);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("pauses indefinitely and resumes with the full native dwell time", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(1000);
    await vi.advanceTimersByTimeAsync(600);
    clock.setPaused(true);
    expect(clock.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(advance).not.toHaveBeenCalled();
    clock.setPaused(false);
    expect(clock.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("repeating the same pause state does not reset the timer", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(1000);
    await vi.advanceTimersByTimeAsync(600);
    clock.setPaused(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("pauses while awaiting effects and resumes after their completion", async () => {
    const ready = deferred(),
      advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(700, ready.promise);
    clock.setPaused(true);
    ready.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10000);
    expect(advance).not.toHaveBeenCalled();
    clock.setPaused(false);
    await vi.advanceTimersByTimeAsync(700);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("explicit navigation restarts a show that was paused", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(400);
    clock.setPaused(true);
    clock.select(500);
    expect(clock.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("handles the full unsigned timer range without platform timeout overflow", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(4294967295);
    await vi.advanceTimersByTimeAsync(2147483647);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2147483647);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("does not advance early when a long chunk ends before the deadline", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(2147483648);
    await vi.advanceTimersByTimeAsync(2147483647);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("uses monotonic elapsed time when the wall clock changes", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(1000);
    await vi.advanceTimersByTimeAsync(600);
    vi.setSystemTime(new Date("2090-01-01"));
    await vi.advanceTimersByTimeAsync(399);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it.each([-1, NaN, Infinity, -Infinity])(
    "rejects invalid %s without disrupting the current timer",
    async (delay) => {
      const advance = vi.fn(),
        clock = createSlideAdvanceClock(advance);
      clock.select(500);
      expect(() => clock.select(delay)).toThrow();
      await vi.advanceTimersByTimeAsync(500);
      expect(advance).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["clear", "dispose"])(
    "%s invalidates a timer and pending readiness",
    async (method) => {
      const advance = vi.fn(),
        clock = createSlideAdvanceClock(advance),
        ready = deferred();
      clock.select(500);
      clock[method]();
      clock.select(500, ready.promise);
      clock[method]();
      ready.resolve();
      await vi.advanceTimersByTimeAsync(10000);
      expect(advance).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("supports clear and a new selection but cannot restart after disposal", async () => {
    const advance = vi.fn(),
      clock = createSlideAdvanceClock(advance);
    clock.select(100);
    clock.clear();
    clock.select(200);
    await vi.advanceTimersByTimeAsync(200);
    expect(advance).toHaveBeenCalledTimes(1);
    clock.dispose();
    clock.select(0);
    clock.setPaused(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("does not advance or leak an unhandled rejection when readiness fails", async () => {
    const advance = vi.fn();
    const clock = createSlideAdvanceClock(advance);
    clock.select(100, Promise.reject(new Error("Effect failed")));
    await vi.advanceTimersByTimeAsync(1000);
    expect(advance).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
