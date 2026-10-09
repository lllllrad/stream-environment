import { DatabaseSync } from 'node:sqlite';
import type { Audit, Receipt } from '../contracts/types.ts';

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS receipts (actor_id TEXT NOT NULL, session_id TEXT NOT NULL, request_id TEXT NOT NULL, hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor_id,session_id,request_id)) STRICT;
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, value TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS audit_session ON audit(session_id,id);`);
  }
  get<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM documents WHERE key=?').get(key); return row ? JSON.parse(row.value as string) : undefined; }
  put(key: string, value: unknown): void { this.db.prepare('INSERT INTO documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  delete(key: string): void { this.db.prepare('DELETE FROM documents WHERE key=?').run(key); }
  list<T>(prefix: string): T[] { return this.db.prepare('SELECT value FROM documents WHERE key LIKE ? ORDER BY key').all(`${prefix}%`).map(r => JSON.parse(r.value as string)); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  receipt(actor: string, session: string, request: string): { hash: string; response: Receipt } | undefined {
    const r = this.db.prepare('SELECT hash,response FROM receipts WHERE actor_id=? AND session_id=? AND request_id=?').get(actor, session, request);
    return r ? { hash: r.hash as string, response: JSON.parse(r.response as string) } : undefined;
  }
  saveReceipt(actor: string, session: string, request: string, digest: string, response: Receipt): void { this.db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?)').run(actor, session, request, digest, JSON.stringify(response)); }
  audit(entry: Omit<Audit, 'id'>): number { return Number(this.db.prepare('INSERT INTO audit(session_id,value) VALUES (?,?)').run(entry.sessionId, JSON.stringify(entry)).lastInsertRowid); }
  audits(cursor = 0, limit = 30): Audit[] { return this.db.prepare('SELECT id,value FROM audit WHERE (?=0 OR id<?) ORDER BY id DESC LIMIT ?').all(cursor, cursor, limit).map(r => ({ ...JSON.parse(r.value as string), id: Number(r.id) })); }
  auditById(id: number): Audit | undefined { const r = this.db.prepare('SELECT id,value FROM audit WHERE id=?').get(id); return r ? { ...JSON.parse(r.value as string), id: Number(r.id) } : undefined; }
  updateAudit(entry: Audit): void { this.db.prepare('UPDATE audit SET value=? WHERE id=?').run(JSON.stringify(entry), entry.id); }
  close(): void { this.db.close(); }
}
