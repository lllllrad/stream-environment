# Machine-readable error recovery

Errors return `{ "ok": false, "error": { "code", "message", "paths", "currentRevision"?, "retryable", "recovery" } }`. Responses never contain internal stacks, request bodies, or credentials. Client code should branch on `code`, not translate/match `message`.

| Code | HTTP | Recovery |
| --- | ---: | --- |
| `UNAUTHORIZED` | 401 | Authenticate with a valid non-revoked credential for the operator or producer role. Public display reads require no credential. |
| `FORBIDDEN` | 403 | Ask the operator to review the required permission scope. |
| `OPERATION_FORBIDDEN`, `FIELD_FORBIDDEN` | 403 | Restrict the command to registered operations/paths. |
| `ITEM_OWNER_CONFLICT` | 403 | Do not overwrite another producer's item without an explicit grant. |
| `AI_WRITES_DISABLED` | 403 | Wait for the operator to enable producer writes. Human edits remain available. |
| `CSRF_REJECTED` | 403 | Use the operator cookie's current CSRF token in `X-CSRF-Token`. |
| `HOST_REJECTED`, `ORIGIN_REJECTED` | 403 | Use the dashboard's receiving interface IP or a configured `ALLOWED_HOSTS` authority. Browser Origin must match the request host. |
| `NOT_FOUND` | 404 | Check the session, output, event/work item, proposal or audit ID. |
| `REVISION_CONFLICT`, `CONTROL_REVISION_CONFLICT` | 409 | Reread and reassess the intended content/control change. Never blindly bump a version. |
| `FIELD_LOCKED` | 409 | Preserve the operator's value; optionally submit a new proposal. |
| `IDEMPOTENCY_CONFLICT` | 409 | The request ID belongs to another body. Use the original body for a retry, or a fresh ID for a new intention. |
| `INACTIVE_SESSION`, `SESSION_ENDED` | 409 | Read the current session; do not move old responses into a new activity. |
| `ACTIVE_SESSION_EXISTS`, `INVALID_TRANSITION` | 409 | Use a valid lifecycle transition and explicitly end the current activity before switching. |
| `STALE_OBSERVATION` | 409 | Do not roll current activity back to an older observation. Historical facts may use a timeline ID/time. |
| `ITEM_RETRACTED` | 409 | The operator must explicitly restore the withdrawn item. |
| `STALE_PROPOSAL`, `PROPOSAL_CONFLICT` | 409 | Review against the current revision or reread the proposal's review state. |
| `UNDO_CONFLICT`, `UNDO_UNAVAILABLE` | 409 | A later change or non-content action prevents safe field-wise undo. Review manually. |
| `SCHEMA_VALIDATION`, `INVALID_TEXT` | 422 | Follow the shared schema, Unicode code-point limits, NFC normalization, no blank/control-containing text, and complete replacement objects. |
| `SESSION_MISMATCH` | 422 | Match path and body session IDs. |
| `AMBIGUOUS_CHANGESET` | 422 | Modify each target path only once in a batch. |
| `INVALID_OBSERVATION_TIME` | 422 | Check the client's UTC clock; more than 60 seconds into the future is rejected. |
| `DISCLOSURE_REQUIRED` | 422 | Auto-apply requires public provenance and a registered publishing grant; a new explicit proposal is a separate request. |
| `DISCLOSURE_REVIEW_REQUIRED` | 422 | The operator must explicitly acknowledge public suitability of unknown/restricted content. |
| `RESTORE_CONFIRMATION_REQUIRED`, `CONFIRMATION_REQUIRED` | 422 | Perform the explicit human confirmation for publishing recovery or permanent cleanup. |
| `INVALID_EXPORT_FORMAT` | 422 | Use `format=json` or `format=markdown` on the operator session export route. |
| `INVALID_PATH`, `INVALID_CURSOR` | 422 | Use a permitted field path or the returned nonnegative cursor. |
| `CONTENT_TYPE_REQUIRED`, `INVALID_JSON`, `BODY_TOO_LARGE` | 422 | Send an application/json object no larger than 64 KiB. |
| `PROPOSAL_ONLY` | 403 | The token-free public content API accepts only `intent: propose`. Immediate changes use authenticated grants. |
| `PROPOSAL_LIMIT` | 429 | Wait for operator review; public queues permit 32 anonymous pending items and stop at 128 global pending items. |
| `SOURCE_REVIEW_REQUIRED` | 403 | At least one affected source is proposal-only or unregistered. Submit a new reviewed proposal; only the operator can enable automatic source publication. |
| `CONTROL_FORBIDDEN` | 403 | Use a scene/widget instance and settings allowed by this controller token and the current plugin. |
| `CONTROLLER_LIMIT` | 429 | Revoke an unused credential before issuing another; at most 128 active control tokens are supported. |
| `RATE_LIMITED` | 429 | Back off within the configured credential quota; avoid unnecessary repeated context reads. |
| `OVERLAY_REVISION_CONFLICT` | 409 | Reload the overlay configuration and reconcile the draft before saving. |
| `INVALID_LAYOUT`, `INVALID_OVERLAY`, `UNKNOWN_WIDGET` | 422 | Use installed widget types, validated settings and integer rectangles inside a supported canvas. |
| `OVERLAY_EXISTS`, `SCENE_EXISTS` | 422 | Choose a unique resolution/name and stay within configuration limits. |
| `PREVIEW_REPLAY` | 409 | Inspect a new candidate ID; this request already has a saved receipt. |
| `RENDER_BUSY` | 429 | At most two inspections run concurrently; retry shortly. |
| `RENDER_UNAVAILABLE` | 503 | Build the app and configure an installed Chromium browser for server-side inspection. |
| `SERVICE_UNAVAILABLE` | 503 | Check `/health/ready` and storage. Retry the same request ID/body for an uncertain committed result. |

Only 429/503 responses advertise `retryable: true`. A rejected apply never partially applies, silently changes into a proposal, removes a lock, or weakens disclosure rules.

## MCP adapter errors

HTTP errors retain the same structured envelope inside an MCP tool result with `isError: true`. Adapter-specific errors include:

| Code | Recovery |
| --- | --- |
| `INVALID_CONFIGURATION` | Set a local HTTP origin and a registered producer token in the host's private environment. |
| `PRODUCER_TOKEN_REQUIRED` | Replace an operator credential with a producer token; no private context was returned. |
| `DASHBOARD_UNAVAILABLE` | Start/check the local dashboard and retry the read. |
| `REQUEST_OUTCOME_UNKNOWN` | A submission may have been saved. Resend the exact ChangeSet and request ID to recover its receipt. |
| `ADAPTER_ERROR` | Check local configuration and the shared contract; no internal stack is returned. |

SDK argument validation errors are tool errors before HTTP submission and may use the SDK's own message format. Neither the adapter nor server automatically changes an apply into a proposal or blindly retries a revision conflict.
