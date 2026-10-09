import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const dataDir = resolve(process.env.DATA_DIR ?? '.data'), source = resolve(dataDir, 'dashboard.db');
const destination = resolve(process.argv[2] ?? `${dataDir}/backups/dashboard-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
const webRelative = relative(resolve('dist'), destination);
if (!webRelative.startsWith('..') && !webRelative.includes(':')) throw new Error('Backups must not be inside the public asset directory.');
if (!existsSync(source)) throw new Error('The dashboard database does not exist.');
if (existsSync(destination)) throw new Error('The destination already exists; choose a new backup file.');
mkdirSync(resolve(destination, '..'), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, destination); const check = new DatabaseSync(destination, { readOnly: true }); try { const result = check.prepare('PRAGMA integrity_check').get(); if (result?.integrity_check !== 'ok') throw new Error('Backup integrity check failed.'); } finally { check.close(); } console.log(`Consistent SQLite backup written to ${destination}`); }
finally { db.close(); }
