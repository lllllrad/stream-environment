# Operator and OBS guide

## Start and finish an activity

Start the server with `pnpm start` after `pnpm build`. Authenticate at `/admin` using `ADMIN_TOKEN` or the key generated in `.data/operator.key`. The key is not printed, embedded in the web bundle, or sent in a URL. Keep the `.data` directory accessible only to the local account. On Windows, enforce protection through directory ACLs; a POSIX-style file mode alone does not establish a Windows ACL.

Create a session with a title of up to 120 Unicode code points and a goal of up to 300. Long stored content is capped to the available broadcast lines; use the preview to check the visible wording. When no activity is running, the UI creates and starts it. A session created while another is running remains prepared; end the current activity before starting it from the prepared list. Only one session can be active. Pause/resume refers to activity state, independently of the streaming platform.

Enter the current activity, recap, and optional public items. Manual edits create locks that survive restarts and last until explicit unlock or session end. Use a field's **Locked** badge to enable automatic updates again. A producer cannot remove a lock. Ending removes the current-activity display while preserving the final recap; subsequent producer changes to that session are rejected.

## Add an OBS browser source

In **Output settings**, copy the fixed public URL for a preset into a new OBS Browser Source and enter the exact viewport. No login, output key, or output cookie is required:

| Preset | Width | Height | Background |
| --- | ---: | ---: | --- |
| Full | 1920 | 1080 | Opaque dark canvas |
| Side | 480 | 1080 | Transparent 16px margin around an opaque panel |
| Lower | 1920 | 220 | Transparent outside the opaque activity bar |

Use a 1920 × 1080 base canvas for the initial setup. At 1280 × 720 output, scale the source together with the rest of the composition. This app does not embed your main content. Its pages need no audio, microphone, camera, or OBS-control access.

Keep the browser-source default transparent-body CSS. Do not apply a global font-size reduction. The renderer uses fixed source dimensions; entering the wrong viewport clips content rather than providing a freeform layout. Long text uses line caps/ellipses and server-selected compact information density.

Check both **Shutdown source when not visible** and **Refresh browser when scene becomes active** in your intended combination. Every reload fetches the latest public snapshot without authentication.

Use `http://127.0.0.1:4310/display/main-full`, `http://127.0.0.1:4310/display/main-side`, or `http://127.0.0.1:4310/display/main-lower` (replace the port when configured). Legacy URLs containing `#key=...` still open; the fragment is discarded without exchanging credentials. Snapshot and SSE endpoints are also public, and contain only the projected broadcast content. Operator controls, session context, producers, proposals and audit records remain authenticated.

## Publication controls

| Control | Input/storage | What viewers see |
| --- | --- | --- |
| Auto | Valid allowed public changes are applied | Latest public content |
| Hold | Valid changes keep being stored | Last published content, with urgent withdrawals/expiry applied |
| Hidden | Valid changes may keep being stored | No content on any output |
| Stop AI writes | Producer mutations are rejected; human edits still work | Publication follows the independent mode above |

Emergency hide requires one click and no confirmation. Resuming from hold/hidden requires reviewing the next snapshot and explicitly confirming publication. It publishes one latest state, not a replay of changes received while held.

An event or work withdrawal is retained as a tombstone and immediately removed from frozen outputs, even during hold. Clearing a notice removes it from held output; expiry also takes precedence over hold. A producer cannot re-register a withdrawn item. The operator can explicitly correct/restore it, retaining its stable ID.

If a disconnected OBS source continues to show unsafe text, turn off the source's eye icon in OBS immediately. The server cannot deliver an emergency command across a broken connection. The page stops displaying content when its content lease expires, normally within 30 seconds of its last valid matching snapshot/heartbeat. A heartbeat announcing a newer version cannot keep old content alive.

## Producers and review

Register each client with the narrowest session, operation, and field grants it needs. Automatic publication is opt-in in the registration UI; an authorized publishing producer must also submit `disclosure: public`. Otherwise use `intent: propose`. Private/unknown provenance never silently falls back from a rejected apply to a proposal.

Tokens are displayed once; store them in the client's secret store. Revoke a token from **Producers** to immediately block reads, writes, and receipt replays. The server stores hashes, not plaintext tokens. A heartbeat reports connectivity, while `observedAt` describes content freshness. Idle content does not imply a disconnected client. Send heartbeats every five seconds when connected.

Review compares proposed values against current values. Open **Broadcast layout preview** to compare the current editorial content and the proposed result through the full, side or lower renderer. It is a private hypothetical preview, including while outputs are held/hidden; opening it never publishes or approves the proposal. Stale proposals are simulated against the latest session revision without altering their original base revision. Stale proposals require an explicit current-state review acknowledgment. Unknown/restricted provenance requires a separate disclosure approval. Approval applies as an operator correction and locks affected fields. The server cannot certify the truth, ownership rights, or privacy suitability of a producer's text.

## Public output and reconnect

Output URLs are stable and do not expire. Operator cookies expire after 12 hours. Revoking a producer token blocks that producer; hiding the output uses the separate publication controls.

On a new or reconnected stream, only the latest complete public snapshot is delivered. Public revisions are monotonic for each output across session changes. No past event stream or persisted browser-content cache is replayed. Emergency hide continues to clear connected outputs and remains hidden after reload. A disconnected page clears itself after its lease expires.

Upgrading removes obsolete output key hashes and display authentication records from the current SQLite documents while preserving sessions, locks, publication modes and snapshots. Operator credentials remain valid. Historic backups retain their original data until separately replaced or removed.

## Backup and restore

Run `pnpm backup` for a consistent SQLite online backup and integrity check. It uses SQLite's backup API rather than copying a live DB file alone; WAL writes are included consistently. The default destination is `.data/backups/dashboard-<UTC timestamp>.db`. A custom destination can be passed as an argument, but cannot be in `dist`. Existing destinations are never overwritten. Back up the operator-key file separately in a protected location if you rely on it.

To restore:

1. Stop the running server (`Ctrl+C`) and ensure its process has exited.
2. Make a current backup if possible; preserve the existing `.data` directory in a private recovery directory.
3. In a new private data directory, copy the chosen consistent backup as `dashboard.db`. Do not copy WAL/SHM files from a different database snapshot.
4. Preserve the intended operator credential, or supply a new `ADMIN_TOKEN` of at least 24 characters. Set `DATA_DIR` to that directory and restart.
5. Confirm session, locks, hold/hidden state, latest public revision, and storage readiness. Review the next snapshot before resuming publication.
6. Revoke/reissue producer tokens whose security state may have changed since the backup. Restoring an old backup can restore older producer revocation state. Outputs remain public; obsolete output credentials are removed at startup.

Use `/health/live` for process liveness and `/health/ready` for SQLite readiness. Storage failures reject complete commands; they do not publish partial changes. Receipt retries recover committed requests after a lost response.

## Sensitive content cleanup and retention

**Output settings → Sensitive-content cleanup** permanently purges a complete session after explicit confirmation. It deletes session text, associated proposals and receipts, clears applicable public snapshots, redacts matching audit bodies/reasons, records the purge with identifiers only, and compacts the DB. Purging the active session hides all outputs. This broad session-level procedure deliberately avoids accidentally leaving related copies of sensitive content behind.

Separately delete or replace backups, exported screenshots, demo credential files, copied source URLs, and recordings containing sensitive content. SQLite secure deletion/compaction does not establish forensic erasure on every filesystem, SSD, snapshot, or backup. Already viewed or recorded material cannot be withdrawn from viewers by this app.

Ended sessions are retained locally until the operator purges them. Raw audio/video/transcripts are never collected. The application has no persistent access-log file: diagnostics are counters and durations in memory, and producer error state contains machine codes only. If process output is redirected externally, configure a 14-day rotation policy there. Never log credentials or full request bodies.

## Deployment boundary

P0 listens only on `127.0.0.1`. It accepts the matching localhost/127.0.0.1 Host and Origin for the bound port, with no permissive CORS. It does not enable remote binding, tunnels, or proxy trust. External cloud clients need a separately implemented and validated HTTPS access configuration with explicit host/origin controls; a basic reverse proxy forwarding an external origin will be rejected by this build. Do not advertise localhost as a cloud-accessible endpoint.

## Production checks still requiring a person

Check actual OBS source reload/scene transitions, 1080p and 720p readability, contrast over representative video, and the ten-second viewer-comprehension goal. Run `pnpm soak --seconds 28800` on the intended machine, record OBS/browser/OS versions, and inspect memory trends. Browser screenshots and a short synthetic smoke run do not complete these operational checks.

## Export session records

Open **Session records**, filter by lifecycle state if needed, and download JSON or Markdown for the intended session. Exports are operator-only downloads, including active, prepared, paused and ended sessions. No public archive route or producer/MCP export permission is added. Filenames contain the session ID and captured revision, not user-provided titles.

An export captures the current editorial content at the returned revision, including stored edits received while publication was held/hidden. It is not a history of exactly what viewers saw and is not a restorable database backup. The record contains session metadata, recap, last recorded activity, all non-retracted timeline events and reported work, and an unexpired viewer notice. An ended session's last activity is explicitly historical.

Proposals, provenance/source references, producer/owner identities, credentials, lock reasons, receipts, audit records, retracted items and expired notices are excluded. The [JSON export schema](../contracts/session-export.schema.json) declares the exact fields. Markdown uses English headings and preserves content in its original language as escaped literal text, preventing stored HTML, link syntax or Markdown delimiters from becoming active content. No translation/model call is performed.

Downloads are written by the browser outside the live database. Purging a session prevents new exports but does not delete already downloaded files. Include exports in your manual sensitive-content cleanup and retention procedure.
