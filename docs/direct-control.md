# Source publication policies and direct broadcast control

AI content uses producer credentials and reviewed proposals by default. Separate controller credentials can select allowed scenes and change explicitly eligible widget instances without review. The operator configures both in **Producers** (`생산자`) in the admin UI.

## Content sources default to proposals

All built-in sources default to `proposal_only`: `session` (title/goal), `now`, `recap`, `events`, `pin` and `work`. This also applies to existing producers with `canAutoPublish: true` after upgrading. Saved content, layouts and public snapshots remain intact.

Read `GET /api/v1/sources` (`getSources` in OpenAPI) without a token. The response lists source IDs, underlying paths, default policy and effective `policy`; it contains no source content. Token-free proposal context includes the same metadata. Authenticated producer MCP exposes `get_sources`, capabilities include `sourcePolicies`, and the overlay catalog includes `sources`.

In **Data source publication policy** (`데이터 소스 게시 정책`), explicitly select automatic publication for only the needed sources. An `apply` requires both `apply_allowed` on every affected source and the producer's automatic publication grant. Normal field/operation/session grants, public provenance, revisions, observation ordering, ownership, locks and the AI write gate still apply. Source overrides persist across restarts and are operator-only.

Policy follows underlying content paths across every widget and legacy output. Hiding/removing/changing a widget does not permit immediate source writes. Overlapping source definitions combine restrictively; unregistered write paths fail closed. A mixed batch containing a proposal-only source fails atomically with HTTP 403 `SOURCE_REVIEW_REQUIRED`. Validation and candidate render inspection enforce the same policy when their ChangeSet uses `intent: apply`. Use `intent: propose` for a private suggestion. A rejected apply never silently becomes a proposal.

Retractions and clearing content are also source writes. Operator editing, reviewed approval and emergency controls remain available regardless of a source's producer policy. Enabling a source does not unlock previously approved or manually edited fields.

For an operator HTTP client, `POST /api/v1/admin/source-policies` accepts `{ "expectedControlRevision": <current control revision>, "sourceId": "now", "policy": "apply_allowed" }`. Obtain the revision from `/api/v1/admin/control`. Setting a different effective policy increments it; stale revisions are rejected. Cookie-authenticated writes require the normal CSRF header.

## Issue a separate control token

In **Direct control tokens** (`직접 제어 토큰`), enter a name and select scene destinations and/or exact widget instances, then issue the token. Copy the secret from its one-time dialog. The server stores only its hash; listings never return it. Revoke the credential from the same panel when it is no longer needed.

Scene scope permits switching the active application scene across every overlay resolution. Widget scope is an exact `(overlayId, sceneId, widgetId)` triple. Selecting a widget does not grant scene switching, other resolutions or other widget instances. Only opted-in plugins are eligible; currently **Away** supports `visible`, `message`, `detail` and `showDetails`. Geometry, z-index, appearance settings, source content, widget addition/removal and complete layout replacement remain outside this API. Use reviewed layout proposals for layout changes.

The operator HTTP endpoints are `GET/POST /api/v1/admin/controllers` and `POST /api/v1/admin/controllers/{id}/revoke`. Creation accepts `expectedControlRevision`, `name`, `allowedSceneIds` and `widgets` (an array of the exact triples). At least one scope is required. Creation returns HTTP 201 with `{ controller, token }`. Creation and revocation increment the control revision. Up to 128 active credentials are supported. Grants are fixed for a token; issue a new credential to change scope.

Producer and operator credentials cannot call controller routes. Controller credentials cannot call producer/operator APIs and are not accepted by the producer MCP adapter. Controller routes require a bearer token; operator cookies do not authorize them.

## Discover and call the HTTP API

Open `/swagger` on the dashboard and authorize **controllerAuth** to inspect and call these operations in the browser. See [Swagger UI](swagger.md). **bearerAuth** uses a separate producer/operator credential.

From another computer, fetch `http://<dashboard-computer-IP>:4310/openapi.json` without authentication. Import its **Direct control** operations with a controller bearer token. Use a reachable server address as the base URL; `0.0.0.0` is only the listen address.

| Operation ID | HTTP endpoint | Purpose |
| --- | --- | --- |
| `getControlContext` | `GET /api/v1/control/context` | Current configuration revision, mode, active scene ID and scoped targets |
| `setControlScene` | `POST /api/v1/control/scene` | Select an allowed scene |
| `updateControlWidget` | `POST /api/v1/control/widgets` | Patch allowed settings and/or visibility on one instance |

Context contains allowed scene destinations and eligible widget configuration, including each plugin's `settingsKeys`. It contains no session content. Read it before constructing a command. The following Node.js example updates an allowed Away instance, then selects the allowed scene. Store the controller token in the client's environment.

```javascript
const base = process.env.DASHBOARD_URL ?? 'http://192.168.1.20:4310';
const headers = { Authorization: `Bearer ${process.env.DASHBOARD_CONTROL_TOKEN}` };
async function call(path, command) {
  const response = await fetch(`${base}/api/v1/control/${path}`, {
    method: command ? 'POST' : 'GET',
    headers: { ...headers, ...(command ? { 'Content-Type': 'application/json' } : {}) },
    body: command ? JSON.stringify(command) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error.code}: ${data.error.message}`);
  return data;
}
let context = await call('context');
const target = context.widgets.find(w => w.overlayId === 'overlay-1920x1080'
  && w.sceneId === 'break' && w.widget.type === 'away');
if (!target || !context.scenes.some(s => s.id === 'break')) {
  throw new Error('This token does not grant the example widget and scene');
}
const widgetCommand = {
  requestId: crypto.randomUUID(),
  expectedConfigRevision: context.configRevision,
  overlayId: target.overlayId, sceneId: target.sceneId, widgetId: target.widgetId,
  visible: true,
  settings: { message: 'Back in a moment', detail: 'Taking a short break', showDetails: true }
};
const widgetReceipt = await call('widgets', widgetCommand);
console.log(widgetReceipt.outcome, widgetReceipt.publication);
context = await call('context');
const sceneCommand = {
  requestId: crypto.randomUUID(), expectedConfigRevision: context.configRevision,
  sceneId: 'break'
};
const sceneReceipt = await call('scene', sceneCommand);
console.log(sceneReceipt.outcome, sceneReceipt.publication);
```

Commands require a UUID `requestId` and current `expectedConfigRevision`. Settings are a partial patch, with full widget validation after merging. Widget commands require at least one setting or `visible`. The server rechecks exact scope and current plugin eligibility on every new command; removed/ineligible widgets cannot be controlled.

For a lost response, resend the identical command and request ID to recover the original receipt, even after the configuration advances. Changing its action/body under the same ID returns `IDEMPOTENCY_CONFLICT`. Revoked tokens cannot recover receipts. For `OVERLAY_REVISION_CONFLICT`, reread context and reconsider the intended change. Do not blindly replace the revision and retry.

Changes, audit attribution, last-use time, receipts and public snapshots commit atomically. Changed configuration increments `configRevision`; widget changes also increment that layout's revision. Identical settings return `no_change`. No content or layout proposal is created.

In Auto mode, an active-scene change publishes immediately. Inactive widget changes return `publication: not_applicable` until the scene is selected. Hold retains the frozen output and Hidden keeps output hidden; receipts report `held`/`hidden` for active changes. Controller commands do not restore publication. Trusted control works without an active content session and independently of the AI producer-write gate. Default credential quotas are two requests/second with a burst of ten, including reads; commands are limited to 64 KiB. See [error recovery](errors.md).

## Trusted plugin extensions

A widget plugin opts in explicitly, independently of its displayed source paths:

```typescript
directControl: { settingsKeys: ['message', 'detail', 'showDetails'] }
```

Opted-in plugins also allow visibility changes. Declare only existing validated `WidgetSettings` keys appropriate for immediate control. Omitting `directControl` makes the widget ineligible even if a token previously targeted its instance ID. The UI discovers eligible instances from plugin metadata. Source policies still apply to all producer content writes displayed by that widget.

Register trusted content-source definitions in `src/sources/registry.ts`, using a stable ID, label, underlying path grants and `defaultPolicy: 'proposal_only'`. Operator overrides are keyed by source ID. This registry governs publication policy; supporting new source payload shapes/operations also requires extending the shared content schemas and domain operations. Widget rendering plugins do not automatically create arbitrary write APIs. Both extension points are trusted build-time repository changes, followed by a rebuild/restart; runtime plugin uploads are unsupported.
