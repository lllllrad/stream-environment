# External content proposals through MCP

The original requirements already cover **actual viewer-facing content**, not just tasks: sections 8–9 define content operations and proposal review, and section 10.2 specifies an optional MCP adapter. The follow-up prioritizes that adapter. Both HTTP and MCP can suggest session wording, current activity, recap, timeline events, notices and reported work. This integration does not generate content on its own or execute work.

## Connect an MCP client

1. Start the dashboard with `pnpm start` after `pnpm build`.
2. In the operator's **Producers** page, register a producer for the intended session and content fields. Leave automatic publication off to require review. For activity summaries and notices, grant `/now`, `/session/recap`, `/pin` and `/events/*`. Grant `/session/title` and `/session/goal` only if the client needs to suggest those fields.
3. Store the once-shown producer token in the MCP host's secret environment as `DASHBOARD_PRODUCER_TOKEN`. Do not use the operator key.
4. Add the [configuration template](../examples/mcp-config.json) to a host that supports local stdio MCP servers. Replace the script path with this checkout's absolute path and inject the real producer token privately. Use Node.js 24 on PATH or its absolute executable path.

```json
{
  "mcpServers": {
    "broadcast-content": {
      "command": "node",
      "args": ["C:/path/to/stream-environment/scripts/mcp.ts"],
      "env": {
        "DASHBOARD_URL": "http://127.0.0.1:4310",
        "DASHBOARD_PRODUCER_TOKEN": "REPLACE_IN_YOUR_PRIVATE_HOST_CONFIGURATION"
      }
    }
  }
}
```

Host configuration formats can vary; the executable, arguments and environment above define the transport. The script resolves contracts relative to its own path, so the host's working directory can differ. Use the direct Node command for protocol connections. `pnpm mcp` is a convenience launcher from this checkout and reads an optional `.env` file; do not run a build inside a stdio protocol session. Stdout carries only MCP messages, with sanitized startup diagnostics on stderr.

Run the stdio adapter on the AI agent computer. When the dashboard runs on another computer, replace `DASHBOARD_URL` with its reachable address, for example `http://192.168.1.20:4310`. The dashboard binds to `0.0.0.0` by default; DNS names require an explicit `ALLOWED_HOSTS` entry on the dashboard server. See [network deployment](operations.md#deployment-boundary). Keep `127.0.0.1` for same-machine clients.

The adapter accepts a configured HTTP or HTTPS origin without credentials, query, fragment or path. HTTPS requires an independently available HTTPS endpoint; the dashboard process itself serves HTTP. It connects to the existing dashboard over authenticated HTTP and never opens SQLite separately. It refuses operator credentials before reading context. Revocation and changed grants are enforced on every request. MCP transport remains local stdio on the agent computer; this does not expose a remote MCP server or make a private network reachable by a cloud-only host.

The adapter uses the pinned official [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/). Its tool schemas reuse the repository's [ChangeSet JSON Schema](../contracts/change-set.schema.json) through the SDK's [JSON Schema adapter](https://ts.sdk.modelcontextprotocol.io/v2/advanced/schema-libraries); content operations and length rules are not duplicated in an MCP-only format.

## Tools

| Tool | Input | Result and effect |
| --- | --- | --- |
| `get_capabilities` | `{}` | Producer role, field/operation grants, publication grant and text limits |
| `get_context` | `{}` or `{ "sessionId": "session_..." }` | `{ "session": <scope-filtered context> }`, or `session: null` without an active session |
| `validate` | Full ChangeSet with either intent | Side-effect-free before/after comparison; no revision reservation |
| `propose` | Full ChangeSet with `intent: "propose"` | Private review item and receipt; no display-content or public revision change |
| `apply` | Full ChangeSet with `intent: "apply"` | Public update only when all server permissions and publication conditions hold |
| `heartbeat` | `{}` | Connectivity signal; no content or public revision change |

Successful calls return both JSON text and `structuredContent`. Dashboard failures set `isError: true` and preserve the HTTP error's code, paths, current revision, retryability and recovery advice. SDK input-shape failures are MCP tool errors before HTTP submission. The tool name enforces the corresponding intent; no silent conversion between `apply` and `propose` occurs. Operator lifecycle, approval, locks, credentials, audit and output controls are not MCP tools.

## Suggest display content

Read capabilities, then context. Submit a ChangeSet built from the observed context revision; the [content proposal example](../examples/content-proposal.json) demonstrates current activity, a session recap, a viewer notice and a timeline event. Replace its session ID, base revision, timestamps, request ID and content with actual observations. This is synthetic example wording, not evidence of real activity.

Suggested client instruction:

> Suggest concise, factual wording that helps a viewer understand the current activity and its context. Use `set_now` for the current activity, `update_session.fields.recap` for accumulated context, `upsert_event` for a reported decision/result and `set_pin` for a viewer notice. Read granted fields and context first. Submit a proposal for operator review. Preserve uncertainty, provenance and stable event IDs. Do not execute tasks or infer completion without evidence.

`sourceRefs` contain only opaque evidence IDs. Public provenance is a declaration, not a publication permission. Unknown/restricted sources can be proposed but require the operator's explicit disclosure approval. In the **Proposals** page the operator compares current and suggested values and can open a rendered before/after preview for all three presets, reviews stale content and approves or rejects. Approval locks affected fields. Normal publication then updates the anonymous OBS pages; hold and hidden modes continue to apply.

## Recovery

The adapter makes no automatic retries and never rewrites `baseRevision`. For a conflict, read current context and reconsider the suggestion. For a lost submission response (`REQUEST_OUTCOME_UNKNOWN`), resend the exact ChangeSet with the same request ID to recover its original receipt. Do not create a new ID before resolving the uncertain outcome. A failed read returns `DASHBOARD_UNAVAILABLE`; check the local process and URL before retrying. A missing active session is explicit and creates no session automatically.

Use the existing HTTP [client guide](client-guide.md) for ownership, locks, retractions, quotas and timestamps. Default quota is two authenticated requests/second with a burst of ten. The adapter checks the producer role via capabilities on its first call; context discovery may require two HTTP reads. Space out calls or deliberately configure a higher quota for the intended host. Call `heartbeat` when the host supports a connectivity schedule; the adapter has no hidden background publishing loop.
