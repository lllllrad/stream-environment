# Implementation decisions

The supplied requirements describe the product, not instructions for the development agent. All repository documentation is written in English at the user's request. Interface labels and broadcast fixtures use Korean, with Asia/Seoul display times.

| Decision | Choice and reason |
| --- | --- |
| Runtime | Node.js 24, TypeScript, React, a single HTTP process, and SQLite. Native `node:sqlite` avoids a platform-specific database installation. |
| Database | JSON documents in SQLite for sessions/control/output, with separate indexed receipt and audit tables. Every command and its output snapshots commit in one transaction. |
| Transport | HTTP commands and complete public snapshots over SSE. Reconnect always starts from the latest snapshot. |
| Defaults | Three independent outputs: `main-full`, `main-side`, and `main-lower`. Empty initial state; demo content is explicitly opt-in. |
| Deployment | Loopback binding only in P0. Remote deployment requires a separately reviewed HTTPS reverse proxy, configured host/origin allowlists, and access controls; no tunnel is created. |
| Authentication | Operator bearer credential exchanged for an HttpOnly cookie plus CSRF token; producer bearer tokens; output fragment keys exchanged for screen-scoped cookies. Only token hashes are stored in SQLite. |
| Dependencies | Exact package versions and a pnpm lockfile; no runtime LLM calls, external fonts, or remotely loaded assets. |
| P1 | MCP, links/images/QR, numeric progress, arbitrary layouts, export UI, and real work execution are deferred as specified. |
| Validation | Automated domain, HTTP, browser, and screenshot checks are recorded separately from actual OBS review and the eight-hour soak. Unperformed checks are never claimed as passed. |

Reference APIs: [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [React createRoot](https://react.dev/reference/react-dom/client/createRoot), and [Ajv JSON Schema](https://ajv.js.org/json-schema.html).
