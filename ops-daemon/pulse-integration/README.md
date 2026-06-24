# Pulse Bot intake addition (§9)

One **minimal, isolated** addition to the existing Pulse Bot repo
(`github.com/Dreamusichef/aodhq-dojo-dashboard`, deployed at `/opt/dojo-pulse/`). It hands
discussion-channel messages to the Ops Daemon via `ops.db` — keeping **Pulse the only
process that touches Discord**. The daemon reads the handoff; it never connects to Discord.

This is **not** part of the daemon process. It lives in the Pulse repo and runs inside
Pulse's existing nightly window.

## What it does

Using Pulse's **existing** `lib/discord-fetch` (raw REST, 429-aware), fetch new messages
from the discussion channels — **#lounge, #qwei, #tech, #starting-bpms** (NOT
#practice-videos, which is clips) — since a stored per-channel cursor, and INSERT them into
`/opt/ops-daemon/ops.db` (`discord_intake`) via `better-sqlite3` in WAL mode.

It is fully isolated: **own module file, own flag (`OPS_INTAKE_ENABLED`), own error
handling.** If it throws, the caller swallows it — Pulse's clip/rank/streak crons are
unaffected. **No second Discord connection** is introduced (it reuses Pulse's via the
injected fetcher). Raw author handles are fine in `ops.db` (VPS-local, gitignored); they
never leave the VPS — the daemon hashes the author before anything reaches the cockpit.

## Install

1. Copy `ops-intake.js` into the Pulse repo, e.g. `/opt/dojo-pulse/lib/ops-intake.js`.
2. Ensure Pulse depends on `better-sqlite3` (`npm i better-sqlite3` if not already).
3. In Pulse's `.env`, set:
   ```
   OPS_INTAKE_ENABLED=true
   OPS_DB_PATH=/opt/ops-daemon/ops.db
   OPS_INTAKE_CHANNELS=<lounge_id>:lounge,<qwei_id>:qwei,<tech_id>:tech,<startingbpms_id>:starting-bpms
   ```
   (Get channel IDs from Discord with Developer Mode on → right-click channel → Copy ID.)

4. Call it **once** inside the existing nightly intake job, wrapped so it can't affect the
   rest of Pulse. Wire `fetchChannelMessages` to whatever `lib/discord-fetch` exports:

   ```js
   const { runOpsIntake } = require('./lib/ops-intake');
   const discordFetch = require('./lib/discord-fetch'); // Pulse's existing module

   // Adapter: return messages NEWER than afterId for a channel.
   // Map this to discord-fetch's real signature — it already does GET
   // /channels/{id}/messages?after=… with 429 handling. Example shape:
   async function fetchChannelMessages(channelId, afterId) {
     const raw = await discordFetch.fetchMessagesAfter(channelId, afterId); // adjust to real export
     return raw.map((m) => ({
       id: m.id,
       author: m.author?.username ?? m.author?.global_name ?? 'unknown',
       content: m.content ?? '',
       ts: m.timestamp ?? null,
     }));
   }

   try {
     await runOpsIntake({ fetchChannelMessages });
   } catch (err) {
     console.error('[ops-intake] failed (isolated):', err.message); // never rethrow into Pulse
   }
   ```

   The exact `discord-fetch` method name/shape is whatever Pulse already uses — only the
   adapter above needs editing. `runOpsIntake` handles cursors, dedup against the cursor,
   WAL inserts, and per-channel error isolation internally.

## Verify

After a nightly run:
```sh
sqlite3 /opt/ops-daemon/ops.db \
  "SELECT channel, count(*) FROM discord_intake WHERE processed=0 GROUP BY channel;"
```
You should see counts for the four discussion channels. Pulse's existing crons must still
pass `npm test`.

## Cursors

Per-channel cursors are stored in the same `ops.db` `watermarks` table under
`pulse_intake:<channelId>`, so the intake is self-contained and survives restarts. The
daemon and this intake share `ops.db` safely (both open it in WAL mode).
