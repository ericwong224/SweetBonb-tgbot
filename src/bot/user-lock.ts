const LOCK_TTL_MS = 120_000;

interface LockState {
  lockedAt: number;
  waitNotified: boolean;
}

export class UserMessageLock {
  private readonly locks = new Map<number, LockState>();

  tryAcquire(userId: number): boolean {
    this.pruneExpired();
    if (this.locks.has(userId)) return false;
    this.locks.set(userId, { lockedAt: Date.now(), waitNotified: false });
    return true;
  }

  release(userId: number): void {
    this.locks.delete(userId);
  }

  shouldNotifyWait(userId: number): boolean {
    const state = this.locks.get(userId);
    return state != null && !state.waitNotified;
  }

  markWaitNotified(userId: number): void {
    const state = this.locks.get(userId);
    if (state) state.waitNotified = true;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [userId, state] of this.locks) {
      if (now - state.lockedAt > LOCK_TTL_MS) {
        this.locks.delete(userId);
      }
    }
  }
}

export const userMessageLock = new UserMessageLock();
