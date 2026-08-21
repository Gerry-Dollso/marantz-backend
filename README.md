# marantz-backend

Companion media backend for marantzPI. The service runs on the media server and exposes the HEOS/TIDAL library operations that are proxied by the Raspberry Pi controller.

## Current marantzPI integration

The Raspberry Pi currently uses these endpoints:

- `GET /api/tidal/search`
- `GET /api/tidal/browse`
- `GET /api/tidal/artist/albums`
- `GET /api/tidal/album/tracks`
- `GET /api/tidal/play`
- `GET /api/tidal/playlist/play`

The backend talks to HEOS on TCP port 1255 and listens for HTTP requests on port 3100.

## Legacy control endpoints

`server.js` still contains older AVR / HEOS control endpoints from the first backend iterations. The current marantzPI controller performs receiver, transport, volume, zone and seek control locally on the Raspberry Pi, so those older backend routes are not part of the active marantzPI request path. They have intentionally been left in place during this conservative housekeeping pass until the cleaned branches have been tested end-to-end.

## Housekeeping policy

Temporary `server.js.before-*`, `server.js.phase-*`, `*.backup-*`, log and environment files are ignored by Git. One-off hard-coded diagnostic scripts were removed because equivalent tests can be run directly when troubleshooting.
