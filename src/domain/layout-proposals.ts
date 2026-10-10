import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { ensure } from '../contracts/errors.ts';
import { layoutChangeSchema, type LayoutChange } from '../contracts/layout-proposals.ts';
import { widgetZIndex, type WidgetInstance } from '../contracts/overlay.ts';
import { canonical, LIMITS, normalize, text } from '../contracts/validation.ts';

const ajv = new Ajv({ strict: true, allErrors: true });
(addFormats as unknown as (a: Ajv) => void)(ajv);
const validate = ajv.compile<LayoutChange>(layoutChangeSchema);
export function parseLayoutChange(raw: unknown): LayoutChange {
  ensure(Buffer.byteLength(JSON.stringify(raw) ?? '') <= LIMITS.maxBytes, 'BODY_TOO_LARGE', 'Request exceeds 64 KiB.');
  const value = normalize(raw);
  ensure(validate(value), 'SCHEMA_VALIDATION', 'Invalid layout proposal contract.');
  value.provenance.reason = text(value.provenance.reason, 240);
  ensure(Date.parse(value.provenance.observedAt) <= Date.now() + 30000, 'FUTURE_OBSERVATION', 'Observation time is in the future.');
  return value;
}
export function layoutChangedPaths(overlayId: string, sceneId: string, before: WidgetInstance[], after: WidgetInstance[]): string[] {
  const root = `/layouts/${overlayId}/${sceneId}`, paths: string[] = [];
  if (canonical(before.map(w => w.id)) !== canonical(after.map(w => w.id))) paths.push(`${root}/order`);
  for (const id of new Set([...before, ...after].map(w => w.id))) {
    const a = before.find(w => w.id === id), b = after.find(w => w.id === id);
    if (!a || !b) { paths.push(`${root}/widgets/${id}`); continue; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof WidgetInstance>;
    for (const key of keys) {
      const changed = key === 'zIndex' ? widgetZIndex(a) !== widgetZIndex(b) : canonical(a[key]) !== canonical(b[key]);
      if (changed) paths.push(`${root}/widgets/${id}/${key}`);
    }
  }
  return paths;
}
