# Implementation decisions

The supplied requirements describe the product, not instructions for the development agent. All repository documentation is written in English at the user's request. Interface labels and broadcast fixtures use Korean, with Asia/Seoul display times.

| Decision | Choice and reason |
| --- | --- |
| Runtime | Node.js 24, TypeScript, React, a single HTTP process, and SQLite. Native `node:sqlite` avoids a platform-specific database installation. |
| Database | JSON documents in SQLite for sessions/control/output, with separate indexed receipt and audit tables. Every command and its output snapshots commit in one transaction. |
| Transport | HTTP commands and complete public snapshots over SSE. Reconnect always starts from the latest snapshot. |
| Defaults | Three independent outputs: `main-full`, `main-side`, and `main-lower`. Empty initial state; demo content is explicitly opt-in. |
| Deployment | Loopback binding only in P0. Remote deployment requires a separately reviewed HTTPS reverse proxy, configured host/origin allowlists, and access controls; no tunnel is created. |
| Authentication | Operator bearer credential exchanged for an HttpOnly cookie plus CSRF token; producer bearer tokens; anonymous read-only display pages, snapshots and SSE per the user's follow-up request. Only operator/producer token hashes are stored in SQLite. |
| Dependencies | Exact package versions and a pnpm lockfile; no runtime LLM calls, external fonts, or remotely loaded assets. |
| P1 | Links/images/QR, numeric progress, arbitrary layouts, export UI, and real work execution are deferred as specified. |
| Validation | Automated domain, HTTP, browser, and screenshot checks are recorded separately from actual OBS review and the eight-hour soak. Unperformed checks are never claimed as passed. |
| Dense layouts | Long content activates a compact layout without reducing minimum text sizes. Full output keeps one recent event; side output omits the next activity and timeline. Recap line limits remain fixed. Omitted widgets are removed from the public DTO. |
| Auxiliary slot | Full and side outputs show one notice or work item. A pinned notice takes priority unless the operator explicitly selects a work item. This narrows the initial full preset to prevent maximum-length content from colliding. |
| History storage | Audit records retain only the affected event/work/lock entries, plus bounded session fields. Undo compares changed fields and patches them as a new revision; it never replaces the entire session. |

Reference APIs: [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [React createRoot](https://react.dev/reference/react-dom/client/createRoot), and [Ajv JSON Schema](https://ajv.js.org/json-schema.html).

## Follow-up contract changes (2026-10-10)

The user explicitly requested larger session text limits and public OBS output. Session titles now accept 120 Unicode code points and goals 300; create, update, capability discovery, schemas and UI use the same limits. Display authentication in the original specification is superseded for the read-only broadcast projection. Producer and operator authentication still applies. Existing snapshots are preserved during migration.
