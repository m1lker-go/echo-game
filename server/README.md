# ECHO server

Minimal Node.js + Express + Socket.IO server. This is infrastructure only; gameplay logic is not implemented yet.

## Local setup

1. Install Node.js 20+ (Node.js 22 LTS recommended).
2. In this directory run `npm install`.
3. Copy `.env.example` to `.env` and set the PostgreSQL credentials.
4. Run `npm start`.

The server listens on `PORT` (default `3001`). Health check: `GET /health`.

A healthy response includes `"ok": true` and `"database": "connected"`. If the database cannot be reached, the health check returns HTTP 503.

## PostgreSQL separation

Use a dedicated database and account for ECHO (default names: `echo_game_db` and `echo_user`). Do not point `DATABASE_URL` at Cat Fighting's production database.

## Deployment note

Configure the VPS reverse proxy/firewall and PM2 separately from Cat Fighting. Verify that the port is not already occupied before starting this process. Do not commit the real `.env` file.
