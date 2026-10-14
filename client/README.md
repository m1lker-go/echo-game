# ECHO client prototype

A tiny browser prototype: dark empty world, glowing ghost, camera follow, movement, energy pickups, keyboard controls and a touch joystick.

## Public test page

The intended test URL is:

`https://cat-fight.ru/echo/`

The static page is served from `/var/www/echo-game/client/`. This URL requires the ECHO client files to be pulled onto the VPS and the matching Nginx locations to be added to the existing HTTPS server block. Do not change the Cat Fighting root, API routes, or its Socket.IO endpoint.

## Run locally

Serve this folder with any static web server. For example, from the repository root:

```bash
npx serve client
```

Then open the local URL in a browser. Opening `index.html` directly may work for rendering, but using a local static server is recommended.

## Controls

- Desktop: WASD or arrow keys to move; Space or Shift to dash.
- Touch devices: left virtual joystick and right dash button.
- Walk into tiny glowing points to collect energy.

## Server connection

The ECHO Node.js server listens on port 5002 and exposes a health endpoint at `/health`. In the public site configuration, Nginx should proxy `/echo/socket.io/` to `http://127.0.0.1:5002/socket.io/`. The client uses this dedicated Socket.IO path so it does not share the Cat Fighting Socket.IO endpoint.

The browser client can still move and collect points without a server connection. Multiplayer position handling must also be implemented in the ECHO server before live player synchronization will work.
