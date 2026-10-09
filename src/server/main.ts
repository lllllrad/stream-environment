import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.ts';
import { Engine } from '../domain/engine.ts';
import { createHttp } from './http.ts';

const dataDir = resolve(process.env.DATA_DIR ?? '.data');
mkdirSync(dataDir, { recursive: true });
const keyPath = resolve(dataDir, 'operator.key');
let adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('base64url'), { mode: 0o600 });
  adminToken = readFileSync(keyPath, 'utf8').trim();
}
if (adminToken.length < 24) throw new Error('ADMIN_TOKEN must be at least 24 characters.');
function number(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} is invalid.`);
  return value;
}
const port = number('PORT', 4310, 1, 65535), store = new Store(resolve(dataDir, 'dashboard.db'));
const engine = new Engine(store, number('LEASE_MS', 30000, 1000, 30000));
const app = createHttp(engine, { adminToken, webDir: resolve('dist'), port, heartbeatMs: number('HEARTBEAT_MS', 5000, 100, 10000), producerRate: number('PRODUCER_RATE', 2, 1, 100), producerBurst: number('PRODUCER_BURST', 10, 1, 1000) });
app.server.listen(port, '127.0.0.1', () => console.log(`Dashboard ready at http://127.0.0.1:${port}/admin\nOperator credential: ${process.env.ADMIN_TOKEN ? 'ADMIN_TOKEN environment variable' : keyPath}`));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await app.close(); store.close(); }
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
