export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.tail = promise;

    await prev;
    try {
      return await fn();
    } finally {
      resolve();
    }
  }

  async idle(): Promise<void> {
    await this.tail;
  }
}
