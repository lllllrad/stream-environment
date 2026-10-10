# Token-free AI proposals

AI clients can propose content and layouts without registration or any authentication token. These dedicated routes always save suggestions for operator review. Immediate content publication, direct scene/widget control, private context and approval retain their authenticated APIs.

Discover the contract at `http://<dashboard-computer-IP>:4310/openapi.json`, or open `/swagger` and select **Public proposals**. No Authorize step is needed for this tag. Use the reachable server address from the agent computer; the examples use a synthetic LAN address.

| Operation ID | HTTP endpoint | Effect |
| --- | --- | --- |
| `getPublicProposalContext` | `GET /api/v1/public/proposals/context` | Proposal target IDs/revisions, installed plugins/sources, caption-free layouts and already published snapshots |
| `validatePublicContent` | `POST /api/v1/public/proposals/content/validate` | Validate a content suggestion without saving or exposing private before/after values |
| `proposePublicContent` | `POST /api/v1/public/proposals/content` | Save a private content proposal and receipt |
| `validatePublicLayout` | `POST /api/v1/public/proposals/layouts/validate` | Validate a layout suggestion; return only revisions and changed paths |
| `proposePublicLayout` | `POST /api/v1/public/proposals/layouts` | Save a private layout proposal and receipt |

## Content example

Read the public proposal context, use the current session ID/revision, then submit a ChangeSet with `intent: propose`. An active or paused current session is required. An absent session is explicit; this API does not create/start sessions.

```javascript
const base = 'http://192.168.1.20:4310';
async function call(path, command) {
  const response = await fetch(`${base}/api/v1/public/proposals/${path}`, {
    method: command ? 'POST' : 'GET',
    headers: command ? { 'Content-Type': 'application/json' } : {},
    body: command ? JSON.stringify(command) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error.code}: ${data.error.message}`);
  return data;
}
const context = await call('context');
if (!context.session) throw new Error('The operator must start a session first');
const content = {
  schemaVersion: '1.0', requestId: crypto.randomUUID(), intent: 'propose',
  sessionId: context.session.id, baseRevision: context.session.revision,
  provenance: {
    disclosure: 'public', observedAt: new Date().toISOString(),
    sourceRefs: [], reason: 'Suggest concise current-activity wording'
  },
  operations: [{ op: 'set_now', value: {
    title: 'Comparing the two settings', detail: 'Checking the same conditions.',
    status: 'in_progress', next: 'Record the differences'
  } }]
};
await call('content/validate', content);
const receipt = await call('content', content);
console.log(receipt.outcome, receipt.proposalId); // proposed; no output change
```

Other content operations use the shared ChangeSet schema. Public `intent: apply` is rejected even when a source allows producer automatic publication. Source policies do not turn anonymous clients into publishing producers. Suggestions can correct existing items and locked fields, but only the human decision applies them. The operator's normal stale/disclosure review and approval locks remain in effect.

## Layout example

Public context includes current saved geometry, widget types, visibility, order, z-index and non-caption settings. It omits stored `settings.message` and `settings.detail`; outputs contain only already published text. It never returns private session wording, another proposal, provenance, credentials or audit records.

Use a complete widget array and the target layout's revision. Existing widget settings omitted from the request are preserved privately. This prevents a geometry-only suggestion from erasing a caption the caller cannot read. Explicitly include a caption key when proposing new wording. New widget instances use standard defaults for missing settings; omitted widget IDs propose removal.

```javascript
const current = await call('context');
const layout = current.config.layouts.find(l =>
  l.overlayId === 'overlay-1920x1080' && l.sceneId === 'live');
if (!layout) throw new Error('Target layout is unavailable');
const widgets = structuredClone(layout.widgets);
const widget = widgets.find(w => w.id === 'now');
if (!widget) throw new Error('Target widget is unavailable');
widget.zIndex = 5;
const geometry = {
  schemaVersion: '1.0', requestId: crypto.randomUUID(), intent: 'propose',
  overlayId: layout.overlayId, sceneId: layout.sceneId,
  baseRevision: layout.revision,
  provenance: {
    disclosure: 'public', observedAt: new Date().toISOString(),
    sourceRefs: [], reason: 'Suggest bringing the activity widget forward'
  },
  widgets
};
await call('layouts/validate', geometry);
const layoutReceipt = await call('layouts', geometry);
console.log(layoutReceipt.outcome, layoutReceipt.proposalId);
```

The [public layout schema](../contracts/public-layout-change.schema.json) supports partial settings inside a complete widget array. It differs from the authenticated producer layout contract, which uses complete settings. Layout suggestions work without a content session. Operator review compares the full saved/proposed layout, including retained captions, and requires the normal geometry, stale replacement and disclosure acknowledgments. Nothing changes in the layout or broadcast before approval.

Published snapshots may reflect an older frozen layout/content during Hold. Proposal metadata describes current saved revisions. Hidden outputs contain no broadcast content. Full private candidate render inspection remains available to authenticated producers with grants; token-free validation returns no private render or merged text.

## MCP without a token

Launch the existing `node scripts/mcp.ts` adapter with `DASHBOARD_URL` and omit `DASHBOARD_PRODUCER_TOKEN` (or leave it empty). It exposes only `get_proposal_context`, `validate`, `propose`, `validate_layout` and `propose_layout`. These tools use the public routes above and provide no apply, private context, approval or direct control tool. The layout tools accept the public partial-settings contract.

Supplying a valid producer token retains the existing authenticated producer tools and their grants. An invalid supplied token is rejected rather than silently falling back to anonymous access. See [MCP host setup](mcp.md).

## Review and recovery

The operator finds both kinds of suggestion in **Change proposals**, labeled as anonymous with an unauthenticated submitter. Content approval and layout review use the existing operator UI. `disclosure: public` is a caller declaration; it does not authenticate the sender or bypass approval. Tokens cannot be supplied through these bodies to change the anonymous role.

Reuse the identical UUID/body after a lost submission response; the original receipt is recovered after a restart or decision. A different body with that ID returns `IDEMPOTENCY_CONFLICT`. Content receipts remain scoped to the currently active session; read current context after a session switch. A revision conflict requires reconsidering the suggestion against current metadata. Validation does not reserve a revision. There is no anonymous listing or private proposal-status endpoint.

The operator AI-write gate stops public submissions and validation, including receipt recovery while paused. Public metadata reads remain available. Anonymous requests share the configured request quota (default two/second, burst ten), including discovery and validation. Each anonymous review queue is limited to 32 pending items; public submissions stop when the corresponding global queue has 128 pending items. Bodies remain limited to 64 KiB; existing schema/text/layout limits apply. Host/Origin checks remain in force. See [error recovery](errors.md).
