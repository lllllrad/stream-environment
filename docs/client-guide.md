# External client guide

The dashboard receives structured, public-ready text. It does not summarize transcripts, listen to calls, fetch source URLs, execute work, or change streaming-platform state. HTTP is the core integration contract; the local stdio [MCP adapter](mcp.md) exposes the same content operations and review flow.

## Connection workflow

For clients on another computer, use `http://<dashboard-computer-IP>:4310/api/v1` as the base URL. The server binds to `0.0.0.0` by default; a DNS/computer name needs an `ALLOWED_HOSTS` entry. See [network deployment](operations.md#deployment-boundary). The example below uses localhost for a client running on the dashboard computer.

Use a producer token issued by the operator, with `Authorization: Bearer <token>`. Read `/api/v1/capabilities` to discover granted operations, fields, code-point limits, and contract version. Read `/api/v1/sessions/current`, then that session's `/context`. The response filters fields to your grants and gives the session revision and protected lock paths.

Submit one logical update to `/api/v1/sessions/{id}/changes`, matching its path/body session ID and the context's `baseRevision`. Use the shared [ChangeSet schema](../contracts/change-set.schema.json). Read the [example request](../examples/public-change.json) and [receipt](../examples/applied-receipt.json).

```javascript
// Run from a trusted local Node.js client. Store the producer token in its environment.
const base = 'http://127.0.0.1:4310/api/v1';
const headers = { Authorization: `Bearer ${process.env.PRODUCER_TOKEN}` };
const current = await fetch(`${base}/sessions/current`, { headers }).then(r => r.json());
if (!current.session) throw new Error('No active session');
const context = await fetch(`${base}/sessions/${current.session.id}/context`, { headers }).then(r => r.json());
const command = {
  schemaVersion: '1.0',
  requestId: crypto.randomUUID(),
  sessionId: context.id,
  baseRevision: context.revision,
  intent: 'apply',
  provenance: {
    disclosure: 'public',
    observedAt: new Date().toISOString(),
    sourceRefs: ['context:verified:042'],
    reason: 'A verified activity transition'
  },
  operations: [{
    op: 'set_now',
    value: {
      title: 'Comparing the two settings',
      detail: 'Checking differences under the same conditions.',
      status: 'in_progress',
      next: 'Record the conditions that explain the difference'
    }
  }]
};
const response = await fetch(`${base}/sessions/${context.id}/changes`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(command)
});
const receipt = await response.json();
if (!response.ok) throw new Error(`${receipt.error.code}: ${receipt.error.message}`);
console.log(`Stored outcome: ${receipt.outcome}; publication: ${receipt.publication}`);
```

Check response status and `ok` on every context/capability read too. The example is a small submission illustration, not a background agent or an autonomous retry loop.

## OpenAPI discovery and import

Fetch `GET http://<dashboard-computer-IP>:4310/openapi.json` from the agent computer. This public endpoint requires no token and contains only API metadata and synthetic examples, with no session content or credentials. The server performs its normal Host/Origin checks. The response uses the requested dashboard origin in `servers[0].url`; fetching through a LAN address or VPN address keeps subsequent calls on that same address. It ignores forwarded headers.

The OpenAPI 3.1 document is self-contained: all schemas and `$ref` targets are inside the single JSON file. Import it by URL into an OpenAPI-compatible client, or download it first (replace the example IP with the dashboard computer's address):

```bash
curl --fail --silent --show-error http://192.168.1.20:4310/openapi.json -o dashboard-openapi.json
```

In Windows PowerShell, use `curl.exe` for this command. The committed [OpenAPI file](../contracts/openapi.json) is also available for offline import; its relative server URL `/` must be resolved against the dashboard origin or overridden in the importer. `just contracts` regenerates it from the shared schemas and English request examples. Restart the dashboard after changing generated contracts to refresh the served document.

For actual requests, configure `Authorization: Bearer <registered-producer-token>` privately in the client. Use the **Producer** tag to select AI integration operations; **Operator** operations require an operator credential and are unavailable to producer tokens. Schema discovery does not grant access to any protected operation.

| Operation ID | Purpose |
| --- | --- |
| `getCapabilities` | Discover granted operations, field scopes, publication permission and limits |
| `getCurrentSession` | Find the active session; a null session means the operator has not activated one |
| `getSessionContext` | Read scoped content and its current revision |
| `validateChanges` | Compare a candidate without creating content, a proposal or a receipt |
| `submitChanges` | Submit a reviewed-content proposal, or apply when explicitly granted permission |
| `producerHeartbeat` | Report connectivity without changing content |

The validation and submission operations include `proposal` and `apply` request examples. Replace session ID, base revision, observation/event timestamps and UUID with current values; example values are not live state. Prefer `intent: propose` for operator review. Reuse the identical request ID and body after a lost submission response, and reread context before reconsidering a revision conflict. The OpenAPI importer must support version 3.1.

## Publication and uncertainty

`disclosure: public` is a declaration, not a permission grant. Auto-apply additionally requires registered publishing permission, granted fields/operations, the current session, a normal revision, no locks, valid content, and an allowed observation time. An unknown/restricted source uses `intent: propose` and waits for explicit operator review. Mixing sources keeps the most restrictive classification; paraphrasing does not make private information public.

Use plain text. Keep it short and factual. Reflect activities/decisions/results actually reported or verified. Use `certainty: tentative` for uncertain event interpretations; the output labels them as under review. Do not report work completion without evidence. `succeeded` is a producer report, not proof that work was actually performed.

Only submit meaningful changes, complete sentences, and stable IDs. Rephrasing identical meaning is the external client's responsibility; the server detects exact normalized equality, not semantic equivalence. Reuse an event/work ID for a correction, and retract when public content should be removed. Only the owning producer can edit it unless the operator explicitly granted cross-producer editing.

## Responses and retries

| Value | Meaning |
| --- | --- |
| `outcome: applied` | State changed atomically |
| `outcome: proposed` | Private review item saved; not published |
| `outcome: no_change` | Identical content; no visual/content revision increase |
| `publication: published` | Server public snapshot is current; no guarantee every OBS instance has rendered it |
| `publication: held` | Stored, while viewers keep the safe frozen output |
| `publication: hidden` | Stored, while all output content is hidden |
| `publication: not_applicable` | Proposal or content outside the currently published session |

For a lost response after a successful submission, resend the exact command and request ID. Canonical normalization/key ordering yields the original receipt even if revisions and locks have advanced. Changing the body under the same ID produces `IDEMPOTENCY_CONFLICT`. Revoked credentials are rejected even for receipt replays.

For `REVISION_CONFLICT`, reread context and reassess whether the change is still true/useful. Do not merely replace `baseRevision` and blindly retry. For `FIELD_LOCKED`, leave the field intact and submit a new proposal if appropriate. A producer cannot unlock, force-write, change presets/policy, approve proposals, or activate a session.

`observedAt` is UTC and describes when the activity was observed. An older current-activity observation is rejected; historical events use their own IDs and `occurredAt`. An observation more than 60 seconds in the future is rejected. `receivedAt` and `publishedAt` are server-generated separate timestamps.

Call `/changes/validate` for a side-effect-free comparison. It creates no receipt, proposal, lock, content revision, or public revision; real submission repeats validation. Its success does not reserve the current revision.

## Connectivity and quotas

Send `{}` to `POST /api/v1/producers/heartbeat` every five seconds when connected. This does not alter content revisions. Default producer quotas are a sustained two authenticated requests/second with a burst of ten, including context/capability requests. Cache capabilities and read context when needed; configure higher quotas deliberately for a workload that needs them. Requests are limited to 64 KiB and 20 operations.

Keep tokens out of URLs, logs, frontend bundles, and public text. `sourceRefs` are short opaque IDs, never raw source content or paths. The server stores no source transcript. Producer context never contains other clients' private proposals, their original evidence, or operator audit/lock reasons.

## Account-free demo

`pnpm demo` creates a synthetic session and restricted-to-that-session publishing producer. It writes `.data/demo-producer.json` and `.data/demo-outputs.json` privately. It refuses to replace an existing running session. `pnpm demo --exercise` demonstrates receipt replay, conflicting request IDs, server locks, proposals, held changes, withdrawal, and emergency hide. It deliberately leaves a locked activity and hidden outputs for review. `pnpm demo --end` ends only the recorded currently active demo session.

## Content suggestions are not limited to work items

Agents can discover fixed overlay layouts through authenticated `GET /api/v1/overlays` (`getLayouts`) and inspect current/candidate content with `POST /api/v1/sessions/{id}/render-preview` (`renderPreview`). Include an overlay ID, optional scene ID, optional complete ChangeSet and `includeImage`. The private response reports actual browser-visible Unicode ranges, clipping, rectangles and inspected revisions; it never submits or publishes the candidate. See [examples and visibility semantics](overlays.md#agent-inspection-over-http-and-mcp). MCP exposes the same workflow as `get_layouts` and `render_preview`.

The original requirements (sections 8–9) explicitly include proposed viewer-facing wording. Use `set_now` for current activity, `update_session.fields.recap` for accumulated context, `upsert_event` for reported topics/decisions/results, `set_pin` for viewer notices, and scoped session title/goal updates where granted. `upsert_work_item` is just one optional content type. See the [multi-field content proposal](../examples/content-proposal.json). A producer with automatic publication disabled can still submit these actual content proposals for operator review.
