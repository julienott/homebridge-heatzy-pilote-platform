export class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private lastCallTime = 0;

  constructor(private readonly minInterval: number = 1000) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    
    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastCall = now - this.lastCallTime;
      
      if (timeSinceLastCall < this.minInterval) {
        await new Promise(resolve => 
          setTimeout(resolve, this.minInterval - timeSinceLastCall)
        );
      }

      const task = this.queue.shift();
      if (task) {
        this.lastCallTime = Date.now();
        await task();
      }
    }

    this.processing = false;
  }
}