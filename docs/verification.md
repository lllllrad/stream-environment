# Verification record

Recorded on 2026-10-10 (Asia/Seoul). This distinguishes application checks from operational acceptance. No actual OBS capture or eight-hour stability claim is made.

## Environment

- Windows host; Node.js v24.19.0; SQLite 3.53.3 from native `node:sqlite`.
- React 19.2.0; Ajv 8.17.1; TypeScript 5.9.3; esbuild 0.25.12; Playwright 1.56.1.
- Installed Microsoft Edge 154.0.4258.62, running headlessly for browser tests.
- Loopback HTTP, one SQLite database per test/soak instance, no external AI account or LLM calls.
- Actual OBS execution/capture: not performed. An OBS installation is present, but no scene/source configuration was changed.

## Executed checks

| Check | Result |
| --- | --- |
| Dependency installation and locked build | Passed; exact dependency versions recorded in pnpm-lock.yaml |
| TypeScript | Passed, `pnpm typecheck` / equivalent direct TypeScript invocation |
| Domain, contract, HTTP, lease, backup, MCP, export, OpenAPI and startup tests | 46 tests passed |
| Browser workflows and visual regression | 40 tests passed; seven interaction/accessibility cases (including external MCP review) and 33 screenshot comparisons |
| Source-resolution screenshots | Three presets × ten fixtures: empty, minimal, normal, maximum, maximum work, crowded medium lengths, no optional widgets, tentative event, reported work failure, hidden |
| 720p visual composition | Three scaled preset screenshots captured and inspected in a browser, separately from OBS |
| Maximum-text geometry | Fixture text/section boxes stay inside their preset viewport; no auto font shrinking or output scrolling |
| Manual image inspection | Operator control room, full/side normal and maximum content, maximum work, and full 720p composition inspected |
| Keyboard/reduced motion | Enter opens the session dialog, Escape closes it, focus returns to the triggering button; reduced-motion settings exercised |
| Contrast | Broadcast ink/muted/accent colors exceed 4.5:1 against the configured background; this is not a WCAG certification |
| Account-free demo | Creation, public update, receipt replay, conflicting ID rejection, server lock rejection, proposal outcome, hold, withdrawal, emergency hide, explicit end passed on isolated port 4312 |
| Online backup | SQLite backup and integrity check passed while the isolated server was running; automated restore verifies hidden state, locks, snapshots and receipt replay |
| Network access | Default `0.0.0.0` startup, explicit loopback override, interface/DNS Host handling, matching Origin, CSRF, authenticated network publishing and network-address MCP proposals passed. The restarted server responded through LAN and Tailscale interface addresses from this host; protected APIs returned 401 without a token. A second computer's firewall/routing path was not tested. |
| OpenAPI agent integration | All references resolve inside one document; operation IDs are unique and request examples validate. Public discovery is read-only and contains no private state. A network-address client discovered operations from the served spec, read scoped context, validated and submitted actual display wording as a private proposal, replayed its receipt and reported a heartbeat. The running endpoint returned 200 through localhost, LAN and Tailscale addresses from this host, each with the matching server URL. |
| Documentation language | All Markdown documentation scanned; no Korean prose in repository documents |

Native preset screenshots are committed in `tests/e2e/dashboard.spec.ts-snapshots`. Generated HTML/JS/CSS, runtime databases, reports and operator screenshots are ignored. No credentials or real activity records are included in Git.

## Acceptance coverage

| Requirements | Evidence |
| --- | --- |
| AC-01 | Manual browser create/end plus account-free synthetic HTTP producer |
| AC-02–06 | Atomic rejection, receipt replay/canonical hashes, conflicting IDs, revisions, persistent operator locks |
| AC-07–08 | Session-switch isolation, monotonic output versions, observation ordering and future-clock checks |
| AC-09–11 | Private proposal/validation isolation, public response schema restrictions, stale/disclosure review checks |
| AC-12–14 | Hold versus next preview, urgent event/work withdrawal and notice expiry/clearing, persisted hidden/restart state |
| AC-15–17 | Latest-state SSE, offline lease and recovery, anonymous public snapshots/SSE, hidden reload, protected operator/producer APIs (output authentication superseded by the user request) |
| AC-18–20 | Unicode code-point/NFC/control tests, maximum mixed text fixtures, plain-text code-like input, producer ownership and field grants |
| AC-21–22 | Injected DB rollback, restart/backup recovery, exact-content no-change behavior |
| AC-23–24 | Public-only failure widget, scoped DTOs, explicit held/proposed outcomes in demo/client examples |

## Short synthetic soak

Final smoke measurement: 2026-10-09T19:04:15Z (2026-10-10 04:04:15 in Asia/Seoul). Duration 30 seconds; 59 logical updates at a target of two requests/second, with three browser output pages and one operator page. Updates use stable event IDs, matching meaningful bounded UI state rather than appending an unbounded list.

| Measurement | Observed value |
| --- | ---: |
| Update → all three browser headings, p95 | 28.6 ms |
| Update → all three browser headings, p99 | 83.2 ms |
| Hide command → all three outputs absent | 9.2 ms |
| Full/side/lower DOM count at samples | 40 / 36 / 26, constant |
| Operator DOM count | 203 initially, then 224 as its capped recent audit list fills |
| Server RSS samples | 128.7 / 106.9 / 108.8 MB (decimal) |
| Per-output browser JS heap samples | Approximately 3.2–3.6 MB; sampled values, not full process memory |

Measurements include loopback request handling, browser delivery and DOM observation on this host. They do not establish OBS rendering delay, every machine's performance, or long-term memory stability. The raw report is generated at `artifacts/soak-report.json`, which is not a committed promise of repeatable performance.

## Pending operational checks

- Full 28,800-second run on the intended machine: `pnpm soak --seconds 28800`. Inspect server and browser memory trends, CPU, DOM counts, p95/p99 and any failure; record the machine/OS/OBS environment.
- Actual OBS Browser Source captures of each preset at 1080p and 720p, including representative moving video behind transparent sources.
- The intended OBS source-shutdown/scene-refresh combinations, sleep/resume and multi-scene reload behavior in OBS's embedded browser.
- A ten-second viewer comprehension exercise using real public activity wording, plus Korean/English readability at the final source placement.
- Remote/cloud client integration. The local build intentionally does not expose a remote endpoint; an HTTPS/host/origin/access configuration must be implemented and tested before that deployment.

These pending checks do not affect the executed automated results; they prevent labeling the system OBS-certified, remotely deployed, or eight-hour validated.

## Public-output and text-limit follow-up

Creation and updates accept 120 title / 300 goal Unicode code points and reject overflows atomically. Migration preserves published snapshots, controls and operator credentials while removing obsolete output secrets. Anonymous output reads cannot access proposals, context or admin APIs. All 39 browser cases passed in the final complete regression run; the maximum full/full-work screenshots were regenerated and visually inspected.

## MCP content integration follow-up

Five MCP tests launch the actual stdio adapter through the official SDK client and an isolated HTTP server. They cover capability/schema discovery, scope-filtered context, multi-field content validation and proposals, explicit approval/public projection, receipt replay, publishing grants, locks, revisions, field scopes, mismatched intents, revocation, rejected operator credentials, absent sessions and transport failure. The adapter preserves HTTP errors and does not retry or alter intent/revision.

The browser suite submits actual activity/recap/notice wording through MCP, verifies it is absent from anonymous output before review, approves it through the operator UI with explicit disclosure acknowledgment, and observes those three content types over the public display stream. Setup and examples are English and contain placeholders only. No real external account/host was configured.

## Rendered proposal preview follow-up

Domain and HTTP tests verify all preset projections, stale re-evaluation, unknown/restricted disclosure preservation, no storage/publication side effects, hidden output isolation and operator-only access. The MCP browser workflow opens before/after previews for full, side and lower presets, confirms the suggested wording remains absent from the public output, and then explicitly approves it. A private review screenshot is generated at `artifacts/proposal-rendered-review.png`.

## Session-export follow-up

Three export tests verify the response schema/field whitelist, all visible events beyond the broadcast limit, private/withdrawn/expired content exclusion, original wording in JSON, literal safe Markdown, ended-session labeling, immutable reads, attachment headers, operator-only access and export failure after session purge. The browser test downloads actual JSON and Markdown files through the new session-record UI, checks held-content/ended-state semantics, filters records and confirms private/withdrawn content is absent. `artifacts/session-archive.png` records the reviewed operator layout.
