export class Cache<T> {
  private value?: T;
  private expiresAt?: number;
  constructor(private ttlMs: number) {}
  get(): T | undefined {
    if (this.value === undefined || this.expiresAt === undefined) return undefined;
    if (Date.now() >= this.expiresAt) {
      this.clear();
      return undefined;
    }
    return this.value;
  }
  set(value: T): void {
    this.value = value;
    this.expiresAt = Date.now() + this.ttlMs;
  }
  clear(): void {
    this.value = undefined;
    this.expiresAt = undefined;
  }
}
