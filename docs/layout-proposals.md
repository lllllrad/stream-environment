# AI layout proposals

External agents can suggest the complete widget configuration for one fixed-resolution overlay and scene: geometry, visibility, stacking order, presentation settings, widget addition and removal. The operator reviews actual before/after output and approves or rejects it. Agents cannot save layouts directly, activate scenes, add resolutions or install plugins through this feature.

## Permissions and discovery

In **Producers**, enable **Allow layout proposals** for the intended existing producer, or select that grant when registering a new producer. `canProposeLayouts` defaults to false, including for existing credentials. The grant applies to all overlay/scene layouts, independently of session/content grants and `canAutoPublish`. Disable it to stop new submissions, candidate-layout inspection and approval of that author's pending proposals. Revoked authors cannot submit, recover receipts or have pending proposals approved. Operators can still reject them.

Use a producer token in `Authorization: Bearer <token>` and the dashboard computer's reachable origin. Read `GET /api/v1/capabilities` and require `canProposeLayouts: true`. Read `GET /api/v1/overlays` to discover installed plugins, resolutions, scenes, layouts and their current per-layout revisions. This catalog contains no session content. The same discovery is available through MCP `get_capabilities` and `get_layouts`.

Layout proposals do not need an active session. Rendering content in a candidate layout requires an accessible session; its usual session and field grants still apply. Enabling layout proposals does not expand content access. The global AI write gate prevents new layout submissions and validation. Read-only rendering remains available with the layout grant.

## Build and inspect a proposal

Copy the target layout's full `widgets` array and modify the intended instances. `baseRevision` is that layout's revision, **not** `config.revision` or a session revision. Widget IDs are layout-local; higher `zIndex` renders in front, equal values use back-to-front array order, and omitted widgets are removed. The layer is an integer from 0 to 10000; omitted `zIndex` defaults to zero for existing clients. To add a widget, use an installed plugin type with a unique ID and complete validated settings. At most 32 widgets fit one layout; rectangles must remain inside its fixed canvas. Normal color, text and plugin validation applies.

The [LayoutChange schema](../contracts/layout-change.schema.json) defines the exact request, also embedded in the public [OpenAPI specification](../contracts/openapi.json). Only `intent: "propose"` is supported. Use a new UUID request ID, the observed layout revision, UTC observation time, opaque source references and a factual review reason. Private or uncertain widget captions must use `restricted` or `unknown` disclosure; the operator must explicitly permit public display before approval.

```javascript
// Run on the agent computer. Store the producer token privately in its environment.
import { writeFileSync } from 'node:fs';
const base = process.env.DASHBOARD_URL + '/api/v1';
const headers = { Authorization: `Bearer ${process.env.DASHBOARD_PRODUCER_TOKEN}` };
async function request(path, value) {
  const response = await fetch(base + path, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
if (!(await request('/capabilities')).canProposeLayouts) throw new Error('Layout grant required');
const { config } = await request('/overlays');
const layout = config.layouts.find(l => l.overlayId === 'overlay-1920x1080' && l.sceneId === 'live');
if (!layout) throw new Error('Target layout missing');
const widgets = structuredClone(layout.widgets);
const activity = widgets.find(w => w.id === 'now');
if (!activity) throw new Error('Target widget missing');
activity.x = 40;
activity.y = 180;
activity.width = 540;
const command = {
  schemaVersion: '1.0', requestId: crypto.randomUUID(), intent: 'propose',
  overlayId: layout.overlayId, sceneId: layout.sceneId, baseRevision: layout.revision,
  provenance: { disclosure: 'public', observedAt: new Date().toISOString(), sourceRefs: [], reason: 'Move current activity to the left column' },
  widgets
};
await request('/layout-proposals/validate', command);
// Retain the exact request privately before submission to recover a lost response.
writeFileSync('layout-proposal.json', JSON.stringify(command, null, 2));
const receipt = await request('/layout-proposals', command);
console.log(receipt);
console.log(await request(`/layout-proposals/${receipt.proposalId}`));
```

Before submitting, optionally call `POST /api/v1/sessions/{id}/render-preview` with `overlayId`, `sceneId`, `widgets`, optional content `change` and `includeImage`. MCP `render_preview` accepts the same candidate widgets and an optional `sessionId`. It returns exact-size pixel geometry, visible code-point ranges, clipping, overlap and optional PNG. The normal scoped content and private inspection rules apply; it creates no proposal, receipt, audit, layout change or publication. Its `layoutRevision` describes the inspected saved layout; candidate geometry is hypothetical.

`POST /api/v1/layout-proposals/validate` / MCP `validate_layout` validates without writes or reserving a revision. `POST /api/v1/layout-proposals` / MCP `propose_layout` stores a private proposal, canonical colors, original base widgets and an idempotent receipt. It does not change layouts, session content or outputs. The pending queue allows 32 proposals per author and 128 globally. Existing authenticated request quotas also apply.

## Review and publication

The operator's **Change proposals** page includes content and layout proposals. Open a layout comparison to view current and proposed output at the target resolution/scene, browser-measured clipping/overlap, widget geometry/settings and stacking order. Confirm review before approval. Restricted/unknown disclosure requires an additional public-display acknowledgment. A stale proposal requires explicit acknowledgment that its **complete replacement** will overwrite the latest layout, including intervening operator edits. Rejection needs no preview or disclosure approval.

Review refreshes while open. Configuration, layout or channel-control changes reset the review acknowledgments. Approval checks the proposal revision and the reviewed configuration, layout and control revisions atomically, revalidates plugins/geometry and the author's current grant, then saves only that layout. A conflict requires fresh comparison; the server never silently merges a complete replacement or rewrites the original proposal base. Original base widgets remain in the proposal for inspection.

Approval increments layout/configuration revisions when geometry/settings change and records an operator audit entry. It never activates the proposed scene. Auto publishes the selected scene's layout; Hold preserves its published layout until restoration; Hidden keeps all text absent until restoration. Approving an inactive scene changes its saved layout, which appears when that scene is selected. Content revisions, field locks and content proposal semantics remain unchanged. Operators can subsequently edit the approved layout with the ordinary editor and review/save flow.

Operator endpoints are `GET /api/v1/admin/layout-proposals`, `GET /api/v1/admin/layout-proposals/{id}/preview` and `POST /api/v1/admin/layout-proposals/{id}/decision`. Approval requires `expectedProposalRevision`, `expectedConfigRevision`, `expectedLayoutRevision` and `expectedControlRevision`; stale/disclosure acknowledgments use `acknowledgeStale` / `allowDisclosure`. Rejection needs `decision: "reject"` and `expectedProposalRevision`. Normal operator authentication and cookie CSRF protection apply.

## Status and recovery

Read `GET /api/v1/layout-proposals/{id}` or MCP `get_layout_proposal` with `proposalId` to check `pending`, `approved` or `rejected`. Producers can read only their own proposals and need the layout grant; operators can read all. Anonymous outputs cannot expose pending widgets, proposal metadata or provenance.

After an uncertain submission outcome, retry the **exact** stored request with the same request ID to recover its original receipt, even if the layout has changed or the proposal has been decided. Altered payloads with that ID return `IDEMPOTENCY_CONFLICT`. A receipt continues to describe the original submission; read the proposal for its current decision status. MCP reports `REQUEST_OUTCOME_UNKNOWN` for a lost submission response and makes no automatic retry. Revocation/grant checks still precede replay.

For a revision conflict, inspect the latest layout and reconsider the intended changes before creating a new request ID. Do not blindly update `baseRevision`. Layout proposals, receipts and operator widget captions are global configuration records; they survive session purges and are included in database backups. Keep sensitive caption/provenance data out of proposals unless intentionally retained for private review. Separate backup and recording cleanup remains an operator responsibility.
