# Operator and OBS guide

## Start and finish an activity

Start the server with `pnpm start` after `pnpm build`. Authenticate at `/admin` using `ADMIN_TOKEN` or the key generated in `.data/operator.key`. The key is not printed, embedded in the web bundle, or sent in a URL. Keep the `.data` directory accessible only to the local account. On Windows, enforce protection through directory ACLs; a POSIX-style file mode alone does not establish a Windows ACL.

Create a session with a short title and goal. When no activity is running, the UI creates and starts it. A session created while another is running remains prepared; end the current activity before starting it from the prepared list. Only one session can be active. Pause/resume refers to activity state, independently of the streaming platform.

Enter the current activity, recap, and optional public items. Manual edits create locks that survive restarts and last until explicit unlock or session end. Use a field's **Locked** badge to enable automatic updates again. A producer cannot remove a lock. Ending removes the current-activity display while preserving the final recap; subsequent producer changes to that session are rejected.

## Add an OBS browser source

In **Output settings**, issue a read-only URL for a preset. The key is shown once in the dialog. Copy it into a new OBS Browser Source and enter the exact viewport:

| Preset | Width | Height | Background |
| --- | ---: | ---: | --- |
| Full | 1920 | 1080 | Opaque dark canvas |
| Side | 480 | 1080 | Transparent 16px margin around an opaque panel |
| Lower | 1920 | 220 | Transparent outside the opaque activity bar |

Use a 1920 × 1080 base canvas for the initial setup. At 1280 × 720 output, scale the source together with the rest of the composition. This app does not embed your main content. Its pages need no audio, microphone, camera, or OBS-control access.

Keep the browser-source default transparent-body CSS. Do not apply a global font-size reduction. The renderer uses fixed source dimensions; entering the wrong viewport clips content rather than providing a freeform layout. Long text uses line caps/ellipses and server-selected compact information density.

Check both **Shutdown source when not visible** and **Refresh browser when scene becomes active** in your intended combination. Reload must authorize using the source URL's fragment key or an existing valid screen cookie, then fetch the latest snapshot. The page removes the fragment immediately; the key is not sent in HTTP URLs/referrers. If OBS retains the original URL, the original fragment is available on a fresh source load. A copied address from the loaded page no longer contains the key.

Source URL formats are `/display/main-full#key=...`, `/display/main-side#key=...`, and `/display/main-lower#key=...`. Generate real URLs through the operator UI; screen IDs alone are not credentials.

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

Review compares proposed values against current values. Stale proposals require an explicit current-state review acknowledgment. Unknown/restricted provenance requires a separate disclosure approval. Approval applies as an operator correction and locks affected fields. The server cannot certify the truth, ownership rights, or privacy suitability of a producer's text.

## Key rotation and reconnect

Output-key rotation invalidates the old key, all cookies for that screen, and existing SSE connections. Replace the OBS source URL with the newly issued URL and reload. Its key grants only public read access to that screen, with no operator or producer permissions. Output cookies expire after 14 days; operator cookies after 12 hours.

On a new or reconnected stream, only the latest complete safe snapshot is delivered. Public revisions are monotonic for each output across session changes. No past event stream or persisted browser-content cache is replayed. A neutral page after authentication failure is intentional; reissue/re-enter the key instead of displaying an old session.

## Backup and restore

Run `pnpm backup` for a consistent SQLite online backup and integrity check. It uses SQLite's backup API rather than copying a live DB file alone; WAL writes are included consistently. The default destination is `.data/backups/dashboard-<UTC timestamp>.db`. A custom destination can be passed as an argument, but cannot be in `dist`. Existing destinations are never overwritten. Back up the operator-key file separately in a protected location if you rely on it.

To restore:

1. Stop the running server (`Ctrl+C`) and ensure its process has exited.
2. Make a current backup if possible; preserve the existing `.data` directory in a private recovery directory.
3. In a new private data directory, copy the chosen consistent backup as `dashboard.db`. Do not copy WAL/SHM files from a different database snapshot.
4. Preserve the intended operator credential, or supply a new `ADMIN_TOKEN` of at least 24 characters. Set `DATA_DIR` to that directory and restart.
5. Confirm session, locks, hold/hidden state, latest public revision, and storage readiness. Review the next snapshot before resuming publication.
6. Rotate all output keys and revoke/reissue producer tokens whose security state may have changed since the backup. Restoring an old backup can restore older revocation/generation state.

Use `/health/live` for process liveness and `/health/ready` for SQLite readiness. Storage failures reject complete commands; they do not publish partial changes. Receipt retries recover committed requests after a lost response.

## Sensitive content cleanup and retention

**Output settings → Sensitive-content cleanup** permanently purges a complete session after explicit confirmation. It deletes session text, associated proposals and receipts, clears applicable public snapshots, redacts matching audit bodies/reasons, records the purge with identifiers only, and compacts the DB. Purging the active session hides all outputs. This broad session-level procedure deliberately avoids accidentally leaving related copies of sensitive content behind.

Separately delete or replace backups, exported screenshots, demo credential files, copied source URLs, and recordings containing sensitive content. SQLite secure deletion/compaction does not establish forensic erasure on every filesystem, SSD, snapshot, or backup. Already viewed or recorded material cannot be withdrawn from viewers by this app.

Ended sessions are retained locally until the operator purges them. Raw audio/video/transcripts are never collected. The application has no persistent access-log file: diagnostics are counters and durations in memory, and producer error state contains machine codes only. If process output is redirected externally, configure a 14-day rotation policy there. Never log credentials or full request bodies.

## Deployment boundary

P0 listens only on `127.0.0.1`. It accepts the matching localhost/127.0.0.1 Host and Origin for the bound port, with no permissive CORS. It does not enable remote binding, tunnels, or proxy trust. External cloud clients need a separately implemented and validated HTTPS access configuration with explicit host/origin controls; a basic reverse proxy forwarding an external origin will be rejected by this build. Do not advertise localhost as a cloud-accessible endpoint.

## Production checks still requiring a person

Check actual OBS source reload/scene transitions, 1080p and 720p readability, contrast over representative video, and the ten-second viewer-comprehension goal. Run `pnpm soak --seconds 28800` on the intended machine, record OBS/browser/OS versions, and inspect memory trends. Browser screenshots and a short synthetic smoke run do not complete these operational checks.
