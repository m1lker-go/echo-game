# ECHO client prototype

A tiny browser prototype: dark empty world, glowing ghost, camera follow, movement, energy pickups, keyboard controls and a touch joystick.

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

The existing Socket.IO server is currently on port 5002 and exposes a health endpoint at `/health`. To connect the browser client, its host must be reachable from the device and allow Socket.IO traffic. Before an HTTPS-hosted client can connect, configure a public HTTPS/WSS endpoint for the ECHO server and set `window.ECHO_SERVER_URL` in the page before `game.js` loads. A browser cannot connect to `127.0.0.1` on the VPS by using its own localhost.

The prototype attempts to connect to the page's own origin by default; if the web client is not served from the Socket.IO server's origin, it will show an offline status until the public endpoint is configured. Movement and collecting points remain playable offline.
