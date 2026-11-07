// A least-recently-used cache with a byte budget, for decoded video frames.
// Entries are evicted oldest first once the total exceeds the budget; the
// entry just added always stays, so a single frame larger than the budget
// still decodes.
export class FrameCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private total = 0;
  constructor(
    private budget: number,
    private onEvict?: (key: string, value: T) => void,
  ) {}
  get size() {
    return this.entries.size;
  }
  get bytes() {
    return this.total;
  }
  get limit() {
    return this.budget;
  }
  has(key: string) {
    return this.entries.has(key);
  }
  /** The value for `key`, marking it most recently used. */
  get(key: string): T | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value;
  }
  /** The value without changing its recency. */
  peek(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }
  set(key: string, value: T, bytes: number) {
    this.delete(key);
    this.entries.set(key, { value, bytes: Math.max(0, bytes) });
    this.total += Math.max(0, bytes);
    this.evict(key);
  }
  delete(key: string) {
    const e = this.entries.get(key);
    if (!e) return false;
    this.entries.delete(key);
    this.total -= e.bytes;
    this.onEvict?.(key, e.value);
    return true;
  }
  /** Drop every entry whose key matches. */
  deleteWhere(test: (key: string) => boolean) {
    for (const key of [...this.entries.keys()]) if (test(key)) this.delete(key);
  }
  clear() {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }
  setLimit(budget: number) {
    this.budget = budget;
    this.evict();
  }
  values() {
    return [...this.entries.values()].map((e) => e.value);
  }
  keys() {
    return [...this.entries.keys()];
  }
  private evict(keep?: string) {
    for (const key of [...this.entries.keys()]) {
      if (this.total <= this.budget) break;
      if (key !== keep) this.delete(key);
    }
  }
}
