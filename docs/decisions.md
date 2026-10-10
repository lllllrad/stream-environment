# Implementation decisions

The supplied requirements describe the product, not instructions for the development agent. All repository documentation is written in English at the user's request. Interface labels and broadcast fixtures use Korean, with Asia/Seoul display times.

| Decision | Choice and reason |
| --- | --- |
| Runtime | Node.js 24, TypeScript, React, a single HTTP process, and SQLite. Native `node:sqlite` avoids a platform-specific database installation. |
| Database | JSON documents in SQLite for sessions/control/output, with separate indexed receipt and audit tables. Every command and its output snapshots commit in one transaction. |
| Transport | HTTP commands and complete public snapshots over SSE. Reconnect always starts from the latest snapshot. |
| Defaults | Three independent outputs: `main-full`, `main-side`, and `main-lower`. Empty initial state; demo content is explicitly opt-in. |
| Deployment | Bind to `0.0.0.0` by default for agents on other computers; `BIND_ADDRESS` can restrict interfaces. Host must match the receiving interface IP, localhost, or explicit `ALLOWED_HOSTS`; browser Origin must match Host. Authentication remains enforced, with no CORS wildcard, proxy trust, TLS listener or tunnel. |
| Authentication | Operator bearer credential exchanged for an HttpOnly cookie plus CSRF token; producer bearer tokens; separate scoped controller bearer tokens; anonymous read-only display pages, snapshots and SSE per the user's follow-up request. Only credential hashes are stored in SQLite. |
| Dependencies | Exact package versions and a pnpm lockfile; no runtime LLM calls, external fonts, or remotely loaded assets. |
| Follow-up scope | Fixed-resolution overlays and editable scene layouts supersede the original deferred arbitrary-layout scope. Links/images/QR, numeric progress, activity templates and real work execution remain deferred. |
| Overlay model | One overlay per unique resolution, one layout per overlay/scene pair, a global active application scene and ordered widget instances. OBS scenes and session status remain independent. |
| Extensions | Trusted build-time widget modules declare public blocks and settings. Away is a separately registered plugin; no runtime arbitrary-code uploads. |
| Visibility | Exact browser geometry, Unicode ranges and optional scoped screenshots are inspected privately without publication. Full-layout flow is measured before field redaction; ungranted glyphs are hidden in screenshots. |
| Validation | Automated domain, HTTP, browser, and screenshot checks are recorded separately from actual OBS review and the eight-hour soak. Unperformed checks are never claimed as passed. |
| Dense layouts | Long content activates a compact layout without reducing minimum text sizes. Full output keeps one recent event; side output omits the next activity and timeline. Recap line limits remain fixed. Omitted widgets are removed from the public DTO. |
| Auxiliary slot | Full and side outputs show one notice or work item. A pinned notice takes priority unless the operator explicitly selects a work item. This narrows the initial full preset to prevent maximum-length content from colliding. |
| History storage | Audit records retain only the affected event/work/lock entries, plus bounded session fields. Undo compares changed fields and patches them as a new revision; it never replaces the entire session. |

Reference APIs: [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [React createRoot](https://react.dev/reference/react-dom/client/createRoot), and [Ajv JSON Schema](https://ajv.js.org/json-schema.html).

## Follow-up contract changes (2026-10-10)

The user explicitly requested larger session text limits and public OBS output. Session titles now accept 120 Unicode code points and goals 300; create, update, capability discovery, schemas and UI use the same limits. Display authentication in the original specification is superseded for the read-only broadcast projection. Producer and operator authentication still applies. Existing snapshots are preserved during migration.

The optional MCP adapter from requirements section 10.2 is promoted from P1 to implemented follow-up work. It uses the official pinned SDK with stdio and forwards to authenticated HTTP, reusing the same ChangeSet schema and domain command handler. It exposes no operator tools and rejects operator credentials before reading context. The adapter suggests actual display text and never approves its own proposals or executes reported work.

## Rendered proposal review

Private operator proposal previews simulate the same domain candidate used for approval against the current session revision and pass it through the normal preset projection. They show hypothetical content even while publication is held/hidden, clearly labeled in the UI. The response records original/current revisions and the actual publication state. Previewing creates no receipt, proposal change, audit entry, lock or public revision; disclosure and stale-review approval requirements remain enforced.

## Session content export

The P1 session-record export is implemented as an authenticated operator download in JSON or Markdown. It serializes an explicit content/metadata whitelist, all non-retracted visible items and unexpired notices. Held/hidden stored edits are included and labeled as editorial content; this does not claim publication history. Original wording is preserved, while generated Markdown structure is English and stored punctuation is escaped. Private operational data is excluded rather than hidden in the file. Exports do not change revisions or publication and are separate from restorable SQLite backups.

## Source policy and direct control boundary

Producer publication follows independent trusted content-source policies, defaulting to reviewed proposals. Explicit operator overrides and producer publication grants must both allow every affected path; widget placement cannot bypass that rule. Controller credentials have a separate role and HTTP authentication branch, outside the producer/operator Actor union. They permit only exact scene destinations and eligible widget-instance visibility/plugin setting patches. They cannot restore publication, modify content sources or replace layouts. Hold/Hidden remain independent, while the producer-write gate does not stop explicitly authorized direct broadcast control. See [the API and extension guide](direct-control.md).
