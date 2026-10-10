# FRAME — Broadcast Activity Dashboard

A local activity dashboard for viewers who join mid-session. External clients submit short, structured display content over HTTP or local MCP; the operator decides what can be published. Three independent browser outputs receive complete public snapshots over SSE.

## Quick start

Requirements: Node.js 24.x and pnpm 11.25.0. No AI account, database service, microphone, camera, or OBS control permission is needed.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open [the control room](http://127.0.0.1:4310/admin). On first start, the server creates `.data/operator.key`. Copy its contents into the operator-key field. To supply your own credential, copy `.env.example` to `.env` and set `ADMIN_TOKEN` to a random value of at least 24 characters. Credentials, SQLite files, generated reports, and local configuration are ignored by Git.

The initial app has no example content. Create a session, enter its public content, and use **Output settings** to copy a fixed public output URL (no login or key required). The operator UI and broadcast page are separate routes and bundles.

| Output | Browser-source size | Purpose |
| --- | --- | --- |
| `main-full` | 1920 × 1080 | Explanations, breaks, and transitions; opaque background |
| `main-side` | 480 × 1080 | Alongside main content; transparent outside its panel |
| `main-lower` | 1920 × 220 | Brief activity bar; transparent outside its panel |

Interface labels and sample broadcast content are Korean; display time is Asia/Seoul. Repository documentation is English.

## Daily commands with just

The [justfile](justfile) wraps the existing pnpm scripts. Install [just](https://github.com/casey/just#installation) and make it available on `PATH`. On Windows, run `winget install --id Casey.Just --exact`, then open a new terminal. Recipes use the built-in Windows command shell; Git Bash and PowerShell 7 are not required. Node.js and pnpm are still required.

If you already use mise, [mise.toml](mise.toml) selects Node.js 24.x, pnpm 11.25.0, and just. Run `mise install` and use a mise-activated shell for the commands below.

```powershell
just                  # List commands
just install          # Install dependencies from the lockfile
just run              # Build and start the dashboard
```

| Command | Purpose |
| --- | --- |
| `just build` | Build browser bundles |
| `just start` | Start the server using an existing build |
| `just dev` | Build once and watch server changes |
| `just typecheck` / `just test` | Check types / run Node tests |
| `just e2e` | Run isolated Edge browser tests |
| `just check` | Run type checking, Node tests, and build |
| `just verify` | Run `check` and browser tests |
| `just contracts` | Regenerate English API contracts |
| `just demo --exercise` | Exercise a demo on the running server |
| `just backup` | Create a timestamped database backup |
| `just backup-to ".data/backups/manual backup.db"` | Back up to a specific new file |
| `just soak` / `just soak 28800` | Run a 30-second smoke / eight-hour soak |
| `just mcp` | Launch the MCP adapter interactively |

`test`, `e2e`, and `demo` forward optional command-line arguments, for example `just e2e --update-snapshots` or `just demo --scenario tentative`. Use `just --dry-run run` to inspect commands without running them. Checks stop at the first failure. Runtime scripts continue loading `.env` themselves. After frontend edits in `dev` mode, run `just build` and refresh the browser. For an MCP host configuration, keep the direct Node launch described in [MCP setup](docs/mcp.md) so stdout contains only protocol messages.

## What is implemented

- Session creation, start, pause, resume, and end; six kinds of broadcast information.
- Manual edits with persistent server-enforced field locks, explicit unlock, event/work correction and withdrawal, pinned notice expiry, and work selection.
- Automatic publication, hold, emergency hide, and preview-confirmed restoration; a separate producer-write gate.
- Per-producer session/operation/field grants, proposal-only clients, review comparisons and rendered proposal previews, stale/disclosure acknowledgments, credential revocation, and anonymous read-only OBS outputs.
- SQLite transactions for state, audit deltas, receipts, and per-output public snapshots; canonical idempotency, revision checks, observation ordering, atomic batches, and safe restart recovery.
- Anonymous read-only outputs, latest-state SSE reconnect, bounded content leases, plain-text rendering, request limits, and producer rate limits.
- Field-wise undo, full-session sensitive-content scrubbing, consistent backups, operator-only JSON/Markdown session exports, synthetic producers, OpenAPI/JSON Schema contracts, and automated tests.

Long content uses a compact preset while retaining readable font sizes. Auxiliary content is capped or omitted on the server, and longer lines use ellipses. One notice or work item occupies the auxiliary slot; an explicit work selection overrides the notice. See [decisions](docs/decisions.md).

## Development and verification

```powershell
pnpm dev
pnpm typecheck
pnpm test
pnpm test:e2e
```

`dev` rebuilds the browser bundles once, then watches server code. After changing frontend code, run `pnpm build` and refresh the browser. E2E tests use installed Microsoft Edge, run their own isolated server at port 4311, and do not use the normal database. Windows screenshot baselines are committed. Review a layout change before updating them:

```powershell
pnpm exec playwright test --update-snapshots
```

To generate an opt-in demonstration while the normal server is running:

```powershell
pnpm demo
pnpm demo --exercise
pnpm demo --end
```

Demo URLs and producer credentials are written to private `.data` files instead of console logs. An existing active session is never automatically replaced. The exercise ends with all outputs hidden and the current activity locked, so the operator can review recovery. See [the client guide](docs/client-guide.md).

For another fixture: `pnpm demo --scenario tentative` (also `empty`, `minimal`, `normal`, `maximum`, `optional_none`, `failed`, and `hidden`). Finish the current demo before starting another.

```powershell
pnpm backup
pnpm soak --seconds 30
# Full eight-hour run, when the machine can remain available:
pnpm soak --seconds 28800
```

The soak runs a separate local SQLite server, three output pages and one operator page, with meaningful synthetic updates at two requests/second. It writes latency, server memory/CPU, browser heap/DOM samples, and hide timing to `artifacts/soak-report.json`. A short smoke run does not establish eight-hour stability.

## Contracts and operations

- [OpenAPI](contracts/openapi.json), [ChangeSet](contracts/change-set.schema.json), [public snapshot](contracts/public-snapshot.schema.json), [receipt](contracts/change-receipt.schema.json), [error](contracts/error.schema.json), and [session export](contracts/session-export.schema.json).
- [Client guide](docs/client-guide.md) and [error recovery](docs/errors.md).
- [OBS, credentials, backups, recovery, and cleanup](docs/operations.md).
- [Implementation decisions](docs/decisions.md) and [validation record](docs/verification.md).

`node scripts/generate-contracts.mjs` regenerates the English OpenAPI and response schemas. The hand-maintained ChangeSet schema is also the server's validation source.

## Boundaries

The server binds to loopback only and rejects unconfigured Host/Origin values. Remote/cloud AI access needs a separately implemented HTTPS access configuration; registering a localhost address does not make it cloud-accessible. Media/links/QR, freeform layout editors, numeric progress, activity templates, and real work execution remain deferred. There are no runtime model calls or audio/video/transcript collection.

Actual OBS capture, the ten-second viewer-comprehension goal, and the full eight-hour soak require separate operational validation. The [validation record](docs/verification.md) distinguishes executed checks from pending ones.

## External content proposals with MCP

Register a producer in the operator UI, leave automatic publication disabled for reviewed suggestions, and grant the content fields it needs. Launch `node scripts/mcp.ts` from a local MCP host with `DASHBOARD_URL` and `DASHBOARD_PRODUCER_TOKEN`. The adapter exposes `get_capabilities`, `get_context`, `validate`, `propose`, `apply` and `heartbeat`, using the same authenticated HTTP command handler as other clients. See [MCP setup and actual content examples](docs/mcp.md).

The requirements already cover current activity, recap, events, notices and session wording proposals (sections 8–9), independently of reported work items. The optional adapter from section 10.2 is now implemented. Operator approval controls publication; public OBS pages require no login.
