const busy = () =>
  Object.assign(
    Error("The shared board's storage is busy. Try again shortly."),
    { status: 503 },
  );

// Cloudflare can cancel a request waiting only on another request's promise.
// Keep each wait's timers in its own request, sharing only admission metadata.
// Expiring tickets also recover slots if a request ends without its finally.
export class ListingQueue {
  constructor({ limit = 2, timeout = 20_000, interval = 10 } = {}) {
    this.limit = limit;
    this.timeout = timeout;
    this.interval = interval;
    this.running = new Set();
    this.queue = [];
    this.refused = -Infinity;
  }
  expire() {
    const now = Date.now();
    for (const turn of this.running)
      if (turn.expires <= now) this.running.delete(turn);
    this.queue = this.queue.filter((turn) => turn.expires > now);
  }
  async run(
    task,
    now = Date.now,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    const turn = { expires: Date.now() + this.timeout };
    this.queue.push(turn);
    try {
      while (true) {
        this.expire();
        if (turn.expires <= Date.now()) throw busy();
        if (this.queue[0] === turn && this.running.size < this.limit) break;
        await wait(this.interval);
      }
      this.queue.shift();
      turn.at = now();
      turn.expires = Date.now() + this.timeout;
      this.running.add(turn);
      let timer;
      try {
        return await Promise.race([
          task(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(busy()), this.timeout);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      this.running.delete(turn);
      this.queue = this.queue.filter((waiting) => waiting !== turn);
    }
  }
}
