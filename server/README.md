# ECHO server

Backend for the ECHO game. The server provides the HTTP API, PostgreSQL persistence, Socket.IO real-time state, food collection, PvP fights, daily activity tracking, and server-side world bounds.

The ECHO backend is isolated from the Cat Fighting application and must use its own PostgreSQL database/account.

## Stack

- Node.js 20+ (22 LTS recommended)
- Express 5
- Socket.IO 4
- PostgreSQL (`pg`)
- `dotenv` for environment configuration

## Local setup

From `server/`:

```bash
npm install
cp .env.example .env
npm start
```

For development with Node's file watcher:

```bash
npm run dev
```

The HTTP server listens on `PORT` (default `3001`) and binds to `0.0.0.0`.

Health check:

```text
GET /health
```

A healthy response contains `ok: true` and `database: "connected"`. If PostgreSQL is unavailable, the endpoint returns HTTP 503.

## Configuration

See `.env.example` for the complete template.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | — | Runtime environment. |
| `PORT` | `3001` | HTTP/Socket.IO listening port. |
| `CORS_ORIGIN` | `*` | Allowed browser origin(s), comma-separated when multiple. |
| `DATABASE_URL` | — | Optional PostgreSQL connection string. |
| `DB_HOST` | `127.0.0.1` | PostgreSQL host when `DATABASE_URL` is not used. |
| `DB_PORT` | `5432` | PostgreSQL port. |
| `DB_NAME` | `echo_game_db` | ECHO database name. |
| `DB_USER` | `echo_user` | ECHO database user. |
| `DB_PASSWORD` | — | PostgreSQL password. |
| `DB_SSL` | `false` | Enables PostgreSQL SSL when set to `true`. |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL pool size. |
| `DAILY_TIME_ZONE` | `Europe/Moscow` | Time zone used to determine the daily activity date. |

`DATABASE_URL` takes precedence over the individual `DB_*` connection settings.

Never commit the real `.env` file or production database credentials.

## HTTP API

### `GET /health`

Checks that the Node.js process is alive and PostgreSQL is reachable.

### `GET /api/daily-activity?profileId=<id>`

Returns the current day's activity for a client profile:

```json
{
  "date": "2026-10-15",
  "timezone": "Europe/Moscow",
  "playSeconds": 380,
  "foodCollected": 4,
  "pvpWins": 1,
  "profileId": "..."
}
```

`profileId` must be a 16–80 character identifier containing only letters, numbers, `_` or `-`.

The profile ID is used for activity statistics; it is not an authentication mechanism.

## Socket.IO protocol

The game state is server-authoritative at the session level. Each connected socket gets one player object. Player snapshots are broadcast with `echo:players`.

### Client → server

- `echo:hello` — sends the client's profile ID and/or selected character skin and requests the current player/food state.
- `echo:move` — sends player position, velocity and optionally skin. Coordinates are clamped to the playable world on the server.
- `echo:dailyPing` — reports whether the player is actively playing and associates the socket with a daily-activity profile.

### Server → client

- `echo:players` — current players and their state.
- `echo:food` — currently active food points.
- `echo:fight` — starts a PvP fight and identifies both participants.
- `echo:combatResult` — reports the winner/loser and resulting energy.
- `echo:dailyActivity` — acknowledges the current daily-activity date and active/paused state.

## Gameplay rules implemented by the server

### World

The playable world is **100 × 100 cells**. One cell is `84` world units, so the server limits player coordinates to:

```text
x: -4200 … +4200
y: -4200 … +4200
```

Client-side limits exist for responsive movement, but the server clamps every incoming `echo:move` position as the final safety boundary.

### Food

- 34 food points exist on the map.
- Collection radius: 60 world units.
- Each collected point adds 1 energy, up to `MAX_ENERGY`.
- Collected food respawns after a random 10–25 seconds.
- Food collection increments the daily `food_collected` counter for the associated profile.

### PvP

- A fight starts when two eligible players are within 72 world units.
- Players with equal energy do not start a fight.
- Players cannot participate in multiple fights simultaneously.
- A fight lasts 1000 ms.
- The player with more energy wins.
- The winner receives the loser's energy, capped at `MAX_ENERGY`.
- The loser is removed from the active player list.
- A PvP win increments the daily `pvp_wins` counter.

### Character skins

The server accepts only the known ECHO character `.glb` filenames. An unknown skin falls back to `character-female-a.glb`.

## Daily activity

Daily activity is stored in PostgreSQL in the automatically created table:

```text
echo_daily_activity
```

Columns:

- `profile_id`
- `activity_date`
- `play_seconds`
- `food_collected`
- `pvp_wins`
- `updated_at`

The table and the row for the current day are created automatically when the server starts/receives activity. No separate migration is currently required.

Play time is accumulated from Socket.IO activity pings and is bounded to prevent a single connection from adding an unreasonable amount of time. The daily date is calculated using `DAILY_TIME_ZONE`.

Only one active Socket.IO session is allowed for a given activity profile ID. A newer session replaces the previous session.

## Database isolation

Use a dedicated PostgreSQL database and account for ECHO, for example:

```text
database: echo_game_db
user:     echo_user
```

Do **not** point ECHO's `DATABASE_URL` at Cat Fighting's production database.

## Deployment

The backend can run as a standalone Node.js process or under PM2. In the production setup, the public ECHO site is served under `/echo/` and the reverse proxy forwards the ECHO API/Socket.IO traffic to this Node.js process.

Keep the ECHO process, PostgreSQL database, credentials, and reverse-proxy configuration separate from Cat Fighting. Verify that the configured `PORT` is available before starting the process.

After deployment, verify:

```bash
curl -i http://127.0.0.1:<PORT>/health
```

and, through the public reverse proxy, verify the ECHO `/api/daily-activity` endpoint and Socket.IO connection.

## Shutdown

The server handles `SIGTERM` and `SIGINT`, closes Socket.IO/HTTP connections, then closes the PostgreSQL pool. A 10-second safety timeout terminates the process if shutdown does not complete.

## Experimental ECHO voice (disabled by default)

The game issues one-minute LiveKit join tokens over the **already authenticated
Socket.IO session**. The server decides room membership and binds tokens to the
current ECHO 15-minute round and room, using the real Socket.IO ID as the LiveKit
identity. Guests are supported without trusting client-provided player names.

To enable, set `ECHO_LIVEKIT_URL=wss://voice.cat-fight.ru`,
`ECHO_LIVEKIT_API_URL=http://127.0.0.1:7880`, and the matching
`ECHO_LIVEKIT_API_KEY` / `ECHO_LIVEKIT_API_SECRET` (at least 32 characters) in
the **server's private environment**. Do not use testing keys or expose the
API secret. Leave them unset until the voice service and HTTPS are healthy.

Socket events: `echo:voice:availability` provides `{enabled}`; clients call
`echo:voice:join` with an acknowledgment callback and get `{ok,url,token,
identity,roomId,roundId}` or a harmless error. ECHO requests removal of the
corresponding LiveKit participant at socket disconnect, defeat, or round change.
Self-hosted LiveKit may still allow reuse of an unexpired token; the token TTL
is 60 seconds. This is not intended as a hardened eavesdropping boundary until
server-side proximity subscription enforcement is implemented.

The voice feature has no effect on ECHO/Cat Fighting when unset, and does not
alter the existing Socket.IO path, HTTP routes, or PostgreSQL database.

### Browser voice transport (experimental)

The browser loads `client/voice-transport.js` but does not load LiveKit or
establish WebRTC connections until ECHO advertises voice as enabled. The
pinned local UMD bundle is installed via `scripts/install-client-deps.sh`.
The client subscribes only to players within 800 server-reported world units
(100% gain to 500, then a fade to zero), honors per-round Mute, and starts
publishing the microphone only while push-to-talk is held.

**Security limitation:** client-controlled selective subscriptions are not
a strict privacy boundary. A modified client could subscribe outside 800
units. Implement server-enforced track subscription permissions before claiming
proximity as an anti-eavesdropping guarantee. iOS, VK Mini Apps and APK
microphone permissions must be verified separately on devices.

### VPS Node.js compatibility

At initial setup, the VPS ran Node.js **18.20.8**. The selected
`livekit-server-sdk@2.19.2` advertises Node >=19. To protect existing
ECHO/Cat Fighting, the voice service refuses to enable on Node <20.
Upgrade the **ECHO runtime only** before filling the LiveKit environment.
Do not silently switch the system Node.js runtime for other PM2 services.
