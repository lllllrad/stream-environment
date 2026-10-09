import test from 'node:test';
import assert from 'node:assert/strict';
import { Lease } from '../src/web/display-client.ts';
import type { PublicSnapshot } from '../src/contracts/types.ts';
const snapshot = (rev: number) => ({ publicRevision: rev, leaseMs: 30000 } as PublicSnapshot);
test('lease: missed newer snapshot cannot renew old content, lower versions are ignored', () => {
  const lease = new Lease(); assert.equal(lease.accept(snapshot(10), 0, 0), true);
  assert.equal(lease.heartbeat(11, 30000, 25000, 25000), 'refresh');
  assert.equal(lease.deadline, 30000); assert.equal(lease.expired(30000, 30000), true);
  assert.equal(lease.accept(snapshot(9), 31000, 31000), false); assert.equal(lease.revision, 10);
  assert.equal(lease.accept(snapshot(11), 32000, 32000), true); assert.equal(lease.expired(32000, 32000), false);
});
test('lease: matching heartbeat supports long holds; wall clock protects resume from suspended monotonic time', () => {
  const lease = new Lease(); lease.accept(snapshot(10), 0, 0);
  assert.equal(lease.heartbeat(10, 30000, 25000, 25000), 'keep'); assert.equal(lease.deadline, 55000);
  assert.equal(lease.expired(26000, 90000), true); lease.clear(); assert.equal(lease.expired(1,1), true);
});
