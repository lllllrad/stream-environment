import type { ChangeSet, Receipt, PublicSnapshot } from './types.ts';
import { widgetInstanceSchema, type WidgetInstance } from './overlay.ts';

export type LayoutChange = { schemaVersion: '1.0'; requestId: string; intent: 'propose'; overlayId: string; sceneId: string; baseRevision: number; provenance: ChangeSet['provenance']; widgets: WidgetInstance[] };
export type LayoutProposal = { id: string; revision: number; status: 'pending' | 'approved' | 'rejected'; actorId: string; createdAt: string; reviewedAt: string | null; change: LayoutChange; baseWidgets: WidgetInstance[] };
export type LayoutProposalReceipt = { ok: true; requestId: string; outcome: 'proposed'; proposalId: string; overlayId: string; sceneId: string; layoutRevision: number; publication: 'not_applicable' };
export type LayoutProposalPreview = { proposalId: string; proposalRevision: number; configRevision: number; layoutRevision: number; controlRevision: number; baseRevision: number; stale: boolean; publication: Receipt['publication']; changedPaths: string[]; beforeWidgets: WidgetInstance[]; afterWidgets: WidgetInstance[]; before: PublicSnapshot; after: PublicSnapshot };

const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' };
export const layoutChangeSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#', title: 'LayoutChange', type: 'object', additionalProperties: false,
  required: ['schemaVersion','requestId','intent','overlayId','sceneId','baseRevision','provenance','widgets'],
  properties: {
    schemaVersion: { const: '1.0' }, requestId: { type: 'string', format: 'uuid' }, intent: { const: 'propose' },
    overlayId: id, sceneId: id, baseRevision: { type: 'integer', minimum: 0, description: 'Revision of this overlay/scene layout, not the global configuration revision.' },
    provenance: { type: 'object', additionalProperties: false, required: ['disclosure','observedAt','sourceRefs','reason'], properties: {
      disclosure: { enum: ['public','unknown','restricted'] }, observedAt: { type: 'string', format: 'date-time', pattern: 'Z$' },
      sourceRefs: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9:_-]+$' } },
      reason: { type: 'string', minLength: 1, maxLength: 240 }
    } },
    widgets: { type: 'array', maxItems: 32, items: widgetInstanceSchema, description: 'Complete replacement widget array. Higher zIndex renders in front; equal values use back-to-front array order. Omitted zIndex is zero. Include unchanged widgets to retain them.' }
  }
};
