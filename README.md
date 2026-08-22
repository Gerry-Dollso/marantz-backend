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

## Semantic control API

The backend also provides a semantic AVR / HEOS control layer intended for orchestration and future voice control:

- `POST /api/control/power?state=on|standby`
- `POST /api/control/source?source=phono|cd|heos|tidal|tv|aux`
- `POST /api/control/volume?action=up|down`
- `POST /api/control/volume?action=set&value=<dB>`
- `POST /api/control/mute?state=on|off|toggle`
- `POST /api/control/transport?action=play|pause|next|previous`

These routes expose user-level intentions rather than raw Marantz commands. Source mappings remain backend policy; for example, `phono` recalls Smart Select 1, which selects the receiver's renamed 8K input rather than the physical PHONO input.

The marantzPI touchscreen continues to perform its existing receiver controls locally. The semantic backend layer is additive and is intended for external orchestration such as voice control.

## Housekeeping policy

Temporary `server.js.before-*`, `server.js.phase-*`, `*.backup-*`, log and environment files are ignored by Git. One-off hard-coded diagnostic scripts were removed because equivalent tests can be run directly when troubleshooting.
