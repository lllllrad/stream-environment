import test from 'node:test';
import assert from 'node:assert/strict';
import { backup } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup, change, now } from './helpers.ts';
import { Store } from '../src/server/store.ts';
import { Engine } from '../src/domain/engine.ts';
test('online SQLite backup restores a coherent hidden session, locks, snapshots and original receipts',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'broadcast-backup-'));let original:Store|undefined,recovered:Store|undefined;
  try {
    const {store,engine:e,producer:p,session:s}=setup(join(dir,'source.db'));original=store;
    const request=change(s,[now()]),receipt=e.changes(p,s.id,request);
    e.locks({sessionId:s.id,path:'/now',locked:true,expectedRevision:e.session(s.id).revision});e.setControl({mode:'hidden',expectedControlRevision:e.control().controlRevision});
    const expected={session:e.session(s.id),control:e.control(),snapshot:e.output('main-full').snapshot};
    await backup(store.db,join(dir,'backup.db'));recovered=new Store(join(dir,'backup.db'));const restored=new Engine(recovered);
    assert.deepEqual(restored.session(s.id),expected.session);assert.deepEqual(restored.control(),expected.control);assert.deepEqual(restored.output('main-full').snapshot,expected.snapshot);assert.deepEqual(restored.changes(p,s.id,request),receipt);assert.equal(recovered.db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
  } finally {recovered?.close();original?.close();rmSync(dir,{recursive:true,force:true});}
});
