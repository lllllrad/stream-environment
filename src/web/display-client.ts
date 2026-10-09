import type { PublicSnapshot } from '../contracts/types.ts';
export class Lease {
  revision = -1; deadline = 0; wallDeadline = 0;
  accept(snapshot: PublicSnapshot, monotonic = performance.now(), wall = Date.now()): boolean {
    if (snapshot.publicRevision < this.revision) return false;
    const same = snapshot.publicRevision === this.revision;
    this.revision = snapshot.publicRevision; this.extend(snapshot.leaseMs, monotonic, wall);
    return !same;
  }
  heartbeat(revision: number, leaseMs: number, monotonic = performance.now(), wall = Date.now()): 'refresh' | 'keep' | 'ignore' {
    if (revision > this.revision) return 'refresh';
    if (revision !== this.revision) return 'ignore';
    this.extend(leaseMs, monotonic, wall); return 'keep';
  }
  private extend(ms: number, monotonic: number, wall: number) { const bounded = Math.min(30000, Math.max(0, ms)); this.deadline = monotonic + bounded; this.wallDeadline = wall + bounded; }
  expired(monotonic = performance.now(), wall = Date.now()): boolean { return monotonic >= this.deadline || wall >= this.wallDeadline; }
  clear() { this.deadline = 0; this.wallDeadline = 0; }
}
