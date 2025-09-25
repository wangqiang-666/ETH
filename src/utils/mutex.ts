/**
 * 互斥锁实现
 * 用于确保关键操作的原子性，防止并发竞争条件
 */
export class Mutex {
  private locked = false;
  private waitingQueue: Array<() => void> = [];

  /**
   * 获取锁并执行函数
   * @param fn 需要在锁保护下执行的函数
   * @returns 函数执行结果
   */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * 获取锁
   */
  private async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.waitingQueue.push(resolve);
      }
    });
  }

  /**
   * 释放锁
   */
  private release(): void {
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift();
      if (next) {
        next();
      }
    } else {
      this.locked = false;
    }
  }

  /**
   * 检查锁状态
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * 获取等待队列长度
   */
  getWaitingCount(): number {
    return this.waitingQueue.length;
  }
}

/**
 * 异步信号量实现
 * 用于控制并发访问数量
 */
export class Semaphore {
  private permits: number;
  private waitingQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * 获取许可并执行函数
   * @param fn 需要在许可保护下执行的函数
   * @returns 函数执行结果
   */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * 获取许可
   */
  private async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
      } else {
        this.waitingQueue.push(resolve);
      }
    });
  }

  /**
   * 释放许可
   */
  private release(): void {
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift();
      if (next) {
        next();
      }
    } else {
      this.permits++;
    }
  }

  /**
   * 获取可用许可数
   */
  getAvailablePermits(): number {
    return this.permits;
  }

  /**
   * 获取等待队列长度
   */
  getWaitingCount(): number {
    return this.waitingQueue.length;
  }
}

/**
 * 读写锁实现
 * 允许多个读操作并发，但写操作独占
 */
export class ReadWriteLock {
  private readers = 0;
  private writer = false;
  private readWaitingQueue: Array<() => void> = [];
  private writeWaitingQueue: Array<() => void> = [];

  /**
   * 获取读锁并执行函数
   * @param fn 需要在读锁保护下执行的函数
   * @returns 函数执行结果
   */
  async runReadExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireRead();
    try {
      return await fn();
    } finally {
      this.releaseRead();
    }
  }

  /**
   * 获取写锁并执行函数
   * @param fn 需要在写锁保护下执行的函数
   * @returns 函数执行结果
   */
  async runWriteExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireWrite();
    try {
      return await fn();
    } finally {
      this.releaseWrite();
    }
  }

  /**
   * 获取读锁
   */
  private async acquireRead(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.writer && this.writeWaitingQueue.length === 0) {
        this.readers++;
        resolve();
      } else {
        this.readWaitingQueue.push(resolve);
      }
    });
  }

  /**
   * 释放读锁
   */
  private releaseRead(): void {
    this.readers--;
    if (this.readers === 0 && this.writeWaitingQueue.length > 0) {
      const next = this.writeWaitingQueue.shift();
      if (next) {
        this.writer = true;
        next();
      }
    }
  }

  /**
   * 获取写锁
   */
  private async acquireWrite(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.writer && this.readers === 0) {
        this.writer = true;
        resolve();
      } else {
        this.writeWaitingQueue.push(resolve);
      }
    });
  }

  /**
   * 释放写锁
   */
  private releaseWrite(): void {
    this.writer = false;
    
    // 优先处理等待的写操作
    if (this.writeWaitingQueue.length > 0) {
      const next = this.writeWaitingQueue.shift();
      if (next) {
        this.writer = true;
        next();
      }
    } else {
      // 处理等待的读操作
      while (this.readWaitingQueue.length > 0) {
        const next = this.readWaitingQueue.shift();
        if (next) {
          this.readers++;
          next();
        }
      }
    }
  }

  /**
   * 获取锁状态
   */
  getStatus(): {
    readers: number;
    writer: boolean;
    readWaiting: number;
    writeWaiting: number;
  } {
    return {
      readers: this.readers,
      writer: this.writer,
      readWaiting: this.readWaitingQueue.length,
      writeWaiting: this.writeWaitingQueue.length
    };
  }
}