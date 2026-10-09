# Machine-readable error recovery

Errors return `{ "ok": false, "error": { "code", "message", "paths", "currentRevision"?, "retryable", "recovery" } }`. Responses never contain internal stacks, request bodies, or credentials. Client code should branch on `code`, not translate/match `message`.

| Code | HTTP | Recovery |
| --- | ---: | --- |
| `UNAUTHORIZED` | 401 | Authenticate with a valid non-revoked credential for this role/screen. |
| `FORBIDDEN` | 403 | Ask the operator to review the required permission scope. |
| `OPERATION_FORBIDDEN`, `FIELD_FORBIDDEN` | 403 | Restrict the command to registered operations/paths. |
| `ITEM_OWNER_CONFLICT` | 403 | Do not overwrite another producer's item without an explicit grant. |
| `AI_WRITES_DISABLED` | 403 | Wait for the operator to enable producer writes. Human edits remain available. |
| `CSRF_REJECTED` | 403 | Use the operator cookie's current CSRF token in `X-CSRF-Token`. |
| `HOST_REJECTED`, `ORIGIN_REJECTED` | 403 | Use the configured local origin. Remote access is not enabled in P0. |
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
| `INVALID_PATH`, `INVALID_CURSOR` | 422 | Use a permitted field path or the returned nonnegative cursor. |
| `CONTENT_TYPE_REQUIRED`, `INVALID_JSON`, `BODY_TOO_LARGE` | 422 | Send an application/json object no larger than 64 KiB. |
| `RATE_LIMITED` | 429 | Back off within the configured producer quota; avoid unnecessary repeated context reads. |
| `SERVICE_UNAVAILABLE` | 503 | Check `/health/ready` and storage. Retry the same request ID/body for an uncertain committed result. |

Only 429/503 responses advertise `retryable: true`. A rejected apply never partially applies, silently changes into a proposal, removes a lock, or weakens disclosure rules.
