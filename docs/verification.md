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
- Actual second-computer agent integration on the intended LAN/VPN. The server now binds to all interfaces by default, but operating-system firewall rules, reachable addresses and the real remote client still need verification. Internet deployment requires an appropriate HTTPS/host/origin/access configuration.

These pending checks do not affect the executed automated results; they prevent labeling the system OBS-certified, remotely deployed, or eight-hour validated.

## Public-output and text-limit follow-up

Creation and updates accept 120 title / 300 goal Unicode code points and reject overflows atomically. Migration preserves published snapshots, controls and operator credentials while removing obsolete output secrets. Anonymous output reads cannot access proposals, context or admin APIs. All 39 browser cases passed in the final complete regression run; the maximum full/full-work screenshots were regenerated and visually inspected.

## MCP content integration follow-up

Five MCP tests launch the actual stdio adapter through the official SDK client and an isolated HTTP server. They cover capability/schema discovery, scope-filtered context, multi-field content validation and proposals, explicit approval/public projection, receipt replay, publishing grants, locks, revisions, field scopes, mismatched intents, revocation, rejected operator credentials, absent sessions and transport failure. The adapter preserves HTTP errors and does not retry or alter intent/revision.

The browser suite submits actual activity/recap/notice wording through MCP, verifies it is absent from anonymous output before review, approves it through the operator UI with explicit disclosure acknowledgment, and observes those three content types over the public display stream. Setup and examples are English and contain placeholders only. No real external account/host was configured.

## Rendered proposal preview follow-up

Domain and HTTP tests verify all preset projections, stale re-evaluation, unknown/restricted disclosure preservation, no storage/publication side effects, hidden output isolation and operator-only access. The current MCP browser workflow opens before/after previews for both overlay resolutions and switches Live/Away scenes, confirms the suggested wording remains absent from the public output, and then explicitly approves it. A private review screenshot is generated at `artifacts/proposal-rendered-review.png`.

## Session-export follow-up

Three export tests verify the response schema/field whitelist, all visible events beyond the broadcast limit, private/withdrawn/expired content exclusion, original wording in JSON, literal safe Markdown, ended-session labeling, immutable reads, attachment headers, operator-only access and export failure after session purge. The browser test downloads actual JSON and Markdown files through the new session-record UI, checks held-content/ended-state semantics, filters records and confirms private/withdrawn content is absent. `artifacts/session-archive.png` records the reviewed operator layout.

## Fixed-resolution overlay follow-up

Type checking/build and all 53 Node tests pass. The full Edge regression suite passes 43 cases, including the existing 33 unchanged legacy screenshot baselines and two new 1080p/720p Away overlay baselines. After the full run, the extended MCP image workflow and updated live-editor refresh cases also passed their focused reruns. No OBS application or second-computer end-to-end test was performed.

Model tests verify a complete overlay/scene matrix, unique resolutions, cloned scenes, bounded/validated geometry and settings, atomic stale-revision rejection, restart persistence, migration during auto/hold/hidden, scene activation, urgent removals and hiding across all resolutions. Public response contracts reject hidden blocks and operator caption metadata. Scoped candidate inspection produces no session/audit/proposal/output changes.

Real browser tests exercise Unicode code-point ranges, measured ellipsis prefixes, clipping, minimum-size shrinking, frozen first-frame scroll, opaque-panel occlusion, private ungranted fields, transparent PNG generation and unavailable renderer recovery. Ungranted panels still occlude granted text while their original glyphs are absent from scoped output. HTTP tests cover private inspection, operator-only layout control and cookie CSRF. OpenAPI remains self-contained with resolvable references and unique operation IDs.

Operator browser workflows move/resize widgets, review/save/reload exact geometry, add a status widget, edit its message, clone complete scene layouts and refresh content received while the editor is open. Proposal review renders private before/after content in a selected overlay without publication. The actual stdio MCP client discovers layouts and requests a candidate visibility report plus native PNG image block before submitting and approving a separate proposal. `artifacts/overlay-editor.png` was visually inspected; generated render assets remain ignored. Browser fonts/versions and OBS scene scaling can affect pixels; report ranges conservatively count fully visible glyph rectangles, and scrolling inspection describes only the first frame.

## Operator UI cleanup

Type checking and build pass; all 44 Edge cases pass. The UI opens directly in the overlay editor, while content management contains editorial fields without the duplicate legacy preset preview. Compact navigation has an accessible overlay icon. Decorative marketing copy, placeholder identity, obsolete preset controls and local-only labels are removed; operations settings retain diagnostics and sensitive-content cleanup. Legacy output routes and screenshot baselines remain unchanged for existing OBS sources.

The browser suite verifies initial editor access, resolution/scene controls, content navigation and compact navigation. Hold/hide/restore is checked against an actual anonymous overlay page, with both resolutions reviewed before restoration. The MCP review workflow changes overlay resolution and scene, verifies unpublished candidate wording remains private, and then approves it. Operator screenshots are generated under `artifacts/`; no normal-server session content is changed by these isolated tests.

## Widget color input correction

Type checking and build pass. The color regression and existing layout editing cases pass in the final focused run; initial editor access also passed the preceding focused run. The regression types `#bf` across debounce and periodic refresh, verifies no invalid preview requests or rejected responses, completes `#bf8`, checks the rendered `#bbff88` background, edits text color with shorthand and the native picker, and saves while the shorthand field is focused. It checks canonical stored values, persistence after reload, public output color and transparent background. `artifacts/widget-colors.png` was visually inspected. API color formats and backend behavior are unchanged.

## Alpha color support

Type checking/build, 16 focused Node cases and five focused Edge cases pass. RGB/RGBA colors in 3, 4, 6 or 8 hex digits are accepted by the UI and layout API; saved values use six/eight-digit lowercase hex. OpenAPI and the public snapshot schema are regenerated. Tests cover canonical alpha persistence and publication, atomic invalid-color rejection, restart recovery, native RGB picker alpha preservation, opacity controls and public output after reload. `artifacts/widget-alpha-colors.png` was visually inspected.

Real browser inspection checks that partial/zero-alpha backgrounds preserve underlying geometric visibility, explicit `FF` alpha fully occludes it, and zero-alpha text reports no visible glyphs. Partial opacity remains a geometric visibility measurement rather than a contrast/readability guarantee. The normal server was restarted with existing data; a read-only alpha preview returned HTTP 200 and the stored layout hash remained unchanged before/after restart and inspection.

## Layout undo and redo

Type checking/build and three history unit cases pass. Five focused Edge cases cover initial editor access, existing color and save workflows, plus layout undo/redo. Multi-event drags and resizes each undo in one step; shortcuts include Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y. Tests also restore keyboard movement, grouped color/text edits, visibility, stacking order, removed/added widgets and selection. Focused text fields preserve the native browser shortcut. No-op gestures retain redo; new edits discard the redo branch; history is capped at 100 steps.

Saving updates the baseline without discarding history. Undo after save changes only the private draft, invalidates review and leaves stored geometry unchanged; redo returns to the saved state. Incoming content refreshes preserve history, while reload and resolution changes clear it. `artifacts/overlay-history.png` was visually inspected. Tests use the isolated browser server and do not change normal-server content or reload the operator's open draft.

## AI layout proposals

Type checking/build pass. The full Node run passes 65 cases; final focused schema and storage-rollback checks pass eleven cases, including the additional approval rollback case (66 distinct Node cases overall). The full Edge suite passes all 49 cases with existing output screenshot baselines unchanged. Both new layout proposal cases pass again after the final review button/settings styling changes. `artifacts/layout-proposal-review.png` was visually inspected.

Tests exercise explicit existing-producer grants, private validation/submission, canonical alpha settings, receipt replay after restart/approval, ownership, revoked/disabled grants, AI write gating, malformed geometry/plugins and rejection. Approval enforces reviewed configuration/layout/control revisions, stale replacement and restricted-disclosure acknowledgments. An injected storage failure rolls back layout, proposal status, audit and publication together. Auto, Hold, Hidden and inactive scenes retain their publication semantics without changing session content or active scene selection.

HTTP tests cover operator-only review, cookie CSRF and public output after approval. Real MCP stdio tools discover, validate, propose, recover receipts and read decision status. OpenAPI schemas validate actual requests/responses. Browser rendering inspects candidate widget geometry with scoped content, optional private PNG and no proposal/layout/audit/output side effects. Operator browser workflows review actual measured before/after output, widget additions/removal/settings, require disclosure/stale review, invalidate review after concurrent edits, approve and reject, and retain layouts after reload.

The normal server was restarted with existing data on `0.0.0.0:4310`. The updated public OpenAPI operation is available; a read-only hash of sessions, control, layouts and proposals matches before/after restart. No normal-server proposal or layout edit was submitted, and the open operator browser was not reloaded. OBS embedded-browser and second-computer end-to-end checks remain pending.

## Widget z-index

Type checking/build, all 69 Node cases and seven focused Edge cases pass. The final layering browser case also passes after capturing the inspector at its top; `artifacts/widget-z-index.png` was visually inspected. Widget layers accept integers from 0 to 10000. Omitted layers behave as zero, so existing saved layouts, held output snapshots and clients retain their previous order. Equal layers use the original back-to-front array order.

Tests cover atomic invalid-layer rejection, restart persistence, public projection, legacy omission, layer-only AI proposals, OpenAPI validation, undo/redo and reviewed saving. Actual anonymous output hit testing agrees with measured opaque occlusion when z-index overrides array order; equal layers retain tie ordering. Ungranted panels still occlude permitted glyphs without exposing their text. Editor selection handles remain accessible above high-layer preview panels. Forward/Backward swaps adjacent effective layers and order, and proposal review shows both layer values and effective stacking.

The normal server was restarted at `0.0.0.0:4310`; OpenAPI advertises the layer field and a read-only candidate preview accepts it. Stored sessions, control, layouts and proposals retain their pre-restart hash. The open operator browser was not reloaded. OBS embedded-browser rendering was not tested.

## Source publication policy and scoped direct control

Type checking/build, all 77 Node cases and all 51 Edge cases pass. The source-policy/control browser case passes again after final permission labels and controller audit-name display updates. The complete source-policy and control-token panels were visually inspected in `artifacts/source-publication-policies.png` and `artifacts/direct-control-token.png`; one-time token secrets are excluded from screenshots.

Tests cover all built-in sources defaulting to reviewed proposals, explicit persistent operator overrides, independent widget visibility, restrictive overlapping trusted source definitions, producer grants, mixed-batch atomic rejection, HTTP/MCP validation and render-candidate enforcement. Proposals and operator approval remain available without opening automatic publication.

Controller tests enforce token-role isolation, exact scene/widget-instance scopes, current plugin eligibility, declared setting keys, geometry/source-write exclusion, validation, revisions, canonical receipt replay/conflicts, revocation, restart persistence and secret-free listings. Injected receipt failure rolls back configuration, audit, last-use time and publication. Auto, Hold, Hidden and inactive-scene behavior preserve publication controls, including when no session exists or producer AI writes are disabled. HTTP tests include operator cookie CSRF; OpenAPI schemas validate live source metadata, credential issuance/listing, context, commands, receipts and synthetic examples. The operator browser issues/revokes a scoped token and confirms scene/status updates on anonymous output while an unrelated content proposal stays pending.

The demo command was exercised on a separate database/server: seed content is proposed and approved with the operator credential while default source policies remain unchanged; automatic exercise is rejected until explicit source opt-in, then replay/locks/hold/withdrawal/hide and ending pass. The isolated two-second soak performs four updates, with approximately 92 ms publication p95/p99 and 16 ms emergency hide. Its stale login labels were updated to the current UI. This short smoke does not establish eight-hour stability.

The normal server was restarted with existing data at `0.0.0.0:4310`. Read-only requests confirm all six effective policies are `proposal_only`, Away exposes the expected direct-setting metadata, the new public OpenAPI operations exist, and controller context rejects missing authentication. The stored sessions, control, layouts, proposals, source overrides, controllers, control receipts and output snapshots retain their pre-restart hash. No normal-server policies, credentials, content or layouts were changed, and the user's open operator browser was not reloaded. OBS embedded-browser and actual second-computer integration remain operational checks.

## Local Swagger UI

Frozen-lockfile installation, type checking and build pass with pinned `swagger-ui-dist` 5.33.1 and its optional Scarf build hook disabled. All 78 Node cases pass. Nine focused OpenAPI/Swagger cases pass again after the final missing-asset error check. Three focused Edge cases pass for Swagger, operator entry and anonymous output. `artifacts/swagger-ui.png` was visually inspected with authorization cleared and no secrets shown.

Swagger loads the local OpenAPI 3.1 contract, accepts separate producer and controller bearer schemes, executes an actual private content proposal and reads scoped direct control context. Browser checks confirm an existing operator cookie cannot silently authorize explorer requests, tokens disappear on reload, external specification query overrides are ignored, and no external requests occur. Page/initializer aliases are public read-only assets with existing Host/Origin/CSP checks; missing build assets return structured service errors. Canonical OpenAPI cookie authentication remains unchanged for ordinary operator clients.

The normal server was restarted at `0.0.0.0:4310`. Both `/swagger` and `/docs`, local JavaScript/CSS, the upstream license and `/openapi.json` return HTTP 200; protected capabilities still require authentication. Stored sessions, control, layouts, proposals, source overrides, controllers, control receipts and output snapshots retain their pre-restart hash. No real content, layout, credential or policy mutations were submitted, and the existing operator browser was not reloaded.

## Token-free content and layout proposals

Type checking/build, all 84 Node cases and all 53 Edge cases pass. Dedicated public proposal routes expose minimal target metadata, validation and reviewed submission without registration, cookies or bearer credentials. The OpenAPI contract marks all five operations as anonymous. The token-free MCP adapter exposes exactly five proposal/discovery tools; authenticated producer tools retain their existing grants.

Tests cover private content/caption exclusion, preservation of omitted existing widget settings, proposal-only enforcement even for automatically publishable sources, pending-output isolation, revision conflicts, canonical receipt replay across restart/decision, conflicting replay, AI-write gating and pending-queue limits. Injected receipt failures roll back proposal, audit and receipt changes atomically. Private context, approval and immediate control continue to require their existing authentication.

The actual Swagger browser flow submits both content and layout proposals without using Authorize. Captured public request headers contain neither Authorization nor cookies. The anonymous broadcast output remains unchanged until the operator reviews and approves each proposal; afterward, the content and widget geometry appear in the output. Layout review retains the omitted private caption and requires the normal acknowledgments. `artifacts/anonymous-proposal-review.png` was visually inspected. These mutations use an isolated test database.

The normal server was restarted with the latest existing data at `0.0.0.0:4310`. Read-only checks confirm public context and Swagger return HTTP 200, the five public OpenAPI operations require no credentials, saved caption fields are omitted from public metadata, and protected capabilities, controller context and admin state return HTTP 401 without authentication. Stored sessions, control, layouts, proposals, source overrides, controllers, control receipts and output snapshots retain their immediate pre-restart hash. No normal-server mutations were submitted, and the operator's open browser was not reloaded. Actual second-computer and OBS embedded-browser checks remain operational checks.
