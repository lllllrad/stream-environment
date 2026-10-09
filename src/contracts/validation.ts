import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { ensure } from './errors.ts';
import type { ChangeSet, Operation } from './types.ts';

const ajv = new Ajv({ allErrors: true, strict: true });
(addFormats as unknown as (a: Ajv) => void)(ajv);
const schema = JSON.parse(readFileSync(new URL('../../contracts/change-set.schema.json', import.meta.url), 'utf8'));
const validate = ajv.compile(schema);
export const LIMITS = { sessionTitle: 60, goal: 100, nowTitle: 48, nowDetail: 120, next: 60, recap: 100, event: 100, pin: 100, workTitle: 60, publicResult: 160, maxOperations: 20, maxBytes: 65536 };
export const OPERATIONS = ['update_session', 'set_now', 'set_pin', 'upsert_event', 'retract_event', 'upsert_work_item', 'retract_work_item'];
export function normalize(value: unknown): any {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function hash(value: unknown): string { return createHash('sha256').update(canonical(normalize(value))).digest('hex'); }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function strings(value: unknown): void {
  if (typeof value === 'string') {
    ensure(value.trim().length > 0, 'INVALID_TEXT', 'Text must not be blank.');
    ensure(!/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069\u200e\u200f]/u.test(value), 'INVALID_TEXT', 'Text contains prohibited control characters or line breaks.');
  } else if (Array.isArray(value)) value.forEach(strings);
  else if (value && typeof value === 'object') Object.values(value).forEach(strings);
}
export function parseChange(raw: unknown): ChangeSet {
  const value = normalize(raw);
  ensure(validate(value), 'SCHEMA_VALIDATION', ajv.errorsText(validate.errors, { separator: '; ' }));
  strings(value);
  return value as ChangeSet;
}
export function text(value: unknown, limit: number, allowEmpty = false): string {
  ensure(typeof value === 'string', 'INVALID_TEXT', 'Expected text.');
  const normalized = value.normalize('NFC');
  if (allowEmpty && normalized === '') return normalized;
  strings(normalized);
  ensure([...normalized].length <= limit, 'INVALID_TEXT', `Text must be at most ${limit} Unicode code points.`);
  return normalized;
}
export function pathsFor(op: Operation): string[] {
  switch (op.op) {
    case 'update_session': return Object.keys(op.fields).map(k => `/session/${k}`);
    case 'set_now': return ['/now'];
    case 'set_pin': return ['/pin'];
    case 'upsert_event': return [`/events/${op.event.id}`];
    case 'retract_event': return [`/events/${op.id}`];
    case 'upsert_work_item': return [`/workItems/${op.workItem.id}`];
    case 'retract_work_item': return [`/workItems/${op.id}`];
  }
}
export function validPath(path: string): boolean { return /^\/(now|pin|session\/(title|goal|recap)|events\/[A-Za-z0-9_-]{1,80}|workItems\/[A-Za-z0-9_-]{1,80})$/.test(path); }
export function pathAllowed(path: string, allowed: string[] = []): boolean { return allowed.includes(path) || allowed.includes('*') || allowed.some(p => p.endsWith('/*') && path.startsWith(p.slice(0, -1))); }
